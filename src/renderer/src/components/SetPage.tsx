import { studyableCards } from '@lib/sets'
import { formatMs } from '@lib/match'
import { MIN_CARDS_FOR_CHARMS } from '@lib/charms'
import { learnCounts, syncLearn } from '@lib/learn'
import { useStore } from '../store'
import { formatDate } from '../hooks'
import type { ModeName, Navigate } from '../routes'
import { exportSet } from '../exportActions'
import { MasteryBar } from './MasteryBar'

const MODES: { mode: ModeName; title: string; icon: string; blurb: string }[] = [
  { mode: 'learn', title: 'Learn', icon: '🎯', blurb: 'Guided rounds of questions until you master every card.' },
  { mode: 'flashcards', title: 'Flashcards', icon: '🂠', blurb: 'Flip through cards and sort what you know.' },
  { mode: 'test', title: 'Test', icon: '✎', blurb: 'Multiple choice, true/false, written and matching.' },
  { mode: 'match', title: 'Match', icon: '⧉', blurb: 'Race the clock to pair terms and definitions.' },
  { mode: 'charms', title: 'Charms', icon: '◆', blurb: 'Match-3 puzzle powered by your questions.' },
  { mode: 'lock', title: 'Lock', icon: '🔒', blurb: 'Type answers to crack the vault before time runs out.' },
  { mode: 'deepdive', title: 'Deep Dive', icon: '🎣', blurb: 'Fish for definitions; missed cards return as rare fish.' }
]

export function SetPage({ setId, navigate }: { setId: string; navigate: Navigate }) {
  const { getSet, notify } = useStore()
  const set = getSet(setId)

  if (!set) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Set not found</h2>
          <p>It may have been deleted.</p>
          <button className="btn" onClick={() => navigate({ name: 'library' })}>
            Back to library
          </button>
        </div>
      </div>
    )
  }

  const usable = studyableCards(set.cards)
  const scores = set.history.testScores.slice().reverse()

  return (
    <div className="page">
      <button className="link-btn" onClick={() => navigate({ name: 'library' })}>
        ← All sets
      </button>
      <div className="page-head">
        <div>
          <h1>{set.title || 'Untitled set'}</h1>
          {set.description && <p className="muted">{set.description}</p>}
          <p className="muted small">
            {set.cards.length} cards · Last studied {formatDate(set.lastStudied)}
          </p>
        </div>
        <div className="row gap wrap">
          <button className="btn" onClick={() => navigate({ name: 'edit', setId })}>
            ✎ Edit
          </button>
          <button className="btn" onClick={() => void exportSet(set, 'xlsx', notify)} disabled={set.cards.length === 0}>
            Export .xlsx
          </button>
          <button className="btn" onClick={() => void exportSet(set, 'csv', notify)} disabled={set.cards.length === 0}>
            Export .csv
          </button>
        </div>
      </div>

      {usable.length === 0 ? (
        <div className="empty">
          <h2>This set has no complete cards yet</h2>
          <p>Add at least one card with both a term and a definition to start studying.</p>
          <button className="btn primary" onClick={() => navigate({ name: 'edit', setId })}>
            Add cards
          </button>
        </div>
      ) : (
        <ul className="mode-grid">
          {MODES.map((m) => {
            let note = m.mode === 'charms' && usable.length < MIN_CARDS_FOR_CHARMS ? `Needs ${MIN_CARDS_FOR_CHARMS}+ cards` : null
            if (m.mode === 'learn' && set.learn) {
              const lc = learnCounts(syncLearn(set.learn, usable.map((c) => c.id)))
              note = `${lc.mastered} of ${lc.total} mastered · round ${set.learn.round}`
            }
            return (
              <li key={m.mode}>
                <button className="mode-tile" onClick={() => navigate({ name: 'study', setId, mode: m.mode })}>
                  <span className={`mode-icon mode-${m.mode}`} aria-hidden="true">
                    {m.icon}
                  </span>
                  <span className="mode-title">{m.title}</span>
                  <span className="mode-blurb">{note ?? m.blurb}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="stats-grid">
        <section className="panel">
          <h2>Progress</h2>
          <MasteryBar cards={set.cards} />
        </section>
        <section className="panel">
          <h2>Records</h2>
          <dl className="records">
            <div>
              <dt>Best Match time</dt>
              <dd>{set.history.bestMatchMs !== null ? formatMs(set.history.bestMatchMs) : '—'}</dd>
            </div>
            <div>
              <dt>Charms high score</dt>
              <dd>{set.history.charmsHighScore || '—'}</dd>
            </div>
            <div>
              <dt>Lock best score</dt>
              <dd>{set.history.lockBestScore || '—'}</dd>
            </div>
            <div>
              <dt>Deep Dive best</dt>
              <dd>{set.history.deepDiveBest || '—'}</dd>
            </div>
          </dl>
        </section>
        <section className="panel span-2">
          <h2>Test history</h2>
          {scores.length === 0 ? (
            <p className="muted">No tests taken yet. Your scores will appear here.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Correct</th>
                </tr>
              </thead>
              <tbody>
                {scores.slice(0, 15).map((s, i) => (
                  <tr key={`${s.date}-${i}`}>
                    <td>{formatDate(s.date)}</td>
                    <td>
                      <span className="score-chip" data-good={s.percent >= 80}>
                        {s.percent}%
                      </span>
                    </td>
                    <td>
                      {s.correct} / {s.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
