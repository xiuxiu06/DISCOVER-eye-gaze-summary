import type { Dataset, Meta, ObjectVisit, Visit } from './types'

export interface ObjectCandidate {
  objectId: string
  events?: number
  dwellS?: number
  learners?: number
}

export interface ClaudeLaneMatchResult {
  csvText: string
  modelUsed: string
  totalObjects: number
  clinicalObjects: number
  backgroundObjects: number
  verifyObjects: number
}

export const CLINICAL_SWIMLANES = [
  {
    id: 'Reference',
    description: 'Weight-based code sheets, dosing charts, and clinical reference aids (e.g., CodeSheet5kg, CodeSheet37kg).',
  },
  {
    id: 'Patient assessment',
    description:
      'Heart and lung sound auscultation points, pulses/haptics, capillary refill, stethoscope, penlight, pupil/eye checks, patient organs/body/limb exam targets, thermometer body/needle, blood draw, and point-of-care diagnostics like iStat.',
  },
  {
    id: 'Vital sign monitor',
    description:
      'RR, SpO2, and EKG displays, monitor bar, bedside monitor screens (e.g., T3_monitor_screen_*), and HFNC screen.',
  },
  {
    id: 'Equipment & interventions',
    description:
      'O2 delivery devices (nasal cannula, BiPAP, non-rebreather mask), airway bundles, bag-mask, IV bags/lines, medications (e.g., Epinephrine, MedLineSnap), eCPR, blood tubes, and equipment attachment snaps.',
  },
  {
    id: 'Communication',
    description:
      'Teammates’ heads or avatar communication targets (e.g., HeadFollower; mark confidence as "verify" when it is a proxy).',
  },
] as const

export const BACKGROUND_CATEGORIES = [
  {
    id: 'Self',
    description: 'Learner’s own VR hands, finger bones (Thumb, Index, Middle, Ring, Pinky), RobotHand, AutoHandPlayer.',
  },
  {
    id: 'Bed',
    description: 'Hospital bed frame, rails, hooks, pedals, and levers (e.g., Stryker_bed_*, linetBed_*).',
  },
  {
    id: 'System',
    description: 'VR UI chrome, loading screens, background planes, and spatial panel manipulators.',
  },
  {
    id: 'Environment',
    description:
      'Room walls, floor, sink, doors, lights/bulbs, counters, glass panels, and generic Unity colliders/cubes/hinges/knobs.',
  },
] as const

const INCLUDED_LANE_IDS = new Set<string>(CLINICAL_SWIMLANES.map((lane) => lane.id))

const CANONICAL_LANE_BY_ALIAS: Record<string, string> = {
  reference: 'Reference',
  'code sheet': 'Reference',
  codesheet: 'Reference',
  'patient assessment': 'Patient assessment',
  patient: 'Patient assessment',
  'patient exam': 'Patient assessment',
  'vital sign monitor': 'Vital sign monitor',
  'vital signs monitor': 'Vital sign monitor',
  monitor: 'Vital sign monitor',
  vitals: 'Vital sign monitor',
  'equipment & interventions': 'Equipment & interventions',
  'equipment and interventions': 'Equipment & interventions',
  equipment: 'Equipment & interventions',
  interventions: 'Equipment & interventions',
  communication: 'Communication',
  team: 'Communication',
  teammates: 'Communication',
  self: 'Self',
  bed: 'Bed',
  system: 'System',
  environment: 'Environment',
  background: 'Environment',
}

