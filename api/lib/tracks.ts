export const SECTIONS = [
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

export type TrackHit = {
  title: string
  url: string
  duration: number
  image?: string
  section: string
}

export function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["'`«»]/g, '')
    .replace(/^\d+[.\-) ]\s*/g, '')
    .replace(/[_+/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scoreTitle(title: string, query: string): number {
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

export async function loadTracks(): Promise<TrackHit[]> {
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

export function findBestTrack(
  tracks: TrackHit[],
  rawTitle: string,
): { track: TrackHit; score: number; index: number } | null {
  const query = normalizeTitle(rawTitle)
  if (!query) return null
  let bestIndex = -1
  let bestScore = 0
  for (let i = 0; i < tracks.length; i += 1) {
    const score = scoreTitle(normalizeTitle(tracks[i].title), query)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }
  if (bestIndex < 0 || bestScore < 40) return null
  return { track: tracks[bestIndex], score: bestScore, index: bestIndex }
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
