import { Placeholder } from './Placeholder'
import type { ScreenProps } from './types'

export function DisplayTest({ dataset, run, minVisitS }: ScreenProps) {
  const glances = dataset.objectVisits.filter(
    (visit) => visit.runId === run.id && visit.dwell >= minVisitS,
  )
  const objectCount = new Set(glances.map((visit) => visit.objectId)).size
  return (
    <Placeholder
      title="Did people look at this display?"
      question="Did people look at a specific display, how soon, and how often?"
      todo={[
        'Picker for any included object or whole lane, defaulting to Vital sign monitor',
        'Per learner: time to first look, glances, total dwell, mean glance length',
        'Headline: "N of M learners looked at it; median time to first look X min"',
        'Small timeline of glances per learner',
      ]}
    >
      {glances.length} object glances across {objectCount} objects in this run
    </Placeholder>
  )
}
