import { useEffect, useMemo, useRef, useState } from 'react'
import type { LearnSettings, LearnState } from '@shared/types'
import {
  applyAnswer,
  buildQuestion,
  initLearn,
  isLearnComplete,
  isRoundOver,
  learnCounts,
  missedCardIds,
  resetLearn,
  startRound,
  syncLearn,
  type LearnQuestion
} from '@lib/learn'
import { isAnswerCorrect } from '@lib/grading'
import { pick } from '@lib/random'
import { studyableCards } from '@lib/sets'
import { useStore } from '../store'
import { useKeydown } from '../hooks'
import { play } from '../sound'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'question' | 'feedback' | 'summary' | 'complete'

interface Feedback {
  correct: boolean
  choice: number | null
  typed: string
}

const PRAISE = ['Nice!', 'Correct!', 'You got it!', 'Great job!', 'Spot on!', 'Keep it up!']
const AUTO_ADVANCE_MS = 1000

export function LearnMode({ set, cards, navigate, subset, studySubset }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const ids = useMemo(() => cards.map((c) => c.id), [cards])
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  // Distractors come from the whole set, even when studying a subset of missed cards.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pool = useMemo(() => studyableCards(set.cards), [set.id])

  // A subset session ("study missed") is temporary and never overwrites saved progress.
  const [learn, setLearn] = useState<LearnState>(() => {
    const base = subset ? initLearn(ids, set.learn?.settings) : syncLearn(set.learn, ids)
    return !isLearnComplete(base) && isRoundOver(base) ? startRound(base) : base
  })
  const [question, setQuestion] = useState<LearnQuestion | null>(null)
  const [phase, setPhase] = useState<Phase>(() => (isLearnComplete(learn) ? 'complete' : 'question'))
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [typed, setTyped] = useState('')
  const [praise, setPraise] = useState(PRAISE[0])
  const [showSettings, setShowSettings] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const learnRef = useRef(learn)
  learnRef.current = learn
  const advanceTimer = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)

  const persist = (s: LearnState) => {
    if (subset) return
    updateSet(set.id, (cur) => ({ ...cur, learn: s, lastStudied: Date.now() }))
  }

  const ask = (s: LearnState) => {
    const id = s.queue[0]
    const built = id ? buildQuestion(s, pool, id) : null
    setFeedback(null)
    setTyped('')
    if (!built) {
      setQuestion(null)
      learnRef.current = s
      setLearn(s)
      return s
    }
    setQuestion(built.question)
    learnRef.current = built.state
    setLearn(built.state)
    setPhase('question')
    return built.state
  }

  // First question on mount (and save the synced state).
  useEffect(() => {
    if (phase === 'question') persist(ask(learn))
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase === 'question' && question?.kind === 'written') inputRef.current?.focus()
    if (phase === 'feedback' && feedback && !feedback.correct) continueRef.current?.focus()
  }, [phase, question, feedback])

  const clearTimer = () => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
  }

  const choose = (correct: boolean, choice: number | null, typedText = '') => {
    if (phase !== 'question' || !question) return
    setFeedback({ correct, choice, typed: typedText })
    phaseRef.current = 'feedback'
    setPhase('feedback')
    if (correct) {
      setPraise(pick(PRAISE))
      play('correct')
      advanceTimer.current = window.setTimeout(() => commit(true), AUTO_ADVANCE_MS)
    } else {
      play('wrong')
    }
  }

  /** Lock in the verdict for the current card and move on. */
  const commit = (correct: boolean) => {
    clearTimer()
    if (!question || phaseRef.current !== 'feedback') return
    phaseRef.current = 'question' // guard against a double commit before re-render
    const next = applyAnswer(learnRef.current, question.cardId, correct)
    progress.push({ cardId: question.cardId, correct })
    learnRef.current = next
    setLearn(next)
    afterCommit(next)
  }

  const afterCommit = (next: LearnState) => {
    if (isLearnComplete(next)) {
      setPhase('complete')
      setQuestion(null)
      persist(next)
      progress.flush()
      play('win')
    } else if (isRoundOver(next)) {
      setPhase('summary')
      setQuestion(null)
      persist(next)
      progress.flush()
    } else {
      persist(ask(next))
    }
  }

  const nextRound = () => persist(ask(startRound(learnRef.current)))

  const restart = () => {
    setConfirmReset(false)
    setShowSettings(false)
    persist(ask(startRound(resetLearn(learnRef.current, ids))))
  }

  const changeSettings = (patch: Partial<LearnSettings>) => {
    const cur = learnRef.current
    const s = { ...cur, settings: { ...cur.settings, ...patch } }
    if (phase === 'question') persist(ask(s))
    else {
      learnRef.current = s
      setLearn(s)
      persist(s)
    }
  }

  useKeydown(
    (e) => {
      if (confirmReset) return
      const typing = (e.target as HTMLElement).tagName === 'INPUT'
      if (phase === 'question' && question?.kind === 'mc' && !typing) {
        const n = Number(e.key)
        if (n >= 1 && n <= question.options.length) {
          e.preventDefault()
          choose(n - 1 === question.correctIndex, n - 1)
        }
      } else if (phase === 'feedback' && e.key === 'Enter') {
        e.preventDefault()
        commit(!!feedback?.correct)
      } else if (phase === 'summary' && e.key === 'Enter') {
        e.preventDefault()
        nextRound()
      }
    },
    [phase, question, feedback, learn, confirmReset],
    true
  )

  const counts = learnCounts(learn)
  const labels = learn.settings.answerWith === 'definition' ? { prompt: 'Term', answer: 'definition' } : { prompt: 'Definition', answer: 'term' }

  const header = (
    <>
      <ModeHeader title={subset ? 'Learn · missed cards' : 'Learn'} set={set} navigate={navigate}>
        <button className="btn small" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>
          ⚙ Options
        </button>
      </ModeHeader>
      <LearnProgress counts={counts} />
      {showSettings && (
        <div className="panel learn-settings">
          <label className="field inline">
            <span>Answer with</span>
            <select value={learn.settings.answerWith} onChange={(e) => changeSettings({ answerWith: e.target.value as LearnSettings['answerWith'] })}>
              <option value="definition">Definition (you see the term)</option>
              <option value="term">Term (you see the definition)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={learn.settings.shuffle} onChange={(e) => changeSettings({ shuffle: e.target.checked })} />
            Shuffle cards (takes effect next round)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={learn.settings.typeWhenFamiliar}
              onChange={(e) => changeSettings({ typeWhenFamiliar: e.target.checked })}
            />
            Type the answer once a card is familiar
          </label>
          <div>
            <button className="btn small" onClick={() => setConfirmReset(true)}>
              ↺ Restart progress
            </button>
          </div>
        </div>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Restart Learn progress?"
          message="All cards go back to unseen. Your other study history is kept."
          confirmLabel="Restart"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={restart}
        />
      )}
    </>
  )

  /* ---------------- Complete ---------------- */
  if (phase === 'complete') {
    const missed = missedCardIds(learn)
    return (
      <div className="page mode-page">
        {header}
        <div className="panel center-panel">
          <div className="learn-trophy" aria-hidden="true">
            🏆
          </div>
          <h2>You've mastered all {counts.total} cards!</h2>
          <p className="muted">
            {missed.length === 0 ? 'No mistakes along the way — impressive.' : `You missed ${missed.length} ${missed.length === 1 ? 'card' : 'cards'} at least once along the way.`}
          </p>
          <div className="row gap center wrap">
            {missed.length > 0 && (
              <button className="btn primary" onClick={() => studySubset('learn', missed)} autoFocus>
                Study missed cards again ({missed.length})
              </button>
            )}
            <button className="btn" onClick={restart} autoFocus={missed.length === 0}>
              Restart Learn
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Round summary ---------------- */
  if (phase === 'summary') {
    const missedSet = new Set(learn.roundMissed)
    const right = learn.roundCards.filter((id) => !missedSet.has(id))
    return (
      <div className="page mode-page">
        {header}
        <div className="panel">
          <h2>Round {learn.round} complete</h2>
          <p className="muted">
            {right.length} right on the first try · {learn.roundMissed.length} needed another go · {counts.mastered} of {counts.total} mastered overall
          </p>
          <div className="round-cols">
            <section>
              <h3 className="good-text">Correct ({right.length})</h3>
              <ul className="missed-list">
                {right.map((id) => (
                  <li key={id}>
                    <strong>{byId.get(id)?.term}</strong>
                    <span>{byId.get(id)?.definition}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="bad-text">Missed ({learn.roundMissed.length})</h3>
              {learn.roundMissed.length === 0 ? (
                <p className="muted">Nothing missed this round.</p>
              ) : (
                <ul className="missed-list">
                  {learn.roundMissed.map((id) => (
                    <li key={id}>
                      <strong>{byId.get(id)?.term}</strong>
                      <span>{byId.get(id)?.definition}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div className="row center">
            <button className="btn primary big" onClick={nextRound} autoFocus>
              Continue to round {learn.round + 1}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Question / feedback ---------------- */
  if (!question) return <div className="page mode-page">{header}</div>
  const card = byId.get(question.cardId)
  const level = learn.cards[question.cardId]?.level ?? 'unseen'
  const inRound = learn.roundCards.length - learn.queue.length + 1

  return (
    <div className="page mode-page">
      {header}
      <div className={`panel question learn-q ${phase === 'feedback' ? (feedback?.correct ? 'fb-right' : 'fb-wrong') : ''}`} key={`${question.cardId}-${learn.round}-${learn.queue.length}`}>
        <div className="row between">
          <p className="q-label">{labels.prompt}</p>
          <span className={`level-chip lv-${level}`}>
            {level === 'unseen' ? 'New' : level === 'familiar' ? 'Familiar' : 'Mastered'} · Round {learn.round}, {Math.min(inRound, learn.roundCards.length)}/{learn.roundCards.length}
          </span>
        </div>
        <p className="q-prompt">{question.prompt}</p>

        {question.kind === 'mc' ? (
          <>
            <p className="q-label">Choose the {labels.answer}</p>
            <div className="options" role="radiogroup">
              {question.options.map((opt, i) => {
                let cls = ''
                if (phase === 'feedback' && feedback) {
                  if (i === question.correctIndex) cls = 'correct'
                  else if (i === feedback.choice) cls = 'incorrect'
                  else cls = 'dim'
                }
                return (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={feedback?.choice === i}
                    className={`option ${cls}`}
                    disabled={phase !== 'question'}
                    onClick={() => choose(i === question.correctIndex, i)}
                  >
                    <span className="option-key">{i + 1}</span>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (phase === 'question' && typed.trim()) choose(isAnswerCorrect(typed, question.answer), null, typed)
            }}
          >
            <label className="field">
              <span>Type the {labels.answer}</span>
              <div className="row gap">
                <input
                  ref={inputRef}
                  className="big-input grow"
                  value={typed}
                  readOnly={phase !== 'question'}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                {phase === 'question' && (
                  <button className="btn primary" type="submit" disabled={!typed.trim()}>
                    Answer
                  </button>
                )}
              </div>
            </label>
            {phase === 'question' && (
              <button type="button" className="link-btn" onClick={() => choose(false, null, '')}>
                Don't know?
              </button>
            )}
          </form>
        )}

        {phase === 'feedback' && feedback && (
          <div className="learn-feedback" role="status" aria-live="assertive">
            {feedback.correct ? (
              <div className="row between">
                <p className="good-text big-feedback">✓ {praise}</p>
                <button className="btn small" onClick={() => commit(true)}>
                  Next (Enter)
                </button>
              </div>
            ) : (
              <>
                <p className="bad-text big-feedback">✗ Not quite — study this one:</p>
                {question.kind === 'written' && feedback.typed && (
                  <p>
                    <span className="muted">You wrote:</span> {feedback.typed}
                  </p>
                )}
                <div className="answer-pair">
                  <div>
                    <span className="q-label">Term</span>
                    <p>{card?.term}</p>
                  </div>
                  <div>
                    <span className="q-label">Definition</span>
                    <p>{card?.definition}</p>
                  </div>
                </div>
                <div className="row gap between">
                  <button className="btn" onClick={() => commit(true)}>
                    I was right
                  </button>
                  <button ref={continueRef} className="btn primary" onClick={() => commit(false)}>
                    Continue (Enter)
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <p className="muted small center-text">1–4 choose · Enter continues · missed cards come back later in the round</p>
    </div>
  )
}

function LearnProgress({ counts }: { counts: { unseen: number; familiar: number; mastered: number; total: number } }) {
  const t = counts.total || 1
  return (
    <div className="learn-progress">
      <div
        className="learn-bar"
        role="img"
        aria-label={`${counts.unseen} unseen, ${counts.familiar} familiar, ${counts.mastered} mastered`}
      >
        <div className="lp-seg lp-mastered" style={{ width: `${(counts.mastered / t) * 100}%` }} />
        <div className="lp-seg lp-familiar" style={{ width: `${(counts.familiar / t) * 100}%` }} />
      </div>
      <ul className="learn-legend">
        <li>
          <span className="dot lp-unseen" /> Unseen <strong>{counts.unseen}</strong>
        </li>
        <li>
          <span className="dot lp-familiar" /> Familiar <strong>{counts.familiar}</strong>
        </li>
        <li>
          <span className="dot lp-mastered" /> Mastered <strong>{counts.mastered}</strong>
        </li>
      </ul>
    </div>
  )
}
