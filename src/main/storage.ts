import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Settings, StudySet } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

/**
 * JSON file storage in the userData directory.
 *   <userData>/data/settings.json
 *   <userData>/data/sets/<id>.json   (one file per study set)
 * Every write goes to a temp file first and is then renamed over the target,
 * so a crash mid-write never leaves a half-written file behind.
 */
export class Storage {
  private readonly root: string
  private readonly setsDir: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(userData: string) {
    this.root = path.join(userData, 'data')
    this.setsDir = path.join(this.root, 'sets')
  }

  async init(): Promise<void> {
    await fs.mkdir(this.setsDir, { recursive: true })
  }

  /** Serialize writes so two saves of the same file never interleave. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async writeAtomic(file: string, data: string): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(tmp, file)
    } catch (err) {
      // Windows can briefly lock the target (antivirus, indexer). Retry once.
      await new Promise((r) => setTimeout(r, 50))
      try {
        await fs.rename(tmp, file)
      } catch {
        await fs.rm(tmp, { force: true })
        throw err
      }
    }
  }

  private setFile(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid set id: ${id}`)
    return path.join(this.setsDir, `${id}.json`)
  }

  async listSets(): Promise<StudySet[]> {
    const names = await fs.readdir(this.setsDir)
    const sets: StudySet[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(this.setsDir, name), 'utf8')
        const parsed = JSON.parse(raw) as StudySet
        if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.cards)) sets.push(parsed)
      } catch (err) {
        console.error(`Skipping unreadable set file ${name}:`, err)
      }
    }
    return sets
  }

  saveSet(set: StudySet): Promise<void> {
    return this.enqueue(() => this.writeAtomic(this.setFile(set.id), JSON.stringify(set)))
  }

  deleteSet(id: string): Promise<void> {
    return this.enqueue(() => fs.rm(this.setFile(id), { force: true }))
  }

  async getSettings(): Promise<Settings> {
    try {
      const raw = await fs.readFile(path.join(this.root, 'settings.json'), 'utf8')
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.enqueue(() =>
      this.writeAtomic(path.join(this.root, 'settings.json'), JSON.stringify(settings, null, 2))
    )
  }
}
