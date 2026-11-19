import type { Track } from './catalog'

export type DownloadedTrack = { id: string; track: Track; bytes: number; savedAt: number; blob: Blob }
const DB = 'jw-ascolta-offline'
const STORE = 'media'
const RESPONSE_CACHE = 'jw-ascolta-content-v1'
export const LIBRARY_CHANGED = 'jw-ascolta:library-changed'
export const PROGRESS_CHANGED = 'jw-ascolta:progress-changed'

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Archivio del dispositivo non disponibile.'))
  })
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = operation(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(new Error('Salvataggio non riuscito. Controlla lo spazio libero.'))
    })
  } finally { db.close() }
}

export async function listDownloads(): Promise<DownloadedTrack[]> {
  return transaction('readonly', store => store.getAll())
}
export async function offlineAudio(id: string): Promise<Blob | undefined> {
  const record = await transaction<DownloadedTrack | undefined>('readonly', store => store.get(id))
  return record?.blob
}
export async function removeDownload(id: string) {
  await transaction('readwrite', store => store.delete(id))
  window.dispatchEvent(new Event(LIBRARY_CHANGED))
}
export async function saveDownload(track: Track, signal?: AbortSignal) {
  const response = await fetch('/api/download?' + new URLSearchParams({ url: track.url }), { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(120000)]) })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Download non disponibile. Riprova con una connessione stabile.')
  }
  const contentType = response.headers.get('Content-Type') || ''
  if (!/audio|video|octet-stream/i.test(contentType)) throw new Error('Il collegamento non contiene un file audio o video.')
  const max = 150 * 1024 * 1024
  if (Number(response.headers.get('Content-Length')) > max) throw new Error('Questo file supera 150 MB.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Download non supportato dal browser.')
  const parts: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > max) throw new Error('Questo file supera 150 MB.')
      parts.push(new Uint8Array(chunk.value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  if (!bytes) throw new Error('Il file ricevuto è vuoto.')
  if (signal?.aborted) throw signal.reason || new DOMException('Annullato', 'AbortError')
  const blob = new Blob(parts, { type: contentType })
  await transaction('readwrite', store => store.put({ id: track.id, track, bytes, savedAt: Date.now(), blob }))
  window.dispatchEvent(new Event(LIBRARY_CHANGED))
  void navigator.storage?.persist?.().catch(() => {})
}

export async function localResponse(url: string, signal?: AbortSignal): Promise<Response> {
  const cache = await caches.open(RESPONSE_CACHE).catch(() => null)
  if (signal?.aborted) throw signal.reason || new DOMException('Annullato', 'AbortError')
  if (!navigator.onLine) {
    const saved = await cache?.match(url)
    if (saved) return saved
    throw new Error('Questo contenuto non è ancora salvato sul dispositivo. Aprilo una volta con Internet.')
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(35000)]) })
    if (!response.ok) throw new Error('Contenuto non disponibile. Riprova tra poco.')
    if (cache) await cache.put(url, response.clone()).catch(() => {})
    return response
  } catch (error) {
    if (signal?.aborted) throw error
    const saved = await cache?.match(url)
    if (saved) return saved
    throw error instanceof Error && error.name === 'TimeoutError'
      ? new Error('La risposta sta impiegando troppo tempo. Riprova.') : error
  }
}

export type ListeningState = 'new' | 'started' | 'completed'
export type ListeningRecord = { state: ListeningState; position: number; updatedAt: number }
const PROGRESS_KEY = 'jw-ascolta:progress'
export function listeningProgress(): Record<string, ListeningRecord> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') } catch { return {} }
}
export function recordProgress(id: string, position: number, completed = false) {
  const all = listeningProgress()
  const previous = all[id]
  if (!completed && previous?.state === 'completed') return
  if (!completed && previous && Math.abs(previous.position - position) < 5) return
  all[id] = { state: completed ? 'completed' : 'started', position, updatedAt: Date.now() }
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)) } catch { return }
  window.dispatchEvent(new Event(PROGRESS_CHANGED))
}

