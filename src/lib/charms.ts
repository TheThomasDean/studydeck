/**
 * Charms: pure match-3 engine. The UI animates the Step objects it returns.
 *
 * Board is board[row][col], row 0 at the top. Cells may be null only
 * transiently (inside a Step's `boardCleared`).
 */
import { defaultRng, randInt, shuffle, type Rng } from './random'

export const BOARD_SIZE = 8
export const COLOR_COUNT = 6
export const START_MOVES = 20
export const MIN_CARDS_FOR_CHARMS = 6
export const MAX_STONES = 4
export const STONE_BONUS = 100
export const POINTS_PER_CHARM = 10

export type CharmKind = 'normal' | 'question' | 'bomb' | 'stone' | 'poison'

export interface Charm {
  id: number
  /** 0..5, or -1 for stones (which never match). */
  color: number
  kind: CharmKind
  /** Extra moves granted by a question charm (1-3). */
  bonus?: number
}

export type Board = (Charm | null)[][]

export interface Pos {
  r: number
  c: number
}

const key = (r: number, c: number): number => r * BOARD_SIZE + c
const fromKey = (k: number): Pos => ({ r: Math.floor(k / BOARD_SIZE), c: k % BOARD_SIZE })

/** Creates new charms. Every 5th–7th spawn is a question charm. */
export class Spawner {
  private nextId = 1
  private sinceQuestion = 0
  private nextQuestionAt: number
  constructor(readonly rng: Rng = defaultRng) {
    this.nextQuestionAt = randInt(5, 7, rng)
  }

  newId(): number {
    return this.nextId++
  }

  plain(color: number): Charm {
    return { id: this.newId(), color, kind: 'normal' }
  }

  question(color: number): Charm {
    return { id: this.newId(), color, kind: 'question', bonus: randInt(1, 3, this.rng) }
  }

  stone(): Charm {
    return { id: this.newId(), color: -1, kind: 'stone' }
  }

  bomb(color: number): Charm {
    return { id: this.newId(), color, kind: 'bomb' }
  }

  /** A charm dropping in from the top during refill. */
  spawn(stonesOnBoard: number): Charm {
    const color = randInt(0, COLOR_COUNT - 1, this.rng)
    this.sinceQuestion++
    if (this.sinceQuestion >= this.nextQuestionAt) {
      this.sinceQuestion = 0
      this.nextQuestionAt = randInt(5, 7, this.rng)
      return this.question(color)
    }
    const roll = this.rng()
    if (roll < 0.04) return { id: this.newId(), color, kind: 'poison' }
    if (roll < 0.06 && stonesOnBoard < MAX_STONES) return this.stone()
    return this.plain(color)
  }
}

export function cloneBoard(b: Board): Board {
  return b.map((row) => row.slice())
}

export function isMatchable(ch: Charm | null): ch is Charm {
  return !!ch && ch.kind !== 'stone' && ch.color >= 0
}

export function isSwappable(ch: Charm | null): ch is Charm {
  return !!ch && ch.kind !== 'stone'
}

export function countStones(b: Board): number {
  let n = 0
  for (const row of b) for (const ch of row) if (ch?.kind === 'stone') n++
  return n
}

export interface Run {
  cells: Pos[]
  color: number
}

/** All horizontal and vertical runs of 3+ matching charms. */
export function findRuns(b: Board): Run[] {
  const runs: Run[] = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    let c = 0
    while (c < BOARD_SIZE) {
      const ch = b[r][c]
      if (!isMatchable(ch)) {
        c++
        continue
      }
      let end = c + 1
      while (end < BOARD_SIZE && isMatchable(b[r][end]) && b[r][end]!.color === ch.color) end++
      if (end - c >= 3) runs.push({ color: ch.color, cells: Array.from({ length: end - c }, (_, i) => ({ r, c: c + i })) })
      c = end
    }
  }
  for (let c = 0; c < BOARD_SIZE; c++) {
    let r = 0
    while (r < BOARD_SIZE) {
      const ch = b[r][c]
      if (!isMatchable(ch)) {
        r++
        continue
      }
      let end = r + 1
      while (end < BOARD_SIZE && isMatchable(b[end][c]) && b[end][c]!.color === ch.color) end++
      if (end - r >= 3) runs.push({ color: ch.color, cells: Array.from({ length: end - r }, (_, i) => ({ r: r + i, c })) })
      r = end
    }
  }
  return runs
}

export function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1
}

function inBounds(p: Pos): boolean {
  return p.r >= 0 && p.r < BOARD_SIZE && p.c >= 0 && p.c < BOARD_SIZE
}

