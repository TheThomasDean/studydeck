import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  checkSwap,
  createBoard,
  findRuns,
  findValidMove,
  hasValidMove,
  reshuffle,
  resolveBoard,
  Spawner,
  type Board,
  type Charm
} from '../charms'
import { createLockChallenges, lockPoints, timeLeft } from '../lock'
import { createMatchTiles, isMatchingPair } from '../match'
import { seededRng } from '../random'
import { makeSampleSet, makeSet } from '../sets'

describe('match', () => {
  it('creates 12 tiles from 6 cards, each with exactly one partner', () => {
    const tiles = createMatchTiles(makeSampleSet().cards, 6, seededRng(1))
    expect(tiles).toHaveLength(12)
    for (const t of tiles) expect(tiles.filter((o) => isMatchingPair(t, o))).toHaveLength(1)
  })
  it('uses as many pairs as exist for small sets', () => {
    const s = makeSet('s', '', [
      { term: 'a', definition: '1' },
      { term: 'b', definition: '2' }
    ])
    expect(createMatchTiles(s.cards)).toHaveLength(4)
  })
})

describe('lock', () => {
  it('creates one challenge per lock, repeating cards only when needed', () => {
    const cards = makeSampleSet().cards
    const ch = createLockChallenges(cards, 7, 'term', seededRng(1))
    expect(ch).toHaveLength(7)
    expect(new Set(ch.map((c) => c.cardId)).size).toBe(7)
    expect(createLockChallenges(cards.slice(0, 2), 5, 'mixed')).toHaveLength(5)
  })
  it('scores speed and hint bonuses and subtracts penalties', () => {
    expect(lockPoints(0, false)).toBe(175)
    expect(lockPoints(20, true)).toBe(100)
    expect(timeLeft(90, 30, 10)).toBe(50)
    expect(timeLeft(90, 85, 10)).toBe(0)
  })
})

describe('charms engine', () => {
  it('creates a stable board with valid moves, stones and question charms', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sp = new Spawner(seededRng(seed))
      const b = createBoard(sp)
      expect(b).toHaveLength(BOARD_SIZE)
      expect(findRuns(b)).toHaveLength(0)
      expect(hasValidMove(b)).toBe(true)
      const flat = b.flat()
      expect(flat.filter((c) => c?.kind === 'stone')).toHaveLength(3)
      expect(flat.filter((c) => c?.kind === 'question')).toHaveLength(3)
    }
  })

  it('only allows swaps that create a match, and resolution leaves a full stable board', () => {
    const sp = new Spawner(seededRng(7))
    const b = createBoard(sp)
    const [a, p] = findValidMove(b)!
    const res = checkSwap(b, a, p)
    expect(res.valid).toBe(true)
    const steps = resolveBoard(res.board, sp, [a, p])
    expect(steps.length).toBeGreaterThan(0)
    const final = steps[steps.length - 1].boardAfter
    expect(final.flat().every((c) => c !== null)).toBe(true)
    expect(findRuns(final)).toHaveLength(0)
    expect(steps.map((s) => s.combo)).toEqual(steps.map((_, i) => i + 1))
  })

  it('creates a bomb from a run of 4 and the bomb clears a 3x3 area including stones', () => {
    const sp = new Spawner(seededRng(3))
    let id = 1000
    const mk = (color: number, kind: Charm['kind'] = 'normal'): Charm => ({ id: id++, color, kind })
    // Checkerboard of 4 colours guarantees no accidental matches.
    const b: Board = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mk(2 + ((r + c) % 2) + 2 * (r % 2))))
    for (let c = 0; c < 4; c++) b[7][c] = mk(0)
    const steps = resolveBoard(b, sp, [{ r: 7, c: 1 }])
    expect(steps[0].bombsCreated).toBe(1)
    expect(steps[0].boardCleared[7][1]?.kind).toBe('bomb')
    expect(steps[0].cleared).toHaveLength(3)

    // Now a bomb in a match next to a stone.
    const b2: Board = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mk(2 + ((r + c) % 2) + 2 * (r % 2))))
    b2[7][0] = mk(1, 'bomb')
    b2[7][1] = mk(1)
    b2[7][2] = mk(1)
    b2[6][1] = { id: id++, color: -1, kind: 'stone' }
    const s2 = resolveBoard(b2, sp)
    expect(s2[0].stones).toBe(1)
    expect(s2[0].points).toBeGreaterThanOrEqual(100)
    expect(s2[0].blastCenters).toHaveLength(1)
  })

  it('stones cannot be swapped; reshuffle restores a valid move', () => {
    const sp = new Spawner(seededRng(11))
    const b = createBoard(sp)
    let stone = { r: 0, c: 0 }
    b.forEach((row, r) => row.forEach((ch, c) => ch?.kind === 'stone' && (stone = { r, c })))
    const neighbour = stone.c > 0 ? { r: stone.r, c: stone.c - 1 } : { r: stone.r, c: stone.c + 1 }
    expect(checkSwap(b, stone, neighbour).valid).toBe(false)
    const r = reshuffle(b, sp)
    expect(hasValidMove(r)).toBe(true)
    expect(findRuns(r)).toHaveLength(0)
  })

  it('spawns a question charm every 5th to 7th spawn', () => {
    const sp = new Spawner(seededRng(5))
    const kinds = Array.from({ length: 200 }, () => sp.spawn(99).kind)
    const idx = kinds.map((k, i) => (k === 'question' ? i : -1)).filter((i) => i >= 0)
    const gaps = idx.slice(1).map((v, i) => v - idx[i])
    expect(gaps.every((g) => g >= 5 && g <= 7)).toBe(true)
  })
})
