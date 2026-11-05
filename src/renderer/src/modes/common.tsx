import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { Card, StudySet } from '@shared/types'
import type { ProgressEvent } from '@lib/progress'
import { useStore } from '../store'
import type { ModeName, Navigate } from '../routes'

export interface ModeProps {
  set: StudySet
  /** Cards available to this session (complete cards, optionally filtered). */
  cards: Card[]
  navigate: Navigate
  /** True when studying a subset of the set (e.g. "study missed terms"). */
  subset: boolean
  /** Start another mode on a subset of cards (e.g. "Study missed terms"). */
  studySubset(mode: ModeName, cardIds: string[]): void
}

export function ModeHeader({
  title,
  set,
  navigate,
  children
}: {
  title: string
  set: StudySet
  navigate: Navigate
  children?: ReactNode
}) {
  return (
    <div className="mode-head">
      <button className="link-btn" onClick={() => navigate({ name: 'set', setId: set.id })}>
        ← {set.title || 'Untitled set'}
      </button>
      <h1 className="mode-head-title">{title}</h1>
      <div className="mode-head-extra">{children}</div>
    </div>
  )
}

/**
 * Collects per-card progress events and writes them in batches (every 15
 * events and when the mode closes) so large sets aren't rewritten on every answer.
 */
export function useProgress(setId: string): { push(ev: ProgressEvent | ProgressEvent[]): void; flush(): void } {
  const { recordProgress } = useStore()
  const queue = useRef<ProgressEvent[]>([])
  const flush = useCallback(() => {
    if (queue.current.length === 0) return
    const events = queue.current
    queue.current = []
    recordProgress(setId, events)
  }, [recordProgress, setId])
  const push = useCallback(
    (ev: ProgressEvent | ProgressEvent[]) => {
      queue.current.push(...(Array.isArray(ev) ? ev : [ev]))
      if (queue.current.length >= 15) flush()
    },
    [flush]
  )
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => flushRef.current(), [])
  return { push, flush }
}

export function MissedList({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return <p className="muted">No missed terms — nice work!</p>
  return (
    <ul className="missed-list">
      {cards.map((c) => (
        <li key={c.id}>
          <strong>{c.term}</strong>
          <span>{c.definition}</span>
        </li>
      ))}
    </ul>
  )
}
