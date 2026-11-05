import { useEffect, useMemo, useRef, useState } from 'react'
import { isAnswerCorrect, firstLetterHint } from '@lib/grading'
import {
  createLockChallenges,
  escapeBonus,
  LOCK_DIFFICULTIES,
  LOCK_HINT_AFTER,
  LOCK_WRONG_PENALTY_S,
  lockPoints,
  timeLeft,
  type LockAnswerSide,
  type LockChallenge,
  type LockDifficulty
} from '@lib/lock'
import { useStore } from '../store'
import { useReducedMotion } from '../hooks'
import { play } from '../sound'
import { MissedList, ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'setup' | 'playing' | 'won' | 'lost'

interface LockState {
  wrongs: number
  hint: boolean
  opened: boolean
  points: number
}

export function LockMode({ set, cards, navigate, studySubset }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('setup')
  const [difficulty, setDifficulty] = useState<LockDifficulty>('normal')
  const [side, setSide] = useState<LockAnswerSide>('term')
  const [challenges, setChallenges] = useState<LockChallenge[]>([])
  const [locks, setLocks] = useState<LockState[]>([])
  const [current, setCurrent] = useState(0)
  const [input, setInput] = useState('')
  const [penalty, setPenalty] = useState(0)
  const [startAt, setStartAt] = useState(0)
  const [now, setNow] = useState(0)
  const [lockStartAt, setLockStartAt] = useState(0)
  const [jammed, setJammed] = useState(false)
  const [opening, setOpening] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [endElapsed, setEndElapsed] = useState(0)
  const [bonus, setBonus] = useState(0)
  const [newBest, setNewBest] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const ended = useRef(false)

  const config = LOCK_DIFFICULTIES[difficulty]
  const elapsedS = (now - startAt) / 1000
  const remaining = timeLeft(config.seconds, elapsedS, penalty)

  // Countdown ticker.
  useEffect(() => {
    if (phase !== 'playing') return
    const id = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(id)
  }, [phase])

  // Time's up.
  useEffect(() => {
    if (phase === 'playing' && remaining <= 0 && opening === null) finish(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remaining, opening])

  const start = () => {
    const ch = createLockChallenges(cards, config.locks, side)
    const t = performance.now()
    setChallenges(ch)
    setLocks(ch.map(() => ({ wrongs: 0, hint: false, opened: false, points: 0 })))
    setCurrent(0)
    setInput('')
    setPenalty(0)
    setStartAt(t)
    setNow(t)
    setLockStartAt(t)
    setScore(0)
    setBonus(0)
    setNewBest(false)
    setOpening(null)
    setJammed(false)
    ended.current = false
    setPhase('playing')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const finish = (won: boolean, finalLocks = locks, finalScore = score) => {
    if (ended.current) return
    ended.current = true
    const t = performance.now()
    const elapsed = (t - startAt) / 1000
    setNow(t)
    setEndElapsed(elapsed)
    const escape = won ? escapeBonus(timeLeft(config.seconds, elapsed, penalty)) : 0
    const total = finalScore + escape
    setBonus(escape)
    setScore(total)
    // Progress: a lock counts as correct only if opened with no wrong answers.
    progress.push(challenges.map((c, i) => ({ cardId: c.cardId, correct: finalLocks[i].opened && finalLocks[i].wrongs === 0 })))
    progress.flush()
    const best = total > set.history.lockBestScore
    setNewBest(best)
    updateSet(set.id, (s) => ({
      ...s,
      lastStudied: Date.now(),
      history: { ...s.history, lockBestScore: Math.max(s.history.lockBestScore, total) }
    }))
    setPhase(won ? 'won' : 'lost')
    play(won ? 'win' : 'wrong')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (phase !== 'playing' || jammed || opening !== null || !input.trim()) return
    const ch = challenges[current]
    const lock = locks[current]
    if (isAnswerCorrect(input, ch.answer)) {
      const secondsOnLock = (performance.now() - lockStartAt) / 1000
      const pts = lockPoints(secondsOnLock, lock.hint)
      const nextLocks = locks.map((l, i) => (i === current ? { ...l, opened: true, points: pts } : l))
      const nextScore = score + pts
      setLocks(nextLocks)
      setScore(nextScore)
      setInput('')
      setOpening(current)
      play('correct')
      setTimeout(
        () => {
          setOpening(null)
          if (current + 1 >= challenges.length) finish(true, nextLocks, nextScore)
          else {
            setCurrent(current + 1)
            setLockStartAt(performance.now())
            setTimeout(() => inputRef.current?.focus(), 0)
          }
        },
        reduced ? 150 : 700
      )
    } else {
      const wrongs = lock.wrongs + 1
      setLocks(locks.map((l, i) => (i === current ? { ...l, wrongs, hint: l.hint || wrongs >= LOCK_HINT_AFTER } : l)))
      setPenalty((p) => p + LOCK_WRONG_PENALTY_S)
      setJammed(true)
      play('wrong')
      setTimeout(
        () => {
          setJammed(false)
          inputRef.current?.focus()
          inputRef.current?.select()
        },
        reduced ? 200 : 600
      )
    }
  }

  const missedCards = useMemo(() => {
    const ids = new Set<string>()
    challenges.forEach((c, i) => {
      if (!locks[i]?.opened || locks[i].wrongs > 0) ids.add(c.cardId)
    })
    return cards.filter((c) => ids.has(c.id))
  }, [challenges, locks, cards])

  if (phase === 'setup') {
    return (
      <div className="page mode-page">
        <ModeHeader title="Lock" set={set} navigate={navigate} />
        <div className="panel form setup">
          <h2>Escape the vault</h2>
          <p>
            Open every lock by typing the right answer before time runs out. A wrong answer costs {LOCK_WRONG_PENALTY_S} seconds and jams the lock; after{' '}
            {LOCK_HINT_AFTER} wrong answers you get the first letter as a hint.
          </p>
          <fieldset className="fieldset">
            <legend>Difficulty</legend>
            {(Object.keys(LOCK_DIFFICULTIES) as LockDifficulty[]).map((d) => (
              <label key={d} className="radio-row">
                <input type="radio" name="difficulty" checked={difficulty === d} onChange={() => setDifficulty(d)} />
                <span>
                  <strong>{LOCK_DIFFICULTIES[d].label}</strong>{' '}
                  <span className="muted">
                    · {LOCK_DIFFICULTIES[d].locks} locks, {LOCK_DIFFICULTIES[d].seconds} seconds
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field inline">
            <span>Type the</span>
            <select value={side} onChange={(e) => setSide(e.target.value as LockAnswerSide)}>
              <option value="term">Term (you see the definition)</option>
              <option value="definition">Definition (you see the term)</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          {set.history.lockBestScore > 0 && <p className="muted">Best score: {set.history.lockBestScore}</p>}
          <button className="btn primary big" onClick={start} autoFocus>
            Start
          </button>
        </div>
      </div>
    )
  }

  const vault = (
    <div className={`vault ${phase === 'won' ? 'vault-open' : ''}`} aria-label={`${locks.filter((l) => l.opened).length} of ${locks.length} locks open`} role="img">
      {challenges.map((_, i) => {
        const l = locks[i]
        const state = l?.opened ? (opening === i ? 'opening' : 'open') : i === current && phase === 'playing' ? (jammed ? 'jammed active' : 'active') : 'shut'
        return (
          <div key={i} className={`lock ${state}`}>
            <svg viewBox="0 0 60 80" aria-hidden="true">
              <path className="shackle" d="M16 34 V22 a14 14 0 0 1 28 0 V34" />
              <rect className="lock-body" x="6" y="32" width="48" height="44" rx="8" />
              <g className="dial">
                <circle cx="30" cy="54" r="13" className="dial-face" />
                {Array.from({ length: 12 }, (_, t) => (
                  <line key={t} x1="30" y1="42.5" x2="30" y2="45" transform={`rotate(${t * 30} 30 54)`} className="dial-tick" />
                ))}
                <line x1="30" y1="54" x2="30" y2="45.5" className="dial-hand" />
              </g>
            </svg>
            <span className="lock-num">{l?.opened ? '✓' : i + 1}</span>
          </div>
        )
      })}
    </div>
  )

  if (phase === 'won' || phase === 'lost') {
    const hintsUsed = locks.filter((l) => l.hint).length
    const openedCount = locks.filter((l) => l.opened).length
    return (
      <div className="page mode-page">
        <ModeHeader title="Lock" set={set} navigate={navigate} />
        <div className="panel center-panel">
          {vault}
          <h2>{phase === 'won' ? 'You escaped the vault!' : 'Time’s up — the vault stays shut.'}</h2>
          <p className="big-number">{score}</p>
          {newBest && <p className="good-text">New best score!</p>}
          <div className="summary-stats">
            <div className="stat">
              <span className="stat-num">{Math.min(endElapsed, config.seconds).toFixed(1)}s</span>Time taken
            </div>
            <div className="stat">
              <span className="stat-num">+{penalty}s</span>Penalties
            </div>
            <div className="stat">
              <span className="stat-num">{hintsUsed}</span>Hints used
            </div>
            <div className="stat">
              <span className="stat-num">
                {openedCount}/{locks.length}
              </span>
              Locks open
            </div>
          </div>
          {bonus > 0 && <p className="muted small">Includes an escape bonus of {bonus} for time left.</p>}
          <h3>Missed terms</h3>
          <MissedList cards={missedCards} />
          <div className="row gap center wrap">
            <button className="btn primary" onClick={start} autoFocus>
              Play again
            </button>
            <button className="btn" onClick={() => setPhase('setup')}>
              Change difficulty
            </button>
            {missedCards.length > 0 && (
              <button className="btn" onClick={() => studySubset('flashcards', missedCards.map((c) => c.id))}>
                Study missed terms
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const ch = challenges[current]
  const lock = locks[current]
  const timePct = (remaining / config.seconds) * 100
  const penaltyPct = Math.min(100 - timePct, (penalty / config.seconds) * 100)

  return (
    <div className="page mode-page">
      <ModeHeader title="Lock" set={set} navigate={navigate}>
        <span className="score-pill">Score {score}</span>
      </ModeHeader>
      <div className="countdown" aria-label={`${Math.ceil(remaining)} seconds left`}>
        <div className="countdown-track">
          <div className={`countdown-fill ${remaining < 15 ? 'urgent' : ''}`} style={{ width: `${timePct}%` }} />
          {penalty > 0 && <div className="countdown-penalty" style={{ width: `${penaltyPct}%`, left: `${timePct}%` }} />}
        </div>
        <span className={`countdown-text ${remaining < 15 ? 'urgent' : ''}`}>
          {Math.ceil(remaining)}s{penalty > 0 && <span className="penalty"> (−{penalty}s penalty)</span>}
        </span>
      </div>
      {vault}
      <form className={`panel lock-question ${jammed ? 'shake' : ''}`} onSubmit={submit}>
        <p className="q-label">
          Lock {current + 1} of {challenges.length} · type the {ch.answerSide}
        </p>
        <p className="q-prompt">{ch.prompt}</p>
        {lock.hint && (
          <p className="hint" aria-live="polite">
            Hint: <span className="mono">{firstLetterHint(ch.answer)}</span>
          </p>
        )}
        <div className="row gap">
          <input
            ref={inputRef}
            className="big-input grow"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            readOnly={jammed || opening !== null}
            aria-label={`Type the ${ch.answerSide}`}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn primary" type="submit" disabled={jammed || opening !== null || !input.trim()}>
            Unlock
          </button>
        </div>
        <p className="muted small" aria-live="polite">
          {jammed ? `Jammed! −${LOCK_WRONG_PENALTY_S} seconds.` : lock.wrongs > 0 ? `${lock.wrongs} wrong ${lock.wrongs === 1 ? 'try' : 'tries'} on this lock.` : 'Press Enter to try the lock.'}
        </p>
      </form>
    </div>
  )
}
