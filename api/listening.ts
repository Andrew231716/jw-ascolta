export const config = { runtime: 'edge', maxDuration: 60 }

const site = 'https://www.jw.org'
const cdn = 'https://b.jw-cdn.org'
const articles = '/it/biblioteca-digitale/articoli/'
const bible = '/it/cosa-dice-la-Bibbia/'

type AudioMarker = { pid: number; start: number; end: number }

type LibraryTrack = {
  id: string
  title: string
  url: string
  duration: number
  topics: string[]
  description?: string
  source: string
  matchIn?: string
  subtitleUrl?: string
  /** JW MEPS document id — enables chapter text / phrase reading when set. */
  docid?: string
  /** True when the track has a page we can open for frase-a-frase. */
  canRead?: boolean
  /** Paragraph timing markers for original JW MP3 phrase sync. */
  markers?: AudioMarker[]
}

function parseTimecode(value: string): number {
  const match = String(value || '').match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function extractMarkers(file: {
  markers?: {
    markers?: Array<{
      mepsParagraphId?: number | string
      startTime?: string
      duration?: string
    }>
  }
}): AudioMarker[] {
  const list = file.markers?.markers
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      const pid = Number(item.mepsParagraphId)
      const start = parseTimecode(String(item.startTime || ''))
      const duration = parseTimecode(String(item.duration || ''))
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(start)) return null
      return { pid, start, end: start + Math.max(0, duration) }
    })
    .filter((item): item is AudioMarker => Boolean(item))
}

type PendingItem = {
  id: string
  title: string
  source: string
  reason: string
  matchIn?: string
}

async function read(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) })
  if (!response.ok) throw new Error('Fonte JW.org non disponibile')
  return response
}

function label(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|quot|nbsp|apos|#\d+);/g, (entity) => {
      if (entity.startsWith('&#')) return String.fromCharCode(Number(entity.slice(2, -1)))
      return (
        ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity] ??
        entity
      )
    })
    .trim()
}

