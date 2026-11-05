/**
 * Learn mode engine (modeled on Quizlet Learn). Pure functions over LearnState.
 *
 * Levels: unseen -> familiar (first correct answer) -> mastered (correct again
 * in a LATER round). A wrong answer drops a familiar card back to unseen and
 * puts it back in the current round's queue a couple of cards later, so it
 * keeps coming back until it is answered correctly.
 */
import type { Card, LearnCardState, LearnLevel, LearnSettings, LearnState } from '@shared/types'
import { normalizeAnswer } from './grading'
import { defaultRng, shuffle, type Rng } from './random'
import { distractorPool, type Side } from './testGen'

export const ROUND_SIZE = 7
/** A missed card comes back after this many other cards (or at the end of a short queue). */
export const REQUEUE_GAP = 2
export const LEARN_OPTIONS = 4

export const DEFAULT_LEARN_SETTINGS: LearnSettings = {
  answerWith: 'definition',
  shuffle: true,
  typeWhenFamiliar: false
}

function freshCard(): LearnCardState {
  return { level: 'unseen', promotedRound: 0, misses: 0 }
}

export function initLearn(cardIds: string[], settings: LearnSettings = DEFAULT_LEARN_SETTINGS): LearnState {
  const cards: Record<string, LearnCardState> = {}
  for (const id of cardIds) cards[id] = freshCard()
  return { version: 1, round: 0, cards, queue: [], roundCards: [], roundMissed: [], settings: { ...settings } }
}

/** Reconcile saved progress with the current cards (new cards start unseen, deleted ones are dropped). */
export function syncLearn(state: LearnState | undefined, cardIds: string[]): LearnState {
  if (!state || state.version !== 1) return initLearn(cardIds, state?.settings ?? DEFAULT_LEARN_SETTINGS)
  const keep = new Set(cardIds)
  const cards: Record<string, LearnCardState> = {}
  for (const id of cardIds) cards[id] = state.cards[id] ?? freshCard()
  return {
    ...state,
    settings: { ...DEFAULT_LEARN_SETTINGS, ...state.settings },
    cards,
    queue: state.queue.filter((id) => keep.has(id)),
    roundCards: state.roundCards.filter((id) => keep.has(id)),
    roundMissed: state.roundMissed.filter((id) => keep.has(id))
  }
}

export function resetLearn(state: LearnState, cardIds: string[]): LearnState {
  return initLearn(cardIds, state.settings)
}

export function learnCounts(state: LearnState): Record<LearnLevel, number> & { total: number } {
  const counts = { unseen: 0, familiar: 0, mastered: 0, total: 0 }
  for (const c of Object.values(state.cards)) {
    counts[c.level]++
    counts.total++
  }
  return counts
}

export function isLearnComplete(state: LearnState): boolean {
  const ids = Object.keys(state.cards)
  return ids.length > 0 && ids.every((id) => state.cards[id].level === 'mastered')
}

export function isRoundOver(state: LearnState): boolean {
  return state.queue.length === 0
}

/**
 * Pick the next round: up to ROUND_SIZE cards that aren't mastered.
 * Priority: familiar cards from earlier rounds (ready to be mastered), then
 * cards missed before, then unseen cards. With shuffle on, order within each
 * group and the question order are randomized.
 */
export function startRound(state: LearnState, rng: Rng = defaultRng): LearnState {
  let candidates = Object.keys(state.cards).filter((id) => state.cards[id].level !== 'mastered')
  if (state.settings.shuffle) candidates = shuffle(candidates, rng)
  const priority = (id: string) => {
    const c = state.cards[id]
    if (c.level === 'familiar') return 0
    if (c.misses > 0) return 1
    return 2
  }
  candidates.sort((a, b) => priority(a) - priority(b)) // stable
  const picked = candidates.slice(0, ROUND_SIZE)
  const queue = state.settings.shuffle ? shuffle(picked, rng) : picked
  return { ...state, round: state.round + 1, queue, roundCards: picked, roundMissed: [] }
}

/** Apply the final verdict for the card at the front of the queue. */
export function applyAnswer(state: LearnState, cardId: string, correct: boolean): LearnState {
  const cs = state.cards[cardId]
  if (!cs) return state
  const queue = state.queue.slice()
  const at = queue.indexOf(cardId)
  if (at !== -1) queue.splice(at, 1)

  let next: LearnCardState
  let roundMissed = state.roundMissed
  if (correct) {
    if (cs.level === 'unseen') next = { ...cs, level: 'familiar', promotedRound: state.round }
    else if (cs.level === 'familiar' && cs.promotedRound < state.round) next = { ...cs, level: 'mastered', promotedRound: state.round }
    else next = cs
  } else {
    next = { ...cs, level: cs.level === 'mastered' ? 'familiar' : 'unseen', misses: cs.misses + 1 }
    if (!roundMissed.includes(cardId)) roundMissed = [...roundMissed, cardId]
    queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, cardId)
  }
  return { ...state, queue, roundMissed, cards: { ...state.cards, [cardId]: next } }
}

export function missedCardIds(state: LearnState): string[] {
  return Object.keys(state.cards).filter((id) => state.cards[id].misses > 0)
}

/* ---------------- Questions ---------------- */

export type LearnQuestion =
  | { kind: 'mc'; cardId: string; prompt: string; answer: string; options: string[]; correctIndex: number }
  | { kind: 'written'; cardId: string; prompt: string; answer: string }

const otherSide = (s: Side): Side => (s === 'term' ? 'definition' : 'term')
const sideValue = (c: Card, s: Side) => (s === 'term' ? c.term : c.definition)
const setKey = (items: string[]) => items.map(normalizeAnswer).sort().join('\u0000')

/**
 * Build the question for a card. Multiple choice with up to 4 options; the
 * distractor set differs from the last one shown for this card whenever the
 * set has enough other answers. Falls back to a typed answer when there are no
 * other answers (1-card sets) or when "type when familiar" applies.
 * Returns the state with the new distractors remembered.
 */
export function buildQuestion(
  state: LearnState,
  pool: Card[],
  cardId: string,
  rng: Rng = defaultRng
): { question: LearnQuestion; state: LearnState } | null {
  const card = pool.find((c) => c.id === cardId)
  const cs = state.cards[cardId]
  if (!card || !cs) return null
  const side: Side = state.settings.answerWith
  const prompt = sideValue(card, otherSide(side))
  const answer = sideValue(card, side)
  const candidates = distractorPool(pool, card, side)

  if (candidates.length === 0 || (state.settings.typeWhenFamiliar && cs.level === 'familiar')) {
    return { question: { kind: 'written', cardId, prompt, answer }, state }
  }

  const want = Math.min(LEARN_OPTIONS - 1, candidates.length)
  let distractors = shuffle(candidates, rng).slice(0, want)
  if (cs.lastDistractors && candidates.length > want) {
    const last = setKey(cs.lastDistractors)
    for (let i = 0; i < 20 && setKey(distractors) === last; i++) distractors = shuffle(candidates, rng).slice(0, want)
  }
  const options = shuffle([answer, ...distractors], rng)
  return {
    question: { kind: 'mc', cardId, prompt, answer, options, correctIndex: options.indexOf(answer) },
    state: { ...state, cards: { ...state.cards, [cardId]: { ...cs, lastDistractors: distractors } } }
  }
}
