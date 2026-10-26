export const config = { runtime: 'edge' }

import { findBestTrack, loadTracks } from './lib/tracks'

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const title = url.searchParams.get('title') || url.searchParams.get('t') || ''
  if (!title.trim()) {
    return Response.json({ error: 'missing title' }, { status: 400 })
  }

  try {
    const tracks = await loadTracks()
    const match = findBestTrack(tracks, title)
    if (!match) {
      return Response.json(
        { error: 'not_found', query: title },
        { status: 404 },
      )
    }

    const page = new URL(url.origin)
    page.searchParams.set('s', 'tutto')
    page.searchParams.set('mode', 'shuffle')
    page.searchParams.set('play', '1')
    page.searchParams.set('title', match.track.title)
    page.searchParams.set('siri', '1')
    page.searchParams.set('carplay', '1')

    return Response.json({
      title: match.track.title,
      audioUrl: match.track.url,
      duration: match.track.duration,
      image: match.track.image,
      section: match.track.section,
      pageUrl: page.toString(),
      score: match.score,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'resolve_failed' },
      { status: 500 },
    )
  }
}
