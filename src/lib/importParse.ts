import * as XLSX from 'xlsx'
import type { CardDraft } from './sets'

export interface ParsedSheet {
  name: string
  /** Rectangular grid of text cells (all rows padded to the same width). */
  rows: string[][]
}

export interface ParsedWorkbook {
  fileName: string
  sheets: ParsedSheet[]
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

const TEXT_EXTENSIONS = ['csv', 'tsv', 'txt', 'tab']
const SPREADSHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xls', ...TEXT_EXTENSIONS]

export function fileExtension(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

export function isSupportedFile(name: string): boolean {
  return SPREADSHEET_EXTENSIONS.includes(fileExtension(name))
}

export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
}

/* ------------------------------------------------------------------ */
/* Delimited text (CSV / TSV / clipboard)                              */
/* ------------------------------------------------------------------ */

/** Decode bytes as text: UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252. */
export function decodeText(data: Uint8Array): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2))
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(data.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

/** Pick tab, semicolon or comma by looking at the first few lines (outside quotes). */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20000)
  const counts: Record<string, number> = { '\t': 0, ',': 0, ';': 0 }
  let inQuotes = false
  let lines = 0
  for (let i = 0; i < sample.length && lines < 20; i++) {
    const ch = sample[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch === '\n') lines++
    else if (!inQuotes && ch in counts) counts[ch]++
  }
  if (counts['\t'] > 0) return '\t'
  if (counts[';'] > counts[',']) return ';'
  return ','
}

/**
 * RFC 4180 style parser: quoted fields may contain delimiters, doubled quotes
 * ("") and line breaks. Handles \n, \r\n and \r line endings.
 */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  if (text.charCodeAt(0) === 0xfeff) i = 1

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Convert any cell value to trimmed text, normalise line breaks, drop empty rows, pad to a rectangle. */
export function normalizeRows(raw: unknown[][]): string[][] {
  const rows: string[][] = []
  let width = 0
  for (const r of raw) {
    if (!Array.isArray(r)) continue
    const cells = r.map(cellToText)
    // drop trailing empty cells
    let end = cells.length
    while (end > 0 && cells[end - 1] === '') end--
    if (end === 0) continue
    const trimmed = cells.slice(0, end)
    width = Math.max(width, trimmed.length)
    rows.push(trimmed)
  }
  for (const r of rows) while (r.length < width) r.push('')
  return rows
}

export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    // Avoid binary float noise such as 0.30000000000000004
    return String(Number.isInteger(value) ? value : parseFloat(value.toPrecision(15)))
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).replace(/\r\n?/g, '\n').trim()
}

/* ------------------------------------------------------------------ */
/* Workbook parsing                                                    */
/* ------------------------------------------------------------------ */

function looksLikeZip(d: Uint8Array): boolean {
  return d.length > 4 && d[0] === 0x50 && d[1] === 0x4b
}
function looksLikeOle(d: Uint8Array): boolean {
  return d.length > 8 && d[0] === 0xd0 && d[1] === 0xcf && d[2] === 0x11 && d[3] === 0xe0
}
function looksLikeMarkup(d: Uint8Array): boolean {
  const head = new TextDecoder('utf-8').decode(d.subarray(0, 512)).replace(/^﻿/, '').trimStart()
  return head.startsWith('<')
}

/** Parse delimited text (file contents or clipboard). */
export function parseTextTable(text: string, fileName = 'Pasted text'): ParsedWorkbook {
  const rows = normalizeRows(parseDelimited(text))
  if (rows.length === 0) throw new ImportError('No data was found. Make sure the text has at least one row with a term and a definition.')
  return { fileName, sheets: [{ name: 'Sheet1', rows }] }
}

/** Parse any supported file. Throws ImportError with a readable message on failure. */
export function parseWorkbook(data: Uint8Array, fileName: string): ParsedWorkbook {
  const ext = fileExtension(fileName)
  if (!isSupportedFile(fileName)) {
    throw new ImportError(`"${fileName}" is not a supported file. Use .xlsx, .xls, .csv or .tsv.`)
  }
  if (data.length === 0) throw new ImportError(`"${fileName}" is empty.`)

  if (TEXT_EXTENSIONS.includes(ext)) {
    const text = decodeText(data)
    if (text.includes('\u0000')) throw new ImportError(`"${fileName}" does not look like a text file. It may be corrupt.`)
    const delimiter = ext === 'tsv' || ext === 'tab' ? '\t' : detectDelimiter(text)
    const rows = normalizeRows(parseDelimited(text, delimiter))
    if (rows.length === 0) throw new ImportError(`"${fileName}" contains no rows of data.`)
    return { fileName, sheets: [{ name: baseName(fileName) || 'Sheet1', rows }] }
  }

  const isXlsx = ext === 'xlsx' || ext === 'xlsm'
  // Password-protected .xlsx files are stored inside an OLE container instead of a zip.
  if (isXlsx && looksLikeOle(data)) {
    throw new ImportError(`"${fileName}" is password protected. Remove the password in Excel and try again.`)
  }
  if (isXlsx && !looksLikeZip(data)) {
    throw new ImportError(`"${fileName}" is not a valid Excel workbook. The file may be corrupt or saved in another format.`)
  }
  if (ext === 'xls' && !looksLikeOle(data) && !looksLikeZip(data) && !looksLikeMarkup(data)) {
    throw new ImportError(`"${fileName}" is not a valid Excel 97-2003 workbook. The file may be corrupt.`)
  }

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, { type: 'array', dense: true, cellDates: true, cellHTML: false, cellFormula: false })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (/password/i.test(detail)) throw new ImportError(`"${fileName}" is password protected. Remove the password in Excel and try again.`)
    throw new ImportError(`"${fileName}" could not be read. The file appears to be damaged or is not a real Excel workbook. (${detail})`)
  }

  const sheets: ParsedSheet[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
    const rows = normalizeRows(raw)
    if (rows.length > 0) sheets.push({ name, rows })
  }
  if (sheets.length === 0) throw new ImportError(`"${fileName}" has no sheets with data.`)
  return { fileName, sheets }
}

