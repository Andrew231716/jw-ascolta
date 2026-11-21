import type { Track } from './catalog'
import { trackPrimaryTitle } from './catalog'

export type FavoriteKind = 'music' | 'article' | 'video'

export type FavoriteItem = {
  id: string
  title: string
  kind: FavoriteKind
  track?: Track
  source?: string
  clipStart?: number
  clipEnd?: number
  subtitleUrl?: string
  addedAt: number
}

export const FAVORITES_CHANGED = 'jw-ascolta:favorites-changed'
const KEY = 'jw-ascolta:favorites'

function isTrackLike(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false
  const track = value as Track
  return (
    typeof track.id === 'string' &&
    typeof track.title === 'string' &&
    typeof track.url === 'string'
  )
}

export function detectFavoriteKind(track: Track): FavoriteKind {
  if (
    track.contentKind === 'video' ||
    track.id.startsWith('video-') ||
    Boolean(track.subtitleUrl)
  ) {
    return 'video'
  }
  if (
    track.contentKind === 'article' ||
    track.id.startsWith('article-') ||
    (track.source && !track.naturalKey)
  ) {
    return 'article'
  }
  return 'music'
}

export function favoriteIdFor(input: {
  kind?: FavoriteKind
  track?: Track
  source?: string
  title?: string
  clipStart?: number
  clipEnd?: number
}): string {
  const track = input.track
  const kind = input.kind || (track ? detectFavoriteKind(track) : 'music')
  if (kind === 'article') {
    const source = input.source || track?.source
    if (source) return `article:${source}`
    if (track?.id) return `article:${track.id}`
  }
  if (kind === 'video') {
    const base = track?.id || input.title || 'video'
    const start = input.clipStart ?? track?.clipStart
    const end = input.clipEnd ?? track?.clipEnd
    return `video:${base}:${start ?? ''}:${end ?? ''}`
  }
  if (track?.naturalKey) {
    return `music:${track.naturalKey}:${track.lang || ''}`
  }
  if (track?.id) return `music:${track.id}`
  return `${kind}:${input.title || 'item'}`
}

export function favoriteFromTrack(
  track: Track,
  overrides: Partial<FavoriteItem> = {},
): FavoriteItem {
  const kind = overrides.kind || detectFavoriteKind(track)
  const title = overrides.title || trackPrimaryTitle(track)
  const source = overrides.source || track.source
  const clipStart = overrides.clipStart ?? track.clipStart
  const clipEnd = overrides.clipEnd ?? track.clipEnd
  const subtitleUrl = overrides.subtitleUrl || track.subtitleUrl
  return {
    id: favoriteIdFor({ kind, track, source, title, clipStart, clipEnd }),
    title,
    kind,
    track: {
      ...track,
      contentKind: track.contentKind || kind,
      source: source || track.source,
      clipStart,
      clipEnd,
      subtitleUrl: subtitleUrl || track.subtitleUrl,
    },
    source,
    clipStart,
    clipEnd,
    subtitleUrl,
    addedAt: Date.now(),
  }
}

function normalizeFavorite(raw: unknown): FavoriteItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<FavoriteItem> & Track
  // Legacy: plain Track[]
  if (isTrackLike(item) && !('kind' in item && item.kind)) {
    return favoriteFromTrack(item)
  }
  if (
    typeof item.id !== 'string' ||
    typeof item.title !== 'string' ||
    !['music', 'article', 'video'].includes(String(item.kind))
  ) {
    return null
  }
  const track = item.track && isTrackLike(item.track) ? item.track : undefined
  if (!track && !item.source && item.kind !== 'article') return null
  return {
    id: item.id,
    title: item.title,
    kind: item.kind as FavoriteKind,
    track,
    source: typeof item.source === 'string' ? item.source : track?.source,
    clipStart: Number.isFinite(item.clipStart) ? Number(item.clipStart) : track?.clipStart,
    clipEnd: Number.isFinite(item.clipEnd) ? Number(item.clipEnd) : track?.clipEnd,
    subtitleUrl:
      typeof item.subtitleUrl === 'string' ? item.subtitleUrl : track?.subtitleUrl,
    addedAt: Number(item.addedAt) || Date.now(),
  }
}

function readRaw(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items = parsed
      .map(normalizeFavorite)
      .filter((item): item is FavoriteItem => Boolean(item))
    // Deduplicate by id, keep newest
    const byId = new Map<string, FavoriteItem>()
    for (const item of items) {
      const prev = byId.get(item.id)
      if (!prev || (item.addedAt || 0) >= (prev.addedAt || 0)) byId.set(item.id, item)
    }
    return [...byId.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  } catch {
    return []
  }
}

function writeAll(items: FavoriteItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(FAVORITES_CHANGED))
}

export function listFavorites(): FavoriteItem[] {
  return readRaw()
}

export function isFavoriteId(id: string): boolean {
  return readRaw().some((item) => item.id === id)
}

export function isFavoriteTrack(track: Track): boolean {
  return isFavoriteId(favoriteIdFor({ track }))
}

export function toggleFavoriteItem(
  input: FavoriteItem | Track,
): { favorited: boolean; items: FavoriteItem[] } {
  const nextItem =
    'kind' in input && 'addedAt' in input
      ? { ...(input as FavoriteItem), addedAt: Date.now() }
      : favoriteFromTrack(input as Track)
  const current = readRaw()
  const exists = current.some((item) => item.id === nextItem.id)
  const items = exists
    ? current.filter((item) => item.id !== nextItem.id)
    : [nextItem, ...current]
  writeAll(items)
  return { favorited: !exists, items }
}

export function removeFavorite(id: string): FavoriteItem[] {
  const items = readRaw().filter((item) => item.id !== id)
  writeAll(items)
  return items
}

export function favoriteKindLabel(kind: FavoriteKind) {
  if (kind === 'video') return 'Video'
  if (kind === 'article') return 'Articolo'
  return 'Musica'
}
