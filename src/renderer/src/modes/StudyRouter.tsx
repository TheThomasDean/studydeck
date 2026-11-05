import { useMemo } from 'react'
import { studyableCards } from '@lib/sets'
import { useStore } from '../store'
import type { Navigate, Route } from '../routes'
import type { ModeProps } from './common'
import { Flashcards } from './Flashcards'
import { TestMode } from './TestMode'
import { MatchMode } from './MatchMode'
import { CharmsMode } from './CharmsMode'
import { LockMode } from './LockMode'
import { LearnMode } from './LearnMode'
import { DeepDiveMode } from './DeepDiveMode'

export function StudyRouter({ route, navigate }: { route: Extract<Route, { name: 'study' }>; navigate: Navigate }) {
  const { getSet } = useStore()
  const set = getSet(route.setId)

  // Freeze the card list for the session (progress updates must not reshuffle a game).
  const cards = useMemo(() => {
    if (!set) return []
    const usable = studyableCards(set.cards)
    if (!route.cardIds) return usable
    const wanted = new Set(route.cardIds)
    return usable.filter((c) => wanted.has(c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.setId, route.cardIds, !!set])

  if (!set) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Set not found</h2>
          <button className="btn" onClick={() => navigate({ name: 'library' })}>
            Back to library
          </button>
        </div>
      </div>
    )
  }
  if (cards.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <h2>No cards to study</h2>
          <p>Add cards with both a term and a definition first.</p>
          <button className="btn primary" onClick={() => navigate({ name: 'edit', setId: set.id })}>
            Edit set
          </button>
        </div>
      </div>
    )
  }

  const props: ModeProps = {
    set,
    cards,
    navigate,
    subset: !!route.cardIds,
    studySubset: (mode, cardIds) => navigate({ name: 'study', setId: set.id, mode, cardIds })
  }

  switch (route.mode) {
    case 'flashcards':
      return <Flashcards {...props} />
    case 'test':
      return <TestMode {...props} />
    case 'match':
      return <MatchMode {...props} />
    case 'charms':
      return <CharmsMode {...props} />
    case 'lock':
      return <LockMode {...props} />
    case 'learn':
      return <LearnMode {...props} />
    case 'deepdive':
      return <DeepDiveMode {...props} />
  }
}
