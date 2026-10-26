export const config = { runtime: 'edge' }

import { findBestTrack, loadTracks, shuffle } from './lib/tracks'

/**
 * Returns an M3U playlist starting from a title (or shuffled all).
 * Can be opened by some players / Shortcuts for continuous play toward CarPlay.
 */
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const title = url.searchParams.get('title') || ''
  const mode = (url.searchParams.get('mode') || 'shuffle').toLowerCase()
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get('limit') || 80) || 80),
  )

  try {
    let tracks = await loadTracks()
    if (mode === 'shuffle') tracks = shuffle(tracks)

    if (title.trim()) {
      const match = findBestTrack(tracks, title)
      if (!match) {
        return new Response('brano non trovato', { status: 404 })
      }
      const rest = tracks.filter((t) => t.url !== match.track.url)
      tracks = [match.track, ...rest]
    }

    tracks = tracks.slice(0, limit)

    const lines = ['#EXTM3U']
    for (const track of tracks) {
      const seconds = Math.max(1, Math.round(track.duration || 1))
      lines.push(`#EXTINF:${seconds},${track.title.replace(/,/g, ' ')}`)
      lines.push(track.url)
    }

    return new Response(`${lines.join('\n')}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'audio/x-mpegurl; charset=utf-8',
        'Content-Disposition': 'inline; filename="jw-ascolta.m3u"',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : 'playlist_failed',
      { status: 500 },
    )
  }
}