export function swapCells(b: Board, a: Pos, p: Pos): Board {
  const out = cloneBoard(b)
  const tmp = out[a.r][a.c]
  out[a.r][a.c] = out[p.r][p.c]
  out[p.r][p.c] = tmp
  return out
}

/**
 * A swap is allowed if both cells are adjacent, swappable, and the swap either
 * creates a match involving one of the two cells or moves a bomb (bombs are
 * "activated" by swapping them).
 */
export function checkSwap(b: Board, a: Pos, p: Pos): { valid: boolean; board: Board } {
  if (!inBounds(a) || !inBounds(p) || !isAdjacent(a, p)) return { valid: false, board: b }
  const ca = b[a.r][a.c]
  const cp = b[p.r][p.c]
  if (!isSwappable(ca) || !isSwappable(cp)) return { valid: false, board: b }
  const swapped = swapCells(b, a, p)
  if (ca.kind === 'bomb' || cp.kind === 'bomb') return { valid: true, board: swapped }
  const runs = findRuns(swapped)
  const touches = runs.some((run) => run.cells.some((c) => (c.r === a.r && c.c === a.c) || (c.r === p.r && c.c === p.c)))
  return { valid: touches, board: touches ? swapped : b }
}

export function findValidMove(b: Board): [Pos, Pos] | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const a = { r, c }
      for (const p of [
        { r, c: c + 1 },
        { r: r + 1, c }
      ]) {
        if (inBounds(p) && checkSwap(b, a, p).valid) return [a, p]
      }
    }
  }
  return null
}

export function hasValidMove(b: Board): boolean {
  return findValidMove(b) !== null
}

/** Fill a board with no pre-existing matches, a few stones and a few question charms. */
export function createBoard(spawner: Spawner): Board {
  const rng = spawner.rng
  for (let attempt = 0; attempt < 50; attempt++) {
    const b: Board = []
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row: (Charm | null)[] = []
      for (let c = 0; c < BOARD_SIZE; c++) {
        const banned = new Set<number>()
        if (c >= 2 && row[c - 1]!.color === row[c - 2]!.color) banned.add(row[c - 1]!.color)
        if (r >= 2 && b[r - 1][c]!.color === b[r - 2][c]!.color) banned.add(b[r - 1][c]!.color)
        const choices = Array.from({ length: COLOR_COUNT }, (_, i) => i).filter((x) => !banned.has(x))
        row.push(spawner.plain(choices[Math.floor(rng() * choices.length)]))
      }
      b.push(row)
    }
    const spots = shuffle(
      Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => i),
      rng
    )
    // Stones only in the lower half-ish so they are reachable by bombs; question charms anywhere.
    let stones = 0
    let questions = 0
    for (const k of spots) {
      const { r, c } = fromKey(k)
      if (stones < 3 && r >= 3) {
        b[r][c] = spawner.stone()
        stones++
      } else if (questions < 3) {
        b[r][c] = spawner.question(b[r][c]!.color)
        questions++
      }
      if (stones >= 3 && questions >= 3) break
    }
    if (findRuns(b).length === 0 && hasValidMove(b)) return b
  }
  // Practically unreachable; fall back to a reshuffle of the last attempt.
  return reshuffle(createPlainBoard(spawner), spawner)
}

function createPlainBoard(spawner: Spawner): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => spawner.plain(randInt(0, COLOR_COUNT - 1, spawner.rng)))
  )
}

/** Rearrange non-stone charms until there are no matches and at least one valid move. */
export function reshuffle(b: Board, spawner: Spawner): Board {
  const rng = spawner.rng
  const positions: Pos[] = []
  const charms: Charm[] = []
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++) {
      const ch = b[r][c]
      if (isSwappable(ch)) {
        positions.push({ r, c })
        charms.push(ch)
      }
    }
  for (let attempt = 0; attempt < 200; attempt++) {
    const order = shuffle(charms, rng)
    const out = cloneBoard(b)
    positions.forEach((p, i) => (out[p.r][p.c] = order[i]))
    if (findRuns(out).length === 0 && hasValidMove(out)) return out
  }
  // Give up on preserving colours: recolour plain charms randomly until it works.
  for (let attempt = 0; attempt < 500; attempt++) {
    const out = cloneBoard(b)
    for (const p of positions) {
      const ch = out[p.r][p.c]!
      out[p.r][p.c] = { ...ch, color: randInt(0, COLOR_COUNT - 1, rng) }
    }
    if (findRuns(out).length === 0 && hasValidMove(out)) return out
  }
  return createBoard(spawner)
}

