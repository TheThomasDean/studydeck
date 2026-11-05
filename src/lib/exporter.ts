import * as XLSX from 'xlsx'
import type { StudySet } from '@shared/types'

/** Header row + one row per card: Term, Definition, then any extra columns. */
export function setToRows(set: StudySet): string[][] {
  const extraKeys: string[] = []
  for (const c of set.cards) {
    for (const k of Object.keys(c.extra ?? {})) if (!extraKeys.includes(k)) extraKeys.push(k)
  }
  const rows: string[][] = [['Term', 'Definition', ...extraKeys]]
  for (const c of set.cards) {
    rows.push([c.term, c.definition, ...extraKeys.map((k) => c.extra?.[k] ?? '')])
  }
  return rows
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value) || /^\s|\s$/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens Unicode correctly. */
export function rowsToCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

export function setToCsvBytes(set: StudySet): Uint8Array {
  return new TextEncoder().encode(rowsToCsv(setToRows(set)))
}

export function setToXlsxBytes(set: StudySet): Uint8Array {
  const rows = setToRows(set)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = rows[0].map((_, i) => ({ wch: i < 2 ? 40 : 24 }))
  const wb = XLSX.utils.book_new()
  const sheetName = (set.title.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Cards').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Uint8Array(out)
}
