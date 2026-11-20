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

export type PlayMode = 'shuffle' | 'order'

export interface SectionDef {
  slug: SectionSlug
  apiKey: string
  name: string
  shortName: string
  /** Frasi riconosciute nei deep link / comandi Siri */
  aliases: string[]
}

export interface Track {
  id: string
  title: string
  url: string
  duration: number
  image?: string
  sectionSlug: SectionSlug
  sectionName: string
  /** Optional audio clip window (seconds) for video subtitle ranges. */
  clipStart?: number
  clipEnd?: number
  subtitleUrl?: string
  source?: string
  contentKind?: 'music' | 'article' | 'video'
}

export const SECTIONS: SectionDef[] = [
  {
    slug: 'canzoni',
    apiKey: 'AudioOriginalSongs',
    name: 'Canzoni',
    shortName: 'Canzoni',
    aliases: ['canzoni', 'canzone', 'original songs', 'osg'],
  },
  {
    slug: 'musica-internazionale',
    apiKey: 'AudioInternationalMusic',
    name: 'Musica internazionale',
    shortName: 'Internazionale',
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
    name: 'Cantiamo a Geova con gioia — Adunanze',
    shortName: 'Adunanze',
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
    name: 'Cantiamo a Geova con gioia — Cantata',
    shortName: 'Cantata',
    aliases: ['cantata', 'versione cantata', 'coro', 'sjjc'],
  },
  {
    slug: 'strumentale',
    apiKey: 'SJJInstrumental',
    name: 'Cantiamo a Geova con gioia — Strumentale',
    shortName: 'Strumentale',
    aliases: ['strumentale', 'strumentali', 'sjji'],
  },
  {
    slug: 'corale',
    apiKey: 'Vocal',
    name: 'Cantiamo a Geova — Corale',
    shortName: 'Corale',
    aliases: ['corale', 'versione corale', 'snv', 'vocal'],
  },
  {
    slug: 'bambini',
    apiKey: 'AudioChildrenSongs',
    name: 'Canzoni per bambini',
    shortName: 'Bambini',
    aliases: ['bambini', 'per bambini', 'children', 'kids'],
  },
  {
    slug: 'melodie',
    apiKey: 'KingdomMelodies',
    name: 'Melodie del Regno',
    shortName: 'Melodie',
    aliases: ['melodie', 'melodie del regno', 'kingdom melodies', 'iam'],
  },
  {
    slug: 'gnj1',
    apiKey: 'GNJST1Soundtrack',
    name: 'Buona notizia — Colonna sonora 1',
    shortName: 'GNJ 1',
    aliases: ['gnj1', 'gnj 1', 'colonna sonora 1', 'buona notizia 1'],
  },
  {
    slug: 'gnj2',
    apiKey: 'GNJST2Soundtrack',
    name: 'Buona notizia — Colonna sonora 2',
    shortName: 'GNJ 2',
    aliases: ['gnj2', 'gnj 2', 'colonna sonora 2', 'buona notizia 2'],
  },
  {
    slug: 'gnj3',
    apiKey: 'GNJST3Soundtrack',
    name: 'Buona notizia — Colonna sonora 3',
    shortName: 'GNJ 3',
    aliases: ['gnj3', 'gnj 3', 'colonna sonora 3', 'buona notizia 3'],
  },
]

const API = 'https://b.jw-cdn.org/apis/mediator/v1'
const MUSIC_LANG_KEY = 'jw-ascolta:music-lang'

