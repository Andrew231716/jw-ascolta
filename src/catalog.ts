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
  /** Mediator language of the audio file (e.g. I, E, S). */
  lang?: string
  /** Cross-language identity from JW mediator. */
  naturalKey?: string
  /** Italian display title when available. */
  titleIt?: string
  /** Title in the audio language (selected / per-track). */
  titleLocal?: string
  /** Mediator language codes where this track exists. */
  availableLanguages?: string[]
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
const MUSIC_LANG_CACHE_KEY = 'jw-ascolta:music-lang-catalog-v2'
const PINNED_MUSIC_LANGS = [
  'I',
  'E',
  'S',
  'F',
  'X',
  'T',
  'TPO',
  'J',
  'KO',
  'A',
  'SW',
  'TW',
] as const

export type MusicLangInfo = {
  code: string
  name: string
  vernacular?: string
  aliases?: string[]
}

/** Seed + offline fallback until the full JW.org list loads. */
export const MUSIC_LANGUAGES: MusicLangInfo[] = [
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
  { code: 'TW', name: 'Twi', vernacular: 'Twi' },
]

export type MusicLangCode = string

let musicLanguages: MusicLangInfo[] = [...MUSIC_LANGUAGES]
let musicLanguagesLoaded = false
let musicLanguagesPromise: Promise<MusicLangInfo[]> | null = null

function readCachedMusicLanguages(): MusicLangInfo[] | null {
  try {
    const raw = localStorage.getItem(MUSIC_LANG_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; languages?: MusicLangInfo[] }
    if (!Array.isArray(parsed.languages) || parsed.languages.length < 100) return null
    if (parsed.at && Date.now() - parsed.at > 7 * 24 * 60 * 60 * 1000) return null
    return parsed.languages
      .filter(
        (item) =>
          item &&
          typeof item.code === 'string' &&
          typeof item.name === 'string' &&
          isMusicLangCode(item.code),
      )
      .map((item) => ({
        code: item.code.toUpperCase(),
        name: item.name,
        vernacular: item.vernacular || undefined,
        aliases: Array.isArray(item.aliases) ? item.aliases : undefined,
      }))
  } catch {
    return null
  }
}

function persistMusicLanguages(languages: MusicLangInfo[]) {
  try {
    localStorage.setItem(
      MUSIC_LANG_CACHE_KEY,
      JSON.stringify({ at: Date.now(), languages }),
    )
  } catch {
    /* ignore */
  }
}

function prioritizeMusicLanguages(list: MusicLangInfo[]): MusicLangInfo[] {
  const byCode = new Map(list.map((lang) => [lang.code, lang]))
  const head: MusicLangInfo[] = []
  for (const code of PINNED_MUSIC_LANGS) {
    const item = byCode.get(code)
    if (item) {
      head.push(item)
      byCode.delete(code)
    }
  }
  const rest = [...byCode.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }),
  )
  return [...head, ...rest]
}

export function isMusicLangCode(value: string): value is MusicLangCode {
  return /^[A-Z][A-Z0-9]{0,11}$/.test(String(value || '').trim().toUpperCase())
}

export function getMusicLanguages(): MusicLangInfo[] {
  if (!musicLanguagesLoaded) {
    const cached = readCachedMusicLanguages()
    if (cached?.length) {
      musicLanguages = prioritizeMusicLanguages(cached)
      musicLanguagesLoaded = true
    }
  }
  return musicLanguages
}

