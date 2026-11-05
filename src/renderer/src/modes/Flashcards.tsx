import { useMemo, useRef, useState } from 'react'
import { shuffle } from '@lib/random'
import { useStore } from '../store'
import { useKeydown } from '../hooks'
import { play } from '../sound'
import { ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'study' | 'summary'

export function Flashcards({ set, cards, navigate }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const [order, setOrder] = useState<string[]>(() => cards.map((c) => c.id))
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [termFirst, setTermFirst] = useState(true)
  const [starOnly, setStarOnly] = useState(false)
  const [sortMode, setSortMode] = useState(false)
  const [known, setKnown] = useState<string[]>([])
  const [learning, setLearning] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('study')
  const [swipe, setSwipe] = useState<{ startX: number; dx: number } | null>(null)
  const [exit, setExit] = useState<'left' | 'right' | null>(null)
  const seen = useRef(new Set<string>())

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const starred = useMemo(() => new Set(set.cards.filter((c) => c.starred).map((c) => c.id)), [set.cards])
  const deck = useMemo(() => (starOnly ? order.filter((id) => starred.has(id)) : order), [order, starOnly, starred])
  const safeIndex = Math.min(index, Math.max(0, deck.length - 1))
  const current = deck.length > 0 ? byId.get(deck[safeIndex]) : undefined

  const front = current ? (termFirst ? current.term : current.definition) : ''
  const back = current ? (termFirst ? current.definition : current.term) : ''

  const markSeen = (id: string) => {
    if (seen.current.has(id)) return
    seen.current.add(id)
    progress.push({ cardId: id })
  }

  const flip = () => {
    if (!current) return
    setFlipped((f) => !f)
    markSeen(current.id)
    play('click')
  }

  const go = (delta: number) => {
    if (deck.length === 0) return
    const next = safeIndex + delta
    if (next < 0 || next >= deck.length) return
    setIndex(next)
    setFlipped(false)
  }

  const sortCard = (knowIt: boolean) => {
    if (!current || phase !== 'study') return
    const id = current.id
    progress.push({ cardId: id, correct: knowIt })
    seen.current.add(id)
    play(knowIt ? 'correct' : 'wrong')
    if (knowIt) setKnown((k) => [...k, id])
    else setLearning((l) => [...l, id])
    setExit(knowIt ? 'right' : 'left')
    window.setTimeout(() => {
      setExit(null)
      setFlipped(false)
      if (safeIndex + 1 >= deck.length) {
        setPhase('summary')
        progress.flush()
      } else setIndex(safeIndex + 1)
    }, 180)
  }

  const restart = (ids?: string[]) => {
    setOrder(ids ?? cards.map((c) => c.id))
    setIndex(0)
    setFlipped(false)
    setKnown([])
    setLearning([])
    setPhase('study')
  }

  const toggleStar = () => {
    if (!current) return
    const id = current.id
    updateSet(set.id, (s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, starred: !c.starred } : c)) }))
  }

  const speak = () => {
    if (!current || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(flipped ? back : front))
  }

  useKeydown(
    (e) => {
      if (phase !== 'study') return
      if (e.key === ' ' || e.key === 'Spacebar') {
        // Let Space activate focused buttons normally; flip otherwise.
        if ((e.target as HTMLElement).tagName === 'BUTTON' && !(e.target as HTMLElement).classList.contains('flip-card')) return
        e.preventDefault()
        flip()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (sortMode) sortCard(true)
        else go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (sortMode) sortCard(false)
        else go(-1)
      } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
        toggleStar()
      }
    },
    [phase, sortMode, deck, safeIndex, flipped, current]
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setSwipe({ startX: e.clientX, dx: 0 })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (swipe) setSwipe({ ...swipe, dx: e.clientX - swipe.startX })
  }
  const onPointerUp = () => {
    if (!swipe) return
    const { dx } = swipe
    setSwipe(null)
    if (Math.abs(dx) < 8) {
      flip()
      return
    }
    if (Math.abs(dx) > 90) {
      if (sortMode) sortCard(dx > 0)
      else go(dx > 0 ? -1 : 1)
    }
  }

  const header = (
    <ModeHeader title="Flashcards" set={set} navigate={navigate}>
      <label className="check compact">
        <input
          type="checkbox"
          checked={sortMode}
          onChange={(e) => {
            setSortMode(e.target.checked)
            restart(order)
          }}
        />
        Know it / Still learning
      </label>
    </ModeHeader>
  )

  if (phase === 'summary') {
    const learningCards = learning.map((id) => byId.get(id)!).filter(Boolean)
    return (
      <div className="page mode-page">
        {header}
        <div className="panel summary">
          <h2>Round complete!</h2>
          <div className="summary-stats">
            <div className="stat good">
              <span className="stat-num">{known.length}</span>Know it
            </div>
            <div className="stat warn">
              <span className="stat-num">{learning.length}</span>Still learning
            </div>
          </div>
          {learningCards.length > 0 && (
            <ul className="missed-list">
              {learningCards.map((c) => (
                <li key={c.id}>
                  <strong>{c.term}</strong>
                  <span>{c.definition}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row gap center">
            {learning.length > 0 && (
              <button className="btn primary" onClick={() => restart(learning)} autoFocus>
                Study {learning.length} still-learning {learning.length === 1 ? 'card' : 'cards'}
              </button>
            )}
            <button className="btn" onClick={() => restart()} autoFocus={learning.length === 0}>
              Restart all cards
            </button>
          </div>
        </div>
      </div>
    )
  }

  const dx = swipe?.dx ?? 0
  const swipeHint = sortMode && Math.abs(dx) > 30 ? (dx > 0 ? 'know' : 'learning') : null

  return (
    <div className="page mode-page">
      {header}
      {deck.length === 0 ? (
        <div className="empty">
          <h2>No starred cards</h2>
          <p>Star cards with ☆ (or press S) to study just those, or turn off the filter.</p>
          <button className="btn" onClick={() => setStarOnly(false)}>
            Show all cards
          </button>
        </div>
      ) : (
        <>
          <div className="fc-progress">
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${((safeIndex + 1) / deck.length) * 100}%` }} />
            </div>
            <span className="counter" aria-live="polite">
              {safeIndex + 1} / {deck.length}
            </span>
          </div>

          <div className="fc-stage">
            <button
              className={`flip-card ${flipped ? 'flipped' : ''} ${exit ? `exit-${exit}` : ''} ${swipeHint ? `hint-${swipeHint}` : ''}`}
              style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 30}deg)` } : undefined}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setSwipe(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  flip()
                }
              }}
              aria-label={`${flipped ? (termFirst ? 'Definition' : 'Term') : termFirst ? 'Term' : 'Definition'}: ${flipped ? back : front}. Press Space to flip.`}
            >
              <span className="flip-inner">
                <span className="flip-face flip-front">
                  <span className="face-label">{termFirst ? 'Term' : 'Definition'}</span>
                  <span className="face-text">{front}</span>
                </span>
                <span className="flip-face flip-back">
                  <span className="face-label">{termFirst ? 'Definition' : 'Term'}</span>
                  <span className="face-text">{back}</span>
                </span>
              </span>
              {swipeHint && <span className={`swipe-badge ${swipeHint}`}>{swipeHint === 'know' ? 'Know it' : 'Still learning'}</span>}
            </button>
          </div>

          {sortMode ? (
            <div className="row gap center fc-sort">
              <button className="btn warn-btn" onClick={() => sortCard(false)}>
                ← Still learning <span className="pill">{learning.length}</span>
              </button>
              <button className="btn good-btn" onClick={() => sortCard(true)}>
                Know it → <span className="pill">{known.length}</span>
              </button>
            </div>
          ) : (
            <div className="row gap center fc-nav">
              <button className="btn" onClick={() => go(-1)} disabled={safeIndex === 0} aria-label="Previous card">
                ←
              </button>
              <button className="btn" onClick={flip}>
                Flip (Space)
              </button>
              <button className="btn" onClick={() => go(1)} disabled={safeIndex >= deck.length - 1} aria-label="Next card">
                →
              </button>
            </div>
          )}

          <div className="fc-controls" role="toolbar" aria-label="Flashcard options">
            <button className="btn small" onClick={() => restart(shuffle(order))}>
              ⤨ Shuffle
            </button>
            <button className="btn small" onClick={() => restart()}>
              ↺ Restart
            </button>
            <button
              className={`btn small ${current && starred.has(current.id) ? 'starred' : ''}`}
              onClick={toggleStar}
              aria-pressed={!!current && starred.has(current.id)}
            >
              {current && starred.has(current.id) ? '★ Starred' : '☆ Star'}
            </button>
            <button className="btn small" aria-pressed={starOnly} onClick={() => { setStarOnly(!starOnly); setIndex(0); setFlipped(false) }}>
              {starOnly ? '★ Starred only' : 'All cards'}
            </button>
            <button className="btn small" onClick={() => { setTermFirst(!termFirst); setFlipped(false) }}>
              ⇄ {termFirst ? 'Term first' : 'Definition first'}
            </button>
            {'speechSynthesis' in window && (
              <button className="btn small" onClick={speak} aria-label="Read the visible side aloud">
                🔈 Speak
              </button>
            )}
          </div>
          <p className="muted small center-text">
            {sortMode
              ? 'Space flips · → or swipe right = Know it · ← or swipe left = Still learning · S stars'
              : 'Space flips · ← → move between cards · S stars the card'}
          </p>
        </>
      )}
    </div>
  )
}