/** Lingue con catalogo musicale JW.org (codice mediator). */
export const MUSIC_LANGUAGES = [
  { code: 'I', name: 'Italiano', vernacular: 'Italiano' },
  { code: 'E', name: 'Inglese', vernacular: 'English' },
  { code: 'S', name: 'Spagnolo', vernacular: 'Español' },
  { code: 'T', name: 'Portoghese (Brasile)', vernacular: 'Português' },
  { code: 'TPO', name: 'Portoghese (Portogallo)', vernacular: 'Português' },
  { code: 'F', name: 'Francese', vernacular: 'Français' },
  { code: 'X', name: 'Tedesco', vernacular: 'Deutsch' },
  { code: 'O', name: 'Olandese', vernacular: 'Nederlands' },
  { code: 'P', name: 'Polacco', vernacular: 'Polski' },
  { code: 'M', name: 'Romeno', vernacular: 'Română' },
  { code: 'G', name: 'Greco', vernacular: 'Ελληνική' },
  { code: 'U', name: 'Russo', vernacular: 'русский' },
  { code: 'K', name: 'Ucraino', vernacular: 'українська' },
  { code: 'B', name: 'Ceco', vernacular: 'čeština' },
  { code: 'H', name: 'Ungherese', vernacular: 'magyar' },
  { code: 'Z', name: 'Svedese', vernacular: 'Svenska' },
  { code: 'D', name: 'Danese', vernacular: 'Dansk' },
  { code: 'N', name: 'Norvegese', vernacular: 'Norsk' },
  { code: 'FI', name: 'Finlandese', vernacular: 'suomi' },
  { code: 'AL', name: 'Albanese', vernacular: 'shqip' },
  { code: 'C', name: 'Croato', vernacular: 'hrvatski' },
  { code: 'J', name: 'Giapponese', vernacular: '日本語' },
  { code: 'KO', name: 'Coreano', vernacular: '한국어' },
  { code: 'CHS', name: 'Cinese (semplificato)', vernacular: '中文简体' },
  { code: 'CH', name: 'Cinese (tradizionale)', vernacular: '中文繁體' },
  { code: 'IN', name: 'Indonesiano', vernacular: 'Indonesia' },
  { code: 'TG', name: 'Tagalog', vernacular: 'Tagalog' },
  { code: 'VT', name: 'Vietnamita', vernacular: 'Việt' },
  { code: 'SI', name: 'Thai', vernacular: 'ไทย' },
  { code: 'A', name: 'Arabo', vernacular: 'العربية' },
  { code: 'TK', name: 'Turco', vernacular: 'Türkçe' },
  { code: 'SW', name: 'Swahili', vernacular: 'Kiswahili' },
  { code: 'HI', name: 'Hindi', vernacular: 'हिंदी' },
] as const

export type MusicLangCode = (typeof MUSIC_LANGUAGES)[number]['code']

function isMusicLangCode(value: string): value is MusicLangCode {
  return MUSIC_LANGUAGES.some((item) => item.code === value)
}

export function getMusicLanguage(): MusicLangCode {
  try {
    const saved = localStorage.getItem(MUSIC_LANG_KEY) || ''
    if (isMusicLangCode(saved)) return saved
  } catch {
    /* ignore */
  }
  return 'I'
}

export function setMusicLanguage(code: string): MusicLangCode {
  const next = isMusicLangCode(code) ? code : 'I'
  try {
    localStorage.setItem(MUSIC_LANG_KEY, next)
  } catch {
    /* ignore */
  }
  clearMusicCatalogCache()
  return next
}

export function musicLanguageLabel(code: string) {
  return MUSIC_LANGUAGES.find((item) => item.code === code)?.name || code
}

interface MediatorFile {
  progressiveDownloadURL: string
  duration?: number
  mimetype?: string
}

interface MediatorMedia {
  guid: string
  title: string
  duration?: number
  type?: string
  files?: MediatorFile[]
  images?: {
    sqr?: { lg?: string }
    wss?: { sm?: string; lg?: string }
    pnr?: { lg?: string }
  }
}

interface MediatorCategoryResponse {
  category: {
    key: string
    name: string
    media?: MediatorMedia[]
  }
}

function pickImage(media: MediatorMedia): string | undefined {
  return (
    media.images?.sqr?.lg ||
    media.images?.wss?.lg ||
    media.images?.wss?.sm ||
    media.images?.pnr?.lg
  )
}

const SECTION_CACHE_TTL_MS = 30 * 60 * 1000
const sectionCache = new Map<string, { at: number; tracks: Track[] }>()

export function clearMusicCatalogCache() {
  sectionCache.clear()
}

function cacheKey(lang: string, slug: string) {
  return `${lang}:${slug}`
}

export async function fetchSectionTracks(
  section: SectionDef,
  langCode?: string,
): Promise<Track[]> {
  const lang = langCode && isMusicLangCode(langCode) ? langCode : getMusicLanguage()
  const key = cacheKey(lang, section.slug)
  const cached = sectionCache.get(key)
  if (cached && Date.now() - cached.at < SECTION_CACHE_TTL_MS) {
    return cached.tracks.map((track) => ({ ...track }))
  }

  const url = `${API}/categories/${encodeURIComponent(lang)}/${section.apiKey}?detailed=1&clientType=www`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) {
    throw new Error(`Impossibile caricare ${section.name} (${res.status})`)
  }
  const data = (await res.json()) as MediatorCategoryResponse
  const media = data.category.media ?? []
  const tracks: Track[] = []

  for (const item of media) {
    if (item.type && item.type !== 'audio') continue
    const file = item.files?.find((f) =>
      (f.mimetype || '').startsWith('audio/'),
    ) || item.files?.[0]
    if (!file?.progressiveDownloadURL) continue
    tracks.push({
      id: `${lang}:${item.guid}`,
      title: item.title,
      url: file.progressiveDownloadURL,
      duration: item.duration || file.duration || 0,
      image: pickImage(item),
      sectionSlug: section.slug,
      sectionName: section.shortName,
    })
  }

  sectionCache.set(key, { at: Date.now(), tracks })
  return tracks.map((track) => ({ ...track }))
}

