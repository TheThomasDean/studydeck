import type { ThemePref } from '@shared/types'
import { useStore } from '../store'
import type { Navigate } from '../routes'
import { useState } from 'react'
import { CreditsDialog } from './Credits'

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: follow system', light: 'Theme: light', dark: 'Theme: dark' }
function ThemeIcon({ theme }: { theme: ThemePref }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (theme === 'light')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  if (theme === 'dark')
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  )
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="M22 9l-6 6M16 9l6 6" />}
    </svg>
  )
}

export function TopBar({ navigate }: { navigate: Navigate }) {
  const { settings, setTheme, setSound } = useStore()
  const [showCredits, setShowCredits] = useState(false)
  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate({ name: 'library' })} aria-label="StudyDeck home">
        <span className="brand-mark" aria-hidden="true">
          ▤
        </span>
        StudyDeck
      </button>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={() => setShowCredits(true)} title="About StudyDeck" aria-label="About StudyDeck">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.01" />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={() => setSound(!settings.soundOn)}
          aria-pressed={settings.soundOn}
          title={settings.soundOn ? 'Sound effects on (click to mute)' : 'Sound effects muted (click to turn on)'}
          aria-label={settings.soundOn ? 'Mute sound effects' : 'Turn on sound effects'}
        >
          <SpeakerIcon on={settings.soundOn} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme(NEXT_THEME[settings.theme])}
          title={`${THEME_LABEL[settings.theme]} (click to change)`}
          aria-label={`${THEME_LABEL[settings.theme]}. Change theme`}
        >
          <ThemeIcon theme={settings.theme} />
        </button>
      </div>
      {showCredits && <CreditsDialog onClose={() => setShowCredits(false)} />}
    </header>
  )
}
