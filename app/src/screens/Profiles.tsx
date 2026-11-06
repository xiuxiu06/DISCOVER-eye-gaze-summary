import { Placeholder } from './Placeholder'
import type { ScreenProps } from './types'

export function Profiles({ run }: ScreenProps) {
  return (
    <Placeholder
      title="How each learner's attention differs"
      question="How do learners differ in where they look and how they scan?"
      todo={[
        'Lane share bar and % of active time on included lanes',
        'Touchpoints per lane, mean touchpoint length, time to first touchpoint',
        'Longest stretch with no monitor touchpoint, and the same for patient',
        'Monitor ↔ patient switches and a transition heatmap',
        'Comparison table across learners',
      ]}
    >
      {run.userIds.length} learners in this run
    </Placeholder>
  )
}
