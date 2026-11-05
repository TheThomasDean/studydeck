import type { OpenedFile } from '@shared/types'

export type ModeName = 'learn' | 'flashcards' | 'test' | 'match' | 'charms' | 'lock' | 'deepdive'

export type Route =
  | { name: 'library' }
  | { name: 'set'; setId: string }
  | { name: 'edit'; setId: string }
  | { name: 'import'; file?: OpenedFile; text?: string }
  | { name: 'study'; setId: string; mode: ModeName; cardIds?: string[] }

export type Navigate = (route: Route) => void
