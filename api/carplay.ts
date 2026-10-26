export const config = { runtime: 'edge' }

import {
  buildOrderedTracks,
  loadTracks,
  resolveSectionSlugs,
  toHls,
} from './lib/tracks'

/**
 * Endpoint CarPlay: HLS audio-only.
 * Tutti i comandi Siri usano «Apri URL» qui → coda continua in Now Playing.
 * Params: s / section, mode, title / t / brano, limit
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

    return new Response(toHls(ordered.slice(0, limit)), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Content-Disposition': 'inline; filename="jw-ascolta-carplay.m3u8"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
    })
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : 'carplay_failed',
      { status: 500 },
    )
  }
}
