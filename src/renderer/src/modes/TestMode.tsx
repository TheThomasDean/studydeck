import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '@shared/types'
import { addTestScore } from '@lib/progress'
import {
  blankAnswer,
  describeAnswer,
  generateTest,
  gradeTest,
  isAnswered,
  missedCardIds,
  TYPE_LABELS,
  type Answer,
  type AnswerWith,
  type MatchingQuestion,
  type Question,
  type QuestionType,
  type TestOptions,
  type TestResult
} from '@lib/testGen'
import { useStore } from '../store'
import { useKeydown } from '../hooks'
import { play } from '../sound'
import { ModeHeader, useProgress, type ModeProps } from './common'

type Phase = 'setup' | 'taking' | 'results'
const ALL_TYPES: QuestionType[] = ['mc', 'tf', 'written', 'matching']

export function TestMode({ set, cards, navigate }: ModeProps) {
  const { updateSet } = useStore()
  const progress = useProgress(set.id)
  const starredIds = useMemo(() => new Set(set.cards.filter((c) => c.starred).map((c) => c.id)), [set.cards])
  const starredCount = cards.filter((c) => starredIds.has(c.id)).length

  const [phase, setPhase] = useState<Phase>('setup')
  const [opts, setOpts] = useState<TestOptions>({ count: cards.length, types: ALL_TYPES, answerWith: 'definition', starredOnly: false })
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [current, setCurrent] = useState(0)
  const [result, setResult] = useState<TestResult | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const savedDate = useRef<number | null>(null)
  const recorded = useRef(true)
  const resultRef = useRef<TestResult | null>(null)
  resultRef.current = result

  const pool = cards
  const poolForTest = opts.starredOnly ? cards.filter((c) => starredIds.has(c.id)) : cards
  const maxCount = poolForTest.length

  const recordProgressOnce = () => {
    if (recorded.current || !resultRef.current) return
    recorded.current = true
    progress.push(resultRef.current.results.flatMap((r) => r.cardResults.map((c) => ({ cardId: c.cardId, correct: c.correct }))))
    progress.flush()
  }
  const recordRef = useRef(recordProgressOnce)
  recordRef.current = recordProgressOnce
  useEffect(() => () => recordRef.current(), [])

  const start = (testCards: Card[], options: TestOptions) => {
    recordProgressOnce()
    const qs = generateTest(pool, testCards, options)
    setQuestions(qs)
    setAnswers(qs.map(blankAnswer))
    setCurrent(0)
    setResult(null)
    setConfirmSubmit(false)
    setPhase('taking')
  }

  const submit = () => {
    const r = gradeTest(questions, answers)
    setResult(r)
    setPhase('results')
    setConfirmSubmit(false)
    recorded.current = false
    const now = Date.now()
    savedDate.current = now
    updateSet(set.id, (s) => addTestScore(s, r.correct, r.total, now))
    play(r.percent >= 80 ? 'win' : 'click')
  }

  const override = (i: number) => {
    const next = answers.slice()
    const a = next[i]
    if (a.kind !== 'written') return
    next[i] = { ...a, override: true }
    setAnswers(next)
    const r = gradeTest(questions, next)
    setResult(r)
    const date = savedDate.current
    updateSet(set.id, (s) => ({
      ...s,
      history: {
        ...s.history,
        testScores: s.history.testScores.map((t) => (t.date === date ? { ...t, correct: r.correct, total: r.total, percent: r.percent } : t))
      }
    }))
  }

  const setAnswer = (i: number, a: Answer) => {
    setAnswers((prev) => {
      const next = prev.slice()
      next[i] = a
      return next
    })
  }

  const unanswered = questions.filter((q, i) => !isAnswered(q, answers[i])).length
  const next = () => {
    if (current < questions.length - 1) setCurrent(current + 1)
    else if (unanswered > 0) setConfirmSubmit(true)
    else submit()
  }

  useKeydown(
    (e) => {
      if (phase !== 'taking') return
      const q = questions[current]
      if (!q) return
      if (e.key === 'Enter') {
        // Inside a written answer box, Enter also continues.
        e.preventDefault()
        if (confirmSubmit) submit()
        else next()
        return
      }
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const n = Number(e.key)
      if (q.kind === 'mc' && n >= 1 && n <= q.options.length) setAnswer(current, { kind: 'mc', choice: n - 1 })
      if (q.kind === 'tf' && (n === 1 || n === 2)) setAnswer(current, { kind: 'tf', choice: n === 1 })
      if (q.kind === 'tf' && e.key.toLowerCase() === 't') setAnswer(current, { kind: 'tf', choice: true })
      if (q.kind === 'tf' && e.key.toLowerCase() === 'f') setAnswer(current, { kind: 'tf', choice: false })
      if (e.key === 'ArrowRight' && current < questions.length - 1) setCurrent(current + 1)
      if (e.key === 'ArrowLeft' && current > 0) setCurrent(current - 1)
    },
    [phase, questions, current, answers, confirmSubmit],
    true
  )

  /* ---------------- Setup ---------------- */
  if (phase === 'setup') {
    const toggleType = (t: QuestionType) =>
      setOpts((o) => ({ ...o, types: o.types.includes(t) ? o.types.filter((x) => x !== t) : [...o.types, t] }))
    const count = Math.min(opts.count, maxCount)
    return (
      <div className="page mode-page">
        <ModeHeader title="Test" set={set} navigate={navigate} />
        <div className="panel form setup">
          <h2>Set up your test</h2>
          <label className="field inline">
            <span>Questions (max {maxCount})</span>
            <input
              type="number"
              min={1}
              max={maxCount}
              value={count}
              onChange={(e) => setOpts({ ...opts, count: Math.max(1, Math.min(maxCount, Number(e.target.value) || 1)) })}
            />
          </label>
          <fieldset className="fieldset">
            <legend>Question types</legend>
            {ALL_TYPES.map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={opts.types.includes(t)} onChange={() => toggleType(t)} />
                {TYPE_LABELS[t]}
              </label>
            ))}
          </fieldset>
          <label className="field inline">
            <span>Answer with</span>
            <select value={opts.answerWith} onChange={(e) => setOpts({ ...opts, answerWith: e.target.value as AnswerWith })}>
              <option value="definition">Definition (you see the term)</option>
              <option value="term">Term (you see the definition)</option>
              <option value="both">Both (mixed)</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={opts.starredOnly}
              disabled={starredCount === 0}
              onChange={(e) => {
                const starredOnly = e.target.checked
                setOpts({ ...opts, starredOnly, count: starredOnly ? starredCount : cards.length })
              }}
            />
            Only starred cards {starredCount === 0 ? '(none starred yet)' : `(${starredCount})`}
          </label>
          {opts.types.length === 0 && <p className="error-text">Pick at least one question type.</p>}
          <button
            className="btn primary big"
            disabled={opts.types.length === 0 || maxCount === 0}
            onClick={() => start(poolForTest, { ...opts, count })}
          >
            Start test
          </button>
        </div>
      </div>
    )
  }

  /* ---------------- Results ---------------- */
  if (phase === 'results' && result) {
    const missed = missedCardIds(result)
    return (
      <div className="page mode-page">
        <ModeHeader title="Test results" set={set} navigate={navigate} />
        <div className="panel results-head">
          <div className={`score-ring ${result.percent >= 80 ? 'good' : result.percent >= 50 ? 'ok' : 'bad'}`}>
            <span>{result.percent}%</span>
          </div>
          <div>
            <h2>
              {result.correct} / {result.total} correct
            </h2>
            <p className="muted">{result.percent === 100 ? 'Perfect score!' : result.percent >= 80 ? 'Great job!' : 'Keep practicing — retake the ones you missed.'}</p>
            <div className="row gap wrap">
              {missed.length > 0 && (
                <button
                  className="btn primary"
                  onClick={() => {
                    const ids = new Set(missed)
                    start(
                      cards.filter((c) => ids.has(c.id)),
                      { ...opts, count: ids.size }
                    )
                  }}
                >
                  Retake only missed questions ({missed.length})
                </button>
              )}
              <button className="btn" onClick={() => start(poolForTest, { ...opts, count: Math.min(opts.count, maxCount) })}>
                New test
              </button>
              <button className="btn" onClick={() => { recordProgressOnce(); setPhase('setup') }}>
                Change options
              </button>
            </div>
          </div>
        </div>
        <ol className="review-list">
          {questions.map((q, i) => {
            const r = result.results[i]
            return (
              <li key={q.id} className={`review-item ${r.correct ? 'right' : 'wrong'}`}>
                <div className="review-mark" aria-label={r.correct ? 'Correct' : 'Incorrect'}>
                  {r.correct ? '✓' : '✗'}
                </div>
                <div className="review-body">
                  <ReviewDetail q={q} a={answers[i]} />
                  {q.kind === 'written' && !r.correct && (
                    <button className="btn small" onClick={() => override(i)}>
                      I was right
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    )
  }

  /* ---------------- Taking ---------------- */
  const q = questions[current]
  const a = answers[current]
  const answeredCount = questions.length - unanswered
  return (
    <div className="page mode-page">
      <ModeHeader title="Test" set={set} navigate={navigate}>
        <span className="counter">
          {current + 1} / {questions.length}
        </span>
      </ModeHeader>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
      </div>
      <nav className="q-nav" aria-label="Questions">
        {questions.map((qq, i) => (
          <button
            key={qq.id}
            className={`q-dot ${i === current ? 'current' : ''} ${isAnswered(qq, answers[i]) ? 'answered' : ''}`}
            onClick={() => setCurrent(i)}
            aria-label={`Question ${i + 1}${isAnswered(qq, answers[i]) ? ', answered' : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            {i + 1}
          </button>
        ))}
      </nav>

      <div className="panel question" key={q.id}>
        <QuestionView q={q} a={a} onChange={(ans) => setAnswer(current, ans)} />
      </div>

      {confirmSubmit ? (
        <div className="panel confirm-inline" role="alertdialog" aria-label="Submit with unanswered questions">
          <p>
            {unanswered} {unanswered === 1 ? 'question is' : 'questions are'} unanswered. Submit anyway?
          </p>
          <div className="row gap">
            <button className="btn" onClick={() => setConfirmSubmit(false)}>
              Keep answering
            </button>
            <button className="btn primary" onClick={submit} autoFocus>
              Submit test
            </button>
          </div>
        </div>
      ) : (
        <div className="row between">
          <button className="btn" onClick={() => setCurrent(current - 1)} disabled={current === 0}>
            ← Previous
          </button>
          <span className="muted small">1–4 choose · Enter continues</span>
          {current < questions.length - 1 ? (
            <button className="btn primary" onClick={next}>
              Next →
            </button>
          ) : (
            <button className="btn primary" onClick={next}>
              Submit test
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function sideLabel(answerSide: 'term' | 'definition'): { prompt: string; answer: string } {
  return answerSide === 'definition' ? { prompt: 'Term', answer: 'definition' } : { prompt: 'Definition', answer: 'term' }
}

function QuestionView({ q, a, onChange }: { q: Question; a: Answer; onChange(a: Answer): void }) {
  const labels = sideLabel(q.answerSide)
  if (q.kind === 'mc' && a.kind === 'mc') {
    return (
      <>
        <p className="q-label">{labels.prompt}</p>
        <p className="q-prompt">{q.prompt}</p>
        <p className="q-label">Choose the matching {labels.answer}</p>
        <div className="options" role="radiogroup">
          {q.options.map((opt, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={a.choice === i}
              className={`option ${a.choice === i ? 'selected' : ''}`}
              onClick={() => onChange({ kind: 'mc', choice: i })}
            >
              <span className="option-key">{i + 1}</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      </>
    )
  }
  if (q.kind === 'tf' && a.kind === 'tf') {
    return (
      <>
        <div className="tf-pair">
          <div>
            <p className="q-label">{labels.prompt}</p>
            <p className="q-prompt">{q.prompt}</p>
          </div>
          <div>
            <p className="q-label">{labels.answer[0].toUpperCase() + labels.answer.slice(1)}</p>
            <p className="q-prompt">{q.candidate}</p>
          </div>
        </div>
        <p className="q-label">Do these belong together?</p>
        <div className="options two" role="radiogroup">
          {[true, false].map((v, i) => (
            <button
              key={String(v)}
              role="radio"
              aria-checked={a.choice === v}
              className={`option ${a.choice === v ? 'selected' : ''}`}
              onClick={() => onChange({ kind: 'tf', choice: v })}
            >
              <span className="option-key">{i + 1}</span>
              <span>{v ? 'True' : 'False'}</span>
            </button>
          ))}
        </div>
      </>
    )
  }
  if (q.kind === 'written' && a.kind === 'written') {
    return (
      <>
        <p className="q-label">{labels.prompt}</p>
        <p className="q-prompt">{q.prompt}</p>
        <label className="field">
          <span>Type the {labels.answer}</span>
          <input
            className="big-input"
            value={a.text}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange({ kind: 'written', text: e.target.value, override: false })}
          />
        </label>
      </>
    )
  }
  if (q.kind === 'matching' && a.kind === 'matching') return <MatchingView q={q} links={a.links} onChange={(links) => onChange({ kind: 'matching', links })} />
  return null
}

const PAIR_COLORS = 6

function MatchingView({ q, links, onChange }: { q: MatchingQuestion; links: Record<number, number>; onChange(l: Record<number, number>): void }) {
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null)
  const labels = sideLabel(q.answerSide)
  const rightToLeft = new Map(Object.entries(links).map(([l, r]) => [r, Number(l)]))

  const clickLeft = (i: number) => {
    if (links[i] !== undefined) {
      const copy = { ...links }
      delete copy[i]
      onChange(copy)
      setSelectedLeft(i)
      return
    }
    setSelectedLeft(selectedLeft === i ? null : i)
  }
  const clickRight = (r: number) => {
    const existingLeft = rightToLeft.get(r)
    if (selectedLeft === null) {
      if (existingLeft !== undefined) {
        const copy = { ...links }
        delete copy[existingLeft]
        onChange(copy)
      }
      return
    }
    const copy = { ...links }
    if (existingLeft !== undefined) delete copy[existingLeft]
    copy[selectedLeft] = r
    onChange(copy)
    // Auto-advance to the next unlinked prompt.
    const nextLeft = q.pairs.findIndex((_, i) => copy[i] === undefined)
    setSelectedLeft(nextLeft === -1 ? null : nextLeft)
  }

  return (
    <>
      <p className="q-label">Match each {labels.prompt.toLowerCase()} with its {labels.answer}. Click one on the left, then one on the right.</p>
      <div className="matching">
        <div className="match-col">
          {q.pairs.map((p, i) => {
            const linked = links[i] !== undefined
            return (
              <button
                key={i}
                className={`match-item ${selectedLeft === i ? 'selected' : ''} ${linked ? `linked pair-${(i % PAIR_COLORS) + 1}` : ''}`}
                onClick={() => clickLeft(i)}
                aria-pressed={selectedLeft === i}
              >
                <span className="match-badge">{linked ? i + 1 : ''}</span>
                {p.left}
              </button>
            )
          })}
        </div>
        <div className="match-col">
          {q.rightOrder.map((r) => {
            const left = rightToLeft.get(r)
            return (
              <button
                key={r}
                className={`match-item ${left !== undefined ? `linked pair-${(left % PAIR_COLORS) + 1}` : ''}`}
                onClick={() => clickRight(r)}
              >
                <span className="match-badge">{left !== undefined ? left + 1 : ''}</span>
                {q.pairs[r].right}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function ReviewDetail({ q, a }: { q: Question; a: Answer }) {
  if (q.kind === 'matching' && a.kind === 'matching') {
    return (
      <div>
        <p className="q-label">Matching</p>
        <ul className="match-review">
          {q.pairs.map((p, i) => {
            const chosen = a.links[i]
            const ok = chosen === i
            return (
              <li key={i} className={ok ? 'right' : 'wrong'}>
                <strong>{p.left}</strong> → {chosen === undefined ? <em>(no answer)</em> : q.pairs[chosen].right}
                {!ok && <span className="correct-answer"> · Correct: {p.right}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
  if (q.kind === 'matching') return null
  const correctText =
    q.kind === 'mc' ? q.options[q.correctIndex] : q.kind === 'tf' ? (q.isTrue ? 'True' : `False — it matches “${q.correctAnswer}”`) : q.kind === 'written' ? q.answer : ''
  return (
    <div>
      <p className="q-prompt small-prompt">
        {q.kind === 'tf' ? (
          <>
            {q.prompt} <span className="muted">↔</span> {q.candidate}
          </>
        ) : (
          q.prompt
        )}
      </p>
      <p>
        <span className="muted">Your answer:</span> {describeAnswer(q, a)}
        {q.kind === 'written' && a.kind === 'written' && a.override && <span className="muted"> (marked right)</span>}
      </p>
      <p>
        <span className="muted">Correct answer:</span> <strong>{correctText}</strong>
      </p>
    </div>
  )
}
