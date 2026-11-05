import type { Card, StudySet } from '@shared/types'
import { emptyHistory } from './progress'
import { newId } from './random'

export interface CardDraft {
  term: string
  definition: string
  extra?: Record<string, string>
  starred?: boolean
}

export function makeCard(draft: CardDraft): Card {
  return {
    id: newId(),
    term: draft.term,
    definition: draft.definition,
    extra: draft.extra && Object.keys(draft.extra).length > 0 ? draft.extra : undefined,
    timesSeen: 0,
    timesCorrect: 0,
    starred: !!draft.starred,
    lastSeen: null,
    mastery: 'new',
    streak: 0,
    timesMissed: 0
  }
}

export function makeSet(title: string, description: string, drafts: CardDraft[], now = Date.now()): StudySet {
  return {
    id: newId(),
    title: title.trim() || 'Untitled set',
    description,
    createdAt: now,
    updatedAt: now,
    lastStudied: null,
    cards: drafts.map(makeCard),
    history: emptyHistory()
  }
}

/** Cards that have both a term and a definition — the only ones usable in study modes. */
export function studyableCards(cards: Card[]): Card[] {
  return cards.filter((c) => c.term.trim() !== '' && c.definition.trim() !== '')
}

export const SAMPLE_SET_CARDS: CardDraft[] = [
  { term: 'hola', definition: 'hello' },
  { term: 'adiós', definition: 'goodbye' },
  { term: 'por favor', definition: 'please' },
  { term: 'gracias', definition: 'thank you' },
  { term: 'sí', definition: 'yes' },
  { term: 'el agua', definition: 'water' },
  { term: 'la casa', definition: 'house' },
  { term: 'el perro', definition: 'dog' },
  { term: 'el gato', definition: 'cat' },
  { term: 'el libro', definition: 'book' },
  { term: 'la manzana', definition: 'apple' },
  { term: 'buenos días', definition: 'good morning' }
]

export function makeSampleSet(): StudySet {
  return makeSet('Spanish Basics', 'Twelve everyday Spanish words and phrases to explore StudyDeck.', SAMPLE_SET_CARDS)
}
