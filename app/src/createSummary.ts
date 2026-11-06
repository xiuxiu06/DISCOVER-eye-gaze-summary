// Browser counterpart of summarize_gaze.py: filter, dynamic condensing and per-second timeline.
// check:summary compares the full recording against the existing Python-generated output.
import filter from './summaryFilter.json'
import type { GazeSummary } from './summary'
export interface SummaryRow { userId: number; logSession: number; objectId: string; gazeTime: number; epoch: number; order: number }
const ignored = new Set(filter.objects.map((name) => name.toLowerCase()))
const patterns = filter.patterns.map((pattern) => new RegExp(pattern.source, pattern.flags))
const irrelevant = (name: string) => !name.trim() || ignored.has(name.trim().toLowerCase()) || patterns.some((pattern) => pattern.test(name.trim()))
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const directional = new Set(['left', 'right', 'upper', 'lower', 'inner', 'outer'])
const generic = new Set(['new', 'old', 'small', 'large', 'big', 'top', 'bottom', 'front', 'back'])
function tokenize(name: string) {
  const tokens: string[] = [], boundaries = new Set<number>()
  for (const part of name.trim().split(/[_\-\s]+/).filter(Boolean)) {
    if (/^[A-Z]{1,4}\d+$/.test(part)) tokens.push(part)
    else if (/^[a-z][A-Z]{2,}\d*$/.test(part)) tokens.push(part.replace(/\d+$/, ''))
    else for (const token of part.match(/[A-Z]{1,4}\d+(?=[A-Z][a-z]|$)|[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+[a-zA-Z]*/g) ?? []) {
      if (tokens.length && /^\d+(?:kg|mg|ml|cm|mm|g|l)?$/i.test(token)) continue
      tokens.push(token)
    }
    if (tokens.length) boundaries.add(tokens.length)
  }
  if (!tokens.length) { tokens.push(name.trim()); boundaries.add(1) }
  return { tokens, boundaries }
}
// SequenceMatcher matching-block ratio for short identifier tokens (no autojunk applies).
function similarity(a: string, b: string): number {
  function matches(a0: number, a1: number, b0: number, b1: number): number {
    let ai = a0, bi = b0, size = 0
    for (let i = a0; i < a1; i++) for (let j = b0; j < b1; j++) {
      let n = 0
      while (i + n < a1 && j + n < b1 && a[i + n] === b[j + n]) n++
      if (n > size) { ai = i; bi = j; size = n }
    }
    return size ? size + matches(a0, ai, b0, bi) + matches(ai + size, a1, bi + size, b1) : 0
  }
  return a.length + b.length ? 2 * matches(0, a.length, 0, b.length) / (a.length + b.length) : 1
}
export function condenseMapping(names: string[]): Map<string, string> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort(compare)
  const parsed = new Map(unique.map((name) => [name, tokenize(name)]))
  const tokens = new Map<string, string[]>(), normalized = new Map<string, string[]>()
  const stripped = new Set<string>(), fuzzy = new Set<string>()
  const groups = new Map<string, string[]>()
  for (const name of unique) {
    let ts = parsed.get(name)!.tokens
    if (directional.has(ts[0].toLowerCase()) && ts.length >= 2) { ts = ts.slice(1); stripped.add(name) }
    const nt = ts.map((token) => { const low = token.toLowerCase(); return low.length > 4 && low.endsWith('s') && !low.endsWith('ss') ? low.slice(0, -1) : low })
    tokens.set(name, ts); normalized.set(name, nt)
    const key = generic.has(nt[0]) && nt.length >= 2 ? nt.slice(0, 2).join('|') : nt[0]
    groups.set(key, [...(groups.get(key) ?? []), name])
  }
  const multi = [...groups.keys()].filter((key) => groups.get(key)!.length >= 2)
  for (const [key, members] of [...groups]) {
    if (members.length !== 1 || key.includes('|') || key.length < 5) continue
    const solo = members[0], nt = normalized.get(solo)!
    if (nt.length < 2) continue
    for (const mk of multi) {
      if (mk.includes('|') || mk.length < 5) continue
      const rep = normalized.get(groups.get(mk)![0])!
      if (rep.length >= 2 && nt[1] === rep[1] && similarity(nt[0], mk) >= 0.84) {
        groups.get(mk)!.push(solo); fuzzy.add(solo); groups.delete(key); break
      }
    }
  }
  const suffixes = new Map<string, string>()
  for (const mk of multi) for (const name of groups.get(mk) ?? []) {
    const nt = normalized.get(name)!
    if (nt.length >= 2) suffixes.set(nt.join('|'), mk)
  }
  for (const [key, members] of [...groups]) {
    if (members.length !== 1) continue
    const solo = members[0], nt = normalized.get(solo)!
    const mk = nt.length >= 3 ? suffixes.get(nt.slice(1).join('|')) : undefined
    if (mk !== undefined) { groups.get(mk)!.push(solo); fuzzy.add(solo); groups.delete(key) }
  }
  const result = new Map<string, string>()
  for (const [, members] of [...groups].sort((a, b) => compare(a[0], b[0]))) {
    if (members.length === 1) { result.set(members[0], members[0]); continue }
    let core = members.filter((name) => !fuzzy.has(name)); if (!core.length) core = members
    const max = Math.min(...core.map((name) => normalized.get(name)!.length))
    let length = 1
    for (let i = 1; i < Math.min(3, max); i++) {
      if (new Set(core.map((name) => normalized.get(name)![i])).size === 1) length = i + 1
      else break
    }
    const nonDirectional = core.filter((name) => !stripped.has(name))
    if (length > 1 && nonDirectional.length && core.some((name) => name.includes('_'))) {
      while (length > 1 && !nonDirectional.every((name) => parsed.get(name)!.boundaries.has(length) || !name.includes('_'))) length--
    }
    const counts = new Map<string, number>()
    for (const name of core) {
      const ts = tokens.get(name)!.slice(0, length)
      const candidate = !stripped.has(name) && name.includes('_') && length > 1 && parsed.get(name)!.boundaries.has(1)
        ? ts.join('_') : length === 1 ? ts[0] : ts[0] + ts.slice(1).map((t) => t[0].toUpperCase() + t.slice(1)).join('')
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1)
    }
    const uppercase = (name: string) => /^[A-Z]/.test(name)
    const label = [...counts].sort((a, b) => b[1] - a[1] || Number(uppercase(b[0])) - Number(uppercase(a[0])) || compare(a[0], b[0]))[0][0]
    for (const name of members) result.set(name, label)
  }
  return result
}

