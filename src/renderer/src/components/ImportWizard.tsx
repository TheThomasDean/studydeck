import { useEffect, useMemo, useState } from 'react'
import type { OpenedFile } from '@shared/types'
import {
  baseName,
  buildCandidates,
  columnLabels,
  columnLetter,
  detectHeader,
  finalizeCandidates,
  parseTextTable,
  summarizeIssues,
  type IssueKind,
  type ParsedWorkbook
} from '@lib/importParse'
import { makeSet } from '@lib/sets'
import { useStore } from '../store'
import type { Navigate } from '../routes'
import { parseFileAsync } from '../parseAsync'

type Step = 'file' | 'sheet' | 'columns' | 'review' | 'name'

const ISSUE_TEXT: Record<IssueKind, string> = {
  emptyTerm: 'Empty term',
  emptyDefinition: 'Empty definition',
  duplicate: 'Duplicate term'
}

export function ImportWizard({ initialFile, navigate }: { initialFile?: OpenedFile; navigate: Navigate }) {
  const { saveSet, notify } = useStore()
  const [step, setStep] = useState<Step>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [termCol, setTermCol] = useState(0)
  const [defCol, setDefCol] = useState(1)
  const [hasHeader, setHasHeader] = useState(false)
  const [skipEmpty, setSkipEmpty] = useState(true)
  const [skipDuplicates, setSkipDuplicates] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const rows = useMemo(() => workbook?.sheets[sheetIndex]?.rows ?? [], [workbook, sheetIndex])
  const width = rows[0]?.length ?? 0
  const multiSheet = (workbook?.sheets.length ?? 0) > 1

  const selectSheet = (wb: ParsedWorkbook, index: number) => {
    const r = wb.sheets[index].rows
    setSheetIndex(index)
    setTermCol(0)
    setDefCol(r[0]?.length > 1 ? 1 : 0)
    setHasHeader(detectHeader(r))
  }

  const loadWorkbook = (wb: ParsedWorkbook, defaultTitle: string) => {
    setWorkbook(wb)
    setTitle(defaultTitle)
    selectSheet(wb, 0)
    setStep(wb.sheets.length > 1 ? 'sheet' : 'columns')
  }

  const loadFile = async (file: OpenedFile) => {
    setBusy(true)
    setError(null)
    try {
      const wb = await parseFileAsync(file.name, file.data)
      loadWorkbook(wb, baseName(file.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (initialFile) void loadFile(initialFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickFile = async () => {
    setError(null)
    try {
      const file = await window.studydeck.openSpreadsheet()
      if (file) await loadFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }

  const usePaste = () => {
    setError(null)
    try {
      loadWorkbook(parseTextTable(pasteText, 'Pasted cards'), 'Pasted cards')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const candidates = useMemo(
    () => (width >= 2 && termCol !== defCol ? buildCandidates(rows, { termCol, defCol, hasHeader }) : []),
    [rows, width, termCol, defCol, hasHeader]
  )
  const summary = useMemo(() => summarizeIssues(candidates), [candidates])
  const drafts = useMemo(
    () => finalizeCandidates(candidates, { skipEmpty, skipDuplicates }),
    [candidates, skipEmpty, skipDuplicates]
  )
  const flagged = useMemo(() => candidates.filter((c) => c.issues.length > 0), [candidates])
  const labels = useMemo(() => columnLabels(rows, hasHeader), [rows, hasHeader])

  const create = () => {
    const set = makeSet(title, description, drafts)
    saveSet(set)
    notify(`Created “${set.title}” with ${set.cards.length} cards`)
    navigate({ name: 'set', setId: set.id })
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'file', label: 'Choose file' },
    ...(multiSheet ? [{ id: 'sheet' as Step, label: 'Sheet' }] : []),
    { id: 'columns', label: 'Preview & columns' },
    { id: 'review', label: 'Review' },
    { id: 'name', label: 'Name' }
  ]
  const stepIdx = steps.findIndex((s) => s.id === step)

  return (
    <div className="page wizard">
      <button className="link-btn" onClick={() => navigate({ name: 'library' })}>
        ← Cancel import
      </button>
      <h1>Import from Excel</h1>
      <ol className="stepper" aria-label="Import steps">
        {steps.map((s, i) => (
          <li key={s.id} className={i === stepIdx ? 'current' : i < stepIdx ? 'done' : ''} aria-current={i === stepIdx ? 'step' : undefined}>
            <span className="step-num">{i < stepIdx ? '✓' : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="error-box" role="alert">
          <strong>We couldn’t import that.</strong> {error}
        </div>
      )}

      {step === 'file' && (
        <div className="wizard-body">
          <div className="dropzone">
            <div className="dropzone-icon" aria-hidden="true">
              ⇪
            </div>
            <p>
              <strong>Drag an .xlsx, .xls, .csv or .tsv file here</strong>
            </p>
            <p className="muted">or</p>
            <button className="btn primary" onClick={() => void pickFile()} disabled={busy}>
              {busy ? 'Reading file…' : 'Choose a file…'}
            </button>
            {busy && (
              <div className="spinner" role="progressbar" aria-label="Reading file">
                <span />
              </div>
            )}
            <p className="muted small">Expected layout: column A = term, column B = definition. A header row is optional.</p>
          </div>
          <div className="panel">
            <label className="field">
              <span>Or paste cells copied from Excel (tab-separated)</span>
              <textarea
                className="mono"
                rows={6}
                value={pasteText}
                placeholder={'hola\thello\nadiós\tgoodbye'}
                onChange={(e) => setPasteText(e.target.value)}
              />
            </label>
            <button className="btn" onClick={usePaste} disabled={!pasteText.trim()}>
              Use pasted text
            </button>
          </div>
        </div>
      )}

      {step === 'sheet' && workbook && (
        <div className="wizard-body panel">
          <h2>This workbook has {workbook.sheets.length} sheets. Which one holds your cards?</h2>
          <div className="radio-list" role="radiogroup" aria-label="Sheets">
            {workbook.sheets.map((s, i) => (
              <label key={s.name + i} className="radio-row">
                <input type="radio" name="sheet" checked={sheetIndex === i} onChange={() => selectSheet(workbook, i)} />
                <span>
                  <strong>{s.name}</strong> <span className="muted">· {s.rows.length} rows</span>
                </span>
              </label>
            ))}
          </div>
          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep('file')}>
              Back
            </button>
            <button className="btn primary" onClick={() => setStep('columns')}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'columns' && workbook && (
        <div className="wizard-body">
          <div className="panel">
            <h2>
              Preview <span className="muted small">(first {Math.min(10, rows.length)} of {rows.length} rows)</span>
            </h2>
            <div className="table-scroll">
              <table className="table preview">
                <thead>
                  <tr>
                    <th className="col-num">Row</th>
                    {Array.from({ length: width }, (_, i) => (
                      <th key={i} className={i === termCol ? 'col-term' : i === defCol ? 'col-def' : ''}>
                        {columnLetter(i)}
                        {i === termCol && <span className="tag">Term</span>}
                        {i === defCol && <span className="tag">Definition</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, ri) => (
                    <tr key={ri} className={hasHeader && ri === 0 ? 'header-row' : ''}>
                      <td className="col-num">{ri + 1}</td>
                      {r.map((cell, ci) => (
                        <td key={ci} className={ci === termCol ? 'col-term' : ci === defCol ? 'col-def' : ''}>
                          {cell || <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel form-grid">
            <label className="field">
              <span>Term column</span>
              <select value={termCol} onChange={(e) => setTermCol(Number(e.target.value))}>
                {labels.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Definition column</span>
              <select value={defCol} onChange={(e) => setDefCol(Number(e.target.value))}>
                {labels.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is a header (not a card)
            </label>
            {width < 2 && (
              <p className="error-text" role="alert">
                This sheet has only one column. A card needs a term and a definition in two separate columns.
              </p>
            )}
            {width >= 2 && termCol === defCol && (
              <p className="error-text" role="alert">
                Choose two different columns for the term and the definition.
              </p>
            )}
            {width > 2 && <p className="muted small">Other columns are kept as extra card information.</p>}
          </div>
          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep(multiSheet ? 'sheet' : 'file')}>
              Back
            </button>
            <button className="btn primary" onClick={() => setStep('review')} disabled={width < 2 || termCol === defCol}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="wizard-body">
          <div className="panel">
            <h2>
              <span className="big-number">{drafts.length}</span> {drafts.length === 1 ? 'card' : 'cards'} will be created
            </h2>
            <p className="muted">
              {summary.total} data rows found.
              {flagged.length === 0 ? ' No problems found.' : ''}
            </p>
            {(summary.emptyTerm > 0 || summary.emptyDefinition > 0) && (
              <label className="check">
                <input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} />
                Skip rows with an empty term or definition ({summary.emptyTerm + summary.emptyDefinition} problems)
              </label>
            )}
            {summary.duplicate > 0 && (
              <label className="check">
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                Skip duplicate terms ({summary.duplicate} {summary.duplicate === 1 ? 'row' : 'rows'}; the first occurrence is always kept)
              </label>
            )}
          </div>
          {flagged.length > 0 && (
            <div className="panel">
              <h3>Rows with problems</h3>
              <div className="table-scroll short">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Term</th>
                      <th>Definition</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.slice(0, 200).map((c) => (
                      <tr key={c.rowNumber}>
                        <td>{c.rowNumber}</td>
                        <td>{c.term || <span className="muted">(empty)</span>}</td>
                        <td>{c.definition || <span className="muted">(empty)</span>}</td>
                        <td>
                          {c.issues.map((i) => (
                            <span key={i} className={`issue issue-${i}`}>
                              {ISSUE_TEXT[i]}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {flagged.length > 200 && <p className="muted small">…and {flagged.length - 200} more.</p>}
            </div>
          )}
          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep('columns')}>
              Back
            </button>
            <button className="btn primary" onClick={() => setStep('name')} disabled={drafts.length === 0}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'name' && (
        <div className="wizard-body panel form">
          <label className="field">
            <span>Set name</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Description (optional)</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep('review')}>
              Back
            </button>
            <button className="btn primary" onClick={create} disabled={drafts.length === 0}>
              Create set with {drafts.length} cards
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