function links(html: string) {
  return Array.from(
    html.matchAll(/<a\b[^>]*href="(\/it\/[^"#?]+\/)"[^>]*>([\s\S]*?)<\/a>/g),
    ([, path, title]) => ({ path, name: label(title) }),
  )
}

function normalizeQuery(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Longest-first Italian endings so pazienza / paziente / pazienti share a stem. */
const ITALIAN_SUFFIXES = [
  'mente',
  'azione',
  'azioni',
  'izione',
  'izioni',
  'amento',
  'amenti',
  'imento',
  'imenti',
  'atrice',
  'atrici',
  'atore',
  'atori',
  'ienza',
  'ienze',
  'enza',
  'enze',
  'anti',
  'ante',
  'enti',
  'ente',
  'abili',
  'abile',
  'ibili',
  'ibile',
  'issimi',
  'issime',
  'issimo',
  'issima',
  'ando',
  'endo',
  'iamo',
  'are',
  'ere',
  'ire',
  'ati',
  'ate',
  'ato',
  'ata',
  'uti',
  'ute',
  'uto',
  'uta',
  'iti',
  'ite',
  'ito',
  'ita',
  'oni',
  'one',
  'ie',
  'ia',
  'io',
  'i',
  'e',
  'a',
  'o',
]

function stemCandidates(token: string) {
  const out = new Set<string>([token])
  if (token.length >= 5 && /[aeiou]$/.test(token)) out.add(token.slice(0, -1))
  for (const suffix of ITALIAN_SUFFIXES) {
    if (!token.endsWith(suffix)) continue
    const stem = token.slice(0, -suffix.length)
    if (stem.length < 4) continue
    out.add(stem)
    if (stem.length >= 5 && /[aeiou]$/.test(stem)) out.add(stem.slice(0, -1))
    break
  }
  return out
}

function stemsCompatible(a: string, b: string) {
  if (a === b) return a.length >= 4
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < 4) return false
  if (longer.startsWith(shorter)) return true
  let shared = 0
  const limit = Math.min(a.length, b.length)
  while (shared < limit && a[shared] === b[shared]) shared += 1
  return shared >= 4 && shared >= limit - 1
}

function tokenMatches(hayToken: string, needle: string) {
  if (!hayToken || !needle) return false
  if (hayToken.includes(needle)) return true
  if (needle.length >= 4 && hayToken.length >= 4 && needle.includes(hayToken)) return true
  if (needle.length >= 4 && hayToken.startsWith(needle)) return true
  for (const left of stemCandidates(hayToken)) {
    for (const right of stemCandidates(needle)) {
      if (stemsCompatible(left, right)) return true
    }
  }
  return false
}

/** Short Italian function words that match almost every sentence if kept. */
const ITALIAN_STOPWORDS = new Set([
  'a',
  'ad',
  'al',
  'allo',
  'ai',
  'agli',
  'all',
  'agl',
  'alla',
  'alle',
  'con',
  'col',
  'coi',
  'da',
  'dal',
  'dallo',
  'dai',
  'dagli',
  'dall',
  'dagl',
  'dalla',
  'dalle',
  'di',
  'del',
  'dello',
  'dei',
  'degli',
  'dell',
  'degl',
  'della',
  'delle',
  'e',
  'ed',
  'che',
  'chi',
  'cui',
  'come',
  'in',
  'nel',
  'nello',
  'nei',
  'negli',
  'nell',
  'negl',
  'nella',
  'nelle',
  'su',
  'sul',
  'sullo',
  'sui',
  'sugli',
  'sull',
  'sugl',
  'sulla',
  'sulle',
  'per',
  'tra',
  'fra',
  'il',
  'lo',
  'la',
  'i',
  'gli',
  'le',
  'un',
  'uno',
  'una',
  'ma',
  'o',
  'od',
  'se',
  'sia',
  'sono',
  'e',
  'è',
  'ha',
  'ho',
  'hai',
  'hanno',
  'non',
  'si',
  'mi',
  'ti',
  'ci',
  'vi',
  'ne',
])

function significantQueryWords(query: string) {
  return normalizeQuery(query)
    .split(' ')
    .filter(Boolean)
    .filter((word) => word.length >= 4 && !ITALIAN_STOPWORDS.has(word))
}

function matches(haystack: string, query: string) {
  const text = normalizeQuery(haystack)
  const normalized = normalizeQuery(query)
  if (!normalized) return false
  if (text.includes(normalized)) return true
  const words = significantQueryWords(query)
  // Phrase made only of stopwords / tiny tokens: keep exact-includes behaviour only.
  if (!words.length) return false
  const hayTokens = text.split(' ').filter(Boolean)
  return words.every(
    (word) => text.includes(word) || hayTokens.some((token) => tokenMatches(token, word)),
  )
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|quot|nbsp|apos|#\d+);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function articleBodyMatches(path: string, query: string): Promise<boolean> {
  try {
    const response = await fetch(site + path, {
      signal: AbortSignal.timeout(6000),
      headers: { 'Accept-Language': 'it' },
    })
    if (!response.ok) return false
    const html = await response.text()
    const bodyMatch = html.match(
      /<div class="bodyTxt">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
    )
    const body = bodyMatch
      ? stripHtml(bodyMatch[1])
      : Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (m) => stripHtml(m[1]))
          .filter((p) => p.length > 40)
          .join(' ')
    return matches(body, query)
  } catch {
    return false
  }
}

