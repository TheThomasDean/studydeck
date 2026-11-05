import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import {
  buildWave,
  catchPoints,
  isStreakBonus,
  pickTarget,
  REEL_MS,
  RUN_SECONDS,
  SLOWMO_FACTOR,
  SLOWMO_SECONDS,
  SNAP_PENALTY_S,
  SNAP_SHOW_MS,
  summarizeCatches,
  type CatchRecord,
  type Fish,
  type MissMap,
  type Wave
} from '@lib/deepDive'
import { shuffle } from '@lib/random'
import { useStore } from '../store'
import { useKeydown, useReducedMotion } from '../hooks'
import { play } from '../sound'
import { ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'ready' | 'playing' | 'done'
type WaveStatus = 'live' | 'reeling' | 'snapped'

/** Pixels per second at speed 1.0. */
const SWIM_SPEED = 70
const FISH_COLORS = ['#5ab0ff', '#ff8a65', '#7ed492', '#c792ea', '#ffd166', '#4dd0e1']

export function DeepDiveMode({ set, cards, navigate, studySubset }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const reduced = useReducedMotion()
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const [phase, setPhase] = useState<Phase>('ready')
  const [wave, setWave] = useState<Wave | null>(null)
  const [status, setStatus] = useState<WaveStatus>('live')
  const [hooked, setHooked] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [timeLeft, setTimeLeft] = useState(RUN_SECONDS)
  const [penalty, setPenalty] = useState(0)
  const [note, setNote] = useState<{ id: number; text: string } | null>(null)
  const [slowmo, setSlowmo] = useState(false)
  const [records, setRecords] = useState<CatchRecord[]>([])
  const [newBest, setNewBest] = useState(false)
  const [finalScore, setFinalScore] = useState(0)

  const lakeRef = useRef<HTMLDivElement>(null)
  const fishEls = useRef(new Map<string, HTMLDivElement>())
  const runMisses = useRef<MissMap>({})
  const lastTarget = useRef<string | null>(null)
  const swimTime = useRef(0)
  const slowUntil = useRef(0)
  const startAt = useRef(0)
  const penaltyRef = useRef(0)
  const scoreRef = useRef(0)
  const streakRef = useRef(0)
  const statusRef = useRef<WaveStatus>('live')
  const waveRef = useRef<Wave | null>(null)
  const timers = useRef<number[]>([])
  const ended = useRef(false)
  waveRef.current = wave
  statusRef.current = status

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const flash = (text: string) => setNote({ id: Date.now() + Math.random(), text })

  const nextWave = () => {
    const target = pickTarget(cards, runMisses.current, lastTarget.current)
    lastTarget.current = target.id
    swimTime.current = 0
    setHooked(null)
    setStatus('live')
    statusRef.current = 'live'
    setWave(buildWave(cards, target, runMisses.current))
  }

  const start = () => {
    runMisses.current = {}
    lastTarget.current = null
    penaltyRef.current = 0
    scoreRef.current = 0
    streakRef.current = 0
    slowUntil.current = 0
    ended.current = false
    setScore(0)
    setStreak(0)
    setBestStreak(0)
    setPenalty(0)
    setRecords([])
    setNewBest(false)
    setTimeLeft(RUN_SECONDS)
    startAt.current = performance.now()
    setPhase('playing')
    nextWave()
  }

  const finish = () => {
    if (ended.current) return
    ended.current = true
    timers.current.forEach(clearTimeout)
    timers.current = []
    const total = scoreRef.current
    setFinalScore(total)
    setNewBest(total > set.history.deepDiveBest)
    updateSet(set.id, (s) => ({
      ...s,
      lastStudied: Date.now(),
      history: { ...s.history, deepDiveBest: Math.max(s.history.deepDiveBest ?? 0, total) }
    }))
    progress.flush()
    setPhase('done')
    play('win')
  }

  // Countdown (real time, minus snap penalties). The run ends when it hits zero,
  // but a catch that's already reeling in is allowed to land first.
  useEffect(() => {
    if (phase !== 'playing') return
    const id = setInterval(() => {
      const elapsed = (performance.now() - startAt.current) / 1000
      const left = Math.max(0, RUN_SECONDS - elapsed - penaltyRef.current)
      setTimeLeft(left)
      if (performance.now() > slowUntil.current) setSlowmo(false)
      if (left <= 0 && statusRef.current === 'live') finish()
    }, 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Smooth swimming: move fish with transforms on every animation frame.
  useEffect(() => {
    if (phase !== 'playing') return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const factor = statusRef.current === 'live' ? (now < slowUntil.current ? SLOWMO_FACTOR : 1) : 0.15
      swimTime.current += dt * factor * (reduced ? 0.6 : 1)
      const lake = lakeRef.current
      const w = waveRef.current
      if (lake && w) {
        const width = lake.clientWidth
        for (const f of w.fish) {
          const el = fishEls.current.get(f.id)
          if (!el || el.dataset.hooked === 'true') continue
          const fw = el.offsetWidth
          const span = width + fw
          const travel = f.dir * f.speed * SWIM_SPEED * swimTime.current
          const x = (((f.start * span + travel) % span) + span) % span - fw
          el.style.transform = `translate3d(${x}px, 0, 0)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, reduced])

  const hook = (fish: Fish) => {
    if (phase !== 'playing' || statusRef.current !== 'live' || !waveRef.current) return
    const target = waveRef.current.target
    if (fish.correct) {
      statusRef.current = 'reeling'
      setStatus('reeling')
      setHooked(fish.id)
      const nextStreak = streakRef.current + 1
      streakRef.current = nextStreak
      setStreak(nextStreak)
      setBestStreak((b) => Math.max(b, nextStreak))
      const pts = catchPoints(fish.rare, nextStreak)
      scoreRef.current += pts
      setScore(scoreRef.current)
      setRecords((r) => [...r, { cardId: target.id, correct: true, rare: fish.rare }])
      progress.push({ cardId: target.id, correct: true })
      play(fish.rare ? 'win' : 'correct')
      if (isStreakBonus(nextStreak)) {
        slowUntil.current = performance.now() + SLOWMO_SECONDS * 1000
        setSlowmo(true)
        flash(`${nextStreak} in a row! +${pts} · fish slow down`)
      } else flash(`+${pts}${fish.rare ? ' rare catch!' : ''}`)
      // Reel the fish up to the hook.
      const el = fishEls.current.get(fish.id)
      const lake = lakeRef.current
      if (el && lake) {
        el.dataset.hooked = 'true'
        const lakeBox = lake.getBoundingClientRect()
        const elBox = el.getBoundingClientRect()
        const dx = lakeBox.left + lakeBox.width / 2 - elBox.width / 2 - lakeBox.left
        const dy = -(elBox.top - lakeBox.top) - elBox.height * 0.4
        el.style.transition = `transform ${reduced ? 150 : REEL_MS - 100}ms cubic-bezier(0.5, -0.2, 0.6, 1)`
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(0.6)`
      }
      later(() => {
        const elapsed = (performance.now() - startAt.current) / 1000
        if (RUN_SECONDS - elapsed - penaltyRef.current <= 0) finish()
        else nextWave()
      }, reduced ? 250 : REEL_MS)
    } else {
      statusRef.current = 'snapped'
      setStatus('snapped')
      setHooked(fish.id)
      streakRef.current = 0
      setStreak(0)
      penaltyRef.current += SNAP_PENALTY_S
      setPenalty(penaltyRef.current)
      runMisses.current = { ...runMisses.current, [target.id]: (runMisses.current[target.id] ?? 0) + 1 }
      setRecords((r) => [...r, { cardId: target.id, correct: false, rare: false }])
      progress.push({ cardId: target.id, correct: false })
      play('wrong')
      flash(`Snap! −${SNAP_PENALTY_S}s`)
      later(() => {
        const elapsed = (performance.now() - startAt.current) / 1000
        if (RUN_SECONDS - elapsed - penaltyRef.current <= 0) finish()
        else nextWave()
      }, reduced ? 700 : SNAP_SHOW_MS)
    }
  }

  useKeydown(
    (e) => {
      if (phase !== 'playing' || !wave) return
      const n = Number(e.key)
      if (n >= 1 && n <= wave.fish.length) {
        e.preventDefault()
        hook(wave.fish[n - 1])
      }
    },
    [phase, wave]
  )

  /* ---------------- Ready ---------------- */
  if (phase === 'ready') {
    const weak = cards.filter((c) => (c.timesMissed ?? 0) > 0).length
    return (
      <div className="page mode-page">
        <ModeHeader title="Deep Dive" set={set} navigate={navigate} />
        <div className="panel center-panel">
          <div className="dd-intro-art" aria-hidden="true">
            <FishSvg color="#5ab0ff" />
            <FishSvg color="#ffd166" rare />
          </div>
          <h2>Go fishing for answers</h2>
          <p>
            A term hangs from your line. Click the fish carrying its definition (or press its number). Wrong fish snap the line and cost {SNAP_PENALTY_S}{' '}
            seconds. You have {RUN_SECONDS} seconds.
          </p>
          <p className="muted">
            Glowing <strong>rare fish</strong> carry definitions of cards you've missed before. They're worth extra points and turn up more often until you know them.
            {weak > 0 ? ` This set has ${weak} card${weak === 1 ? '' : 's'} you've missed.` : ''}
          </p>
          {set.history.deepDiveBest > 0 && <p className="muted">Best score: {set.history.deepDiveBest}</p>}
          <button className="btn primary big" onClick={start} autoFocus>
            Cast off
          </button>
        </div>
      </div>
    )
  }

  /* ---------------- Aquarium summary ---------------- */
  if (phase === 'done') {
    const summary = summarizeCatches(records)
    const missed = summary.filter((s) => s.missed).map((s) => byId.get(s.cardId)!).filter(Boolean)
    const caught = records.filter((r) => r.correct).length
    return (
      <div className="page mode-page">
        <ModeHeader title="Deep Dive" set={set} navigate={navigate} />
        <div className="panel center-panel dd-summary">
          <h2>{newBest ? 'New best score!' : 'Time’s up — here’s your aquarium'}</h2>
          <p className="big-number">{finalScore}</p>
          <div className="summary-stats">
            <div className="stat good">
              <span className="stat-num">{caught}</span>Fish caught
            </div>
            <div className="stat">
              <span className="stat-num">{bestStreak}</span>Best streak
            </div>
            <div className="stat warn">
              <span className="stat-num">{missed.length}</span>Missed terms
            </div>
            <div className="stat">
              <span className="stat-num">{Math.max(finalScore, set.history.deepDiveBest)}</span>Best score
            </div>
          </div>
          <Aquarium entries={summary} byId={byId} />
          <h3>Missed terms</h3>
          {missed.length === 0 ? (
            <p className="muted">Nothing got away — every catch was clean.</p>
          ) : (
            <ul className="missed-list">
              {missed.map((c) => (
                <li key={c.id}>
                  <strong>{c.term}</strong>
                  <span>{c.definition}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row gap center wrap">
            <button className="btn primary" onClick={start} autoFocus>
              Play again
            </button>
            {missed.length > 0 && (
              <button className="btn" onClick={() => studySubset('learn', missed.map((c) => c.id))}>
                Study missed terms in Learn
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Playing ---------------- */
  const pct = (timeLeft / RUN_SECONDS) * 100
  return (
    <div className="page mode-page">
      <ModeHeader title="Deep Dive" set={set} navigate={navigate}>
        <span className="score-pill">Score {score}</span>
      </ModeHeader>
      <div className="dd-hud">
        <div className="countdown-track">
          <div className={`countdown-fill ${timeLeft < 15 ? 'urgent' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`countdown-text ${timeLeft < 15 ? 'urgent' : ''}`}>
          {Math.ceil(timeLeft)}s{penalty > 0 && <span className="penalty"> (−{penalty}s)</span>}
        </span>
        <span className={`dd-streak ${streak >= 3 ? 'hot' : ''}`}>🔥 {streak}</span>
        {slowmo && <span className="dd-slowmo">🐢 Slow-mo</span>}
      </div>

      <div className={`dd-scene ${status === 'snapped' ? 'snapped' : ''}`}>
        <div className="dd-sky">
          <svg className="dd-boat" viewBox="0 0 160 70" aria-hidden="true">
            <path d="M10 40 L150 40 L130 62 L30 62 Z" className="boat-hull" />
            <rect x="60" y="22" width="34" height="18" rx="3" className="boat-cabin" />
            <line x1="98" y1="40" x2="128" y2="4" className="boat-rod" />
          </svg>
        </div>
        <div className="dd-line" aria-hidden="true" />
        {wave && (
          <div className="dd-term" aria-live="polite">
            <span className="q-label">Catch the definition of</span>
            <strong title={wave.target.term}>{wave.target.term}</strong>
          </div>
        )}
        <div className="dd-lake" ref={lakeRef} style={{ height: `calc(${Math.max(3, wave?.fish.length ?? 4)} * var(--lane-h) + 110px)` }}>
          {wave?.fish.map((f, i) => {
            const isHooked = hooked === f.id
            const reveal = status === 'snapped' && f.correct
            const snappedOn = status === 'snapped' && isHooked
            return (
              <div
                key={f.id}
                ref={(el) => {
                  if (el) fishEls.current.set(f.id, el)
                  else fishEls.current.delete(f.id)
                }}
                className={`fish ${f.rare ? 'rare' : ''} ${reveal ? 'reveal' : ''} ${snappedOn ? 'wrong' : ''} ${isHooked && status === 'reeling' ? 'hooked' : ''} ${
                  status !== 'live' && !isHooked && !reveal ? 'faded' : ''
                }`}
                style={{
                  top: `calc(${f.lane} * var(--lane-h) + 8px)`,
                  width: fishWidth(f.text, f.rare),
                  height: f.text.length > 50 ? (f.rare ? 96 : 88) : undefined
                }}
                role="button"
                tabIndex={0}
                aria-label={`Fish ${i + 1}${f.rare ? ', rare' : ''}: ${f.text}`}
                title={f.text}
                onPointerDown={(e) => {
                  e.preventDefault()
                  hook(f)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    hook(f)
                  }
                }}
              >
                <FishSvg color={FISH_COLORS[f.lane % FISH_COLORS.length]} rare={f.rare} flip={f.dir === 1} />
                <span className="fish-num">{i + 1}</span>
                <span className="fish-text">{f.text}</span>
              </div>
            )
          })}
          {note && (
            <div key={note.id} className="float-note dd-note">
              {note.text}
            </div>
          )}
        </div>
      </div>
      {status === 'snapped' && wave && (
        <p className="dd-reveal" role="status">
          <strong>{wave.target.term}</strong> → {wave.target.definition}
        </p>
      )}
      <p className="muted small center-text">Click or tap a fish · keys 1–{wave?.fish.length ?? 4} hook a fish · hover a fish to read long text</p>
    </div>
  )
}

/** Fish grow with their label so text stays readable; very long labels are clamped (full text on hover). */
function fishWidth(text: string, rare: boolean): string {
  const base = Math.min(300, Math.max(150, 70 + text.length * 6.5))
  return `${Math.round(base * (rare ? 1.15 : 1))}px`
}

function FishSvg({ color, rare = false, flip = false }: { color: string; rare?: boolean; flip?: boolean }) {
  return (
    <svg className={`fish-svg ${flip ? 'flip' : ''}`} viewBox="0 0 200 90" preserveAspectRatio="none" aria-hidden="true">
      {rare && <ellipse cx="95" cy="45" rx="98" ry="44" className="fish-glow" />}
      <path d="M160 45 L198 12 L190 45 L198 78 Z" fill={rare ? '#ffb703' : color} className="fish-tail" />
      <ellipse cx="88" cy="45" rx="80" ry="38" fill={rare ? '#ffd166' : color} className="fish-body" />
      <ellipse cx="88" cy="47" rx="64" ry="27" className="fish-belly" />
      <circle cx="26" cy="36" r="5" className="fish-eye" />
      {rare && <path d="M150 10 l3 7 7 1 -5 5 1 7 -6 -4 -6 4 1 -7 -5 -5 7 -1z" className="fish-star" />}
    </svg>
  )
}

function Aquarium({ entries, byId }: { entries: { cardId: string; missed: boolean; catches: number }[]; byId: Map<string, Card> }) {
  // Stable random placement per render of the summary.
  // Spread fish over a loose grid (with a little jitter) so labels don't pile up.
  const placed = useMemo(() => {
    const list = shuffle(entries)
    const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(list.length * 1.8))))
    const rows = Math.max(1, Math.ceil(list.length / cols))
    return list.map((e, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      return {
        ...e,
        left: ((col + 0.15 + Math.random() * 0.3) / cols) * 88 + 2,
        top: ((row + 0.1 + Math.random() * 0.25) / rows) * 72 + 4,
        delay: (i % 7) * 0.4,
        color: FISH_COLORS[i % FISH_COLORS.length]
      }
    })
  }, [entries])
  if (placed.length === 0) return <div className="aquarium empty-tank">No fish this time — cast off again!</div>
  return (
    <div className="aquarium" role="img" aria-label={`${entries.filter((e) => !e.missed).length} cards caught cleanly, ${entries.filter((e) => e.missed).length} missed`}>
      {placed.map((e) => (
        <div
          key={e.cardId}
          className={`tank-fish ${e.missed ? 'thrash' : 'calm'}`}
          style={{ left: `${e.left}%`, top: `${e.top}%`, animationDelay: `${e.delay}s` }}
          title={`${byId.get(e.cardId)?.term} — ${byId.get(e.cardId)?.definition}`}
        >
          <FishSvg color={e.missed ? '#ef476f' : e.color} flip={e.left < 45} />
          <span className="tank-label">{byId.get(e.cardId)?.term}</span>
        </div>
      ))}
      <div className="tank-legend">
        <span>🐟 small &amp; calm = known</span>
        <span>🐠 big &amp; thrashing = missed</span>
      </div>
    </div>
  )
}
