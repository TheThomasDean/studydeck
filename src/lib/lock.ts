import type { Card } from '@shared/types'
import { defaultRng, shuffle, type Rng } from './random'

export type LockDifficulty = 'easy' | 'normal' | 'hard'
export type LockAnswerSide = 'term' | 'definition' | 'mixed'

export const LOCK_DIFFICULTIES: Record<LockDifficulty, { label: string; locks: number; seconds: number }> = {
  easy: { label: 'Easy', locks: 5, seconds: 120 },
  normal: { label: 'Normal', locks: 5, seconds: 90 },
  hard: { label: 'Hard', locks: 7, seconds: 90 }
}

export const LOCK_WRONG_PENALTY_S = 5
export const LOCK_HINT_AFTER = 2

export interface LockChallenge {
  cardId: string
  term: string
  prompt: string
  answer: string
  answerSide: 'term' | 'definition'
}

/** Random challenges, one per lock. Cards repeat only if the set is smaller than the lock count. */
export function createLockChallenges(
  cards: Card[],
  lockCount: number,
  side: LockAnswerSide,
  rng: Rng = defaultRng
): LockChallenge[] {
  if (cards.length === 0) return []
  const order: Card[] = []
  while (order.length < lockCount) order.push(...shuffle(cards, rng))
  return order.slice(0, lockCount).map((c) => {
    const answerSide = side === 'mixed' ? (rng() < 0.5 ? 'term' : 'definition') : side
    return {
      cardId: c.id,
      term: c.term,
      prompt: answerSide === 'term' ? c.definition : c.term,
      answer: answerSide === 'term' ? c.term : c.definition,
      answerSide
    }
  })
}

/**
 * Points for one opened lock: 100 base, up to 50 speed bonus (loses 5 per
 * second spent on that lock), 25 bonus if no hint was shown.
 */
export function lockPoints(secondsOnLock: number, hintUsed: boolean): number {
  const speed = Math.max(0, Math.round(50 - 5 * secondsOnLock))
  return 100 + speed + (hintUsed ? 0 : 25)
}

/** Escape bonus: 5 points per second left on the clock. */
export function escapeBonus(secondsLeft: number): number {
  return Math.max(0, Math.floor(secondsLeft)) * 5
}

/** Seconds remaining once penalties are subtracted. */
export function timeLeft(limitS: number, elapsedS: number, penaltyS: number): number {
  return Math.max(0, limitS - elapsedS - penaltyS)
}