function vttToText(vtt: string) {
  return vtt
    .replace(/^\uFEFF?WEBVTT[^\n]*\n?/i, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*[^\n]+/g, ' ')
    .replace(/^\d+\s*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function subtitleMatches(url: string, query: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return false
    const text = vttToText(await response.text())
    return matches(text, query)
  } catch {
    return false
  }
}

/** Italian books with JW.org MP3 chapters (pub-media symbols). */
const BOOK_AUDIO_PUBS: Array<[string, string]> = [
  ['wcg', 'Cammina coraggiosamente con Dio'],
  ['ia', 'Imitiamo la loro fede'],
  ['jy', 'Gesù: la via, la verità, la vita'],
  ['cf', 'Vieni, sii mio discepolo'],
  ['cl', 'Avviciniamoci a Geova'],
  ['rr', 'La pura adorazione di Geova'],
  ['bh', 'Cosa insegna realmente la Bibbia?'],
  ['bhs', 'Cosa ci insegna la Bibbia?'],
  ['lff', 'Puoi vivere felice per sempre'],
  ['lfb', 'Impariamo dai racconti della Bibbia'],
  ['my', 'Il mio libro di racconti biblici'],
  ['gt', 'Il più grande uomo che sia mai esistito'],
  ['bt', 'Rendiamo completa testimonianza'],
  ['lr', 'Impariamo dal grande Insegnante'],
  ['lv', 'Mantenetevi nell’amore di Dio'],
  ['lvs', 'Come rimanere nell’amore di Dio'],
  ['fy', 'Il segreto della felicità familiare'],
  ['kr', 'Il Regno di Dio è già una realtà'],
  ['jd', 'Viviamo avendo in mente il giorno di Geova'],
  ['jr', 'Dio ci parla per mezzo di Geremia'],
  ['th', 'Applicati alla lettura e all’insegnamento'],
  ['gwt', 'La Parola di Dio è verità'],
]

const MAGAZINE_PUBS = new Set(['w', 'g', 'wp'])

function isCatalogPub(pub: string) {
  return pub === 'mrt' || BOOK_AUDIO_PUBS.some(([id]) => id === pub)
}

function isAllowedPub(pub: string) {
  return MAGAZINE_PUBS.has(pub) || isCatalogPub(pub)
}

async function articleTopics() {
  const html = await (await read(site + articles)).text()
  const topics = new Map<string, string>()
  for (const { path, name } of links(html)) {
    if (!name || name.length > 100) continue
    const root = path.startsWith(articles)
      ? articles
      : path.startsWith(bible)
        ? bible
        : ''
    if (root && /^[^/]+\/$/.test(path.slice(root.length)) && !topics.has(path)) {
      topics.set(path, name)
    }
  }
  const fromSite = Array.from(topics, ([id, name]) => ({ id, name }))
  const preferHtml = '/it/biblioteca-digitale/articoli/altri-argomenti/'
  const preferred = fromSite.filter((item) => item.id === preferHtml)
  const rest = fromSite.filter((item) => item.id !== preferHtml)
  // Pubs with MP3 first (magazines + books), then HTML "Altri argomenti",
  // then the remaining site sections.
  return [
    { id: 'pub:mrt', name: 'Altri argomenti (audio disponibili)' },
    { id: 'pub:w', name: 'Torre di Guardia — studio (audio)' },
    { id: 'pub:g', name: 'Svegliatevi! (audio)' },
    { id: 'pub:wp', name: 'Torre di Guardia — pubblica (audio)' },
    ...BOOK_AUDIO_PUBS.map(([id, name]) => ({ id: `pub:${id}`, name: `${name} (audio)` })),
    ...preferred,
    ...rest,
  ]
}

interface Category {
  key: string
  name: string
  subcategories?: Category[]
  media?: Array<{
    guid: string
    naturalKey: string
    title: string
    type: string
    duration: number
    description?: string
    files?: Array<{
      mimetype: string
      frameHeight: number
      progressiveDownloadURL: string
      subtitles?: { url: string }
    }>
  }>
}

async function category(key: string): Promise<Category> {
  const data = await (
    await read(
      cdn + '/apis/mediator/v1/categories/I/' + key + '?detailed=1&clientType=www',
    )
  ).json()
  return data.category
}

async function videoTracks(key: string) {
  const root = await category(key)
  const seen = new Set<string>()
  const tracks: LibraryTrack[] = []
  function collect(node: Category, path: string[]) {
    const topics = [...path, node.name]
    for (const media of node.media ?? []) {
      if (seen.has(media.guid) || media.type !== 'video') continue
      const files = (media.files ?? []).filter(
        (file) => file.mimetype === 'video/mp4' && file.progressiveDownloadURL,
      )
      // Prefer lowest resolution for audio listening.
      const file = files.sort((a, b) => a.frameHeight - b.frameHeight)[0]
      if (!file) continue
      const subtitleUrl =
        file.subtitles?.url ||
        files.map((f) => f.subtitles?.url).find(Boolean) ||
        undefined
      seen.add(media.guid)
      tracks.push({
        id: 'video-' + media.guid,
        title: media.title,
        url: file.progressiveDownloadURL,
        duration: media.duration,
        topics,
        description: media.description,
        subtitleUrl,
        source:
          site +
          '/finder?lank=' +
          encodeURIComponent(media.naturalKey) +
          '&wtlocale=I',
      })
    }
    for (const child of node.subcategories ?? []) collect(child, topics)
  }
  collect(root, [])
  return tracks
}

const VIDEO_SUBTITLE_PAGE = 48

function partitionVideoQuery(tracks: LibraryTrack[], query: string) {
  const titleHits: LibraryTrack[] = []
  const maybeSub: LibraryTrack[] = []
  for (const track of tracks) {
    if (
      matches(track.title, query) ||
      matches(track.description || '', query) ||
      track.topics.some((topic) => matches(topic, query))
    ) {
      titleHits.push({ ...track, matchIn: 'Nel titolo' })
    } else if (track.subtitleUrl) {
      maybeSub.push(track)
    }
  }
  return { titleHits, maybeSub }
}

async function scanSubtitleHits(tracks: LibraryTrack[], query: string) {
  const deep = await Promise.allSettled(
    tracks.map(async (track) => {
      const hit = await subtitleMatches(track.subtitleUrl!, query)
      return hit ? ({ ...track, matchIn: 'Nei sottotitoli' } satisfies LibraryTrack) : null
    }),
  )
  return deep.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : [],
  )
}

