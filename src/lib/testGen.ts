import type { Card } from '@shared/types'
import { isAnswerCorrect, normalizeAnswer } from './grading'
import { defaultRng, newId, shuffle, type Rng } from './random'

export type QuestionType = 'mc' | 'tf' | 'written' | 'matching'
/** Which side the learner must produce. "term" = prompt shows the definition. */
export type AnswerWith = 'term' | 'definition' | 'both'
export type Side = 'term' | 'definition'

export interface TestOptions {
  count: number
  types: QuestionType[]
  answerWith: AnswerWith
  starredOnly: boolean
}

export interface McQuestion {
  kind: 'mc'
  id: string
  cardId: string
  answerSide: Side
  prompt: string
  options: string[]
  correctIndex: number
}

export interface TfQuestion {
  kind: 'tf'
  id: string
  cardId: string
  answerSide: Side
  prompt: string
  /** The paired value shown next to the prompt. */
  candidate: string
  isTrue: boolean
  /** The real answer, shown in results. */
  correctAnswer: string
}

export interface WrittenQuestion {
  kind: 'written'
  id: string
  cardId: string
  answerSide: Side
  prompt: string
  answer: string
}

export interface MatchingPair {
  cardId: string
  left: string
  right: string
}

export interface MatchingQuestion {
  kind: 'matching'
  id: string
  answerSide: Side
  pairs: MatchingPair[]
  /** Order in which the right-hand values are displayed (indexes into pairs). */
  rightOrder: number[]
}

export type Question = McQuestion | TfQuestion | WrittenQuestion | MatchingQuestion

export type Answer =
  | { kind: 'mc'; choice: number | null }
  | { kind: 'tf'; choice: boolean | null }
  | { kind: 'written'; text: string; override: boolean }
  | { kind: 'matching'; /** left index -> right pair index */ links: Record<number, number> }

export const MATCHING_MAX = 6

export const TYPE_LABELS: Record<QuestionType, string> = {
  mc: 'Multiple choice',
  tf: 'True / False',
  written: 'Written',
  matching: 'Matching'
}

function sideValue(card: Card, side: Side): string {
  return side === 'term' ? card.term : card.definition
}
function otherSide(side: Side): Side {
  return side === 'term' ? 'definition' : 'term'
}

function chooseSide(answerWith: AnswerWith, rng: Rng): Side {
  if (answerWith === 'both') return rng() < 0.5 ? 'term' : 'definition'
  return answerWith
}

