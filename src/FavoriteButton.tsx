import { useEffect, useState } from 'react'
import type { Track } from './catalog'
import {
  FAVORITES_CHANGED,
  favoriteFromTrack,
  favoriteIdFor,
  isFavoriteId,
  toggleFavoriteItem,
  type FavoriteKind,
} from './favoritesStore'

export function FavoriteButton({
  track,
  title,
  kind,
  source,
  clipStart,
  clipEnd,
  subtitleUrl,
  compact = false,
}: {
  track?: Track
  title?: string
  kind?: FavoriteKind
  source?: string
  clipStart?: number
  clipEnd?: number
  subtitleUrl?: string
  compact?: boolean
}) {
  const id = favoriteIdFor({
    track,
    title: title || track?.title,
    kind: kind || (track ? undefined : 'article'),
    source: source || track?.source,
    clipStart: clipStart ?? track?.clipStart,
    clipEnd: clipEnd ?? track?.clipEnd,
  })
  const [saved, setSaved] = useState(() => isFavoriteId(id))

  useEffect(() => {
    const refresh = () => setSaved(isFavoriteId(id))
    refresh()
    window.addEventListener(FAVORITES_CHANGED, refresh)
    return () => window.removeEventListener(FAVORITES_CHANGED, refresh)
  }, [id])

  function onToggle() {
    if (track) {
      const result = toggleFavoriteItem(
        favoriteFromTrack(track, {
          title,
          kind,
          source,
          clipStart,
          clipEnd,
          subtitleUrl,
        }),
      )
      setSaved(result.favorited)
      return
    }
    if (!title && !source) return
    const result = toggleFavoriteItem({
      id,
      title: title || 'Preferito',
      kind: kind || 'article',
      source,
      clipStart,
      clipEnd,
      subtitleUrl,
      addedAt: Date.now(),
    })
    setSaved(result.favorited)
  }

  return (
    <button
      type="button"
      className={compact ? 'btn ghost small favorite-btn' : 'btn ghost small'}
      aria-pressed={saved}
      aria-label={saved ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
      onClick={onToggle}
    >
      {saved ? '★ Nei preferiti' : '☆ Preferiti'}
    </button>
  )
}