async function filterVideosByQuery(
  tracks: LibraryTrack[],
  query: string,
  subtitlePage = 0,
) {
  if (!query) return { tracks, nextSubtitlePage: null as number | null }
  const { titleHits, maybeSub } = partitionVideoQuery(tracks, query)
  const start = Math.max(0, subtitlePage) * VIDEO_SUBTITLE_PAGE
  const slice = maybeSub.slice(start, start + VIDEO_SUBTITLE_PAGE)
  const subHits = await scanSubtitleHits(slice, query)
  const nextSubtitlePage =
    start + slice.length < maybeSub.length ? subtitlePage + 1 : null
  return {
    tracks: subtitlePage === 0 ? [...titleHits, ...subHits] : subHits,
    nextSubtitlePage,
  }
}

async function allVideoTracks() {
  const root = await category('VideoOnDemand')
  const categories = root.subcategories ?? []
  const results = await Promise.allSettled(categories.map((item) => videoTracks(item.key)))
  const tracks = [
    ...new Map(
      results
        .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
        .map((track) => [track.id, track]),
    ).values(),
  ]
  return tracks
}

async function fetchArticleAudio(docid: string) {
  // Do NOT pass track=1: article track numbers are often 2+.
  const params = new URLSearchParams({
    docid,
    output: 'json',
    fileformat: 'MP3',
    alllangs: '0',
    langwritten: 'I',
    txtCMSLang: 'I',
  })
  const response = await fetch(cdn + '/apis/pub-media/GETPUBMEDIALINKS?' + params, {
    signal: AbortSignal.timeout(8000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Audio non verificato')
  const data = await response.json()
  const file = data.files?.I?.MP3?.find(
    (item: {
      mimetype?: string
      file?: { url?: string }
      title?: string
      duration?: number
      markers?: { markers?: Array<{ mepsParagraphId?: number; startTime?: string; duration?: string }> }
    }) => item.mimetype === 'audio/mpeg' && item.file?.url?.startsWith('https://'),
  )
  return file
    ? {
        title: String(file.title || ''),
        url: String(file.file.url),
        duration: Number(file.duration ?? 0),
        markers: extractMarkers(file),
      }
    : null
}

async function articleTracks(path: string, offset: number, query = '', name = '') {
  const html = await (await read(site + path)).text()
  const documentIds = new Map<
    string,
    { path: string; title: string; matchIn?: string }
  >()
  const titlesByPath = new Map<string, string>()
  for (const link of links(html)) {
    if (link.name) titlesByPath.set(link.path, link.name)
  }
  for (const match of html.matchAll(
    /<a\b[^>]*href="(\/it\/[^"#?]+\/)"[^>]*data-page-id="mid(\d+)"[^>]*>/g,
  )) {
    if (match[1] === path) continue
    if (!documentIds.has(match[2])) {
      documentIds.set(match[2], {
        path: match[1],
        title: titlesByPath.get(match[1]) || '',
      })
    }
  }

  const all = [...documentIds]
  let candidates: Array<[string, { path: string; title: string; matchIn?: string }]>
  if (!query) {
    candidates = all
  } else {
    const titleHits = all.filter(
      ([, meta]) =>
        (meta.title && matches(meta.title, query)) || matches(meta.path, query),
    )
    for (const [, meta] of titleHits) meta.matchIn = 'Nel titolo'

    // Deep search: scan article bodies that did not match by title.
    const rest = all.filter(([id]) => !titleHits.some(([hitId]) => hitId === id))
    const deepWindow = rest.slice(0, 12)
    const deepHits = await Promise.allSettled(
      deepWindow.map(async ([id, meta]) => {
        const hit = await articleBodyMatches(meta.path, query)
        return hit
          ? ([id, { ...meta, matchIn: 'Nel testo' }] as [
              string,
              { path: string; title: string; matchIn?: string },
            ])
          : null
      }),
    )
    const bodyHits = deepHits.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    )
    candidates = [...titleHits, ...bodyHits]
  }

  const batch = candidates.slice(offset, offset + 12)
  const results = await Promise.allSettled(
    batch.map(async ([id, meta]) => {
      const file = await fetchArticleAudio(id)
      if (!file) {
        return {
          pending: {
            id: 'pending-' + id,
            title: meta.title || `Articolo ${id}`,
            source: site + meta.path,
            reason: 'Audio non ancora pubblicato su JW.org',
            matchIn: meta.matchIn,
          } satisfies PendingItem,
          track: null as LibraryTrack | null,
        }
      }
      return {
        pending: null as PendingItem | null,
        track: {
          id: 'article-' + id,
          title: file.title || meta.title || `Articolo ${id}`,
          url: file.url,
          duration: file.duration,
          source: site + meta.path,
          topics: name ? [name] : [],
          matchIn: meta.matchIn,
          docid: id,
          canRead: true,
          markers: file.markers,
        } satisfies LibraryTrack,
      }
    }),
  )

  const failed = results.filter((result) => result.status === 'rejected').length
  const tracks = results.flatMap((result) =>
    result.status === 'fulfilled' && result.value.track ? [result.value.track] : [],
  )
  const pending = results.flatMap((result) =>
    result.status === 'fulfilled' && result.value.pending
      ? [result.value.pending]
      : [],
  )
  return {
    tracks,
    pending,
    next: offset + batch.length < candidates.length ? offset + batch.length : null,
    failed,
  }
}

function recentIssues(count: number) {
  const now = new Date()
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, '0')
    out.push(`${y}${m}`)
  }
  return out
}