export const CLAUDE_LANE_SYSTEM_PROMPT = [
  'You are a Pediatric Simulation & VR Human-Factors Specialist for the CCHMC DISCOVER platform.',
  'Your task is to classify every VR scene `object_id` from a gaze tracking log into its swimlane category.',
  '',
  '### Primary Clinical Swimlane Categories (`include = True`):',
  ...CLINICAL_SWIMLANES.map((lane) => `- "${lane.id}": ${lane.description}`),
  '',
  '### Non-Clinical Background Categories (`include = False`, set aside from clinical swimlanes):',
  ...BACKGROUND_CATEGORIES.map((lane) => `- "${lane.id}": ${lane.description}`),
  '',
  '### Rules:',
  '1. Every input `object_id` MUST appear in `"mappings"` with one exact category name above.',
  '2. Set `"confidence"` to `"draft"` when classification is clear, or `"verify"` when an object name is ambiguous or a proxy (such as `HeadFollower` for teammates’ heads, generic `Screen`, or avatar limb `*IK`/`*Grab*` targets).',
  '3. Return ONLY valid JSON with no markdown code fences or commentary, matching this exact shape:',
  '{"mappings": {"<object_id>": {"lane": "<Category>", "confidence": "draft"}}}',
].join('\n')

const BROWSER_KEY_STORAGE = 'discover-claude-api-key'
const ANTHROPIC_VERSION = '2023-06-01'
const FALLBACK_MODEL = 'claude-sonnet-5-5'
const MAX_TOKENS = 32768

export function getSavedBrowserApiKey(): string {
  try {
    return localStorage.getItem(BROWSER_KEY_STORAGE)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function setSavedBrowserApiKey(key: string): void {
  try {
    const trimmed = key.trim()
    if (trimmed) localStorage.setItem(BROWSER_KEY_STORAGE, trimmed)
    else localStorage.removeItem(BROWSER_KEY_STORAGE)
  } catch {
    // Ignore storage errors in private browsing modes.
  }
}

export async function checkServerClaudeStatus(): Promise<boolean> {
  try {
    const resp = await fetch('/api/claude-status', { method: 'GET' })
    if (!resp.ok) return false
    const data = (await resp.json()) as { hasServerKey?: boolean }
    return Boolean(data.hasServerKey)
  } catch {
    return false
  }
}

function parseLine(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter)
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"' && quoted && line[i + 1] === '"') {
      field += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

function accumulateCsvObjects(
  csvText: string,
  idleMaxS: number,
  stats: Map<string, { events: number; dwell: number; users: Set<string> }>,
): void {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/)
  const first = lines[0] ?? ''
  const delimiter = first.includes('\t') ? '\t' : ','
  const header = parseLine(first, delimiter).map((h) =>
    h.trim().toLowerCase().replace(/[\s_-]/g, ''),
  )
  const objIdx = header.findIndex((h) => h === 'objectid' || h === 'object')
  const gazeIdx = header.findIndex((h) => h === 'gazetime' || h === 'duration')
  const userIdx = header.findIndex((h) => h === 'userid' || h === 'user')
  if (objIdx === -1) return

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i]
    if (!rawLine || rawLine.trim() === '') continue
    const cols = parseLine(rawLine, delimiter)
    const obj = (cols[objIdx] ?? '').trim()
    if (!obj || ['null', 'none', 'nan'].includes(obj.toLowerCase())) continue
    const user = userIdx !== -1 ? (cols[userIdx] ?? '').trim() : ''
    if (user === '0') continue
    const dur = gazeIdx !== -1 ? Number((cols[gazeIdx] ?? '').trim()) : 0
    let entry = stats.get(obj)
    if (!entry) {
      entry = { events: 0, dwell: 0, users: new Set<string>() }
      stats.set(obj, entry)
    }
    if (Number.isFinite(dur) && dur >= 0 && dur <= idleMaxS) {
      entry.events += 1
      entry.dwell += dur
      if (user) entry.users.add(user)
    }
  }
}

/** Extract unique object IDs (plus basic event/dwell stats) from raw gaze CSVs, or fall back to dataset meta. */
export function extractObjectsForClassification(
  gazeText: string | undefined,
  dataset: Dataset,
  idealText?: string,
): ObjectCandidate[] {
  if (gazeText || idealText) {
    const idleMaxS = dataset.meta.params.IDLE_MAX_S ?? 30
    const stats = new Map<string, { events: number; dwell: number; users: Set<string> }>()
    if (gazeText) accumulateCsvObjects(gazeText, idleMaxS, stats)
    if (idealText) accumulateCsvObjects(idealText, idleMaxS, stats)
    if (stats.size > 0) {
      return [...stats.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([objectId, info]) => ({
          objectId,
          events: info.events,
          dwellS: Math.round(info.dwell * 1000) / 1000,
          learners: info.users.size,
        }))
    }
  }

  return Object.keys(dataset.meta.objects)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((objectId) => ({ objectId }))
}

