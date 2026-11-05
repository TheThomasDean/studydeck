// Types shared by the main process, preload script and renderer.

export type Mastery = 'new' | 'learning' | 'familiar' | 'mastered'

export interface Card {
  id: string
  term: string
  definition: string
  /** Values from extra spreadsheet columns, keyed by header name. */
  extra?: Record<string, string>
  timesSeen: number
  timesCorrect: number
  starred: boolean
  lastSeen: number | null
  mastery: Mastery
  /** Consecutive correct answers, used to promote / demote mastery. */
  streak: number
  /** Total wrong answers across all modes (drives Deep Dive's rare fish). */
  timesMissed?: number
}

export interface TestScore {
  date: number
  correct: number
  total: number
  percent: number
}

export interface SetHistory {
  testScores: TestScore[]
  /** Match times in milliseconds, best first (top 10 kept). */
  matchTimes: number[]
  bestMatchMs: number | null
  charmsHighScore: number
  lockBestScore: number
  deepDiveBest: number
}

export interface StudySet {
  id: string
  title: string
  description: string
  createdAt: number
  updatedAt: number
  lastStudied: number | null
  cards: Card[]
  history: SetHistory
  /** Saved Learn-mode progress so a session can be resumed. */
  learn?: LearnState
}

/* ---------------- Learn mode ---------------- */

export type LearnLevel = 'unseen' | 'familiar' | 'mastered'

export interface LearnCardState {
  level: LearnLevel
  /** Round in which the card last moved up a level (mastery needs a later round). */
  promotedRound: number
  /** Wrong answers in Learn for this card (for "study missed cards"). */
  misses: number
  /** Distractors shown the last time this card was asked. */
  lastDistractors?: string[]
}

export interface LearnSettings {
  /** Side the learner answers with; the other side is the prompt. */
  answerWith: 'definition' | 'term'
  shuffle: boolean
  /** Switch familiar cards to typed answers. */
  typeWhenFamiliar: boolean
}

export interface LearnState {
  version: 1
  round: number
  cards: Record<string, LearnCardState>
  /** Card ids still to answer in the current round (front = next). */
  queue: string[]
  /** All card ids picked for the current round. */
  roundCards: string[]
  /** Card ids answered wrong at least once in the current round. */
  roundMissed: string[]
  settings: LearnSettings
}

export type ThemePref = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePref
  soundOn: boolean
  seeded: boolean
}

export interface OpenedFile {
  name: string
  data: Uint8Array
}

export interface SaveResult {
  ok: boolean
  path?: string
  error?: string
}

/** The API exposed to the renderer as window.studydeck. */
export interface StudyDeckApi {
  listSets(): Promise<StudySet[]>
  saveSet(set: StudySet): Promise<void>
  deleteSet(id: string): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  openSpreadsheet(): Promise<OpenedFile | null>
  saveExport(defaultName: string, data: Uint8Array, kind: 'xlsx' | 'csv'): Promise<SaveResult>
  platform: string
}

export const IPC = {
  listSets: 'sets:list',
  saveSet: 'sets:save',
  deleteSet: 'sets:delete',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  openSpreadsheet: 'dialog:openSpreadsheet',
  saveExport: 'dialog:saveExport'
} as const

export const DEFAULT_SETTINGS: Settings = { theme: 'system', soundOn: false, seeded: false }