/** Known JW.org web roots for Italian books (when TOC scraping helps). */
const BOOK_WEB_ROOTS: Record<string, string> = {
  wcg: '/it/biblioteca-digitale/libri/cammina-coraggiosamente-con-dio/',
  ia: '/it/biblioteca-digitale/libri/vera-fede/',
  lff: '/it/biblioteca-digitale/libri/puoi-vivere-felice-per-sempre/',
  bh: '/it/biblioteca-digitale/libri/cosa-insegna-la-bibbia/',
  cl: '/it/biblioteca-digitale/libri/avviciniamoci/',
}

function chapterSource(pub: string, docid?: number | string) {
  const id = String(docid || '')
  if (/^\d{6,12}$/.test(id)) {
    return {
      source: `${site}/finder?wtlocale=I&docid=${id}&prefer=lang`,
      docid: id,
      canRead: true,
    }
  }
  const root = BOOK_WEB_ROOTS[pub]
  return {
    source: root
      ? site + root
      : pub === 'mrt'
        ? site + articles + 'altri-argomenti/'
        : site + '/it/biblioteca-digitale/libri/',
    canRead: false,
  }
}

async function catalogPubTracks(
  pub: string,
  query: string,
  offset: number,
  topicName: string,
  pageSize = 24,
): Promise<{ tracks: LibraryTrack[]; pending: PendingItem[]; next: number | null; failed: number }> {
  const params = new URLSearchParams({
    output: 'json',
    pub,
    fileformat: 'MP3',
    alllangs: '0',
    langwritten: 'I',
    txtCMSLang: 'I',
  })
  const data = await (await read(cdn + '/apis/pub-media/GETPUBMEDIALINKS?' + params)).json()
  let files: Array<{
    title?: string
    duration?: number
    docid?: number
    track?: number
    file?: { url?: string }
    mimetype?: string
    markers?: { markers?: Array<{ mepsParagraphId?: number; startTime?: string; duration?: string }> }
  }> = data.files?.I?.MP3 ?? []
  files = files.filter(
    (item) =>
      item.mimetype === 'audio/mpeg' &&
      item.file?.url?.startsWith('https://') &&
      (!query || matches(String(item.title || ''), query)),
  )
  const slice = files.slice(offset, offset + pageSize)
  return {
    tracks: slice.map((item, index) => {
      const link = chapterSource(pub, item.docid)
      const markers = extractMarkers(item)
      return {
        id: `pub-${pub}-` + (item.docid || item.track || 'x') + '-' + (item.track || index),
        title: String(item.title || topicName),
        url: String(item.file!.url),
        duration: Number(item.duration ?? 0),
        topics: [topicName],
        source: link.source,
        docid: link.docid,
        canRead: link.canRead,
        markers: markers.length ? markers : undefined,
        matchIn: query ? 'Nel titolo' : undefined,
      }
    }),
    pending: [],
    next: offset + slice.length < files.length ? offset + slice.length : null,
    failed: 0,
  }
}