/** Distinct values from other cards on the given side, never equal to `correct`. */
export function distractorPool(cards: Card[], card: Card, side: Side): string[] {
  const correctKey = normalizeAnswer(sideValue(card, side))
  const seen = new Set<string>([correctKey])
  const out: string[] = []
  for (const c of cards) {
    if (c.id === card.id) continue
    const v = sideValue(c, side)
    const key = normalizeAnswer(v)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** A multiple choice question with up to 4 options (fewer if the pool is small). */
export function makeMc(pool: Card[], card: Card, answerSide: Side, rng: Rng = defaultRng): McQuestion | null {
  const distractors = shuffle(distractorPool(pool, card, answerSide), rng).slice(0, 3)
  if (distractors.length === 0) return null
  const correct = sideValue(card, answerSide)
  const options = shuffle([correct, ...distractors], rng)
  return {
    kind: 'mc',
    id: newId(),
    cardId: card.id,
    answerSide,
    prompt: sideValue(card, otherSide(answerSide)),
    options,
    correctIndex: options.indexOf(correct)
  }
}

function makeTf(pool: Card[], card: Card, answerSide: Side, rng: Rng): TfQuestion {
  const correct = sideValue(card, answerSide)
  const others = distractorPool(pool, card, answerSide)
  const isTrue = others.length === 0 || rng() < 0.5
  const candidate = isTrue ? correct : others[Math.floor(rng() * others.length)]
  return {
    kind: 'tf',
    id: newId(),
    cardId: card.id,
    answerSide,
    prompt: sideValue(card, otherSide(answerSide)),
    candidate,
    isTrue,
    correctAnswer: correct
  }
}

function makeWritten(card: Card, answerSide: Side): WrittenQuestion {
  return {
    kind: 'written',
    id: newId(),
    cardId: card.id,
    answerSide,
    prompt: sideValue(card, otherSide(answerSide)),
    answer: sideValue(card, answerSide)
  }
}

/** Matching: left column shows prompts, right column the answers to pair with them. */
function makeMatching(group: Card[], answerSide: Side, rng: Rng): MatchingQuestion {
  const pairs = group.map((c) => ({
    cardId: c.id,
    left: sideValue(c, otherSide(answerSide)),
    right: sideValue(c, answerSide)
  }))
  return {
    kind: 'matching',
    id: newId(),
    answerSide,
    pairs,
    rightOrder: shuffle(
      pairs.map((_, i) => i),
      rng
    )
  }
}

/** Pick up to n cards whose answer-side values are pairwise distinct (so matching is unambiguous). */
function distinctGroup(cards: Card[], n: number, side: Side): { group: Card[]; rest: Card[] } {
  const group: Card[] = []
  const rest: Card[] = []
  const used = new Set<string>()
  const usedPrompt = new Set<string>()
  for (const c of cards) {
    const k = normalizeAnswer(sideValue(c, side))
    const p = normalizeAnswer(sideValue(c, otherSide(side)))
    if (group.length < n && !used.has(k) && !usedPrompt.has(p)) {
      group.push(c)
      used.add(k)
      usedPrompt.add(p)
    } else rest.push(c)
  }
  return { group, rest }
}

/**
 * Build a randomized test.
 * - `count` = number of cards tested (each matching question tests up to 6 cards).
 * - Question types rotate through the selected types in random order.
 * - `pool` is the full set used for distractors; `cards` are the cards to test.
 */
export function generateTest(pool: Card[], cards: Card[], opts: TestOptions, rng: Rng = defaultRng): Question[] {
  const types = opts.types.length > 0 ? opts.types : (['mc'] as QuestionType[])
  let remaining = shuffle(cards, rng).slice(0, Math.max(1, Math.min(opts.count, cards.length)))
  const questions: Question[] = []
  let typeIdx = Math.floor(rng() * types.length)

  while (remaining.length > 0) {
    const type = types[typeIdx % types.length]
    typeIdx++
    const side = chooseSide(opts.answerWith, rng)

    if (type === 'matching') {
      const { group, rest } = distinctGroup(remaining, MATCHING_MAX, side)
      if (group.length >= 2) {
        questions.push(makeMatching(group, side, rng))
        remaining = rest
        continue
      }
      // Too few distinct cards left for matching: fall through to another type.
      if (types.length === 1) {
        const card = remaining.shift()!
        questions.push(makeMc(pool, card, side, rng) ?? makeWritten(card, side))
        continue
      }
      continue
    }

    const card = remaining.shift()!
    if (type === 'mc') questions.push(makeMc(pool, card, side, rng) ?? makeWritten(card, side))
    else if (type === 'tf') questions.push(makeTf(pool, card, side, rng))
    else questions.push(makeWritten(card, side))
  }
  return questions
}

export function blankAnswer(q: Question): Answer {
  switch (q.kind) {
    case 'mc':
      return { kind: 'mc', choice: null }
    case 'tf':
      return { kind: 'tf', choice: null }
    case 'written':
      return { kind: 'written', text: '', override: false }
    case 'matching':
      return { kind: 'matching', links: {} }
  }
}

export function isAnswered(q: Question, a: Answer): boolean {
  if (q.kind === 'mc' && a.kind === 'mc') return a.choice !== null
  if (q.kind === 'tf' && a.kind === 'tf') return a.choice !== null
  if (q.kind === 'written' && a.kind === 'written') return a.text.trim() !== ''
  if (q.kind === 'matching' && a.kind === 'matching') return Object.keys(a.links).length === q.pairs.length
  return false
}

export interface QuestionResult {
  questionId: string
  earned: number
  possible: number
  correct: boolean
  cardResults: { cardId: string; correct: boolean }[]
}

export function gradeQuestion(q: Question, a: Answer): QuestionResult {
  if (q.kind === 'matching') {
    const links = a.kind === 'matching' ? a.links : {}
    const cardResults = q.pairs.map((p, i) => ({ cardId: p.cardId, correct: links[i] === i }))
    const earned = cardResults.filter((r) => r.correct).length
    return { questionId: q.id, earned, possible: q.pairs.length, correct: earned === q.pairs.length, cardResults }
  }
  let correct = false
  if (q.kind === 'mc' && a.kind === 'mc') correct = a.choice === q.correctIndex
  if (q.kind === 'tf' && a.kind === 'tf') correct = a.choice === q.isTrue
  if (q.kind === 'written' && a.kind === 'written') correct = a.override || isAnswerCorrect(a.text, q.answer)
  return { questionId: q.id, earned: correct ? 1 : 0, possible: 1, correct, cardResults: [{ cardId: q.cardId, correct }] }
}

export interface TestResult {
  results: QuestionResult[]
  correct: number
  total: number
  percent: number
}

export function gradeTest(questions: Question[], answers: Answer[]): TestResult {
  const results = questions.map((q, i) => gradeQuestion(q, answers[i] ?? blankAnswer(q)))
  const correct = results.reduce((s, r) => s + r.earned, 0)
  const total = results.reduce((s, r) => s + r.possible, 0)
  return { results, correct, total, percent: total === 0 ? 0 : Math.round((correct / total) * 100) }
}

/** Card ids answered incorrectly (used for "Retake only missed questions"). */
export function missedCardIds(result: TestResult): string[] {
  const ids: string[] = []
  for (const r of result.results) for (const c of r.cardResults) if (!c.correct) ids.push(c.cardId)
  return ids
}

/** A human readable version of the user's answer for the results page. */
export function describeAnswer(q: Question, a: Answer): string {
  if (q.kind === 'mc' && a.kind === 'mc') return a.choice === null ? '(no answer)' : q.options[a.choice]
  if (q.kind === 'tf' && a.kind === 'tf') return a.choice === null ? '(no answer)' : a.choice ? 'True' : 'False'
  if (q.kind === 'written' && a.kind === 'written') return a.text.trim() || '(no answer)'
  return ''
}
