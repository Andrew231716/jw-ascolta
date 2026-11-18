import type { Track } from './catalog'

export type RecentItem = {
  id: string
  title: string
  kind: 'music' | 'article' | 'video'
  track?: Track
  source?: string
  clipStart?: number
  clipEnd?: number
  query?: string
  updatedAt: number
}

export type VideoClipBookmark = {
  trackId: string
  title: string
  url: string
  source?: string
  subtitleUrl: string
  duration: number
  sectionSlug: string
  sectionName: string
  clipStart: number
  clipEnd: number
  startCueIndex: number
  endCueIndex: number | null
  query?: string
  snippet: string
  updatedAt: number
}

const RECENT_KEY = 'jw-ascolta:recent'
const VIDEO_BOOKMARK_KEY = 'jw-ascolta:video-clips'
const RECENT_LIMIT = 40

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota */
  }
}

export function listRecent(): RecentItem[] {
  const items = readJson<RecentItem[]>(RECENT_KEY, [])
  return Array.isArray(items)
    ? items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_LIMIT)
    : []
}

export function pushRecent(item: Omit<RecentItem, 'updatedAt'> & { updatedAt?: number }) {
  const next: RecentItem = { ...item, updatedAt: item.updatedAt ?? Date.now() }
  const previous = listRecent().filter((entry) => entry.id !== next.id)
  writeJson(RECENT_KEY, [next, ...previous].slice(0, RECENT_LIMIT))
}

export function listVideoBookmarks(): VideoClipBookmark[] {
  const all = readJson<Record<string, VideoClipBookmark>>(VIDEO_BOOKMARK_KEY, {})
  return Object.values(all || {}).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadVideoBookmark(trackId: string): VideoClipBookmark | null {
  const all = readJson<Record<string, VideoClipBookmark>>(VIDEO_BOOKMARK_KEY, {})
  return all[trackId] ?? null
}

export function saveVideoBookmark(bookmark: VideoClipBookmark) {
  const all = readJson<Record<string, VideoClipBookmark>>(VIDEO_BOOKMARK_KEY, {})
  all[bookmark.trackId] = bookmark
  writeJson(VIDEO_BOOKMARK_KEY, all)
}

export function clearVideoBookmark(trackId: string) {
  const all = readJson<Record<string, VideoClipBookmark>>(VIDEO_BOOKMARK_KEY, {})
  delete all[trackId]
  writeJson(VIDEO_BOOKMARK_KEY, all)
}

/** True when this origin has no Vercel /api backend (e.g. GitHub Pages). */
export function isStaticMirrorHost(hostname = window.location.hostname) {
  return (
    hostname.endsWith('github.io') ||
    hostname.endsWith('githubusercontent.com')
  )
}