type BrowseItem = { id: string; name: string; kind: 'book' | 'magazine' | 'articles' | 'videos' }
type BrowseSection = { id: string; name: string; hint: string; items: BrowseItem[] }

async function browseSections(kind: 'articles' | 'videos'): Promise<{ sections: BrowseSection[] }> {
  if (kind === 'videos') {
    const root = await category('VideoOnDemand')
    return {
      sections: [
        {
          id: 'videos',
          name: 'Categorie video',
          hint: 'Scegli una categoria, poi un video. Con i sottotitoli puoi ascoltare da frase a frase.',
          items:
            root.subcategories?.map(({ key, name }) => ({
              id: key,
              name,
              kind: 'videos' as const,
            })) ?? [],
        },
      ],
    }
  }

  const topics = await articleTopics()
  const books: BrowseItem[] = BOOK_AUDIO_PUBS.map(([id, name]) => ({
    id: `pub:${id}`,
    name,
    kind: 'book',
  }))
  const magazines: BrowseItem[] = [
    { id: 'pub:w', name: 'Torre di Guardia — studio', kind: 'magazine' },
    { id: 'pub:g', name: 'Svegliatevi!', kind: 'magazine' },
    { id: 'pub:wp', name: 'Torre di Guardia — pubblica', kind: 'magazine' },
  ]
  const htmlTopics: BrowseItem[] = topics
    .filter((item) => !item.id.startsWith('pub:'))
    .map((item) => ({ id: item.id, name: item.name, kind: 'articles' as const }))
  const mrt = topics.find((item) => item.id === 'pub:mrt')
  if (mrt) {
    htmlTopics.unshift({ id: mrt.id, name: 'Altri argomenti (audio)', kind: 'articles' })
  }

  return {
    sections: [
      {
        id: 'books',
        name: 'Libri',
        hint: 'Apri un libro, scegli il capitolo e ascolta tutto o da frase a frase.',
        items: books,
      },
      {
        id: 'magazines',
        name: 'Riviste',
        hint: 'Articoli audio delle riviste recenti pubblicati su JW.org.',
        items: magazines,
      },
      {
        id: 'articles',
        name: 'Articoli e argomenti',
        hint: 'Sezioni come su JW.org: apri una categoria, poi l’articolo.',
        items: htmlTopics,
      },
    ],
  }
}

/** Search every Italian book with MP3 in one pass (used by global article search). */
async function searchBookAudio(query: string) {
  const results = await Promise.allSettled(
    BOOK_AUDIO_PUBS.map(async ([id, name]) => catalogPubTracks(id, query, 0, name, 200)),
  )
  const tracks = [
    ...new Map(
      results
        .flatMap((result) => (result.status === 'fulfilled' ? result.value.tracks : []))
        .map((track) => [track.id, track]),
    ).values(),
  ]
  return {
    tracks,
    pending: [] as PendingItem[],
    failed: results.filter((result) => result.status === 'rejected').length,
    more: false,
  }
}

