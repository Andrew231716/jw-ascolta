export const config = { runtime: 'edge' }

import {
  buildOrderedTracks,
  loadTracks,
  resolveSectionSlugs,
  toHls,
  toM3u,
} from './lib/tracks'

/**
 * Playlist for Siri / CarPlay.
 * - format=hls (default with carplay=1) → audio-only HLS, queue continua
 * - format=m3u → classic M3U
 * Params: s / section, mode, title, limit
 */
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const title =
    url.searchParams.get('title') ||
    url.searchParams.get('t') ||
    url.searchParams.get('brano') ||
    ''
  const mode = (
    url.searchParams.get('mode') ||
    url.searchParams.get('ordine') ||
    'shuffle'
  ).toLowerCase()
  const sectionsRaw =
    url.searchParams.get('s') ||
    url.searchParams.get('section') ||
    url.searchParams.get('sezioni') ||
    'tutto'
  const wantHls =
    url.searchParams.get('format') === 'hls' ||
    url.searchParams.get('hls') === '1' ||
    url.searchParams.get('carplay') === '1' ||
    url.pathname.endsWith('.m3u8') ||
    (url.searchParams.get('format') || '') === ''
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get('limit') || 80) || 80),
  )

  try {
    const slugs = resolveSectionSlugs(sectionsRaw)
    const tracks = await loadTracks(slugs)
    const ordered = buildOrderedTracks(tracks, mode, title)
    if (!ordered) {
      return new Response('brano non trovato', { status: 404 })
    }
    const slice = ordered.slice(0, limit)
    const body = wantHls ? toHls(slice) : toM3u(slice)

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': wantHls
          ? 'application/vnd.apple.mpegurl; charset=utf-8'
          : 'audio/x-mpegurl; charset=utf-8',
        'Content-Disposition': wantHls
          ? 'inline; filename="jw-ascolta.m3u8"'
          : 'inline; filename="jw-ascolta.m3u"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
    })
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : 'playlist_failed',
      { status: 500 },
    )
  }
}
