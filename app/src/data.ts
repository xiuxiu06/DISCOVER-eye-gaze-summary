import type {
  Dataset,
  FunnelStep,
  IdleInterval,
  Meta,
  ObjectVisit,
  RawRow,
  Run,
  Session,
  Visit,
} from './types'

type Folder = 'data' | 'data-mock'

async function fetchJson<T>(folder: Folder, name: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${folder}/${name}.json`)
  if (!response.ok) throw new Error(`${folder}/${name}.json: HTTP ${response.status}`)
  try {
    return (await response.json()) as T
  } catch {
    // The dev server answers missing files with index.html, so this also means "missing".
    throw new Error(`${folder}/${name}.json is missing or isn't valid JSON`)
  }
}

async function loadFolder(folder: Folder, meta: Meta): Promise<Dataset> {
  const [funnel, sessions, runs, visits, objectVisits, idle, rawSample] = await Promise.all([
    fetchJson<FunnelStep[]>(folder, 'funnel'),
    fetchJson<Session[]>(folder, 'sessions'),
    fetchJson<Run[]>(folder, 'runs'),
    fetchJson<Visit[]>(folder, 'visits'),
    fetchJson<ObjectVisit[]>(folder, 'object_visits'),
    fetchJson<IdleInterval[]>(folder, 'idle'),
    fetchJson<RawRow[]>(folder, 'raw_sample'),
  ])
  return {
    origin: folder === 'data' ? 'real' : 'mock',
    meta,
    funnel,
    sessions,
    runs,
    visits,
    objectVisits,
    idle,
    rawSample,
  }
}

/**
 * Loads pipeline output from data/, or mock data if the pipeline hasn't run.
 * Only a missing meta.json triggers the fallback. If real data is present but
 * incomplete this throws, so real and mock data are never mixed or swapped silently.
 */
export async function loadDataset(): Promise<Dataset> {
  let realMeta: Meta | undefined
  try {
    realMeta = await fetchJson<Meta>('data', 'meta')
  } catch {
    realMeta = undefined
  }
  if (realMeta) return loadFolder('data', realMeta)
  return loadFolder('data-mock', await fetchJson<Meta>('data-mock', 'meta'))
}