async function pubTracks(
  pub: string,
  query: string,
  offset: number,
  topicName: string,
): Promise<{ tracks: LibraryTrack[]; pending: PendingItem[]; next: number | null; failed: number }> {
  if (isCatalogPub(pub)) {
    return catalogPubTracks(pub, query, offset, topicName)
  }

  // Magazines: look far enough back for study WT audio (e.g. giugno 2024 in late 2026).
  const issues = recentIssues(pub === 'w' ? 36 : pub === 'g' || pub === 'wp' ? 24 : 18)
  const batches = await Promise.allSettled(
    issues.map(async (issue) => {
      const params = new URLSearchParams({
        output: 'json',
        pub,
        issue,
        fileformat: 'MP3',
        alllangs: '0',
        langwritten: 'I',
        txtCMSLang: 'I',
      })
      const response = await fetch(
        cdn + '/apis/pub-media/GETPUBMEDIALINKS?' + params,
        { signal: AbortSignal.timeout(8000) },
      )
      if (response.status === 404) return [] as LibraryTrack[]
      if (!response.ok) throw new Error('Audio rivista non verificato')
      const data = await response.json()
      const files = data.files?.I?.MP3 ?? []
      return files
        .filter(
          (item: { mimetype?: string; file?: { url?: string }; title?: string }) =>
            item.mimetype === 'audio/mpeg' &&
            item.file?.url?.startsWith('https://') &&
            (!query || matches(String(item.title || ''), query)),
        )
        .map(
          (item: {
            title?: string
            duration?: number
            track?: number
            docid?: number
            file?: { url?: string }
            markers?: {
              markers?: Array<{ mepsParagraphId?: number; startTime?: string; duration?: string }>
            }
          }): LibraryTrack => {
            const markers = extractMarkers(item)
            const docid = item.docid ? String(item.docid) : undefined
            return {
              id: `pub-${pub}-${issue}-${item.track || item.title}`,
              title: String(item.title || `${pub} ${issue}`),
              url: String(item.file!.url),
              duration: Number(item.duration ?? 0),
              topics: [topicName, String(data.formattedDate || issue)],
              source: docid
                ? `${site}/finder?wtlocale=I&docid=${docid}&prefer=lang`
                : site + '/it/biblioteca-digitale/riviste/',
              docid,
              canRead: Boolean(docid),
              markers: markers.length ? markers : undefined,
              matchIn: query ? 'Nel titolo' : undefined,
            }
          },
        )
    }),
  )
  const failed = batches.filter((b) => b.status === 'rejected').length
  const tracks = batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : []))
  const slice = tracks.slice(offset, offset + 24)
  return {
    tracks: slice,
    pending: [],
    next: offset + slice.length < tracks.length ? offset + slice.length : null,
    failed,
  }
}

