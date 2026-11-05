import type { Card, Mastery, SetHistory, StudySet, TestScore } from '@shared/types'

export const MASTERY_LEVELS: Mastery[] = ['new', 'learning', 'familiar', 'mastered']

export function emptyHistory(): SetHistory {
  return { testScores: [], matchTimes: [], bestMatchMs: null, charmsHighScore: 0, lockBestScore: 0, deepDiveBest: 0 }
}

/**
 * Mastery rules (simple and predictable):
 *  - a wrong answer resets the streak and puts the card in "learning";
 *  - 2 correct in a row -> "familiar"; 4 correct in a row -> "mastered";
 *  - just viewing a new card (flashcard flip) moves it to "learning".
 */
export function masteryFor(streak: number, correct: boolean): Mastery {
  if (!correct) return 'learning'
  if (streak >= 4) return 'mastered'
  if (streak >= 2) return 'familiar'
  return 'learning'
}

export function recordAnswer(card: Card, correct: boolean, now = Date.now()): Card {
  const streak = correct ? (card.streak ?? 0) + 1 : 0
  return {
    ...card,
    timesSeen: card.timesSeen + 1,
    timesCorrect: card.timesCorrect + (correct ? 1 : 0),
    timesMissed: (card.timesMissed ?? 0) + (correct ? 0 : 1),
    lastSeen: now,
    streak,
    mastery: masteryFor(streak, correct)
  }
}

export function recordSeen(card: Card, now = Date.now()): Card {
  return {
    ...card,
    timesSeen: card.timesSeen + 1,
    lastSeen: now,
    mastery: card.mastery === 'new' ? 'learning' : card.mastery
  }
}

export interface ProgressEvent {
  cardId: string
  /** true/false for graded answers, undefined for "just seen". */
  correct?: boolean
}

/** Apply a batch of progress events to a set, returning a new set. */
export function applyProgress(set: StudySet, events: ProgressEvent[], now = Date.now()): StudySet {
  if (events.length === 0) return set
  const byId = new Map(set.cards.map((c) => [c.id, c]))
  for (const ev of events) {
    const card = byId.get(ev.cardId)
    if (!card) continue
    byId.set(ev.cardId, ev.correct === undefined ? recordSeen(card, now) : recordAnswer(card, ev.correct, now))
  }
  return { ...set, cards: set.cards.map((c) => byId.get(c.id) ?? c), lastStudied: now }
}

export function masteryCounts(cards: Card[]): Record<Mastery, number> {
  const counts: Record<Mastery, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 }
  for (const c of cards) counts[c.mastery] = (counts[c.mastery] ?? 0) + 1
  return counts
}

export function addTestScore(set: StudySet, correct: number, total: number, now = Date.now()): StudySet {
  const score: TestScore = {
    date: now,
    correct,
    total,
    percent: total === 0 ? 0 : Math.round((correct / total) * 100)
  }
  const testScores = [...set.history.testScores, score].slice(-50)
  return { ...set, history: { ...set.history, testScores }, lastStudied: now }
}

/** Returns the updated set and whether the time is a new best. */
export function addMatchTime(set: StudySet, ms: number): { set: StudySet; isBest: boolean; previousBest: number | null } {
  const previousBest = set.history.bestMatchMs
  const isBest = previousBest === null || ms < previousBest
  const matchTimes = [...set.history.matchTimes, ms].sort((a, b) => a - b).slice(0, 10)
  return {
    set: {
      ...set,
      lastStudied: Date.now(),
      history: { ...set.history, matchTimes, bestMatchMs: isBest ? ms : previousBest }
    },
    isBest,
    previousBest
  }
}

/** Fill in fields that older or hand-edited files may lack. */
export function normalizeSet(raw: StudySet): StudySet {
  const history = { ...emptyHistory(), ...(raw.history ?? {}) }
  return {
    id: raw.id,
    title: raw.title ?? 'Untitled set',
    description: raw.description ?? '',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    lastStudied: raw.lastStudied ?? null,
    history,
    learn: raw.learn,
    cards: (raw.cards ?? []).map((c) => ({
      id: c.id,
      term: String(c.term ?? ''),
      definition: String(c.definition ?? ''),
      extra: c.extra,
      timesSeen: c.timesSeen ?? 0,
      timesCorrect: c.timesCorrect ?? 0,
      starred: !!c.starred,
      lastSeen: c.lastSeen ?? null,
      mastery: MASTERY_LEVELS.includes(c.mastery) ? c.mastery : 'new',
      streak: c.streak ?? 0,
      timesMissed: c.timesMissed ?? 0
    }))
  }
}
