import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import {
  BOARD_SIZE,
  checkSwap,
  createBoard,
  hasValidMove,
  isAdjacent,
  MIN_CARDS_FOR_CHARMS,
  reshuffle,
  resolveBoard,
  Spawner,
  START_MOVES,
  type Board,
  type Charm,
  type Pos
} from '@lib/charms'
import { makeMc, type McQuestion } from '@lib/testGen'
import { pick } from '@lib/random'
import { useStore } from '../store'
import { useKeydown, useReducedMotion } from '../hooks'
import { play } from '../sound'
import { MissedList, ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'playing' | 'animating' | 'question' | 'over'

const COLOR_NAMES = ['Red circle', 'Orange square', 'Yellow triangle', 'Green diamond', 'Blue star', 'Purple hexagon']

const k = (p: Pos) => p.r * BOARD_SIZE + p.c

interface PendingQuestion {
  charm: Charm
  card: Card
  q: McQuestion
  answer: number | null
}

export function CharmsMode(props: ModeProps) {
  if (props.cards.length < MIN_CARDS_FOR_CHARMS) {
    return (
      <div className="page mode-page">
        <ModeHeader title="Charms" set={props.set} navigate={props.navigate} />
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ◆
          </div>
          <h2>Charms needs at least {MIN_CARDS_FOR_CHARMS} cards</h2>
          <p>
            This set has {props.cards.length} complete {props.cards.length === 1 ? 'card' : 'cards'}. Add {MIN_CARDS_FOR_CHARMS - props.cards.length} more
            to unlock the game, so there are enough answers for the questions.
          </p>
          <button className="btn primary" onClick={() => props.navigate({ name: 'edit', setId: props.set.id })}>
            Add cards
          </button>
        </div>
      </div>
    )
  }
  return <CharmsGame {...props} />
}

function CharmsGame({ set, cards, navigate, studySubset }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const reduced = useReducedMotion()
  const spawner = useRef(new Spawner())
  const [board, setBoard] = useState<Board>(() => createBoard(spawner.current))
  const [phase, setPhase] = useState<Phase>('playing')
  const [moves, setMoves] = useState(START_MOVES)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [bestCombo, setBestCombo] = useState(0)
  const [selected, setSelected] = useState<Pos | null>(null)
  const [focusPos, setFocusPos] = useState<Pos>({ r: 0, c: 0 })
  const [clearing, setClearing] = useState<Set<number>>(new Set())
  const [blasts, setBlasts] = useState<Set<number>>(new Set())
  const [invalid, setInvalid] = useState<Set<number>>(new Set())
  const [falls, setFalls] = useState<Record<number, number>>({})
  const [fallVersion, setFallVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [question, setQuestion] = useState<PendingQuestion | null>(null)
  const [asked, setAsked] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [missedIds, setMissedIds] = useState<string[]>([])
  const [highScore, setHighScore] = useState(set.history.charmsHighScore)
  const [newHigh, setNewHigh] = useState(false)
  const [floating, setFloating] = useState<{ id: number; text: string } | null>(null)

  const movesRef = useRef(START_MOVES)
  const scoreRef = useRef(0)
  const queueRef = useRef<Charm[]>([])
  const alive = useRef(true)
  const dragFrom = useRef<Pos | null>(null)
  const suppressClick = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const recentCards = useRef<string[]>([])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reduced ? Math.min(ms, 60) : ms))

  const setMovesBoth = (n: number) => {
    movesRef.current = Math.max(0, n)
    setMoves(movesRef.current)
  }

  const flash = (text: string) => setFloating({ id: Date.now() + Math.random(), text })

  const endGame = () => {
    const finalScore = scoreRef.current
    setPhase('over')
    progress.flush()
    if (finalScore > set.history.charmsHighScore) {
      setNewHigh(true)
      setHighScore(finalScore)
      updateSet(set.id, (s) => ({ ...s, lastStudied: Date.now(), history: { ...s.history, charmsHighScore: Math.max(finalScore, s.history.charmsHighScore) } }))
    } else {
      updateSet(set.id, (s) => ({ ...s, lastStudied: Date.now() }))
    }
    play('win')
  }

  const makeQuestion = (charm: Charm): PendingQuestion | null => {
    const fresh = cards.filter((c) => !recentCards.current.includes(c.id))
    const card = pick(fresh.length > 0 ? fresh : cards)
    recentCards.current = [...recentCards.current, card.id].slice(-Math.min(5, cards.length - 1))
    const q = makeMc(cards, card, 'definition') ?? makeMc(cards, card, 'term')
    return q ? { charm, card, q, answer: null } : null
  }

  /** Show the next queued question, or continue/finish the game. */
  const advance = () => {
    while (queueRef.current.length > 0) {
      const charm = queueRef.current.shift()!
      const pq = makeQuestion(charm)
      if (pq) {
        setQuestion(pq)
        setPhase('question')
        return
      }
    }
    setQuestion(null)
    if (movesRef.current <= 0) endGame()
    else setPhase('playing')
  }

  const doSwap = async (a: Pos, b: Pos) => {
    if (phase !== 'playing') return
    const res = checkSwap(board, a, b)
    setSelected(null)
    if (!res.valid) {
      setInvalid(new Set([k(a), k(b)]))
      play('wrong')
      setTimeout(() => alive.current && setInvalid(new Set()), 350)
      return
    }
    play('click')
    setPhase('animating')
    setMovesBoth(movesRef.current - 1)
    setBoard(res.board)
    await wait(160)

    const steps = resolveBoard(res.board, spawner.current, [a, b])
    let current = res.board
    for (const step of steps) {
      if (!alive.current) return
      setCombo(step.combo)
      setBestCombo((c) => Math.max(c, step.combo))
      setClearing(new Set(step.cleared.map(k)))
      setBlasts(new Set(step.blastCenters.map(k)))
      play(step.blastCenters.length > 0 ? 'win' : 'pop')
      await wait(step.blastCenters.length > 0 ? 340 : 230)
      if (!alive.current) return
      scoreRef.current += step.points
      setScore(scoreRef.current)
      const notes: string[] = [`+${step.points}`]
      if (step.combo > 1) notes.push(`Combo ×${step.combo}`)
      if (step.stones > 0) notes.push(`Stone +${step.stones * 100}`)
      if (step.poison > 0) {
        setMovesBoth(movesRef.current - step.poison)
        notes.push(`Poison −${step.poison} move${step.poison > 1 ? 's' : ''}`)
      }
      flash(notes.join(' · '))
      queueRef.current.push(...step.questions)
      setClearing(new Set())
      setBlasts(new Set())
      setFalls(step.falls)
      setFallVersion((v) => v + 1)
      setBoard(step.boardAfter)
      current = step.boardAfter
      await wait(300)
    }
    if (!alive.current) return
    setFalls({})
    setCombo(0)

    if (!hasValidMove(current)) {
      setNotice('No moves left — reshuffling the board!')
      await wait(900)
      current = reshuffle(current, spawner.current)
      setBoard(current)
      setTimeout(() => alive.current && setNotice(null), 1200)
    }
    advance()
  }

  const answerQuestion = (choice: number) => {
    if (!question || question.answer !== null) return
    const correct = choice === question.q.correctIndex
    setQuestion({ ...question, answer: choice })
    setAsked((n) => n + 1)
    progress.push({ cardId: question.card.id, correct })
    if (correct) {
      setCorrectCount((n) => n + 1)
      setMovesBoth(movesRef.current + (question.charm.bonus ?? 1))
      play('correct')
    } else {
      setMissedIds((m) => (m.includes(question.card.id) ? m : [...m, question.card.id]))
      play('wrong')
    }
  }

  const clickCell = (p: Pos) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (phase !== 'playing') return
    const ch = board[p.r][p.c]
    if (!ch || ch.kind === 'stone') {
      setSelected(null)
      return
    }
    if (!selected) setSelected(p)
    else if (selected.r === p.r && selected.c === p.c) setSelected(null)
    else if (isAdjacent(selected, p)) void doSwap(selected, p)
    else setSelected(p)
  }

  const posFromPoint = (x: number, y: number): Pos | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-r]') as HTMLElement | null
    if (!el || !gridRef.current?.contains(el)) return null
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (phase !== 'playing') return
    const p = posFromPoint(e.clientX, e.clientY)
    dragFrom.current = p
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const from = dragFrom.current
    if (!from) return
    const p = posFromPoint(e.clientX, e.clientY)
    if (p && isAdjacent(from, p)) {
      dragFrom.current = null
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 400)
      void doSwap(from, p)
    }
  }
  const onPointerUp = () => {
    dragFrom.current = null
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const delta = d[e.key]
    if (!delta) return
    e.preventDefault()
    const next = {
      r: Math.min(BOARD_SIZE - 1, Math.max(0, focusPos.r + delta[0])),
      c: Math.min(BOARD_SIZE - 1, Math.max(0, focusPos.c + delta[1]))
    }
    setFocusPos(next)
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-r="${next.r}"][data-c="${next.c}"]`)
    el?.focus()
  }

  useKeydown(
    (e) => {
      if (phase !== 'question' || !question) return
      const n = Number(e.key)
      if (question.answer === null && n >= 1 && n <= question.q.options.length) {
        e.preventDefault()
        answerQuestion(n - 1)
      } else if (question.answer !== null && e.key === 'Enter') {
        e.preventDefault()
        advance()
      }
    },
    [phase, question]
  )

  const restart = () => {
    progress.flush()
    spawner.current = new Spawner()
    setBoard(createBoard(spawner.current))
    movesRef.current = START_MOVES
    scoreRef.current = 0
    queueRef.current = []
    setMoves(START_MOVES)
    setScore(0)
    setCombo(0)
    setBestCombo(0)
    setAsked(0)
    setCorrectCount(0)
    setMissedIds([])
    setNewHigh(false)
    setSelected(null)
    setQuestion(null)
    setPhase('playing')
  }

  const missedCards = useMemo(() => missedIds.map((id) => cards.find((c) => c.id === id)!).filter(Boolean), [missedIds, cards])

  if (phase === 'over') {
    return (
      <div className="page mode-page">
        <ModeHeader title="Charms" set={set} navigate={navigate} />
        <div className="panel center-panel">
          <h2>{newHigh ? 'New high score!' : 'Out of moves'}</h2>
          <p className="big-number">{score}</p>
          <div className="summary-stats">
            <div className="stat">
              <span className="stat-num">{highScore}</span>High score
            </div>
            <div className="stat good">
              <span className="stat-num">
                {correctCount}/{asked}
              </span>
              Questions right
            </div>
            <div className="stat">
              <span className="stat-num">×{bestCombo}</span>Best combo
            </div>
          </div>
          <h3>Missed terms</h3>
          <MissedList cards={missedCards} />
          <div className="row gap center">
            <button className="btn primary" onClick={restart} autoFocus>
              Play again
            </button>
            {missedCards.length > 0 && (
              <button className="btn" onClick={() => studySubset('flashcards', missedIds)}>
                Study missed terms
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page mode-page charms-page">
      <ModeHeader title="Charms" set={set} navigate={navigate} />
      <div className="charms-layout">
        <aside className="hud" aria-label="Game status">
          <div className="hud-item">
            <span className="hud-label">Score</span>
            <span className="hud-value">{score}</span>
          </div>
          <div className={`hud-item ${moves <= 3 ? 'low' : ''}`}>
            <span className="hud-label">Moves left</span>
            <span className="hud-value" aria-live="polite">
              {moves}
            </span>
          </div>
          <div className="hud-item">
            <span className="hud-label">Combo</span>
            <span className={`hud-value ${combo > 1 ? 'combo-hot' : ''}`}>{combo > 1 ? `×${combo}` : '—'}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">Questions</span>
            <span className="hud-value small">
              {correctCount}/{asked}
            </span>
          </div>
          <div className="hud-item">
            <span className="hud-label">High score</span>
            <span className="hud-value small">{highScore}</span>
          </div>
          <details className="legend">
            <summary>How to play</summary>
            <p>Swap two neighbouring charms to line up 3 or more of the same shape. Each swap costs a move.</p>
            <ul>
              <li>
                <CharmIcon charm={{ id: -1, color: 4, kind: 'question', bonus: 2 }} /> Question: answer right for bonus moves
              </li>
              <li>
                <CharmIcon charm={{ id: -2, color: 0, kind: 'bomb' }} /> Bomb: made by matching 4+; swap or match it to clear 3×3
              </li>
              <li>
                <CharmIcon charm={{ id: -3, color: -1, kind: 'stone' }} /> Stone: only bombs break it (+100)
              </li>
              <li>
                <CharmIcon charm={{ id: -4, color: 3, kind: 'poison' }} /> Poison: costs 1 move when matched
              </li>
            </ul>
          </details>
        </aside>

        <div className="board-wrap">
          <div
            ref={gridRef}
            className={`charm-board ${phase !== 'playing' ? 'locked' : ''}`}
            role="grid"
            aria-label="Charms board. Use arrow keys to move, Enter to select and swap."
            onKeyDown={onGridKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {board.flatMap((row, r) =>
              row.map((ch, c) => {
                if (!ch) return null
                const pk = r * BOARD_SIZE + c
                const fall = falls[ch.id]
                const isSel = selected?.r === r && selected?.c === c
                const isFocus = focusPos.r === r && focusPos.c === c
                return (
                  <button
                    key={fall ? `${ch.id}-${fallVersion}` : ch.id}
                    data-r={r}
                    data-c={c}
                    role="gridcell"
                    tabIndex={isFocus ? 0 : -1}
                    className={`charm ${isSel ? 'selected' : ''} ${clearing.has(pk) ? 'clearing' : ''} ${blasts.has(pk) ? 'blast' : ''} ${invalid.has(pk) ? 'shake' : ''} ${fall ? 'falling' : ''} kind-${ch.kind}`}
                    style={{ gridRow: r + 1, gridColumn: c + 1, ['--fall' as string]: fall ?? 0 }}
                    onClick={() => clickCell({ r, c })}
                    onFocus={() => setFocusPos({ r, c })}
                    aria-label={describeCharm(ch, r, c)}
                    aria-selected={isSel}
                  >
                    <CharmIcon charm={ch} />
                  </button>
                )
              })
            )}
          </div>
          {floating && (
            <div key={floating.id} className="float-note" aria-live="polite">
              {floating.text}
            </div>
          )}
          {notice && (
            <div className="board-notice" role="status">
              {notice}
            </div>
          )}
        </div>
      </div>

      {phase === 'question' && question && (
        <div className="modal-backdrop">
          <div className="modal question-modal" role="dialog" aria-modal="true" aria-labelledby="charm-q-title">
            <p className="q-label" id="charm-q-title">
              Question charm · worth +{question.charm.bonus ?? 1} move{(question.charm.bonus ?? 1) > 1 ? 's' : ''}
            </p>
            <p className="q-prompt">{question.q.prompt}</p>
            <div className="options" role="radiogroup">
              {question.q.options.map((opt, i) => {
                const answered = question.answer !== null
                const cls = answered ? (i === question.q.correctIndex ? 'correct' : i === question.answer ? 'incorrect' : 'dim') : ''
                return (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={question.answer === i}
                    className={`option ${cls}`}
                    onClick={() => answerQuestion(i)}
                    disabled={answered}
                    autoFocus={i === 0}
                  >
                    <span className="option-key">{i + 1}</span>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>
            {question.answer !== null && (
              <div className="feedback" role="status">
                {question.answer === question.q.correctIndex ? (
                  <p className="good-text">Correct! +{question.charm.bonus ?? 1} moves.</p>
                ) : (
                  <p className="bad-text">
                    Not quite. The answer is <strong>{question.q.options[question.q.correctIndex]}</strong>.
                  </p>
                )}
                <button className="btn primary" onClick={advance} autoFocus>
                  Continue (Enter)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function describeCharm(ch: Charm, r: number, c: number): string {
  const where = `row ${r + 1}, column ${c + 1}`
  if (ch.kind === 'stone') return `Stone, ${where}`
  const base = COLOR_NAMES[ch.color] ?? 'Charm'
  if (ch.kind === 'question') return `${base} question charm worth ${ch.bonus} moves, ${where}`
  if (ch.kind === 'bomb') return `${base} bomb, ${where}`
  if (ch.kind === 'poison') return `${base} poison charm, ${where}`
  return `${base}, ${where}`
}

/** Colour + distinct shape per colour so the board is colour-blind friendly. */
export function CharmIcon({ charm }: { charm: Charm }) {
  if (charm.kind === 'stone') {
    return (
      <svg viewBox="0 0 40 40" className="charm-svg" aria-hidden="true">
        <path d="M8 14 L15 6 L27 6 L34 13 L33 28 L24 35 L12 34 L6 25 Z" className="stone-body" />
        <path d="M14 15 L20 19 L27 14 M18 26 L22 22 L28 25" className="stone-crack" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 40 40" className={`charm-svg c${charm.color}`} aria-hidden="true">
      <Shape color={charm.color} />
      {charm.kind === 'question' && (
        <>
          <text x="20" y="25.5" textAnchor="middle" className="charm-glyph">
            ?
          </text>
          <circle cx="32" cy="8" r="7" className="badge-bg" />
          <text x="32" y="11" textAnchor="middle" className="badge-text">
            {charm.bonus}
          </text>
        </>
      )}
      {charm.kind === 'bomb' && (
        <>
          <circle cx="20" cy="21" r="8" className="bomb-core" />
          <path d="M24 13 Q27 8 31 9" className="bomb-fuse" />
          <circle cx="31.5" cy="8.5" r="2.4" className="bomb-spark" />
        </>
      )}
      {charm.kind === 'poison' && (
        <>
          <circle cx="20" cy="20" r="9" className="poison-core" />
          <text x="20" y="24.5" textAnchor="middle" className="poison-glyph">
            ☠
          </text>
        </>
      )}
    </svg>
  )
}

function Shape({ color }: { color: number }) {
  switch (color) {
    case 0:
      return <circle cx="20" cy="20" r="15" className="shape" />
    case 1:
      return <rect x="6" y="6" width="28" height="28" rx="4" className="shape" />
    case 2:
      return <path d="M20 4 L36 34 L4 34 Z" className="shape" />
    case 3:
      return <path d="M20 3 L37 20 L20 37 L3 20 Z" className="shape" />
    case 4:
      return <path d="M20 3 L24.7 14.5 L37 15.3 L27.5 23.2 L30.5 35.3 L20 28.6 L9.5 35.3 L12.5 23.2 L3 15.3 L15.3 14.5 Z" className="shape" />
    default:
      return <path d="M11 5 L29 5 L38 20 L29 35 L11 35 L2 20 Z" className="shape" />
  }
}
