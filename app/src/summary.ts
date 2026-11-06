import type { Visit } from './types'

export interface GazeSummary {
  relevant_objects: string[]
  users: { userId: number; entries: { second: number; object: string | null }[] }[]
}

/** Read the existing summarize_gaze.py JSON format, without reimplementing its filters. */
export function parseSummary(input: unknown): GazeSummary {
  if (!input || typeof input !== 'object') throw new Error('Expected a gaze summary JSON object.')
  const data = input as Record<string, unknown>
  if (!Array.isArray(data.relevant_objects) || !data.relevant_objects.every((x) => typeof x === 'string')) {
    throw new Error('Missing relevant_objects. Generate the file with summarize_gaze.py --condense.')
  }
  const names = new Set(data.relevant_objects)
  const users: GazeSummary['users'] = []
  for (const [key, value] of Object.entries(data)) {
    if (!/^user\d+$/.test(key) || key === 'user0') continue
    if (!Array.isArray(value)) throw new Error(key + ' must contain a timeline.')
    const entries: GazeSummary['users'][number]['entries'] = []
    let previous = -1
    for (const item of value) {
      if (!item || !Number.isSafeInteger(item.second) || item.second < 0 || item.second <= previous ||
          (item.object !== null && (typeof item.object !== 'string' || !names.has(item.object)))) {
        throw new Error('Invalid or unordered timeline entry in ' + key + '.')
      }
      entries.push({ second: item.second, object: item.object })
      previous = item.second
    }
    if (entries.length) users.push({ userId: Number(key.slice(4)), entries })
  }
  if (!users.length) throw new Error('No learner timelines found in this summary.')
  return { relevant_objects: data.relevant_objects, users: users.sort((a, b) => a.userId - b.userId) }
}

/** Run-length encode adjacent identical seconds; nulls and missing seconds break a segment. */
export function summaryVisits(summary: GazeSummary, userId: number): Visit[] {
  const visits: Visit[] = []
  for (const entry of summary.users.find((user) => user.userId === userId)?.entries ?? []) {
    if (entry.object === null) continue
    const last = visits.at(-1)
    if (last && last.lane === entry.object && last.end === entry.second) {
      last.end++
      last.dwell++
      last.objects[entry.object]++
    } else visits.push({
      sessionId: 'summary-' + userId, userId, runId: 'summary', lane: entry.object,
      start: entry.second, end: entry.second + 1, dwell: 1, objects: { [entry.object]: 1 },
    })
  }
  return visits
}
