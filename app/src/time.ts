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

/** Picker label for a run, e.g. "05-06 13:04–13:55". */
export function formatRunWindow(startIso: string, endIso: string): string {
  const start = new Date(isoToEpoch(startIso) * 1000).toISOString()
  const end = new Date(isoToEpoch(endIso) * 1000).toISOString()
  return `${start.slice(5, 10)} ${start.slice(11, 16)}–${end.slice(11, 16)}`
}
