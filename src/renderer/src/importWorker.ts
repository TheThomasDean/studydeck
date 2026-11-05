/// <reference lib="webworker" />
import { parseWorkbook } from '@lib/importParse'

export interface WorkerRequest {
  name: string
  data: Uint8Array
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const wb = parseWorkbook(e.data.data, e.data.name)
    self.postMessage({ ok: true, workbook: wb })
  } catch (err) {
    self.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) })
  }
}