export async function ensureMusicLanguages(): Promise<MusicLangInfo[]> {
  getMusicLanguages()
  if (musicLanguagesLoaded && musicLanguages.length > 200) {
    return musicLanguages
  }
  if (musicLanguagesPromise) return musicLanguagesPromise

  musicLanguagesPromise = (async () => {
    const res = await fetch(`${API}/languages/I/all`, {
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`languages_${res.status}`)
    const data = (await res.json()) as {
      languages?: Array<{
        code?: string
        name?: string
        vernacular?: string
        isSignLanguage?: boolean
      }>
    }
    const parsed = (data.languages || [])
      .filter((item) => item?.code && item?.name && isMusicLangCode(item.code))
      .map((item) => ({
        code: String(item.code).toUpperCase(),
        name: String(item.name),
        vernacular: item.vernacular || undefined,
      }))
    if (parsed.length < 100) return musicLanguages
    musicLanguages = prioritizeMusicLanguages(parsed)
    musicLanguagesLoaded = true
    persistMusicLanguages(musicLanguages)
    return musicLanguages
  })().catch(() => musicLanguages)

  return musicLanguagesPromise
}

export function getMusicLanguage(): MusicLangCode {
  try {
    const saved = localStorage.getItem(MUSIC_LANG_KEY) || ''
    if (isMusicLangCode(saved)) return saved.toUpperCase()
  } catch {
    /* ignore */
  }
  return 'I'
}

export function setMusicLanguage(code: string): MusicLangCode {
  const next = isMusicLangCode(code) ? code.toUpperCase() : 'I'
  try {
    localStorage.setItem(MUSIC_LANG_KEY, next)
  } catch {
    /* ignore */
  }
  clearMusicCatalogCache()
  return next
}

export function musicLanguageLabel(code: string) {
  const normalized = String(code || '').toUpperCase()
  return (
    getMusicLanguages().find((item) => item.code === normalized)?.name ||
    normalized ||
    code
  )
}

export function filterMusicLanguages(query: string, limit = 80): MusicLangInfo[] {
  const all = getMusicLanguages()
  const q = normalizeAlias(query)
  if (!q) {
    return all.slice(0, Math.min(limit, 40))
  }
  const scored: Array<{ lang: MusicLangInfo; score: number }> = []
  for (const lang of all) {
    const code = lang.code.toLowerCase()
    const name = normalizeAlias(lang.name)
    const vernacular = normalizeAlias(lang.vernacular || '')
    const aliases = (lang.aliases || []).map((alias) => normalizeAlias(alias))
    let score = 0
    if (code === q || name === q || vernacular === q) score = 100
    else if (code.startsWith(q) || name.startsWith(q) || vernacular.startsWith(q))
      score = 80
    else if (
      name.includes(q) ||
      vernacular.includes(q) ||
      code.includes(q) ||
      aliases.some((alias) => alias.includes(q))
    ) {
      score = 50
    }
    if (score > 0) scored.push({ lang, score })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.lang.name.localeCompare(b.lang.name, 'it', { sensitivity: 'base' }),
  )
  return scored.slice(0, limit).map((item) => item.lang)
}

export function trackPrimaryTitle(track: Track) {
  return track.titleIt || track.title
}

export function trackSecondaryTitle(track: Track): string | null {
  const primary = trackPrimaryTitle(track)
  const local = track.titleLocal || (track.lang && track.lang !== 'I' ? track.title : '')
  if (!local) return null
  if (normalizeTitle(local) === normalizeTitle(primary)) return null
  return local
}

export function trackSearchText(track: Track) {
  return [track.title, track.titleIt, track.titleLocal]
    .filter(Boolean)
    .join(' ')
}

export function trackMatchesQuery(track: Track, rawQuery: string) {
  const q = normalizeTitle(rawQuery)
  if (!q) return false
  return normalizeTitle(trackSearchText(track)).includes(q)
}

export function languagesForTrack(track: Track): MusicLangCode[] {
  const available = new Set(
    (track.availableLanguages || [])
      .map((code) => String(code).toUpperCase())
      .filter(isMusicLangCode),
  )
  if (track.lang && isMusicLangCode(track.lang)) {
    available.add(track.lang.toUpperCase())
  }
  available.add('I')
  const knownOrder = getMusicLanguages()
    .map((lang) => lang.code)
    .filter((code) => available.has(code))
  const knownSet = new Set(knownOrder)
  const unknown = [...available]
    .filter((code) => !knownSet.has(code))
    .sort((a, b) => a.localeCompare(b))
  const ordered = [...knownOrder, ...unknown]
  return ordered.length ? ordered : ['I']
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
  languageAgnosticNaturalKey?: string
  naturalKey?: string
  availableLanguages?: string[]
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

function mediaToTrack(
  item: MediatorMedia,
  section: SectionDef,
  lang: string,
): Track | null {
  if (item.type && item.type !== 'audio') return null
  const file =
    item.files?.find((f) => (f.mimetype || '').startsWith('audio/')) ||
    item.files?.[0]
  if (!file?.progressiveDownloadURL) return null
  const naturalKey = item.languageAgnosticNaturalKey || undefined
  const titleLocal = item.title
  const titleIt = lang === 'I' ? item.title : undefined
  return {
    id: `${lang}:${item.guid}`,
    title: titleIt || titleLocal,
    titleIt,
    titleLocal,
    url: file.progressiveDownloadURL,
    duration: item.duration || file.duration || 0,
    image: pickImage(item),
    sectionSlug: section.slug,
    sectionName: section.shortName,
    lang,
    naturalKey,
    availableLanguages: item.availableLanguages,
    contentKind: 'music',
  }
}

async function fetchSectionTracksRaw(
  section: SectionDef,
  lang: string,
): Promise<Track[]> {
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
    const track = mediaToTrack(item, section, lang)
    if (track) tracks.push(track)
  }
  sectionCache.set(key, { at: Date.now(), tracks })
  return tracks.map((track) => ({ ...track }))
}

function mergeItalianTitles(localTracks: Track[], italianTracks: Track[]): Track[] {
  const italianByKey = new Map<string, Track>()
  for (const track of italianTracks) {
    if (track.naturalKey) italianByKey.set(track.naturalKey, track)
  }
  return localTracks.map((track) => {
    const italian = track.naturalKey
      ? italianByKey.get(track.naturalKey)
      : undefined
    const titleIt = italian?.title || track.titleIt || track.title
    const titleLocal = track.titleLocal || track.title
    return {
      ...track,
      title: titleIt,
      titleIt,
      titleLocal,
      availableLanguages:
        track.availableLanguages || italian?.availableLanguages,
    }
  })
}

export async function fetchSectionTracks(
  section: SectionDef,
  langCode?: string,
): Promise<Track[]> {
  const lang = langCode && isMusicLangCode(langCode) ? langCode : getMusicLanguage()
  if (lang === 'I') {
    return fetchSectionTracksRaw(section, 'I').then((tracks) =>
      tracks.map((track) => ({
        ...track,
        title: track.titleIt || track.title,
        titleIt: track.titleIt || track.title,
        titleLocal: track.titleLocal || track.title,
      })),
    )
  }

  const [localTracks, italianTracks] = await Promise.all([
    fetchSectionTracksRaw(section, lang),
    fetchSectionTracksRaw(section, 'I').catch(() => [] as Track[]),
  ])
  return mergeItalianTitles(localTracks, italianTracks)
}

export async function fetchTrackInLanguage(
  track: Track,
  langCode: string,
): Promise<Track | null> {
  if (!track.naturalKey) return null
  const lang = isMusicLangCode(langCode) ? langCode : getMusicLanguage()
  if (track.lang === lang && track.url) {
    return {
      ...track,
      title: track.titleIt || track.title,
    }
  }
  const section = SECTIONS.find((item) => item.slug === track.sectionSlug)
  if (!section) return null
  try {
    const tracks = await fetchSectionTracks(section, lang)
    return tracks.find((item) => item.naturalKey === track.naturalKey) || null
  } catch {
    return null
  }
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
    const titles = [tracks[i].title, tracks[i].titleIt, tracks[i].titleLocal]
      .filter(Boolean)
      .map((value) => normalizeTitle(value as string))
      .filter(Boolean)
    if (!titles.length) continue

    let score = 0
    for (const title of titles) {
      let next = 0
      if (title === query) next = 100
      else if (title.startsWith(query) || query.startsWith(title)) next = 80
      else if (title.includes(query) || query.includes(title)) next = 60
      else {
        const qTokens = query.split(' ').filter((t) => t.length > 2)
        const tTokens = new Set(title.split(' ').filter((t) => t.length > 2))
        if (qTokens.length) {
          const hits = qTokens.filter((t) => tTokens.has(t)).length
          next = (hits / qTokens.length) * 50
        }
      }
      if (next > score) score = next
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
