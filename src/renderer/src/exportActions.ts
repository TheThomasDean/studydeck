import type { StudySet } from '@shared/types'
import { setToCsvBytes, setToXlsxBytes } from '@lib/exporter'

export async function exportSet(
  set: StudySet,
  kind: 'xlsx' | 'csv',
  notify: (msg: string, kind?: 'info' | 'error') => void
): Promise<void> {
  try {
    const bytes = kind === 'xlsx' ? setToXlsxBytes(set) : setToCsvBytes(set)
    const result = await window.studydeck.saveExport(set.title, bytes, kind)
    if (result.ok) notify(`Exported to ${result.path}`)
    else if (result.error) notify(`Export failed: ${result.error}`, 'error')
  } catch (err) {
    notify(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}
