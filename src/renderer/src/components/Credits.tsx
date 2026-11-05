import { useEffect, useRef, useState } from 'react'

export const CREATOR = 'Thomas Dean'

/** Splash shown for a moment when the app opens. Click or press any key to skip. */
export function Splash({ onDone }: { onDone(): void }) {
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finish = () => {
      if (done.current) return
      done.current = true
      setLeaving(true)
      setTimeout(onDone, reduced ? 0 : 350)
    }
    const t = setTimeout(finish, reduced ? 900 : 2200)
    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [onDone])

  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`} role="status" aria-label={`StudyDeck, made by ${CREATOR}. Loading.`}>
      <div className="splash-inner">
        <div className="splash-mark" aria-hidden="true">
          ▤
        </div>
        <h1 className="splash-title">StudyDeck</h1>
        <div className="splash-bar" aria-hidden="true">
          <span />
        </div>
        <p className="splash-credit">
          Made by <strong>{CREATOR}</strong>
        </p>
      </div>
    </div>
  )
}

/** About / credits dialog opened from the top bar. */
export function CreditsDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="dialog credits"
      aria-labelledby="credits-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="splash-mark small" aria-hidden="true">
        ▤
      </div>
      <h2 id="credits-title">StudyDeck</h2>
      <p className="muted small">Version 1.0</p>
      <p className="credits-made">
        Made by <strong>{CREATOR}</strong>
      </p>
      <p className="muted">Flashcards, Learn, Test, Match, Charms, Lock and Deep Dive — all offline, all yours.</p>
      <div className="dialog-actions center">
        <button className="btn primary" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </dialog>
  )
}
