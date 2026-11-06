import { Placeholder } from './Placeholder'
import type { ScreenProps } from './types'

export function RawToSignal({ dataset, touchpoints }: ScreenProps) {
  return (
    <Placeholder
      title="From raw gaze log to clean signal"
      question="How do we turn the raw firehose into a clean signal?"
      todo={[
        'Monospace table of the first ~25 raw rows, with headline row and object counts',
        'Step list from funnel.json showing rows, seconds and a plain note for each step',
        'Final card: "A 50-minute session → ~N touchpoints"',
      ]}
    >
      {dataset.rawSample.length} raw rows, {dataset.funnel.length} funnel steps,{' '}
      {touchpoints.length} touchpoints in this run
    </Placeholder>
  )
}
