import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildCandidates,
  detectHeader,
  finalizeCandidates,
  ImportError,
  parseDelimited,
  parseTextTable,
  parseWorkbook,
  summarizeIssues
} from '../importParse'
import { setToCsvBytes, setToXlsxBytes } from '../exporter'
import { makeSet } from '../sets'

const enc = (s: string) => new TextEncoder().encode(s)

describe('parseDelimited', () => {
  it('handles quoted commas, escaped quotes and line breaks inside quotes', () => {
    const rows = parseDelimited('term,definition\n"a, b","say ""hi"""\r\n"multi\nline",x\n', ',')
    expect(rows).toEqual([
      ['term', 'definition'],
      ['a, b', 'say "hi"'],
      ['multi\nline', 'x']
    ])
  })

  it('auto-detects tabs (paste from Excel) and semicolons', () => {
    expect(parseDelimited('hola\thello\nadiós\tgoodbye')).toEqual([
      ['hola', 'hello'],
      ['adiós', 'goodbye']
    ])
    expect(parseDelimited('a;b\nc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })
})

describe('parseWorkbook', () => {
  it('parses UTF-8 CSV with a BOM and Unicode', () => {
    const wb = parseWorkbook(enc('﻿Term,Definition\n日本,Japan\ncafé,coffee\n'), 'words.csv')
    expect(wb.sheets[0].rows).toEqual([
      ['Term', 'Definition'],
      ['日本', 'Japan'],
      ['café', 'coffee']
    ])
  })

  it('reads xlsx with several sheets and converts numbers to text', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Element', 'Number'], ['Gold', 79], ['Pi', 3.14159]]), 'Chem')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x', 'line1\nline2']]), 'Other')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const parsed = parseWorkbook(bytes, 'book.xlsx')
    expect(parsed.sheets.map((s) => s.name)).toEqual(['Chem', 'Other'])
    expect(parsed.sheets[0].rows[1]).toEqual(['Gold', '79'])
    expect(parsed.sheets[0].rows[2][1]).toBe('3.14159')
    expect(parsed.sheets[1].rows[0][1]).toBe('line1\nline2')
  })

  it('throws a readable ImportError for a corrupt workbook', () => {
    expect(() => parseWorkbook(enc('this is not a zip file'), 'broken.xlsx')).toThrow(ImportError)
    expect(() => parseWorkbook(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9, 9]), 'broken.xlsx')).toThrow(/damaged/)
    expect(() => parseWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'locked.xlsx')).toThrow(/password/)
    expect(() => parseWorkbook(enc('a,b'), 'notes.docx')).toThrow(/not a supported file/)
  })

  it('parses 5,000+ rows quickly', () => {
    const lines = ['Term,Definition']
    for (let i = 0; i < 6000; i++) lines.push(`term ${i},"definition, number ${i}"`)
    const t0 = performance.now()
    const wb = parseWorkbook(enc(lines.join('\n')), 'big.csv')
    const cands = buildCandidates(wb.sheets[0].rows, { termCol: 0, defCol: 1, hasHeader: true })
    expect(cands).toHaveLength(6000)
    expect(cands[5999].definition).toBe('definition, number 5999')
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('header detection and candidates', () => {
  it('detects header rows by common names', () => {
    expect(detectHeader([['Term', 'Definition'], ['a', 'b']])).toBe(true)
    expect(detectHeader([['hola', 'hello'], ['a', 'b']])).toBe(false)
  })

  it('flags empty cells and duplicate terms, then skips or keeps them', () => {
    const rows = parseTextTable('Word\tMeaning\tNote\nhola\thello\tgreeting\n\tmissing\t\nHola\thi again\t\nadiós\t\t').sheets[0].rows
    const cands = buildCandidates(rows, { termCol: 0, defCol: 1, hasHeader: true })
    expect(cands[0].extra).toEqual({ Note: 'greeting' })
    const s = summarizeIssues(cands)
    expect(s).toMatchObject({ total: 4, emptyTerm: 1, emptyDefinition: 1, duplicate: 1 })
    expect(finalizeCandidates(cands, { skipEmpty: true, skipDuplicates: true })).toHaveLength(1)
    expect(finalizeCandidates(cands, { skipEmpty: false, skipDuplicates: false })).toHaveLength(4)
  })
})

describe('export round trip', () => {
  it('exports to CSV and XLSX and re-imports the same cards', () => {
    const set = makeSet('Round, "trip"', '', [
      { term: 'a, b', definition: 'line1\nline2' },
      { term: 'ñ', definition: '"quoted"' }
    ])
    for (const [bytes, name] of [
      [setToCsvBytes(set), 'x.csv'],
      [setToXlsxBytes(set), 'x.xlsx']
    ] as const) {
      const rows = parseWorkbook(bytes, name).sheets[0].rows
      expect(detectHeader(rows)).toBe(true)
      const drafts = finalizeCandidates(buildCandidates(rows, { termCol: 0, defCol: 1, hasHeader: true }), {
        skipEmpty: true,
        skipDuplicates: false
      })
      expect(drafts.map((d) => [d.term, d.definition])).toEqual([
        ['a, b', 'line1\nline2'],
        ['ñ', '"quoted"']
      ])
    }
  })
})