function normalizeLaneName(rawLane: string | undefined): { lane: string; recognized: boolean } {
  const cleaned = (rawLane ?? '').trim()
  const mapped = CANONICAL_LANE_BY_ALIAS[cleaned.toLowerCase()]
  if (mapped) return { lane: mapped, recognized: true }
  return { lane: 'Environment', recognized: false }
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fence = /```(?:json)?\s*(\{[\s\S]*\})\s*```/.exec(trimmed)
  const candidate = fence
    ? fence[1].trim()
    : (() => {
        const start = trimmed.indexOf('{')
        const end = trimmed.lastIndexOf('}')
        return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed
      })()
  return JSON.parse(candidate) as Record<string, unknown>
}

function csvCell(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replaceAll('"', '""')}"`
  }
  return str
}

export function buildLaneMapCsvFromResponse(
  candidates: ObjectCandidate[],
  rawText: string,
  modelUsed: string,
): ClaudeLaneMatchResult {
  const parsed = extractJsonObject(rawText)
  const rawMappings =
    parsed.mappings && typeof parsed.mappings === 'object'
      ? (parsed.mappings as Record<string, unknown>)
      : parsed

  const caseInsensitiveLookup = new Map<string, { lane?: string; confidence?: string }>()
  for (const [key, val] of Object.entries(rawMappings)) {
    if (typeof val === 'string') {
      caseInsensitiveLookup.set(key.toLowerCase(), { lane: val, confidence: 'draft' })
    } else if (val && typeof val === 'object') {
      const objVal = val as { lane?: unknown; category?: unknown; confidence?: unknown }
      caseInsensitiveLookup.set(key.toLowerCase(), {
        lane: typeof objVal.lane === 'string' ? objVal.lane : typeof objVal.category === 'string' ? objVal.category : undefined,
        confidence: typeof objVal.confidence === 'string' ? objVal.confidence : 'draft',
      })
    }
  }

  const lines = ['object_id,lane,include,confidence,events,dwell_s_excl_idle,learners']
  let clinicalObjects = 0
  let backgroundObjects = 0
  let verifyObjects = 0

  for (const item of candidates) {
    const hit = caseInsensitiveLookup.get(item.objectId.toLowerCase())
    const { lane, recognized } = normalizeLaneName(hit?.lane)
    const include = INCLUDED_LANE_IDS.has(lane)
    const confidence = !recognized || hit?.confidence === 'verify' ? 'verify' : 'draft'

    if (include) clinicalObjects++
    else backgroundObjects++
    if (confidence === 'verify') verifyObjects++

    lines.push(
      [
        csvCell(item.objectId),
        csvCell(lane),
        include ? 'True' : 'False',
        confidence,
        item.events ?? 0,
        item.dwellS ?? 0,
        item.learners ?? 0,
      ].join(','),
    )
  }

  return {
    csvText: `${lines.join('\n')}\n`,
    modelUsed,
    totalObjects: candidates.length,
    clinicalObjects,
    backgroundObjects,
    verifyObjects,
  }
}

async function resolveBrowserClaudeModel(apiKey: string): Promise<string> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (resp.ok) {
      const payload = (await resp.json()) as {
        data?: { id?: string; created_at?: string }[]
      }
      const models = [...(payload.data ?? [])].filter((m) => typeof m.id === 'string')
      models.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      const sonnet = models.find((m) => m.id!.toLowerCase().includes('sonnet'))
      if (sonnet?.id) return sonnet.id
      if (models[0]?.id) return models[0].id
    }
  } catch {
    // Fall back to default model if models endpoint fails.
  }
  return FALLBACK_MODEL
}

