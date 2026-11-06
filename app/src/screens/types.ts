import type { Dataset, Run, Visit } from '../types'

/** What every screen receives from the app shell. */
export interface ScreenProps {
  dataset: Dataset
  run: Run
  /** Current "Min touchpoint" slider value, in seconds. */
  minVisitS: number
  /** The selected run's visits at or above the slider value, in time order. */
  touchpoints: Visit[]
}
