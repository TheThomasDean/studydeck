import { parseWorkbook, type ParsedWorkbook } from '@lib/importParse'
import ImportWorker from './importWorker?worker'

/**
 * Parse a spreadsheet off the UI thread in a Web Worker so large files never
 * freeze the window. Falls back to parsing on the main thread if workers are
 * unavailable for any reason.
 */
export function parseFileAsync(name: string, data: Uint8Array): Promise<ParsedWorkbook> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new ImportWorker()
    } catch {
      setTimeout(() => {
        try {
          resolve(parseWorkbook(data, name))
        } catch (err) {
          reject(err)
        }
      }, 0)
      return
    }
    worker.onmessage = (e: MessageEvent<{ ok: true; workbook: ParsedWorkbook } | { ok: false; message: string }>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.workbook)
      else reject(new Error(e.data.message))
    }
    worker.onerror = (e) => {
      worker.terminate()
      e.preventDefault()
      // Worker failed to load: parse here instead.
      try {
        resolve(parseWorkbook(data, name))
      } catch (err) {
        reject(err)
      }
    }
    // Copy so the caller keeps its buffer usable.
    const copy = data.slice()
    worker.postMessage({ name, data: copy }, [copy.buffer])
  })
}