export function createSummary(rows: SummaryRow[]): GazeSummary {
  const rawNames = new Map<string, string>()
  for (const row of rows) if (!irrelevant(row.objectId) && !rawNames.has(row.objectId.toLowerCase())) rawNames.set(row.objectId.toLowerCase(), row.objectId)
  const mapping = condenseMapping([...rawNames.values()])
  const canonical = new Map([...rawNames].map(([low, name]) => [low, mapping.get(name)!]))
  const processed = rows.map((row) => ({ ...row, objectId: canonical.get(row.objectId.toLowerCase()) ?? row.objectId }))
  const users: GazeSummary['users'] = []
  for (const userId of [...new Set(rows.map((row) => row.userId))].sort((a, b) => a - b)) {
    if (userId === 0) continue
    const entries: GazeSummary['users'][number]['entries'] = []
    const sessions = new Map<number, SummaryRow[]>()
    for (const row of processed) if (row.userId === userId) {
      const group = sessions.get(row.logSession) ?? []; group.push(row); sessions.set(row.logSession, group)
    }
    function append(segment: SummaryRow[], cumulative: boolean) {
      const totals = new Map<number, Map<string, number>>(), used = new Map<number, number>()
      let max = 0, cursor = 0, previous: number | undefined
      const anchor = Math.floor(segment[0].epoch)
      const add = (second: number, amount: number, row: SummaryRow) => {
        used.set(second, (used.get(second) ?? 0) + amount)
        if (!irrelevant(row.objectId)) {
          const scores = totals.get(second) ?? new Map<string, number>()
          scores.set(row.objectId, (scores.get(row.objectId) ?? 0) + amount); totals.set(second, scores)
        }
      }
      for (const row of segment) {
        const second = Math.floor(row.epoch) - anchor, duration = row.gazeTime
        if (cumulative) {
          if (duration <= 0) continue
          const end = cursor + duration
          for (let sec = Math.floor(cursor); sec <= Math.floor(Math.max(cursor, end - 1e-9)); sec++) {
            const overlap = Math.min(end, sec + 1) - Math.max(cursor, sec)
            if (overlap > 0) add(sec, overlap, row)
          }
          cursor = end; continue
        }
        max = Math.max(max, second)
        if (duration <= 0) { previous = second; continue }
        if (previous !== undefined && second > previous && (second - previous >= 2 || duration > 1)) {
          const interior = Math.max(0, second - previous - 1)
          for (let sec = previous + 1; sec < second; sec++) add(sec, 1, row)
          const remainder = Math.max(0, duration - interior)
          let before: number, current: number
          if (previous === 0) { before = Math.min(1, remainder * 0.5); current = Math.min(1, remainder - before) }
          else {
            before = Math.min(Math.max(0, 1 - Math.min(1, used.get(previous) ?? 0)), remainder)
            current = remainder - before
            if (current > 1) { before = Math.min(1, before + current - 1); current = 1 }
          }
          if (before > 0) add(previous, before, row)
          if (current > 0) add(second, current, row)
        } else add(second, duration, row)
        previous = second
      }
      const count = cumulative ? Math.max(1, Math.ceil(cursor - 1e-6)) : max + 1
      const offset = entries.length
      for (let sec = 0; sec < count; sec++) {
        let object: string | null = null, best = -Infinity
        for (const [name, score] of totals.get(sec) ?? []) if (score > best) { object = name; best = score }
        entries.push({ second: offset + sec, object })
      }
    }
    for (const session of [...sessions.values()].sort((a, b) => a[0].epoch - b[0].epoch || a[0].order - b[0].order)) {
      session.sort((a, b) => a.epoch - b.epoch || a.order - b.order)
      if (session.every((row) => row.epoch % 60 === 0) && session.reduce((sum, row) => sum + row.gazeTime, 0) > 5 && session.length > 10) {
        append(session, true); continue
      }
      let segment: SummaryRow[] = []
      for (const row of session) {
        if (segment.length && row.epoch - segment.at(-1)!.epoch > Math.max(row.gazeTime + 15, 300)) { append(segment, false); segment = [] }
        segment.push(row)
      }
      if (segment.length) append(segment, false)
    }
    if (entries.length) users.push({ userId, entries })
  }
  return { relevant_objects: [...new Set(mapping.values())].sort((a, b) => compare(a.toLowerCase(), b.toLowerCase())), users }
}