async function callAnthropicDirectFromBrowser(
  userMessage: string,
  apiKey: string,
): Promise<{ text: string; modelUsed: string }> {
  const model = await resolveBrowserClaudeModel(apiKey)
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: CLAUDE_LANE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Claude API HTTP ${resp.status}: ${errText}`)
  }

  if (!resp.body) {
    throw new Error('Claude API returned an empty response stream.')
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let modelUsed = model
  let stopReason: string | undefined
  const chunks: string[] = []

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const dataStr = line.slice(5).trim()
      if (!dataStr || dataStr === '[DONE]') continue
      const evt = JSON.parse(dataStr) as {
        type?: string
        message?: { model?: string }
        delta?: { type?: string; text?: string; stop_reason?: string }
        error?: unknown
      }
      if (evt.type === 'message_start' && evt.message?.model) {
        modelUsed = evt.message.model
      } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
        chunks.push(evt.delta.text)
      } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
        stopReason = evt.delta.stop_reason
      } else if (evt.type === 'error') {
        throw new Error(`Claude stream error: ${JSON.stringify(evt.error)}`)
      }
    }
  }

  if (stopReason === 'max_tokens') {
    throw new Error('Claude hit max_tokens before completing the lane mapping JSON.')
  }

  return { text: chunks.join('').trim(), modelUsed }
}

export async function matchLaneMapWithClaude(options: {
  candidates: ObjectCandidate[]
  apiKey?: string
}): Promise<ClaudeLaneMatchResult> {
  const { candidates, apiKey } = options
  if (candidates.length === 0) {
    throw new Error('No objects found to classify.')
  }

  const userMessage = [
    `Classify each of these ${candidates.length} DISCOVER VR objects into its swimlane category:`,
    JSON.stringify(
      candidates.map((c) =>
        c.events !== undefined
          ? { object_id: c.objectId, events: c.events, dwell_s: c.dwellS }
          : c.objectId,
      ),
    ),
  ].join('\n\n')

  // Prefer the local Vite server route (/api/match-lanes), which can read .env server-side without CORS issues.
  let serverResponse: Response | undefined
  try {
    serverResponse = await fetch('/api/match-lanes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: CLAUDE_LANE_SYSTEM_PROMPT,
        userMessage,
        apiKey: apiKey?.trim() || undefined,
      }),
    })
  } catch {
    serverResponse = undefined
  }

  if (serverResponse && serverResponse.status !== 404) {
    const payload = (await serverResponse.json().catch(() => ({}))) as {
      text?: string
      modelUsed?: string
      error?: string
    }
    if (!serverResponse.ok) {
      throw new Error(payload.error ?? `Server returned HTTP ${serverResponse.status}`)
    }
    if (!payload.text) {
      throw new Error('Claude returned an empty response.')
    }
    return buildLaneMapCsvFromResponse(candidates, payload.text, payload.modelUsed ?? FALLBACK_MODEL)
  }

  // Fallback for static builds: call Anthropic directly from the browser using user-supplied API key.
  const trimmedKey = apiKey?.trim() ?? ''
  if (!trimmedKey) {
    throw new Error('Please enter your Anthropic (Claude) API key to match swimlanes.')
  }
  const direct = await callAnthropicDirectFromBrowser(userMessage, trimmedKey)
  return buildLaneMapCsvFromResponse(candidates, direct.text, direct.modelUsed)
}

/**
 * Applies a lane_map.csv directly onto an already-processed built-in dataset (when no raw gaze CSV
 * has been uploaded yet), updating object lanes, objectVisits, and merged lane-level visits immediately.
 */
export function applyLaneMapToBuiltInDataset(
  dataset: Dataset,
  laneMapCsv: string,
): { dataset: Dataset; unmappedObjects: string[] } {
  const lines = laneMapCsv.replace(/^\uFEFF/, '').split(/\r?\n/)
  const first = lines[0] ?? ''
  const delimiter = first.includes('\t') ? '\t' : ','
  const header = parseLine(first, delimiter).map((h) => h.trim())
  const objAt = header.indexOf('object_id')
  const laneAt = header.indexOf('lane')
  const incAt = header.indexOf('include')
  const confAt = header.indexOf('confidence')
  if (objAt === -1 || laneAt === -1) {
    throw new Error('Lane map CSV must include object_id and lane columns.')
  }

  const parsedMap = new Map<string, { lane: string; include: boolean; verify: boolean }>()
  for (const rawLine of lines.slice(1)) {
    if (!rawLine.trim()) continue
    const row = parseLine(rawLine, delimiter)
    const objId = (row[objAt] ?? '').trim()
    if (!objId) continue
    const lane = (row[laneAt] ?? '').trim() || 'Unmapped'
    const include = incAt !== -1 ? (row[incAt] ?? '').trim() === 'True' : INCLUDED_LANE_IDS.has(lane)
    const verify = confAt !== -1 ? (row[confAt] ?? '').trim() === 'verify' : false
    parsedMap.set(objId, { lane, include, verify })
  }

  const distinctObjects = Object.keys(dataset.meta.objects)
  const unmappedObjects = distinctObjects.filter((name) => !parsedMap.has(name)).sort()
  const nextObjects: Meta['objects'] = {}
  for (const name of distinctObjects) {
    const mapped = parsedMap.get(name)
    if (mapped) nextObjects[name] = { lane: mapped.lane, verify: mapped.verify }
    else nextObjects[name] = { lane: 'Unmapped', verify: true }
  }

  const mergeGapS = dataset.meta.params.MERGE_GAP_S ?? 1
  const minExportS = dataset.meta.params.EXPORT_MIN_VISIT_S ?? 0.1
  const round3 = (n: number) => Math.round(n * 1000) / 1000

  const nextObjectVisits: ObjectVisit[] = dataset.objectVisits
    .filter((ov) => parsedMap.get(ov.objectId)?.include ?? false)
    .map((ov) => ({
      ...ov,
      lane: parsedMap.get(ov.objectId)!.lane,
    }))

  // Sort by session and start time, then merge adjacent visits in the same lane.
  const sortedOv = [...nextObjectVisits].sort(
    (a, b) => a.sessionId.localeCompare(b.sessionId) || a.start - b.start,
  )
  const nextVisits: Visit[] = []
  for (const ov of sortedOv) {
    const prev = nextVisits[nextVisits.length - 1]
    if (
      prev &&
      prev.sessionId === ov.sessionId &&
      prev.lane === ov.lane &&
      ov.start - prev.end <= mergeGapS
    ) {
      prev.start = round3(Math.min(prev.start, ov.start))
      prev.end = round3(Math.max(prev.end, ov.end))
      prev.dwell = round3(prev.dwell + ov.dwell)
      prev.objects[ov.objectId] = round3((prev.objects[ov.objectId] ?? 0) + ov.dwell)
    } else {
      nextVisits.push({
        sessionId: ov.sessionId,
        userId: ov.userId,
        runId: ov.runId,
        lane: ov.lane,
        start: ov.start,
        end: ov.end,
        dwell: ov.dwell,
        objects: { [ov.objectId]: ov.dwell },
      })
    }
  }

  const filteredVisits = nextVisits.filter((v) => v.dwell >= minExportS)
  const baseLanes = dataset.meta.lanes.filter((l) => l.id !== 'Unmapped')
  if (unmappedObjects.length > 0) {
    baseLanes.push({
      id: 'Unmapped',
      label: 'Unmapped',
      order: baseLanes.length,
      include: false,
      color: '#9AA0A6',
      band: '#F1F3F4',
    })
  }

  return {
    dataset: {
      ...dataset,
      meta: {
        ...dataset.meta,
        generatedAt: new Date().toISOString(),
        objects: nextObjects,
        lanes: baseLanes,
      },
      visits: filteredVisits,
      objectVisits: nextObjectVisits,
    },
    unmappedObjects,
  }
}
