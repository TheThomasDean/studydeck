import { describe, expect, it } from 'vitest'
import { firstLetterHint, isAnswerCorrect, normalizeAnswer } from '../grading'
import { recordAnswer } from '../progress'
import { makeCard } from '../sets'

describe('lenient grading', () => {
  it('ignores case, surrounding whitespace, punctuation and accents', () => {
    expect(isAnswerCorrect('  HELLO!! ', 'hello')).toBe(true)
    expect(isAnswerCorrect('thank-you', 'Thank you.')).toBe(true)
    expect(isAnswerCorrect('adios', 'Adiós')).toBe(true)
    expect(isAnswerCorrect("dont", "don't")).toBe(true)
    expect(isAnswerCorrect('goodbye', 'hello')).toBe(false)
    expect(isAnswerCorrect('', 'hello')).toBe(false)
  })

  it('accepts any listed alternative', () => {
    expect(isAnswerCorrect('car', 'automobile; car')).toBe(true)
    expect(isAnswerCorrect('hi', 'hello / hi')).toBe(true)
  })

  it('normalizes internal whitespace', () => {
    expect(normalizeAnswer('el   perro')).toBe('el perro')
  })

  it('reveals only the first letter as a hint', () => {
    expect(firstLetterHint('buenos días')).toBe('b _ _ _ _ _   _ _ _ _')
  })
})

describe('mastery progression', () => {
  it('promotes on streaks and demotes on mistakes', () => {
    let c = makeCard({ term: 'a', definition: 'b' })
    c = recordAnswer(c, true)
    expect(c.mastery).toBe('learning')
    c = recordAnswer(c, true)
    expect(c.mastery).toBe('familiar')
    c = recordAnswer(recordAnswer(c, true), true)
    expect(c.mastery).toBe('mastered')
    expect(c.timesSeen).toBe(4)
    c = recordAnswer(c, false)
    expect(c.mastery).toBe('learning')
    expect(c.timesCorrect).toBe(4)
  })
})
