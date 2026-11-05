/**
 * Lenient answer grading shared by written test questions and the Lock game.
 * Ignores case, surrounding/repeated whitespace, punctuation and diacritics
 * ("Adiós!" matches "adios"). If the expected answer lists alternatives
 * separated by ";" or " / ", any one of them is accepted as well.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip combining accents
    .toLowerCase()
    .replace(/['’‘`´]/g, '') // apostrophes join words: don't -> dont
    .replace(/[\p{P}\p{S}]+/gu, ' ') // punctuation & symbols -> space
    .replace(/\s+/g, ' ')
    .trim()
}

export function answerAlternatives(expected: string): string[] {
  const whole = normalizeAnswer(expected)
  const parts = expected
    .split(/;|\s\/\s|\n/)
    .map(normalizeAnswer)
    .filter((p) => p.length > 0)
  return Array.from(new Set([whole, ...parts])).filter((p) => p.length > 0)
}

export function isAnswerCorrect(given: string, expected: string): boolean {
  const g = normalizeAnswer(given)
  if (!g) return false
  return answerAlternatives(expected).includes(g)
}

/** Hint text such as "S _ _ _ _" revealing only the first letter. */
export function firstLetterHint(expected: string): string {
  const trimmed = expected.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\s+/)
    .map((word, w) =>
      Array.from(word)
        .map((ch, i) => (w === 0 && i === 0 ? ch : '_'))
        .join(' ')
    )
    .join('   ')
}
