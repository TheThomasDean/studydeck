import { useMemo, useState } from 'react'
import type { StudySet } from '@shared/types'
import { makeSet } from '@lib/sets'
import { useStore } from '../store'
import { formatDate } from '../hooks'
import type { Navigate } from '../routes'
import { ConfirmDialog } from './ConfirmDialog'
import { MasteryBar } from './MasteryBar'

type Sort = 'recent' | 'name'

export function Library({ navigate }: { navigate: Navigate }) {
  const { sets, saveSet, deleteSet, notify } = useStore()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [pendingDelete, setPendingDelete] = useState<StudySet | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? sets.filter((s) => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      : sets
    const sorted = filtered.slice()
    if (sort === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    else sorted.sort((a, b) => Math.max(b.lastStudied ?? 0, b.updatedAt) - Math.max(a.lastStudied ?? 0, a.updatedAt))
    return sorted
  }, [sets, query, sort])

  const newSet = () => {
    const set = makeSet('', '', [
      { term: '', definition: '' },
      { term: '', definition: '' }
    ])
    saveSet(set)
    navigate({ name: 'edit', setId: set.id })
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your study sets</h1>
          <p className="muted">Create a set, import one from Excel, or drop a spreadsheet anywhere on this window.</p>
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => navigate({ name: 'import' })}>
            ⇪ Import from Excel
          </button>
          <button className="btn primary" onClick={newSet}>
            ＋ New set
          </button>
        </div>
      </div>

      {sets.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <span className="sr-only">Search sets</span>
            <input
              type="search"
              placeholder="Search sets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="row gap-sm">
            <span className="muted">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">Most recent</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </label>
        </div>
      )}

      {sets.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ▤
          </div>
          <h2>No study sets yet</h2>
          <p>Make your first set by hand or import a spreadsheet with terms in column A and definitions in column B.</p>
          <div className="row gap center">
            <button className="btn" onClick={() => navigate({ name: 'import' })}>
              Import from Excel
            </button>
            <button className="btn primary" onClick={newSet}>
              New set
            </button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h2>No matches</h2>
          <p>No sets match “{query}”.</p>
          <button className="btn" onClick={() => setQuery('')}>
            Clear search
          </button>
        </div>
      ) : (
        <ul className="set-grid">
          {visible.map((s) => (
            <li key={s.id} className="set-card">
              <button className="set-card-main" onClick={() => navigate({ name: 'set', setId: s.id })}>
                <h2 className="set-title">{s.title || 'Untitled set'}</h2>
                <p className="muted small">
                  {s.cards.length} {s.cards.length === 1 ? 'card' : 'cards'} · Last studied {formatDate(s.lastStudied)}
                </p>
                {s.description && <p className="set-desc">{s.description}</p>}
                <MasteryBar cards={s.cards} showLegend={false} />
              </button>
              <button
                className="icon-btn set-card-delete"
                aria-label={`Delete ${s.title || 'untitled set'}`}
                title="Delete set"
                onClick={() => setPendingDelete(s)}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this set?"
          message={`“${pendingDelete.title || 'Untitled set'}” and its ${pendingDelete.cards.length} cards and study history will be permanently deleted.`}
          confirmLabel="Delete set"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const title = pendingDelete.title
            void deleteSet(pendingDelete.id)
            setPendingDelete(null)
            notify(`Deleted “${title || 'Untitled set'}”`)
          }}
        />
      )}
    </div>
  )
}
