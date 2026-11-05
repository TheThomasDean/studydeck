import type { StudyDeckApi } from '../shared/types'

declare global {
  interface Window {
    studydeck: StudyDeckApi
  }
}

export {}
