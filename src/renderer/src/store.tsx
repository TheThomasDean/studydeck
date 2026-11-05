import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Settings, StudySet, ThemePref } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { applyProgress, normalizeSet, type ProgressEvent } from '@lib/progress'
import { makeSampleSet } from '@lib/sets'
import { setSoundEnabled } from './sound'

interface Store {
  ready: boolean
  loadError: string | null
  sets: StudySet[]
  settings: Settings
  getSet(id: string): StudySet | undefined
  /** Save a set. `touch` bumps updatedAt (content edits); progress updates leave it. */
  saveSet(set: StudySet, touch?: boolean): void
  deleteSet(id: string): Promise<void>
  recordProgress(setId: string, events: ProgressEvent[]): void
  updateSet(setId: string, fn: (s: StudySet) => StudySet): void
  setTheme(theme: ThemePref): void
  setSound(on: boolean): void
  notify(message: string, kind?: 'info' | 'error'): void
  toast: { id: number; message: string; kind: 'info' | 'error' } | null
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}

const api = window.studydeck

let initialLoad: Promise<{ sets: StudySet[]; settings: Settings }> | null = null

/** Load everything once (guards against StrictMode double effects seeding twice). */
function loadInitial(): Promise<{ sets: StudySet[]; settings: Settings }> {
  initialLoad ??= (async () => {
    const [rawSets, s] = await Promise.all([api.listSets(), api.getSettings()])
    let sets = rawSets.map(normalizeSet)
    let settings = s
    if (!s.seeded) {
      const sample = makeSampleSet()
      await api.saveSet(sample)
      sets = [...sets, sample]
      settings = { ...s, seeded: true }
      await api.saveSettings(settings)
    }
    return { sets, settings }
  })()
  return initialLoad
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sets, setSets] = useState<StudySet[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [toast, setToast] = useState<Store['toast']>(null)
  const setsRef = useRef<StudySet[]>([])
  setsRef.current = sets

  const notify = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setToast({ id: Date.now() + Math.random(), message, kind })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 3000)
    return () => clearTimeout(t)
  }, [toast])

  const persist = useCallback(
    (set: StudySet) => {
      api.saveSet(set).catch((err: unknown) => notify(`Could not save "${set.title}": ${String(err)}`, 'error'))
    },
    [notify]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { sets: loaded, settings: nextSettings } = await loadInitial()
        if (cancelled) return
        setSets(loaded)
        setSettings(nextSettings)
        setSoundEnabled(nextSettings.soundOn)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Theme: follow OS unless overridden.
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  const saveSettings = useCallback(
    (next: Settings) => {
      setSettings(next)
      api.saveSettings(next).catch((err: unknown) => notify(`Could not save settings: ${String(err)}`, 'error'))
    },
    [notify]
  )

  const saveSet = useCallback(
    (set: StudySet, touch = true) => {
      const next = touch ? { ...set, updatedAt: Date.now() } : set
      setSets((prev) => {
        const i = prev.findIndex((s) => s.id === next.id)
        if (i === -1) return [...prev, next]
        const copy = prev.slice()
        copy[i] = next
        return copy
      })
      persist(next)
    },
    [persist]
  )

  const updateSet = useCallback(
    (setId: string, fn: (s: StudySet) => StudySet) => {
      const current = setsRef.current.find((s) => s.id === setId)
      if (!current) return
      const next = fn(current)
      setsRef.current = setsRef.current.map((s) => (s.id === setId ? next : s))
      saveSet(next, false)
    },
    [saveSet]
  )

  const recordProgress = useCallback(
    (setId: string, events: ProgressEvent[]) => {
      if (events.length === 0) return
      updateSet(setId, (s) => applyProgress(s, events))
    },
    [updateSet]
  )

  const deleteSet = useCallback(
    async (id: string) => {
      setSets((prev) => prev.filter((s) => s.id !== id))
      try {
        await api.deleteSet(id)
      } catch (err) {
        notify(`Could not delete the set: ${String(err)}`, 'error')
      }
    },
    [notify]
  )

  const value = useMemo<Store>(
    () => ({
      ready,
      loadError,
      sets,
      settings,
      toast,
      getSet: (id) => sets.find((s) => s.id === id),
      saveSet,
      deleteSet,
      recordProgress,
      updateSet,
      setTheme: (theme) => saveSettings({ ...settings, theme }),
      setSound: (on) => {
        setSoundEnabled(on)
        saveSettings({ ...settings, soundOn: on })
      },
      notify
    }),
    [ready, loadError, sets, settings, toast, saveSet, deleteSet, recordProgress, updateSet, saveSettings, notify]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
