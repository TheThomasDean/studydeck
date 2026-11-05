import { describe, expect, it } from 'vitest'
import { normalizeAnswer } from '../grading'
import { seededRng } from '../random'
import { makeSampleSet, makeSet } from '../sets'
import { blankAnswer, generateTest, gradeTest, makeMc, missedCardIds, type Answer, type Question } from '../testGen'

const set = makeSampleSet()

describe('generateTest', () => {
  it('creates multiple choice questions with 4 unique options including the answer', () => {
    const qs = generateTest(set.cards, set.cards, { count: 12, types: ['mc'], answerWith: 'definition', starredOnly: false }, seededRng(1))
    expect(qs).toHaveLength(12)
    for (const q of qs) {
      if (q.kind !== 'mc') throw new Error('expected mc')
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options.map(normalizeAnswer)).size).toBe(4)
      const card = set.cards.find((c) => c.id === q.cardId)!
      expect(q.options[q.correctIndex]).toBe(card.definition)
      expect(q.prompt).toBe(card.term)
    }
  })

  it('uses fewer options when the set is small and never duplicates answers', () => {
    const small = makeSet('s', '', [
      { term: 'a', definition: 'x' },
      { term: 'b', definition: 'X!' },
      { term: 'c', definition: 'y' }
    ])
    const q = makeMc(small.cards, small.cards[0], 'definition', seededRng(2))!
    expect(q.options).toHaveLength(2) // "X!" duplicates "x" after normalization
  })

  it('respects count, and matching groups contain up to 6 cards', () => {
    const qs = generateTest(set.cards, set.cards, { count: 12, types: ['matching'], answerWith: 'term', starredOnly: false }, seededRng(3))
    const cardsTested = qs.reduce((n, q) => n + (q.kind === 'matching' ? q.pairs.length : 1), 0)
    expect(cardsTested).toBe(12)
    expect(qs.every((q) => q.kind !== 'matching' || q.pairs.length <= 6)).toBe(true)
  })

  it('mixes all types and every card appears exactly once', () => {
    const qs = generateTest(set.cards, set.cards, { count: 12, types: ['mc', 'tf', 'written', 'matching'], answerWith: 'both', starredOnly: false }, seededRng(4))
    const ids = qs.flatMap((q) => (q.kind === 'matching' ? q.pairs.map((p) => p.cardId) : [q.cardId]))
    expect(new Set(ids).size).toBe(12)
    expect(new Set(qs.map((q) => q.kind)).size).toBeGreaterThan(2)
  })
})

describe('gradeTest', () => {
  function perfectAnswer(q: Question): Answer {
    switch (q.kind) {
      case 'mc':
        return { kind: 'mc', choice: q.correctIndex }
      case 'tf':
        return { kind: 'tf', choice: q.isTrue }
      case 'written':
        return { kind: 'written', text: ` ${q.answer.toUpperCase()}! `, override: false }
      case 'matching':
        return { kind: 'matching', links: Object.fromEntries(q.pairs.map((_, i) => [i, i])) }
    }
  }

  it('scores perfect answers as 100% and blank answers as 0%', () => {
    const qs = generateTest(set.cards, set.cards, { count: 12, types: ['mc', 'tf', 'written', 'matching'], answerWith: 'both', starredOnly: false }, seededRng(5))
    const perfect = gradeTest(qs, qs.map(perfectAnswer))
    expect(perfect.percent).toBe(100)
    expect(perfect.total).toBe(12)
    const blank = gradeTest(qs, qs.map(blankAnswer))
    expect(blank.correct).toBe(0)
    expect(missedCardIds(blank)).toHaveLength(12)
  })

  it('honours the "I was right" override for written answers', () => {
    const qs = generateTest(set.cards, set.cards.slice(0, 1), { count: 1, types: ['written'], answerWith: 'term', starredOnly: false }, seededRng(6))
    expect(gradeTest(qs, [{ kind: 'written', text: 'nope', override: false }]).correct).toBe(0)
    expect(gradeTest(qs, [{ kind: 'written', text: 'nope', override: true }]).correct).toBe(1)
  })
})