export async function fetchTracksForSlugs(
  slugs: SectionSlug[],
  langCode?: string,
): Promise<{ tracks: Track[]; unavailable: string[] }> {
  const lang = langCode && isMusicLangCode(langCode) ? langCode : getMusicLanguage()
  const wanted =
    slugs.includes('tutto') || slugs.length === 0
      ? SECTIONS
      : SECTIONS.filter((s) => slugs.includes(s.slug))

  const batches = await Promise.allSettled(
    wanted.map((section) => fetchSectionTracks(section, lang)),
  )
  const tracks = batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : [])
  const unavailable = wanted.filter((_, index) => batches[index].status === 'rejected').map((section) => section.shortName)
  if (unavailable.length === wanted.length && wanted.length) {
    throw new Error(
      `Catalogo musicale non disponibile in ${musicLanguageLabel(lang)}. Riprova o scegli un’altra lingua.`,
    )
  }
  return { tracks, unavailable }
}

export function normalizeAlias(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_+/]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function resolveSectionInput(raw: string): SectionSlug[] {
  const value = normalizeAlias(raw)
  if (!value || value === 'tutto' || value === 'all' || value === 'musica') {
    return ['tutto']
  }

  const parts = value.split(/[,|]+/).map((p) => p.trim()).filter(Boolean)
  const found = new Set<SectionSlug>()

  for (const part of parts) {
    if (part === 'tutto' || part === 'all') {
      found.add('tutto')
      continue
    }
    const match = SECTIONS.find(
      (s) =>
        s.slug === part ||
        normalizeAlias(s.shortName) === part ||
        normalizeAlias(s.name) === part ||
        s.aliases.some((a) => normalizeAlias(a) === part),
    )
    if (match) found.add(match.slug)
  }

  if (found.has('tutto')) return ['tutto']
  return [...found]
}

export function parsePlayMode(raw: string | null): PlayMode {
  if (!raw) return 'shuffle'
  const v = normalizeAlias(raw)
  if (
    v === 'order' ||
    v === 'ordine' ||
    v === 'in ordine' ||
    v === 'sequential' ||
    v === 'sequenziale'
  ) {
    return 'order'
  }
  return 'shuffle'
}

export function buildPlaylist(tracks: Track[], mode: PlayMode): Track[] {
  if (tracks.length === 0) return []
  if (mode === 'order') return [...tracks]
  const copy = [...tracks]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Strip punctuation / numbering noise for title matching. */
export function normalizeTitle(raw: string): string {
  return normalizeAlias(raw)
    .replace(/[“”"'«»]/g, '')
    .replace(/[.,;:!?…¡¿()[\]{}]/g, ' ')
    .replace(/^\d+[.\-) ]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the best matching track index for a spoken/typed title.
 * Prefers exact match, then prefix, then substring, then loose token overlap.
 */
export function findTrackIndexByTitle(
  tracks: Track[],
  rawTitle: string,
): number {
  const query = normalizeTitle(rawTitle)
  if (!query || tracks.length === 0) return -1

  let best = -1
  let bestScore = 0

  for (let i = 0; i < tracks.length; i += 1) {
    const title = normalizeTitle(tracks[i].title)
    if (!title) continue

    let score = 0
    if (title === query) score = 100
    else if (title.startsWith(query) || query.startsWith(title)) score = 80
    else if (title.includes(query) || query.includes(title)) score = 60
    else {
      const qTokens = query.split(' ').filter((t) => t.length > 2)
      const tTokens = new Set(title.split(' ').filter((t) => t.length > 2))
      if (qTokens.length) {
        const hits = qTokens.filter((t) => tTokens.has(t)).length
        score = (hits / qTokens.length) * 50
      }
    }

    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }

  return bestScore >= 40 ? best : -1
}

/** Put matched track first, then the rest of the playlist (continues after). */
export function playlistStartingAtTitle(
  tracks: Track[],
  rawTitle: string,
): { playlist: Track[]; matched: Track | null } {
  const idx = findTrackIndexByTitle(tracks, rawTitle)
  if (idx < 0) return { playlist: tracks, matched: null }
  const matched = tracks[idx]
  const rest = tracks.filter((_, i) => i !== idx)
  return { playlist: [matched, ...rest], matched }
}

export function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
