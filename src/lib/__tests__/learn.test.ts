import { describe, expect, it } from 'vitest'
import {
  applyAnswer,
  buildQuestion,
  initLearn,
  isLearnComplete,
  isRoundOver,
  learnCounts,
  missedCardIds,
  REQUEUE_GAP,
  ROUND_SIZE,
  startRound,
  syncLearn
} from '../learn'
import { normalizeAnswer } from '../grading'
import { seededRng } from '../random'
import { makeSampleSet, makeSet } from '../sets'

const cards = makeSampleSet().cards // 12 cards
const ids = cards.map((c) => c.id)

/** Answer every card in the round, using `verdict` to decide right/wrong. */
function playRound(state: ReturnType<typeof initLearn>, verdict: (id: string, attempt: number) => boolean) {
  const attempts: Record<string, number> = {}
  let guard = 0
  while (!isRoundOver(state) && guard++ < 200) {
    const id = state.queue[0]
    attempts[id] = (attempts[id] ?? 0) + 1
    state = applyAnswer(state, id, verdict(id, attempts[id]))
  }
  return state
}

describe('Learn rounds and mastery', () => {
  it('builds rounds of at most 7 non-mastered cards', () => {
    let s = startRound(initLearn(ids), seededRng(1))
    expect(s.round).toBe(1)
    expect(s.queue).toHaveLength(ROUND_SIZE)
    expect(new Set(s.queue).size).toBe(ROUND_SIZE)
    s = playRound(s, () => true)
    expect(learnCounts(s)).toMatchObject({ unseen: 5, familiar: 7, mastered: 0 })
  })

  it('a card only becomes mastered in a later round than it became familiar', () => {
    let s = startRound(initLearn(ids.slice(0, 3), { answerWith: 'definition', shuffle: false, typeWhenFamiliar: false }))
    s = playRound(s, () => true)
    expect(learnCounts(s).familiar).toBe(3)
    expect(learnCounts(s).mastered).toBe(0)
    s = playRound(startRound(s), () => true)
    expect(learnCounts(s).mastered).toBe(3)
    expect(isLearnComplete(s)).toBe(true)
  })

  it('re-queues a missed card a couple of cards later until it is answered correctly', () => {
    let s = startRound(initLearn(ids.slice(0, 5), { answerWith: 'definition', shuffle: false, typeWhenFamiliar: false }))
    const first = s.queue[0]
    s = applyAnswer(s, first, false)
    expect(s.queue.indexOf(first)).toBe(REQUEUE_GAP)
    expect(s.roundMissed).toEqual([first])
    expect(s.cards[first]).toMatchObject({ level: 'unseen', misses: 1 })
    // Answer it right the second time it comes up.
    s = playRound(s, (_id, attempt) => attempt > 1 || _id !== first)
    expect(s.cards[first].level).toBe('familiar')
    expect(missedCardIds(s)).toEqual([first])
  })

  it('a familiar card answered wrong drops back to unseen and missed cards are prioritised next round', () => {
    const settings = { answerWith: 'definition' as const, shuffle: false, typeWhenFamiliar: false }
    let s = playRound(startRound(initLearn(ids, settings)), () => true) // first 7 familiar
    s = startRound(s)
    // Round 2 starts with the 7 familiar cards (ready to be mastered).
    expect(s.queue.every((id) => s.cards[id].level === 'familiar')).toBe(true)
    const victim = s.queue[0]
    s = applyAnswer(s, victim, false)
    expect(s.cards[victim].level).toBe('unseen')
  })

  it('handles tiny and empty sets', () => {
    const empty = startRound(initLearn([]))
    expect(isRoundOver(empty)).toBe(true)
    expect(isLearnComplete(empty)).toBe(false)
    const one = startRound(initLearn([ids[0]]))
    expect(one.queue).toEqual([ids[0]])
  })

  it('syncs saved progress with added and deleted cards', () => {
    let s = playRound(startRound(initLearn(ids.slice(0, 3)), seededRng(2)), () => true)
    s = syncLearn(s, [ids[0], ids[5]])
    expect(Object.keys(s.cards)).toEqual([ids[0], ids[5]])
    expect(s.cards[ids[0]].level).toBe('familiar')
    expect(s.cards[ids[5]].level).toBe('unseen')
  })
})

describe('Learn questions', () => {
  it('shows 4 unique options including the answer', () => {
    const s = startRound(initLearn(ids), seededRng(3))
    const built = buildQuestion(s, cards, s.queue[0], seededRng(4))!
    if (built.question.kind !== 'mc') throw new Error('expected mc')
    expect(built.question.options).toHaveLength(4)
    expect(new Set(built.question.options.map(normalizeAnswer)).size).toBe(4)
    expect(built.question.options[built.question.correctIndex]).toBe(cards.find((c) => c.id === s.queue[0])!.definition)
  })

  it('never repeats the same distractor set for a card back-to-back', () => {
    let s = startRound(initLearn(ids), seededRng(5))
    const id = s.queue[0]
    let prev = ''
    for (let i = 0; i < 30; i++) {
      const built = buildQuestion(s, cards, id, seededRng(100 + i))!
      if (built.question.kind !== 'mc') throw new Error('expected mc')
      const key = built.question.options.filter((_, j) => j !== (built.question as { correctIndex: number }).correctIndex).sort().join('|')
      expect(key).not.toBe(prev)
      prev = key
      s = built.state
    }
  })

  it('uses as many options as exist for small sets and handles duplicate definitions', () => {
    const small = makeSet('s', '', [
      { term: 'a', definition: 'same' },
      { term: 'b', definition: 'Same!' },
      { term: 'c', definition: 'other' }
    ]).cards
    const s = startRound(initLearn(small.map((c) => c.id)))
    const q = buildQuestion(s, small, small[0].id, seededRng(6))!.question
    if (q.kind !== 'mc') throw new Error('expected mc')
    expect(q.options).toHaveLength(2) // "Same!" duplicates "same"
  })

  it('falls back to a typed answer for one-card sets and for familiar cards when enabled', () => {
    const one = makeSet('s', '', [{ term: 'a', definition: 'b' }]).cards
    expect(buildQuestion(startRound(initLearn([one[0].id])), one, one[0].id)!.question.kind).toBe('written')
    let s = initLearn(ids, { answerWith: 'term', shuffle: false, typeWhenFamiliar: true })
    s = playRound(startRound(s), () => true)
    const q = buildQuestion(startRound(s), cards, ids[0])!.question
    expect(q.kind).toBe('written')
    expect(q.answer).toBe(cards[0].term) // answering with the term
  })
})