/* ------------------------------------------------------------------ */
/* Header detection and card building                                  */
/* ------------------------------------------------------------------ */

const HEADER_WORDS = [
  'term', 'terms', 'definition', 'definitions', 'word', 'words', 'meaning', 'meanings', 'front', 'back',
  'question', 'questions', 'answer', 'answers', 'english', 'spanish', 'french', 'german', 'translation',
  'concept', 'description', 'name', 'value', 'vocab', 'vocabulary', 'prompt', 'clue', 'example', 'notes',
  'note', 'hint', 'category', 'type', 'side a', 'side b'
]

export function detectHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const first = rows[0].filter((c) => c !== '')
  if (first.length === 0) return false
  if (first.some((c) => HEADER_WORDS.includes(c.toLowerCase().replace(/[^a-z ]/g, '').trim()))) return true
  return false
}

export function columnLetter(index: number): string {
  let s = ''
  let n = index + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function columnLabels(rows: string[][], hasHeader: boolean): string[] {
  const width = rows[0]?.length ?? 0
  return Array.from({ length: width }, (_, i) => {
    const header = hasHeader ? rows[0][i]?.trim() : ''
    return header ? `${columnLetter(i)} – ${header}` : `Column ${columnLetter(i)}`
  })
}

export type IssueKind = 'emptyTerm' | 'emptyDefinition' | 'duplicate'

export interface ImportCandidate {
  /** 1-based row number in the original sheet, for messages. */
  rowNumber: number
  term: string
  definition: string
  extra: Record<string, string>
  issues: IssueKind[]
}

export interface BuildOptions {
  termCol: number
  defCol: number
  hasHeader: boolean
}

export function buildCandidates(rows: string[][], opts: BuildOptions): ImportCandidate[] {
  const { termCol, defCol, hasHeader } = opts
  const width = rows[0]?.length ?? 0
  const extraCols: number[] = []
  for (let i = 0; i < width; i++) if (i !== termCol && i !== defCol) extraCols.push(i)
  const extraNames = extraCols.map((i) => (hasHeader && rows[0][i]?.trim()) || `Column ${columnLetter(i)}`)

  const seen = new Set<string>()
  const out: ImportCandidate[] = []
  for (let r = hasHeader ? 1 : 0; r < rows.length; r++) {
    const row = rows[r]
    const term = row[termCol] ?? ''
    const definition = row[defCol] ?? ''
    const issues: IssueKind[] = []
    if (!term) issues.push('emptyTerm')
    if (!definition) issues.push('emptyDefinition')
    if (term) {
      const key = term.toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(key)) issues.push('duplicate')
      else seen.add(key)
    }
    const extra: Record<string, string> = {}
    extraCols.forEach((col, k) => {
      if (row[col]) extra[extraNames[k]] = row[col]
    })
    out.push({ rowNumber: r + 1, term, definition, extra, issues })
  }
  return out
}

export interface IssueSummary {
  total: number
  emptyTerm: number
  emptyDefinition: number
  duplicate: number
}

export function summarizeIssues(candidates: ImportCandidate[]): IssueSummary {
  const s: IssueSummary = { total: candidates.length, emptyTerm: 0, emptyDefinition: 0, duplicate: 0 }
  for (const c of candidates) for (const i of c.issues) s[i]++
  return s
}

export interface FinalizeOptions {
  skipEmpty: boolean
  skipDuplicates: boolean
}

export function finalizeCandidates(candidates: ImportCandidate[], opts: FinalizeOptions): CardDraft[] {
  const out: CardDraft[] = []
  for (const c of candidates) {
    const empty = c.issues.includes('emptyTerm') || c.issues.includes('emptyDefinition')
    if (empty && (opts.skipEmpty || (!c.term && !c.definition))) continue
    if (c.issues.includes('duplicate') && opts.skipDuplicates) continue
    out.push({ term: c.term, definition: c.definition, extra: c.extra })
  }
  return out
}
