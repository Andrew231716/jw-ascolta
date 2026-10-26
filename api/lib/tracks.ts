export type SectionSlug =
  | 'tutto'
  | 'canzoni'
  | 'musica-internazionale'
  | 'adunanze'
  | 'cantata'
  | 'strumentale'
  | 'corale'
  | 'bambini'
  | 'melodie'
  | 'gnj1'
  | 'gnj2'
  | 'gnj3'

export const SECTION_DEFS: Array<{
  slug: SectionSlug
  apiKey: string
  aliases: string[]
}> = [
  {
    slug: 'canzoni',
    apiKey: 'AudioOriginalSongs',
    aliases: ['canzoni', 'canzone', 'original songs', 'osg'],
  },
  {
    slug: 'musica-internazionale',
    apiKey: 'AudioInternationalMusic',
    aliases: [
      'musica internazionale',
      'internazionale',
      'international',
      'imc',
    ],
  },
  {
    slug: 'adunanze',
    apiKey: 'SJJMeetings',
    aliases: [
      'adunanze',
      'cantici adunanze',
      'per le adunanze',
      'meeting',
      'sjjm',
      'cantici',
    ],
  },
  {
    slug: 'cantata',
    apiKey: 'SJJChorus',
    aliases: ['cantata', 'versione cantata', 'coro', 'sjjc'],
  },
  {
    slug: 'strumentale',
    apiKey: 'SJJInstrumental',
    aliases: ['strumentale', 'strumentali', 'sjji'],
  },
  {
    slug: 'corale',
    apiKey: 'Vocal',
    aliases: ['corale', 'versione corale', 'snv', 'vocal'],
  },
  {
    slug: 'bambini',
    apiKey: 'AudioChildrenSongs',
    aliases: ['bambini', 'per bambini', 'children', 'kids'],
  },
  {
    slug: 'melodie',
    apiKey: 'KingdomMelodies',
    aliases: ['melodie', 'melodie del regno', 'kingdom melodies', 'iam'],
  },
  {
    slug: 'gnj1',
    apiKey: 'GNJST1Soundtrack',
    aliases: ['gnj1', 'gnj 1', 'colonna sonora 1', 'buona notizia 1'],
  },
  {
    slug: 'gnj2',
    apiKey: 'GNJST2Soundtrack',
    aliases: ['gnj2', 'gnj 2', 'colonna sonora 2', 'buona notizia 2'],
  },
  {
    slug: 'gnj3',
    apiKey: 'GNJST3Soundtrack',
    aliases: ['gnj3', 'gnj 3', 'colonna sonora 3', 'buona notizia 3'],
  },
]

const LANG = 'I'
const API = 'https://b.jw-cdn.org/apis/mediator/v1'

export type TrackHit = {
  title: string
  url: string
  duration: number
  image?: string
  section: string
  sectionSlug: SectionSlug
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

export function normalizeAlias(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_+/]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function resolveSectionSlugs(raw: string): SectionSlug[] {
  const value = normalizeAlias(raw || 'tutto')
  if (!value || value === 'tutto' || value === 'all' || value === 'musica') {
    return ['tutto']
  }

  const parts = value
    .split(/[,|]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const found = new Set<SectionSlug>()

  for (const part of parts) {
    if (part === 'tutto' || part === 'all') {
      found.add('tutto')
      continue
    }
    const match = SECTION_DEFS.find(
      (s) =>
        s.slug === part || s.aliases.some((a) => normalizeAlias(a) === part),
    )
    if (match) found.add(match.slug)
  }

  if (found.size === 0 || found.has('tutto')) return ['tutto']
  return [...found]
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

export async function loadTracks(
  slugs: SectionSlug[] = ['tutto'],
): Promise<TrackHit[]> {
  const wanted =
    slugs.includes('tutto') || slugs.length === 0
      ? SECTION_DEFS
      : SECTION_DEFS.filter((s) => slugs.includes(s.slug))

  const batches = await Promise.all(
    wanted.map(async (section) => {
      const res = await fetch(
        `${API}/categories/${LANG}/${section.apiKey}?detailed=1&clientType=www`,
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
      const sectionName = data.category?.name || section.slug
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
          section: sectionName,
          sectionSlug: section.slug,
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

export function buildOrderedTracks(
  tracks: TrackHit[],
  mode: string,
  title: string,
): TrackHit[] | null {
  let list = [...tracks]
  const useShuffle =
    mode === 'shuffle' || mode === 'casuale' || mode === '1' || mode === 'true'
  if (useShuffle) list = shuffle(list)

  if (title.trim()) {
    const match = findBestTrack(list, title)
    if (!match) return null
    const rest = list.filter((t) => t.url !== match.track.url)
    list = [match.track, ...rest]
  }
  return list
}

/** Audio-only HLS so iOS / CarPlay can queue many MP3s from one Open URL. */
export function toHls(tracks: TrackHit[]): string {
  const target = Math.max(
    10,
    ...tracks.map((t) => Math.ceil(t.duration || 10)),
  )
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ]
  for (const track of tracks) {
    const seconds = Math.max(1, track.duration || 1)
    lines.push(`#EXTINF:${seconds.toFixed(3)},${track.title.replace(/,/g, ' ')}`)
    lines.push(track.url)
  }
  lines.push('#EXT-X-ENDLIST')
  return `${lines.join('\n')}\n`
}

export function toM3u(tracks: TrackHit[]): string {
  const lines = ['#EXTM3U']
  for (const track of tracks) {
    const seconds = Math.max(1, Math.round(track.duration || 1))
    lines.push(`#EXTINF:${seconds},${track.title.replace(/,/g, ' ')}`)
    lines.push(track.url)
  }
  return `${lines.join('\n')}\n`
}
