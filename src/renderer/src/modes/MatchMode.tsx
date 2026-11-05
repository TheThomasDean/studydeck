import { useRef, useState } from 'react'
import { addMatchTime } from '@lib/progress'
import { createMatchTiles, formatMs, isMatchingPair, MATCH_PAIRS, MATCH_PENALTY_MS, type MatchTile } from '@lib/match'
import { useStore } from '../store'
import { useElapsed, useReducedMotion } from '../hooks'
import { play } from '../sound'
import { ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'ready' | 'playing' | 'done'

export function MatchMode({ set, cards, navigate }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('ready')
  const [tiles, setTiles] = useState<MatchTile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [clearing, setClearing] = useState<Set<string>>(new Set())
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [shaking, setShaking] = useState<Set<string>>(new Set())
  const [penalty, setPenalty] = useState(0)
  const [startAt, setStartAt] = useState<number | null>(null)
  const [final, setFinal] = useState<{ ms: number; isBest: boolean; previousBest: number | null } | null>(null)
  const missed = useRef(new Set<string>())
  const busy = useRef(false)
  const clearedRef = useRef(new Set<string>())
  const penaltyRef = useRef(0)
  const elapsed = useElapsed(startAt, phase === 'playing')

  const pairs = Math.min(MATCH_PAIRS, cards.length)

  const start = () => {
    setTiles(createMatchTiles(cards, MATCH_PAIRS))
    setSelected(null)
    setCleared(new Set())
    setClearing(new Set())
    setShaking(new Set())
    setPenalty(0)
    setFinal(null)
    missed.current = new Set()
    clearedRef.current = new Set()
    penaltyRef.current = 0
    busy.current = false
    setStartAt(performance.now())
    setPhase('playing')
  }

  const finish = (penaltyMs: number, endAt: number) => {
    const ms = Math.round(endAt - (startAt ?? endAt) + penaltyMs)
    let outcome = { ms, isBest: false, previousBest: set.history.bestMatchMs }
    updateSet(set.id, (s) => {
      const r = addMatchTime(s, ms)
      outcome = { ms, isBest: r.isBest, previousBest: r.previousBest }
      return r.set
    })
    setFinal(outcome)
    setPhase('done')
    progress.flush()
    play('win')
  }

  const clickTile = (tile: MatchTile) => {
    if (phase !== 'playing' || busy.current || clearedRef.current.has(tile.id)) return
    if (selected === null) {
      setSelected(tile.id)
      play('click')
      return
    }
    if (selected === tile.id) {
      setSelected(null)
      return
    }
    const first = tiles.find((t) => t.id === selected)!
    setSelected(null)
    if (isMatchingPair(first, tile)) {
      play('pop')
      progress.push({ cardId: tile.cardId, correct: !missed.current.has(tile.cardId) })
      const ids = new Set([first.id, tile.id])
      setClearing((c) => new Set([...c, ...ids]))
      ids.forEach((id) => clearedRef.current.add(id))
      const allDone = clearedRef.current.size === tiles.length
      const endAt = performance.now()
      window.setTimeout(
        () => {
          setClearing((c) => {
            const n = new Set(c)
            ids.forEach((id) => n.delete(id))
            return n
          })
          setCleared(new Set(clearedRef.current))
          if (allDone) finish(penaltyRef.current, endAt)
        },
        reduced ? 0 : 280
      )
    } else {
      play('wrong')
      missed.current.add(first.cardId)
      missed.current.add(tile.cardId)
      penaltyRef.current += MATCH_PENALTY_MS
      setPenalty(penaltyRef.current)
      const ids = new Set([first.id, tile.id])
      setShaking(ids)
      busy.current = true
      window.setTimeout(() => {
        setShaking(new Set())
        busy.current = false
      }, reduced ? 150 : 450)
    }
  }

  const best = set.history.bestMatchMs

  return (
    <div className="page mode-page">
      <ModeHeader title="Match" set={set} navigate={navigate}>
        {phase === 'playing' && (
          <span className="timer" aria-live="off">
            ⏱ {formatMs(elapsed + penalty)}
            {penalty > 0 && <span className="penalty"> (+{penalty / 1000}s)</span>}
          </span>
        )}
      </ModeHeader>

      {phase === 'ready' && (
        <div className="panel center-panel">
          <h2>Ready to play?</h2>
          <p>
            Match all {pairs} terms with their definitions as fast as you can. Wrong pairs add a {MATCH_PENALTY_MS / 1000}-second penalty.
          </p>
          {best !== null && <p className="muted">Your best time: {formatMs(best)}</p>}
          <button className="btn primary big" onClick={start} autoFocus>
            Start game
          </button>
        </div>
      )}

      {phase === 'playing' && (
        <ul className={`match-grid tiles-${tiles.length}`}>
          {tiles.map((t) => {
            const isCleared = cleared.has(t.id)
            return (
              <li key={t.id}>
                <button
                  className={`match-tile ${selected === t.id ? 'selected' : ''} ${clearing.has(t.id) ? 'clearing' : ''} ${shaking.has(t.id) ? 'shake' : ''} ${isCleared ? 'cleared' : ''}`}
                  onClick={() => clickTile(t)}
                  disabled={isCleared}
                  aria-hidden={isCleared}
                  aria-pressed={selected === t.id}
                  tabIndex={isCleared ? -1 : 0}
                >
                  {t.text}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {phase === 'done' && final && (
        <div className="panel center-panel">
          <h2>{final.isBest ? (final.previousBest === null ? 'First record set!' : 'New best time!') : 'All matched!'}</h2>
          <p className="big-number">{formatMs(final.ms)}</p>
          {final.previousBest !== null && (
            <p className="muted">
              {final.isBest
                ? `Previous best: ${formatMs(final.previousBest)} — you beat it by ${formatMs(final.previousBest - final.ms)}.`
                : `Best time: ${formatMs(final.previousBest)} (${formatMs(final.ms - final.previousBest)} slower).`}
            </p>
          )}
          {penalty > 0 && <p className="muted small">Includes {penalty / 1000}s of penalties.</p>}
          <button className="btn primary big" onClick={start} autoFocus>
            Play again
          </button>
        </div>
      )}
    </div>
  )
}