const BACKUP_KEYS = [
  'jw-ascolta:favorites', 'jw-ascolta:later', 'jw-ascolta:collections', 'jw-ascolta:recent',
  'jw-ascolta:narration-progress', 'jw-ascolta:video-clips', 'jw-ascolta:progress', 'jw-narrator',
]
export function exportBackup() {
  const values = Object.fromEntries(BACKUP_KEYS.map(key => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null))
  const blob = new Blob([JSON.stringify({ app: 'jw-ascolta', version: 1, savedAt: new Date().toISOString(), values }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'jw-ascolta-backup.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function restoreBackup(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Il backup supera 5 MB.')
  const data = JSON.parse(await file.text())
  if (data.app !== 'jw-ascolta' || data.version !== 1 || !data.values || typeof data.values !== 'object') throw new Error('Backup JW Ascolta non valido.')
  const entries = Object.entries(data.values) as [string, string][]
  for (const [key, value] of entries) {
    if (!BACKUP_KEYS.includes(key) || typeof value !== 'string') throw new Error('Il backup contiene dati non riconosciuti.')
    if (key !== 'jw-narrator') {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object') throw new Error('Il backup contiene dati non validi.')
      if (['jw-ascolta:favorites', 'jw-ascolta:later', 'jw-ascolta:recent', 'jw-ascolta:collections'].includes(key) && !Array.isArray(parsed)) throw new Error('Elenco non valido nel backup.')
      if (['jw-ascolta:favorites', 'jw-ascolta:later'].includes(key) && !parsed.every(validTrack)) throw new Error('Brano non valido nel backup.')
      if (key === 'jw-ascolta:recent' && !parsed.every((item: { id: string; title: string; kind: string; track?: Track; source?: string }) => item && typeof item.id === 'string' && typeof item.title === 'string' && ['music', 'article', 'video'].includes(item.kind) && (!item.track || validTrack(item.track)) && (!item.source || safeSource(item.source)))) throw new Error('Cronologia non valida nel backup.')
      if (['jw-ascolta:narration-progress', 'jw-ascolta:video-clips'].includes(key) && (Array.isArray(parsed) || !Object.values(parsed).every((value) => {
        const item = value as { title?: string; source?: string; articleId?: string; sentenceIndex?: number; trackId?: string; url?: string; subtitleUrl?: string; startCueIndex?: number }
        if (!item || typeof item.title !== 'string') return false
        if (key === 'jw-ascolta:narration-progress') return typeof item.articleId === 'string' && typeof item.source === 'string' && safeSource(item.source) && Number.isInteger(item.sentenceIndex) && item.sentenceIndex! >= 0
        return typeof item.trackId === 'string' && typeof item.url === 'string' && validTrack({ id: item.trackId, title: item.title, url: item.url } as Track) && typeof item.subtitleUrl === 'string' && Number.isInteger(item.startCueIndex)
      }))) throw new Error('Segnalibro non valido nel backup.')
      if (key === 'jw-ascolta:progress' && (Array.isArray(parsed) || !Object.values(parsed).every(value => {
        const item = value as ListeningRecord
        return item && ['started', 'completed', 'new'].includes(item.state) && Number.isFinite(item.position) && item.position >= 0
      }))) throw new Error('Stato ascolto non valido.')
      if (key === 'jw-ascolta:collections' && !parsed.every((item: { id: string; name: string; tracks: Track[] }) => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.tracks) && item.tracks.every(validTrack))) throw new Error('Raccolta non valida nel backup.')
    }
  }
  const before = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]))
  try { for (const [key, value] of entries) localStorage.setItem(key, value) } catch {
    for (const [key, value] of before) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    throw new Error('Spazio insufficiente per ripristinare il backup.')
  }
}
function validTrack(item: Track) {
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.url !== 'string') return false
  try { return new URL(item.url).protocol === 'https:' } catch { return false }
}

export async function savedArticles(): Promise<Array<{ id: string; title: string; source: string }>> {
  const cache = await caches.open(RESPONSE_CACHE)
  const entries = await cache.keys()
  const articles = new Map<string, { id: string; title: string; source: string }>()
  for (const entry of entries) {
    if (new URL(entry.url).pathname.startsWith('/__saved-article/')) {
      const response = await cache.match(entry)
      const data = await response?.json().catch(() => null)
      if (data?.source) articles.set(data.source, data)
      continue
    }
    if (!new URL(entry.url).pathname.endsWith('/api/article-text')) continue
    const response = await cache.match(entry)
    const data = await response?.json().catch(() => null)
    if (data?.text && data?.source && !articles.has(data.source)) articles.set(data.source, { id: data.source, title: data.title || 'Articolo', source: data.source })
  }
  return [...articles.values()]
}

function safeSource(source: string) {
  try { const url = new URL(source); return url.protocol === 'https:' && ['jw.org', 'www.jw.org'].includes(url.hostname) } catch { return false }
}

export type SavedArticle = { id: string; title: string; source: string; audioUrl?: string; audioDuration?: number; markers?: Array<{ pid: number; start: number; end: number }> }
export async function rememberArticle(article: SavedArticle) {
  const cache = await caches.open(RESPONSE_CACHE)
  await cache.put('/__saved-article/' + encodeURIComponent(article.source), new Response(JSON.stringify(article)))
}
