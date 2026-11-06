import type { Matching } from './api'
import type { ClaudeReport } from './reportTypes'

export interface SavedUpload {
  gaze: { name: string; size: number; text: string }
  laneMap?: { name: string; size: number; text: string }
  ideal?: { name: string; size: number; text: string }
  matching?: Matching
  reportCache?: { key: string; report: ClaudeReport }
  pendingJob?: { key: string; jobId: string }
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('discover-uploads', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readUpload(): Promise<SavedUpload | undefined> {
  const db = await openStore()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').get('current')
      request.onsuccess = () => resolve(request.result as SavedUpload | undefined)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveUpload(upload?: SavedUpload): Promise<void> {
  const db = await openStore()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite')
      const store = transaction.objectStore('files')
      if (upload) store.put(upload, 'current')
      else store.delete('current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
