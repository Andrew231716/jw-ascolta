const SECTIONS = [
  'AudioOriginalSongs',
  'AudioInternationalMusic',
  'SJJMeetings',
  'SJJChorus',
  'SJJInstrumental',
  'Vocal',
  'AudioChildrenSongs',
  'KingdomMelodies',
  'GNJST1Soundtrack',
  'GNJST2Soundtrack',
  'GNJST3Soundtrack',
] as const

const LANG = 'I'
const API = 'https://b.jw-cdn.org/apis/mediator/v1'

type TrackHit = {
  title: string
  url: string
  duration: number
  image?: string
  section: string
}

function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[“”"'«»]/g, '')
    .replace(/^\d+[.\-) ]\s*/g, '')
    .replace(/[_+/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreTitle(title: string, query: string): number {
  if (!title || !query) return 0
  if (title === query) return 100
  if (title.startsWith(query) || query.startsWith(title)) return 80
  if (title.includes(query) || query.includes(title)) return 60
  const qTokens = query.split(' ').filter((t) => t.length > 2)
  const tTokens = new Set(title.split(' ').filter((t) => t.length > 2))
  if (!qTokens.length) return 0
  const hits = qTokens.filter((t) => tTokens.has(t)).length
  return (hits / qTokens.length) * 50
}

async function loadTracks(): Promise<TrackHit[]> {
  const batches = await Promise.all(
    SECTIONS.map(async (key) => {
      const res = await fetch(
        `${API}/categories/${LANG}/${key}?detailed=1&clientType=www`,
      )
      if (!res.ok) return [] as TrackHit[]
      const data = (await res.json()) as {
        category?: {
          name?: string
          media?: Array<{
            title?: string
            duration?: number
            type?: string
            files?: Array<{
              progressiveDownloadURL?: string
              duration?: number
              mimetype?: string
            }>
            images?: { sqr?: { lg?: string }; wss?: { lg?: string } }
          }>
        }
      }
      const section = data.category?.name || key
      const out: TrackHit[] = []
      for (const item of data.category?.media || []) {
        if (item.type && item.type !== 'audio') continue
        const file =
          item.files?.find((f) => (f.mimetype || '').startsWith('audio/')) ||
          item.files?.[0]
        if (!file?.progressiveDownloadURL || !item.title) continue
        out.push({
          title: item.title,
          url: file.progressiveDownloadURL,
          duration: item.duration || file.duration || 0,
          image: item.images?.sqr?.lg || item.images?.wss?.lg,
          section,
        })
      }
      return out
    }),
  )
  return batches.flat()
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const title = url.searchParams.get('title') || url.searchParams.get('t') || ''
  const query = normalizeTitle(title)
  if (!query) {
    return Response.json({ error: 'missing title' }, { status: 400 })
  }

  try {
    const tracks = await loadTracks()
    let best: TrackHit | null = null
    let bestScore = 0
    for (const track of tracks) {
      const score = scoreTitle(normalizeTitle(track.title), query)
      if (score > bestScore) {
        bestScore = score
        best = track
      }
    }
    if (!best || bestScore < 40) {
      return Response.json(
        { error: 'not_found', query: title },
        { status: 404 },
      )
    }

    const page = new URL('https://jw-ascolta.vercel.app/')
    page.searchParams.set('s', 'tutto')
    page.searchParams.set('mode', 'shuffle')
    page.searchParams.set('play', '1')
    page.searchParams.set('title', best.title)
    page.searchParams.set('siri', '1')

    return Response.json({
      title: best.title,
      audioUrl: best.url,
      duration: best.duration,
      image: best.image,
      section: best.section,
      pageUrl: page.toString(),
      score: bestScore,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'resolve_failed' },
      { status: 500 },
    )
  }
}
