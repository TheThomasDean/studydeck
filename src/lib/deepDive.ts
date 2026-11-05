/**
 * Deep Dive (fishing game) rules. Pure functions; the UI animates the waves.
 *
 * Each "wave" shows one term on the fishing line and a few fish labeled with
 * definitions. Terms are picked with weights so missed cards come up more
 * often and well-known cards less. A fish is "rare" (bigger, glowing, worth
 * more) when the card its own label comes from has been missed — so rare
 * fish are not automatically the right answer.
 */
import type { Card } from '@shared/types'
import { normalizeAnswer } from './grading'
import { defaultRng, shuffle, type Rng } from './random'

/* Tunables — change freely. */
export const RUN_SECONDS = 75
export const FISH_PER_WAVE = 4
export const BASE_POINTS = 100
export const RARE_POINTS = 250
export const SNAP_PENALTY_S = 3
export const STREAK_BONUS_EVERY = 5
export const STREAK_BONUS_POINTS = 150
export const SLOWMO_SECONDS = 6
export const SLOWMO_FACTOR = 0.45
export const REEL_MS = 700
export const SNAP_SHOW_MS = 1100

/** Misses per card: saved history (card.timesMissed) plus misses in this run. */
export type MissMap = Record<string, number>

export function missesFor(card: Card, runMisses: MissMap): number {
  return (card.timesMissed ?? 0) + (runMisses[card.id] ?? 0)
}

export function isRareCard(card: Card, runMisses: MissMap): boolean {
  return missesFor(card, runMisses) > 0
}

/**
 * Weight for picking a card as the target. Missed cards count up to 4x as
 * often as fresh ones; mastered cards with no misses half as often.
 */
export function cardWeight(card: Card, runMisses: MissMap): number {
  const misses = missesFor(card, runMisses)
  let w = 1 + Math.min(misses, 3)
  if (misses === 0 && card.mastery === 'mastered') w = 0.5
  // Misses during this run matter most: an extra bump so they return soon.
  if ((runMisses[card.id] ?? 0) > 0) w += 1
  return w
}

export function weightedPick<T>(items: T[], weight: (t: T) => number, rng: Rng = defaultRng): T {
  const weights = items.map(weight)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/** Next target card, avoiding an immediate repeat when possible. */
export function pickTarget(cards: Card[], runMisses: MissMap, lastId: string | null, rng: Rng = defaultRng): Card {
  const pool = cards.length > 1 ? cards.filter((c) => c.id !== lastId) : cards
  return weightedPick(pool, (c) => cardWeight(c, runMisses), rng)
}

export interface Fish {
  id: string
  cardId: string
  text: string
  correct: boolean
  rare: boolean
  /** Swim lane (0 = shallowest). */
  lane: number
  /** +1 swims right, -1 swims left. */
  dir: 1 | -1
  /** Relative speed, ~0.8–1.3. */
  speed: number
  /** Starting position across the lake, 0–1. */
  start: number
}

export interface Wave {
  id: number
  target: Card
  fish: Fish[]
}

let waveCounter = 0

/**
 * Build a wave: the target's fish plus up to FISH_PER_WAVE-1 decoys whose
 * definitions are all different from each other and from the answer
 * (duplicate definitions in the set never produce two "correct-looking" fish).
 * Decoys are picked with the same weights, so missed cards also show up as decoys.
 */
export function buildWave(cards: Card[], target: Card, runMisses: MissMap, rng: Rng = defaultRng, count = FISH_PER_WAVE): Wave {
  const used = new Set([normalizeAnswer(target.definition)])
  let pool = cards.filter((c) => c.id !== target.id)
  const decoys: Card[] = []
  while (decoys.length < count - 1 && pool.length > 0) {
    const c = weightedPick(pool, (x) => cardWeight(x, runMisses), rng)
    pool = pool.filter((x) => x.id !== c.id)
    const key = normalizeAnswer(c.definition)
    if (!key || used.has(key)) continue
    used.add(key)
    decoys.push(c)
  }
  const chosen = shuffle([target, ...decoys], rng)
  const lanes = shuffle(
    chosen.map((_, i) => i),
    rng
  )
  waveCounter++
  return {
    id: waveCounter,
    target,
    fish: chosen.map((c, i) => ({
      id: `${waveCounter}-${c.id}`,
      cardId: c.id,
      text: c.definition,
      correct: c.id === target.id,
      rare: isRareCard(c, runMisses),
      lane: lanes[i],
      dir: rng() < 0.5 ? 1 : -1,
      speed: 0.8 + rng() * 0.5,
      start: rng()
    }))
  }
}

/** Points for a correct catch, including the streak bonus when it lands on a multiple of 5. */
export function catchPoints(rare: boolean, streakAfter: number): number {
  const base = rare ? RARE_POINTS : BASE_POINTS
  return base + (streakAfter > 0 && streakAfter % STREAK_BONUS_EVERY === 0 ? STREAK_BONUS_POINTS : 0)
}

export function isStreakBonus(streakAfter: number): boolean {
  return streakAfter > 0 && streakAfter % STREAK_BONUS_EVERY === 0
}

export interface CatchRecord {
  cardId: string
  correct: boolean
  rare: boolean
}

/** Aquarium summary: one entry per card, missed if it was ever missed in the run. */
export function summarizeCatches(records: CatchRecord[]): { cardId: string; missed: boolean; catches: number }[] {
  const map = new Map<string, { cardId: string; missed: boolean; catches: number }>()
  for (const r of records) {
    const e = map.get(r.cardId) ?? { cardId: r.cardId, missed: false, catches: 0 }
    if (r.correct) e.catches++
    else e.missed = true
    map.set(r.cardId, e)
  }
  return [...map.values()]
}
