import type { Dataset, Run, Visit } from '../types'

/** An uploaded or Claude-generated file the app is holding. */
export interface HeldFile {
  name: string
  size: number
  source?: 'upload' | 'claude'
}

export interface FileControls {
  gaze: HeldFile | undefined
  laneMap: HeldFile | undefined
  reading: boolean
  matchingLanes: boolean
  hasServerClaudeKey: boolean
  error: string | undefined
  /** Facts about the last processed upload or Claude match, shown next to the file list. */
  note: string | undefined
  addFiles: (files: File[]) => void
  uploadLaneMapFile: (file: File) => void
  matchLanesWithClaude: (apiKey?: string) => Promise<boolean>
  downloadLaneMap: () => void
  removeGaze: () => void
  removeLaneMap: () => void
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
