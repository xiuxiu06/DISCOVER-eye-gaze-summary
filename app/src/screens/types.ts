import type { Dataset, Run, Visit } from '../types'
import type { Analysis, Matching } from '../api'
import type { ClaudeReport } from '../reportTypes'

/** An uploaded file the app is holding. */
export interface HeldFile {
  name: string
  size: number
}

export interface FileControls {
  gaze: HeldFile | undefined
  laneMap: HeldFile | undefined
  reading: boolean
  error: string | undefined
  /** Facts about the last processed upload, shown next to the file list. */
  note: string | undefined
  addFiles: (files: File[]) => void
  removeGaze: () => void
  removeLaneMap: () => void
  ideal: HeldFile | undefined
  addIdeal: (file: File) => void
  removeIdeal: () => void
  reprocess: () => void
  analysis: Analysis | undefined
  matching: Matching
  setMatch: (learner: string, ideal: string | null) => void
  report: ClaudeReport | undefined
  generating: boolean
  reportError: string | undefined
  generateReport: () => void
}

/** What every screen receives from the app shell. */
export interface ScreenProps {
  dataset: Dataset
  run: Run
  /** Current "Min touchpoint" slider value, in seconds. */
  minVisitS: number
  /** The selected run's visits at or above the slider value, in time order. */
  touchpoints: Visit[]
  files: FileControls
  openLanes: () => void
  /** Opens a learner's report card. */
  openLearner: (userId: number) => void
  /** The learner shown on the report card. */
  learnerId: number
  setLearnerId: (userId: number) => void
}