export default async function handler(request: Request) {
  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind')
  const topic = searchParams.get('topic')
  const query = (searchParams.get('q') ?? '').trim().slice(0, 120)
  const offset = Number(searchParams.get('offset') ?? 0)
  const browse = searchParams.get('browse') === '1'
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return new Response(null, { status: 400 })
  }
  const headers = {
    'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
  }
  try {
    const link = searchParams.get('link')
    if (link) {
      const parsed = new URL(link)
      if (parsed.protocol !== 'https:' || !['www.jw.org', 'jw.org'].includes(parsed.hostname)) return Response.json({ error: 'Usa un collegamento HTTPS di JW.org.' }, { status: 400 })
      const naturalKey = parsed.searchParams.get('lank') || parsed.hash.split('/').filter(Boolean).at(-1) || ''
      if (naturalKey && /^[\w-]+$/.test(naturalKey)) {
        const tracks = await allVideoTracks()
        const track = tracks.find(item => new URL(item.source).searchParams.get('lank') === naturalKey)
        if (track) return Response.json({ track }, { headers })
      }
      return Response.json({ article: parsed.href }, { headers })
    }
    if (searchParams.get('latest') === '1') {
      const result = await articleTracks('/it/biblioteca-digitale/novita/', offset, '', 'Novità JW.org')
      return Response.json(result, result.failed ? {} : { headers })
    }
    if (browse && (kind === 'articles' || kind === 'videos') && !topic && !query) {
      return Response.json(await browseSections(kind), { headers })
    }
    if (kind === 'videos' && query && !topic) {
      // Search every VOD category for titles in one pass, then page through subtitles.
      const catalog = await allVideoTracks()
      const filtered = await filterVideosByQuery(catalog, query, offset)
      return Response.json(
        {
          tracks: filtered.tracks,
          pending: [],
          failed: 0,
          next: filtered.nextSubtitlePage,
        },
        { headers },
      )
    }
    if (kind === 'articles' && query && !topic) {
      const topics = await articleTopics()
      // Skip individual book topics here: books are searched together on the first page.
      const searchable = topics.filter(
        (item) => !(item.id.startsWith('pub:') && isCatalogPub(item.id.slice(4)) && item.id !== 'pub:mrt'),
      )
      // Larger batches so title search reaches HTML catalogs (e.g. Cybercrime) in one hop.
      const batchSize = 8
      const group = Math.floor(offset / 1024) * batchSize
      const page = offset % 1024
      const batch = searchable.slice(group, group + batchSize)
      const results = await Promise.allSettled([
        ...batch.map(async ({ id, name }) => {
          if (id.startsWith('pub:')) {
            const result = await pubTracks(id.slice(4), query, page * 24, name)
            return { ...result, more: result.next !== null }
          }
          const result = await articleTracks(id, page * 12, query, name)
          return { ...result, more: result.next !== null }
        }),
        // Always scan book MP3 catalogs on the first hop so chapters like wcg §17 appear.
        ...(group === 0 && page === 0 ? [searchBookAudio(query)] : []),
      ])
      const available = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      const failed =
        results.length -
        available.length +
        available.reduce((sum, result) => sum + result.failed, 0)
      const tracks = [
        ...new Map(
          available.flatMap((result) => result.tracks).map((track) => [track.id, track]),
        ).values(),
      ].sort((a, b) => {
        const rank = (track: LibraryTrack) =>
          track.matchIn === 'Nel titolo' ? 0 : track.matchIn === 'Nel testo' ? 1 : 2
        return rank(a) - rank(b) || a.title.localeCompare(b.title, 'it')
      })
      const pending = [
        ...new Map(
          available
            .flatMap((result) => result.pending || [])
            .map((item) => [item.id, item]),
        ).values(),
      ]
      return Response.json(
        {
          tracks,
          pending,
          failed,
          next:
            available.some((result) => result.more) && page < 1023
              ? offset + 1
              : group + batch.length < searchable.length
                ? (Math.floor(group / batchSize) + 1) * 1024
                : null,
        },
        failed ? {} : { headers },
      )
    }
    if (kind === 'articles') {
      if (!topic) return Response.json({ topics: await articleTopics() }, { headers })
      if (topic.startsWith('pub:')) {
        const pub = topic.slice(4)
        if (!isAllowedPub(pub)) return new Response(null, { status: 400 })
        const topicName =
          (await articleTopics()).find((item) => item.id === topic)?.name || pub
        const result = await pubTracks(pub, query, offset, topicName)
        return Response.json(result, result.failed ? {} : { headers })
      }
      if (
        !/^\/it\/(?:biblioteca-digitale\/articoli|cosa-dice-la-Bibbia)\/[\p{L}\d-]+\/$/u.test(
          topic,
        )
      ) {
        return new Response(null, { status: 400 })
      }
      const result = await articleTracks(topic, offset, query)
      return Response.json(result, result.failed ? {} : { headers })
    }
    if (kind === 'videos') {
      if (!topic) {
        const root = await category('VideoOnDemand')
        return Response.json(
          {
            topics:
              root.subcategories?.map(({ key, name }) => ({ id: key, name })) ?? [],
          },
          { headers },
        )
      }
      if (!/^VOD[A-Za-z]+$/.test(topic)) return new Response(null, { status: 400 })
      if (!query) {
        return Response.json(
          { tracks: await videoTracks(topic), pending: [], next: null },
          { headers },
        )
      }
      const filtered = await filterVideosByQuery(await videoTracks(topic), query, offset)
      return Response.json(
        {
          tracks: filtered.tracks,
          pending: [],
          next: filtered.nextSubtitlePage,
        },
        { headers },
      )
    }
    return new Response(null, { status: 400 })
  } catch {
    return Response.json(
      { error: 'Catalogo JW.org temporaneamente non disponibile.' },
      { status: 502 },
    )
  }
}
