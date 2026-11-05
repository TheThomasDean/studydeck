import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card, StudySet } from '@shared/types'
import { makeCard } from '@lib/sets'
import { useStore } from '../store'
import type { Navigate } from '../routes'

const PAGE_SIZE = 100
const AUTOSAVE_MS = 400

export function Editor({ setId, navigate }: { setId: string; navigate: Navigate }) {
  const { getSet, saveSet, deleteSet } = useStore()
  const original = getSet(setId)
  const [draft, setDraft] = useState<StudySet | null>(original ?? null)
  const [page, setPage] = useState(0)
  const [lastDeleted, setLastDeleted] = useState<{ card: Card; index: number } | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'pending'>('saved')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const focusCardId = useRef<string | null>(null)
  const dirty = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const flush = useCallback(() => {
    if (dirty.current && draftRef.current) {
      saveSet(draftRef.current)
      dirty.current = false
      setSaveState('saved')
    }
  }, [saveSet])

  // Debounced autosave.
  useEffect(() => {
    if (!dirty.current) return
    setSaveState('pending')
    const t = setTimeout(flush, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [draft, flush])

  // Save on unmount.
  useEffect(() => () => flush(), [flush])

  // Focus a newly added card's term field.
  useEffect(() => {
    if (!focusCardId.current) return
    const el = document.getElementById(`term-${focusCardId.current}`)
    if (el) {
      el.focus()
      el.scrollIntoView({ block: 'center' })
      focusCardId.current = null
    }
  })

  if (!draft) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Set not found</h2>
          <button className="btn" onClick={() => navigate({ name: 'library' })}>
            Back to library
          </button>
        </div>
      </div>
    )
  }

  const update = (fn: (s: StudySet) => StudySet) => {
    dirty.current = true
    setDraft((d) => (d ? fn(d) : d))
  }

  const updateCard = (id: string, patch: Partial<Card>) =>
    update((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))

  const addCard = () => {
    const card = makeCard({ term: '', definition: '' })
    focusCardId.current = card.id
    update((s) => ({ ...s, cards: [...s.cards, card] }))
    setPage(Math.floor(draft.cards.length / PAGE_SIZE))
  }

  const deleteCard = (index: number) => {
    const card = draft.cards[index]
    setLastDeleted({ card, index })
    update((s) => ({ ...s, cards: s.cards.filter((_, i) => i !== index) }))
  }

  const undoDelete = () => {
    if (!lastDeleted) return
    const { card, index } = lastDeleted
    update((s) => {
      const cards = s.cards.slice()
      cards.splice(Math.min(index, cards.length), 0, card)
      return { ...s, cards }
    })
    setLastDeleted(null)
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.cards.length || from === to) return
    update((s) => {
      const cards = s.cards.slice()
      const [c] = cards.splice(from, 1)
      cards.splice(to, 0, c)
      return { ...s, cards }
    })
  }

  const done = () => {
    const d = draftRef.current
    const isEmpty = d && !d.title.trim() && !d.description.trim() && d.cards.every((c) => !c.term.trim() && !c.definition.trim())
    if (d && isEmpty) {
      dirty.current = false
      void deleteSet(d.id)
      navigate({ name: 'library' })
      return
    }
    if (d && !d.title.trim()) {
      dirty.current = true
      draftRef.current = { ...d, title: 'Untitled set' }
    }
    flush()
    navigate({ name: 'set', setId })
  }

  const pageCount = Math.max(1, Math.ceil(draft.cards.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE_SIZE
  const pageCards = draft.cards.slice(start, start + PAGE_SIZE)

  return (
    <div className="page editor">
      <div className="page-head sticky-head">
        <div className="row gap">
          <h1>Edit set</h1>
          <span className="muted small" aria-live="polite">
            {saveState === 'saved' ? '✓ All changes saved' : 'Saving…'}
          </span>
        </div>
        <button className="btn primary" onClick={done}>
          Done
        </button>
      </div>

      <div className="panel form">
        <label className="field">
          <span>Title</span>
          <input
            value={draft.title}
            placeholder="e.g. Biology – Chapter 4"
            onChange={(e) => update((s) => ({ ...s, title: e.target.value }))}
            autoFocus={!draft.title}
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            value={draft.description}
            placeholder="Optional"
            rows={2}
            onChange={(e) => update((s) => ({ ...s, description: e.target.value }))}
          />
        </label>
      </div>

      {lastDeleted && (
        <div className="undo-bar" role="status">
          Deleted “{lastDeleted.card.term || 'empty card'}”.
          <button className="btn small" onClick={undoDelete}>
            Undo
          </button>
          <button className="link-btn" onClick={() => setLastDeleted(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="card-table" role="table" aria-label="Cards">
        <div className="card-row card-row-head" role="row">
          <span role="columnheader" className="col-num">
            #
          </span>
          <span role="columnheader">Term</span>
          <span role="columnheader">Definition</span>
          <span role="columnheader" className="sr-only">
            Actions
          </span>
        </div>
        {pageCards.length === 0 && <p className="muted pad">No cards yet. Add your first card below.</p>}
        {pageCards.map((card, i) => {
          const index = start + i
          return (
            <div
              key={card.id}
              role="row"
              className={`card-row ${dragIndex === index ? 'dragging' : ''} ${dropIndex === index && dragIndex !== index ? 'drop-target' : ''}`}
              onDragOver={(e) => {
                if (dragIndex === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropIndex(index)
              }}
              onDrop={(e) => {
                if (dragIndex === null) return
                e.preventDefault()
                move(dragIndex, index)
                setDragIndex(null)
                setDropIndex(null)
              }}
            >
              <span className="col-num" role="cell">
                <span
                  className="drag-handle"
                  draggable
                  title="Drag to reorder"
                  aria-hidden="true"
                  onDragStart={(e) => {
                    setDragIndex(index)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(index))
                  }}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                >
                  ⋮⋮
                </span>
                {index + 1}
              </span>
              <span role="cell">
                <textarea
                  id={`term-${card.id}`}
                  className="cell-input"
                  rows={1}
                  aria-label={`Term ${index + 1}`}
                  value={card.term}
                  placeholder="Term"
                  onChange={(e) => updateCard(card.id, { term: e.target.value })}
                />
              </span>
              <span role="cell">
                <textarea
                  className="cell-input"
                  rows={1}
                  aria-label={`Definition ${index + 1}`}
                  value={card.definition}
                  placeholder="Definition"
                  onChange={(e) => updateCard(card.id, { definition: e.target.value })}
                  onKeyDown={(e) => {
                    // Tab out of the last definition adds a new card, like Quizlet.
                    if (e.key === 'Tab' && !e.shiftKey && index === draft.cards.length - 1) {
                      e.preventDefault()
                      addCard()
                    }
                  }}
                />
              </span>
              <span role="cell" className="row-actions">
                <button
                  className={`icon-btn star ${card.starred ? 'on' : ''}`}
                  aria-pressed={card.starred}
                  aria-label={card.starred ? `Unstar card ${index + 1}` : `Star card ${index + 1}`}
                  title={card.starred ? 'Unstar' : 'Star'}
                  onClick={() => updateCard(card.id, { starred: !card.starred })}
                >
                  {card.starred ? '★' : '☆'}
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Move card ${index + 1} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Move card ${index + 1} down`}
                  title="Move down"
                  disabled={index === draft.cards.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-btn danger-text"
                  aria-label={`Delete card ${index + 1}`}
                  title="Delete card"
                  onClick={() => deleteCard(index)}
                >
                  🗑
                </button>
              </span>
            </div>
          )
        })}
      </div>

      {pageCount > 1 && (
        <nav className="pager" aria-label="Card pages">
          <button className="btn small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ← Previous
          </button>
          <span>
            Cards {start + 1}–{Math.min(start + PAGE_SIZE, draft.cards.length)} of {draft.cards.length}
          </span>
          <button className="btn small" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            Next →
          </button>
        </nav>
      )}

      <button className="btn add-card" onClick={addCard}>
        ＋ Add card
      </button>
    </div>
  )
}
