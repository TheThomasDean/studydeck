import type { Card } from '@shared/types'
import { MASTERY_LEVELS, masteryCounts } from '@lib/progress'

const LABELS = { new: 'New', learning: 'Learning', familiar: 'Familiar', mastered: 'Mastered' }

export function MasteryBar({ cards, showLegend = true }: { cards: Card[]; showLegend?: boolean }) {
  const counts = masteryCounts(cards)
  const total = cards.length || 1
  const summary = MASTERY_LEVELS.map((m) => `${counts[m]} ${LABELS[m].toLowerCase()}`).join(', ')
  return (
    <div className="mastery">
      <div className="mastery-bar" role="img" aria-label={`Card mastery: ${summary}`}>
        {MASTERY_LEVELS.map((m) =>
          counts[m] > 0 ? (
            <div key={m} className={`mastery-seg m-${m}`} style={{ width: `${(counts[m] / total) * 100}%` }} />
          ) : null
        )}
      </div>
      {showLegend && (
        <ul className="mastery-legend">
          {MASTERY_LEVELS.map((m) => (
            <li key={m}>
              <span className={`dot m-${m}`} aria-hidden="true" />
              {LABELS[m]} <strong>{counts[m]}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
