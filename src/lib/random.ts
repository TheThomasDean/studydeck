/** A random number generator returning a float in [0, 1). */
export type Rng = () => number

export const defaultRng: Rng = () => Math.random()

/** Deterministic RNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(min: number, maxInclusive: number, rng: Rng = defaultRng): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1))
}

/** Fisher–Yates shuffle returning a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = defaultRng): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Up to n distinct random items. */
export function sample<T>(items: readonly T[], n: number, rng: Rng = defaultRng): T[] {
  return shuffle(items, rng).slice(0, Math.max(0, n))
}

export function pick<T>(items: readonly T[], rng: Rng = defaultRng): T {
  return items[Math.floor(rng() * items.length)]
}

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
