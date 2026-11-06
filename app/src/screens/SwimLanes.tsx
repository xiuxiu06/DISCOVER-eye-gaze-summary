import { countByLearner, includedLanes } from '../metrics'
import { Placeholder } from './Placeholder'
import type { ScreenProps } from './types'

export function SwimLanes({ dataset, run, touchpoints }: ScreenProps) {
  const counts = countByLearner(touchpoints)
  const lanes = includedLanes(dataset.meta)
  return (
    <Placeholder
      title="Where each learner's attention went over time"
      question="How did each person's attention move, and was anyone on the team watching the patient or monitor?"
      todo={[
        'One swim panel per learner: lane labels, pale bands, dots joined by a thin line',
        'Hatched idle intervals, shared time axis, zoom and pan with a reset button',
        'Team coverage strip for Patient assessment and Vital sign monitor',
        'Dot tooltip and a scrubber with a side panel',
        'Stretch: overlay mode',
      ]}
    >
      <ul className="lane-key">
        {lanes.map((lane) => (
          <li key={lane.id} style={{ background: lane.band, borderLeftColor: lane.color }}>
            {lane.label}
          </li>
        ))}
      </ul>
      <p>
        Touchpoints:{' '}
        {run.userIds.map((id) => `Learner ${id}: ${counts.get(id) ?? 0}`).join(' · ')}
      </p>
    </Placeholder>
  )
}
