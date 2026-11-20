import {
  trackPrimaryTitle,
  type Track,
} from './catalog'

export type ShareKind = 'music' | 'article' | 'video'

export function detectShareKind(track: Track): ShareKind {
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

export function sanitizeAudioFilename(title: string, ext = 'mp3') {
  const base = (title || 'audio')
    .normalize('NFKD')
    .replace(/[^\w\s\-àèéìòùÀÈÉÌÒÙ.]+/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return `${base || 'audio'}.${ext}`
}

export function extensionForMime(type: string) {
  if (/mpeg|mp3/i.test(type)) return 'mp3'
  if (/mp4|m4a|aac/i.test(type)) return 'm4a'
  if (/wav/i.test(type)) return 'wav'
  if (/ogg/i.test(type)) return 'ogg'
  return 'mp3'
}

export function buildTrackShareUrl(track: Track): string {
  const url = new URL(window.location.href)
  url.search = ''
  const kind = detectShareKind(track)
  const title = trackPrimaryTitle(track)

  if (kind === 'article' && track.source) {
    url.searchParams.set('view', 'library')
    url.searchParams.set(
      'article',
      track.id.replace(/^article-/, '').replace(/^article:/, ''),
    )
    url.searchParams.set('articleUrl', track.source)
    url.searchParams.set('articleTitle', title)
    return url.toString()
  }

  if (kind === 'video') {
    url.searchParams.set('view', 'library')
    url.searchParams.set('listening', 'videos')
    url.searchParams.set('videoTitle', title)
    if (track.source) url.searchParams.set('videoSource', track.source)
    if (track.url) url.searchParams.set('videoAudio', track.url)
    if (track.subtitleUrl) url.searchParams.set('subtitleUrl', track.subtitleUrl)
    if (track.sectionSlug) url.searchParams.set('videoSection', track.sectionSlug)
    if (track.sectionName) url.searchParams.set('videoSectionName', track.sectionName)
    if (track.clipStart != null) url.searchParams.set('vs', String(Math.floor(track.clipStart)))
    if (track.clipEnd != null) url.searchParams.set('ve', String(Math.ceil(track.clipEnd)))
    url.searchParams.set('play', '1')
    return url.toString()
  }

  url.searchParams.set(
    's',
    !track.sectionSlug || track.sectionSlug === 'tutto'
      ? 'tutto'
      : track.sectionSlug,
  )
  url.searchParams.set('mode', 'order')
  url.searchParams.set('play', '1')
  url.searchParams.set('title', title)
  if (track.lang) url.searchParams.set('lang', track.lang)
  return url.toString()
}

export async function shareLink(track: Track): Promise<'shared' | 'copied'> {
  const link = buildTrackShareUrl(track)
  const title = trackPrimaryTitle(track)
  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url: link })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }
  await navigator.clipboard.writeText(link)
  return 'copied'
}

export async function fetchAudioBlob(
  mediaUrl: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  if (!mediaUrl) throw new Error('Nessun audio da scaricare.')
  if (mediaUrl.startsWith('blob:')) {
    const res = await fetch(mediaUrl, { signal })
    if (!res.ok) throw new Error('Audio locale non disponibile.')
    const blob = await res.blob()
    return { blob, mime: blob.type || 'audio/mpeg' }
  }
  const response = await fetch(
    '/api/download?' + new URLSearchParams({ url: mediaUrl }),
    {
      signal: AbortSignal.any([
        signal || new AbortController().signal,
        AbortSignal.timeout(120000),
      ]),
    },
  )
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(
      (data as { error?: string }).error ||
        'Download non disponibile. Riprova con una connessione stabile.',
    )
  }
  const mime = response.headers.get('Content-Type') || 'audio/mpeg'
  const blob = await response.blob()
  if (!blob.size) throw new Error('Il file ricevuto è vuoto.')
  return { blob, mime }
}

export async function shareOrDownloadMp3(
  track: Track,
  signal?: AbortSignal,
): Promise<'shared' | 'downloaded'> {
  if (!track.url) throw new Error('Nessun file audio per questo contenuto.')
  const { blob, mime } = await fetchAudioBlob(track.url, signal)
  const ext = extensionForMime(mime)
  const filename = sanitizeAudioFilename(trackPrimaryTitle(track), ext)
  const file = new File([blob], filename, { type: mime || 'audio/mpeg' })

  const payload = {
    files: [file],
    title: trackPrimaryTitle(track),
    text: trackPrimaryTitle(track),
  }
  if (navigator.canShare?.(payload)) {
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
  return 'downloaded'
}
