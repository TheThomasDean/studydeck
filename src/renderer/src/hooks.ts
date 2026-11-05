import { useEffect, useRef, useState } from 'react'

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduced(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return reduced
}

/** Global keydown listener that ignores keys typed into inputs unless `inInputs` is set. */
export function useKeydown(handler: (e: KeyboardEvent) => void, deps: unknown[], inInputs = false): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing && !inInputs) return
      ref.current(e)
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Milliseconds elapsed since `start` (or 0), re-rendering every `interval` ms while running. */
export function useElapsed(start: number | null, running: boolean, interval = 100): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(performance.now()), interval)
    return () => clearInterval(id)
  }, [running, interval])
  if (start === null) return 0
  return Math.max(0, now - start)
}

export function formatDate(ts: number | null): string {
  if (!ts) return 'Never'
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
