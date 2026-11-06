// The log's clock is treated as UTC everywhere, so times show as logged.

/** Parses a pipeline ISO string to epoch seconds. A string with no offset counts as UTC. */
export function isoToEpoch(iso: string): number {
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(iso)
  return Date.parse(hasOffset ? iso : `${iso}Z`) / 1000
}

/** Clock time as logged, e.g. "13:04:27". */
export function formatClock(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(11, 19)
}

/** Time since the start of a run, e.g. 125 -> "02:05". */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A run's date, e.g. "May 6". */
export function formatDay(iso: string): string {
  const date = new Date(isoToEpoch(iso) * 1000)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

/** A span of clock time to the minute, e.g. "13:04–13:55". */
export function formatClockSpan(start: number, end: number): string {
  return `${formatClock(start).slice(0, 5)}–${formatClock(end).slice(0, 5)}`
}

/** The learners in a run, e.g. [1, 2, 3, 4] -> "learners 1–4", [2] -> "learner 2". */
export function formatLearners(ids: number[]): string {
  if (ids.length === 1) return `learner ${ids[0]}`
  const consecutive = ids.every((id, index) => index === 0 || id === ids[index - 1] + 1)
  return `learners ${consecutive ? `${ids[0]}–${ids.at(-1)}` : ids.join(', ')}`
}

/** A file or duration size, e.g. 2.4 -> "2.4 min". Undefined shows as a dash. */
export function formatMinutes(seconds: number | undefined): string {
  return seconds === undefined ? '—' : `${(seconds / 60).toFixed(1)} min`
}

export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)} h`
}

export function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

/** A length of time, e.g. 2.4 -> "2.4 s", 125 -> "2m 05s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}
