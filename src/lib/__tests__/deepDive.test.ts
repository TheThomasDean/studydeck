import { describe, expect, it } from 'vitest'
import type { Card } from '@shared/types'
import { buildWave, cardWeight, catchPoints, isStreakBonus, pickTarget, summarizeCatches, BASE_POINTS, RARE_POINTS } from '../deepDive'
import { normalizeAnswer } from '../grading'
import { seededRng } from '../random'
import { makeSampleSet, makeSet } from '../sets'

const base = makeSampleSet().cards

describe('Deep Dive weighting', () => {
  it('missed cards weigh more than fresh ones, mastered cards less', () => {
    const fresh = base[0]
    const missed: Card = { ...base[1], timesMissed: 2 }
    const mastered: Card = { ...base[2], mastery: 'mastered' }
    expect(cardWeight(missed, {})).toBeGreaterThan(cardWeight(fresh, {}))
    expect(cardWeight(mastered, {})).toBeLessThan(cardWeight(fresh, {}))
    expect(cardWeight(fresh, { [fresh.id]: 1 })).toBeGreaterThan(cardWeight(fresh, {}))
  })

  it('missed cards come up as the target noticeably more often', () => {
    const cards = base.map((c, i) => (i < 2 ? { ...c, timesMissed: 3 } : c))
    const rng = seededRng(42)
    const counts: Record<string, number> = {}
    let last: string | null = null
    for (let i = 0; i < 6000; i++) {
      const t = pickTarget(cards, {}, last, rng)
      counts[t.id] = (counts[t.id] ?? 0) + 1
      last = t.id
    }
    const missedAvg = (counts[cards[0].id] + counts[cards[1].id]) / 2
    const freshAvg = cards.slice(2).reduce((s, c) => s + counts[c.id], 0) / 10
    expect(missedAvg).toBeGreaterThan(freshAvg * 2.5)
  })

  it('never picks the same target twice in a row when there is a choice', () => {
    const rng = seededRng(7)
    let last: string | null = null
    for (let i = 0; i < 500; i++) {
      const t = pickTarget(base, {}, last, rng)
      expect(t.id).not.toBe(last)
      last = t.id
    }
  })
})

describe('Deep Dive waves', () => {
  it('has one correct fish and unique definitions, even with duplicate definitions in the set', () => {
    const cards = makeSet('d', '', [
      { term: 'a', definition: 'dup' },
      { term: 'b', definition: 'Dup.' },
      { term: 'c', definition: 'x' },
      { term: 'd', definition: 'y' },
      { term: 'e', definition: 'z' }
    ]).cards
    for (let seed = 1; seed < 50; seed++) {
      const wave = buildWave(cards, cards[0], {}, seededRng(seed))
      expect(wave.fish.filter((f) => f.correct)).toHaveLength(1)
      expect(new Set(wave.fish.map((f) => normalizeAnswer(f.text))).size).toBe(wave.fish.length)
      expect(new Set(wave.fish.map((f) => f.lane)).size).toBe(wave.fish.length)
      expect(wave.fish.length).toBeLessThanOrEqual(4)
    }
  })

  it('works with 1-3 card sets', () => {
    const one = makeSet('o', '', [{ term: 'a', definition: 'b' }]).cards
    expect(buildWave(one, one[0], {}).fish).toHaveLength(1)
    const two = makeSet('t', '', [
      { term: 'a', definition: 'b' },
      { term: 'c', definition: 'd' }
    ]).cards
    expect(buildWave(two, two[0], {}).fish).toHaveLength(2)
  })

  it('marks fish rare by their own card, not by whether they are correct', () => {
    const cards = base.map((c, i) => (i === 1 ? { ...c, timesMissed: 1 } : c))
    const wave = buildWave(cards.slice(0, 4), cards[0], {}, seededRng(9))
    for (const f of wave.fish) expect(f.rare).toBe(f.cardId === cards[1].id)
  })
})

describe('Deep Dive scoring', () => {
  it('rare fish and streaks score more', () => {
    expect(catchPoints(false, 1)).toBe(BASE_POINTS)
    expect(catchPoints(true, 1)).toBe(RARE_POINTS)
    expect(catchPoints(false, 5)).toBeGreaterThan(BASE_POINTS)
    expect(isStreakBonus(10)).toBe(true)
    expect(isStreakBonus(4)).toBe(false)
  })
  it('summarizes catches per card', () => {
    const s = summarizeCatches([
      { cardId: 'a', correct: true, rare: false },
      { cardId: 'b', correct: false, rare: false },
      { cardId: 'a', correct: true, rare: false },
      { cardId: 'b', correct: true, rare: true }
    ])
    expect(s).toEqual([
      { cardId: 'a', missed: false, catches: 2 },
      { cardId: 'b', missed: true, catches: 1 }
    ])
  })
})