export interface Step {
  combo: number
  cleared: Pos[]
  blastCenters: Pos[]
  /** Board with cleared cells set to null and new bombs placed. */
  boardCleared: Board
  /** Board after gravity and refill. */
  boardAfter: Board
  /** cell id -> rows it fell during refill (new charms included). */
  falls: Record<number, number>
  points: number
  questions: Charm[]
  poison: number
  stones: number
  bombsCreated: number
}

/**
 * Resolve matches repeatedly (cascades) until the board is stable.
 * `swapped` are the two swapped positions (preferred spots for new bombs);
 * bombs sitting on those positions after the swap are detonated.
 */
export function resolveBoard(start: Board, spawner: Spawner, swapped: Pos[] = []): Step[] {
  const steps: Step[] = []
  let board = cloneBoard(start)
  let combo = 0

  for (let guard = 0; guard < 100; guard++) {
    const runs = findRuns(board)
    const triggers = combo === 0 ? swapped.filter((p) => board[p.r][p.c]?.kind === 'bomb') : []
    if (runs.length === 0 && triggers.length === 0) break
    combo++

    const toClear = new Set<number>()
    for (const run of runs) for (const p of run.cells) toClear.add(key(p.r, p.c))

    // New bombs from runs of 4+.
    const newBombs = new Map<number, Charm>()
    for (const run of runs) {
      if (run.cells.length < 4) continue
      const candidates = [
        ...(combo === 1 ? run.cells.filter((p) => swapped.some((s) => s.r === p.r && s.c === p.c)) : []),
        run.cells[Math.floor(run.cells.length / 2)],
        ...run.cells
      ]
      const spot = candidates.find((p) => board[p.r][p.c]?.kind !== 'bomb' && !newBombs.has(key(p.r, p.c)))
      if (!spot) continue
      newBombs.set(key(spot.r, spot.c), spawner.bomb(run.color))
      toClear.delete(key(spot.r, spot.c))
    }

    // Detonations (chain reactions included).
    const queue: number[] = []
    const detonated = new Set<number>()
    for (const k of toClear) if (board[fromKey(k).r][fromKey(k).c]?.kind === 'bomb') queue.push(k)
    for (const p of triggers) {
      queue.push(key(p.r, p.c))
      toClear.add(key(p.r, p.c))
    }
    const blastCenters: Pos[] = []
    while (queue.length > 0) {
      const k = queue.shift()!
      if (detonated.has(k)) continue
      detonated.add(k)
      const center = fromKey(k)
      blastCenters.push(center)
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const p = { r: center.r + dr, c: center.c + dc }
          if (!inBounds(p)) continue
          const pk = key(p.r, p.c)
          if (newBombs.has(pk)) continue
          const ch = board[p.r][p.c]
          if (!ch) continue
          toClear.add(pk)
          if (ch.kind === 'bomb' && !detonated.has(pk)) queue.push(pk)
        }
    }

    let charmsCleared = 0
    let stones = 0
    let poison = 0
    const questions: Charm[] = []
    const cleared: Pos[] = []
    for (const k of toClear) {
      const p = fromKey(k)
      const ch = board[p.r][p.c]
      if (!ch) continue
      cleared.push(p)
      if (ch.kind === 'stone') stones++
      else charmsCleared++
      if (ch.kind === 'question') questions.push(ch)
      if (ch.kind === 'poison') poison++
    }
    const points = charmsCleared * POINTS_PER_CHARM * combo + stones * STONE_BONUS

    const boardCleared = cloneBoard(board)
    for (const p of cleared) boardCleared[p.r][p.c] = null
    for (const [k, bomb] of newBombs) {
      const p = fromKey(k)
      boardCleared[p.r][p.c] = bomb
    }

    // Gravity + refill.
    const boardAfter = cloneBoard(boardCleared)
    const falls: Record<number, number> = {}
    let stonesOnBoard = countStones(boardCleared)
    for (let c = 0; c < BOARD_SIZE; c++) {
      let write = BOARD_SIZE - 1
      for (let r = BOARD_SIZE - 1; r >= 0; r--) {
        const ch = boardCleared[r][c]
        if (ch) {
          boardAfter[write][c] = ch
          if (write !== r) falls[ch.id] = write - r
          write--
        }
      }
      const empties = write + 1
      for (let r = write; r >= 0; r--) {
        const ch = spawner.spawn(stonesOnBoard)
        if (ch.kind === 'stone') stonesOnBoard++
        boardAfter[r][c] = ch
        falls[ch.id] = empties
      }
    }

    steps.push({
      combo,
      cleared,
      blastCenters,
      boardCleared,
      boardAfter,
      falls,
      points,
      questions,
      poison,
      stones,
      bombsCreated: newBombs.size
    })
    board = boardAfter
  }
  return steps
}
