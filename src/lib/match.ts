import type { Card } from '@shared/types'
import { normalizeAnswer } from './grading'
import { defaultRng, shuffle, type Rng } from './random'

export interface MatchTile {
  id: string
  cardId: string
  side: 'term' | 'definition'
  text: string
}

export const MATCH_PAIRS = 6
export const MATCH_PENALTY_MS = 1000

/**
 * Pick up to `pairs` random cards (preferring ones whose terms and definitions
 * are unique so every tile has exactly one partner) and return shuffled tiles.
 */
export function createMatchTiles(cards: Card[], pairs = MATCH_PAIRS, rng: Rng = defaultRng): MatchTile[] {
  const chosen: Card[] = []
  const terms = new Set<string>()
  const defs = new Set<string>()
  for (const c of shuffle(cards, rng)) {
    if (chosen.length >= pairs) break
    const t = normalizeAnswer(c.term)
    const d = normalizeAnswer(c.definition)
    if (terms.has(t) || defs.has(d) || terms.has(d) || defs.has(t)) continue
    terms.add(t)
    defs.add(d)
    chosen.push(c)
  }
  const tiles: MatchTile[] = []
  for (const c of chosen) {
    tiles.push({ id: `${c.id}:t`, cardId: c.id, side: 'term', text: c.term })
    tiles.push({ id: `${c.id}:d`, cardId: c.id, side: 'definition', text: c.definition })
  }
  return shuffle(tiles, rng)
}

export function isMatchingPair(a: MatchTile, b: MatchTile): boolean {
  return a.cardId === b.cardId && a.side !== b.side
}

export function formatMs(ms: number): string {
  const totalTenths = Math.floor(ms / 100)
  const tenths = totalTenths % 10
  const totalSeconds = Math.floor(totalTenths / 10)
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${tenths}` : `${s}.${tenths}s`
}
