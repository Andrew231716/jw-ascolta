export const config = { runtime: 'edge', maxDuration: 60 }

const site = 'https://www.jw.org'
const cdn = 'https://b.jw-cdn.org'
const articles = '/it/biblioteca-digitale/articoli/'
const bible = '/it/cosa-dice-la-Bibbia/'

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

function matches(haystack: string, query: string) {
  const text = normalizeQuery(haystack)
  const normalized = normalizeQuery(query)
  if (!normalized) return false
  if (text.includes(normalized)) return true
  const words = normalized.split(' ').filter(Boolean)
  return words.length > 0 && words.every((word) => text.includes(word))
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
  // Pubs with MP3 first, then HTML "Altri argomenti" (pending/TTS titles like Cybercrime),
  // then the remaining site sections.
  return [
    { id: 'pub:mrt', name: 'Altri argomenti (audio disponibili)' },
    { id: 'pub:w', name: 'Torre di Guardia — studio (audio)' },
    { id: 'pub:g', name: 'Svegliatevi! (audio)' },
    { id: 'pub:wp', name: 'Torre di Guardia — pubblica (audio)' },
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

async function filterVideosByQuery(tracks: LibraryTrack[], query: string) {
  if (!query) return tracks
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
  // Cap subtitle fetches per request to stay within Edge time limits.
  const slice = maybeSub.slice(0, 18)
  const deep = await Promise.allSettled(
    slice.map(async (track) => {
      const hit = await subtitleMatches(track.subtitleUrl!, query)
      return hit ? ({ ...track, matchIn: 'Nei sottotitoli' } satisfies LibraryTrack) : null
    }),
  )
  const subHits = deep.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : [],
  )
  return [...titleHits, ...subHits]
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
    (item: { mimetype?: string; file?: { url?: string }; title?: string; duration?: number }) =>
      item.mimetype === 'audio/mpeg' && item.file?.url?.startsWith('https://'),
  )
  return file
    ? {
        title: String(file.title || ''),
        url: String(file.file.url),
        duration: Number(file.duration ?? 0),
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

async function pubTracks(
  pub: string,
  query: string,
  offset: number,
  topicName: string,
): Promise<{ tracks: LibraryTrack[]; pending: PendingItem[]; next: number | null; failed: number }> {
  if (pub === 'mrt') {
    const params = new URLSearchParams({
      output: 'json',
      pub: 'mrt',
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
    }> = data.files?.I?.MP3 ?? []
    files = files.filter(
      (item) =>
        item.mimetype === 'audio/mpeg' &&
        item.file?.url?.startsWith('https://') &&
        (!query || matches(String(item.title || ''), query)),
    )
    const slice = files.slice(offset, offset + 24)
    return {
      tracks: slice.map((item, index) => ({
        id:
          'pub-mrt-' +
          (item.docid || item.track || 'x') +
          '-' +
          (item.track || index),
        title: String(item.title || 'Articolo'),
        url: String(item.file!.url),
        duration: Number(item.duration ?? 0),
        topics: [topicName],
        source: site + articles + 'altri-argomenti/',
      })),
      pending: [],
      next: offset + slice.length < files.length ? offset + slice.length : null,
      failed: 0,
    }
  }

  // Magazines: probe recent issues
  const issues = recentIssues(pub === 'g' || pub === 'wp' ? 18 : 12)
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
            file?: { url?: string }
          }): LibraryTrack => ({
            id: `pub-${pub}-${issue}-${item.track || item.title}`,
            title: String(item.title || `${pub} ${issue}`),
            url: String(item.file!.url),
            duration: Number(item.duration ?? 0),
            topics: [topicName, String(data.formattedDate || issue)],
            source: site + '/it/biblioteca-digitale/riviste/',
          }),
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
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return new Response(null, { status: 400 })
  }
  const headers = {
    'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
  }
  try {
    if ((kind === 'articles' || kind === 'videos') && query && !topic) {
      const topics =
        kind === 'articles'
          ? await articleTopics()
          : ((await category('VideoOnDemand')).subcategories?.map(({ key, name }) => ({
              id: key,
              name,
            })) ?? [])
      // Larger batches so title search reaches HTML catalogs (e.g. Cybercrime) in one hop.
      const batchSize = kind === 'articles' ? 8 : 4
      const group = Math.floor(offset / 1024) * batchSize
      const page = offset % 1024
      const batch = topics.slice(group, group + batchSize)
      const results = await Promise.allSettled(
        batch.map(async ({ id, name }) => {
          if (kind === 'articles') {
            if (id.startsWith('pub:')) {
              const result = await pubTracks(id.slice(4), query, page * 24, name)
              return { ...result, more: result.next !== null }
            }
            const result = await articleTracks(id, page * 12, query, name)
            return { ...result, more: result.next !== null }
          }
          return {
            tracks: await filterVideosByQuery(await videoTracks(id), query),
            pending: [] as PendingItem[],
            failed: 0,
            more: false,
          }
        }),
      )
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
      ]
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
              : group + batch.length < topics.length
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
        if (!/^(mrt|w|g|wp)$/.test(pub)) return new Response(null, { status: 400 })
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
      return Response.json(
        {
          tracks: query
            ? await filterVideosByQuery(await videoTracks(topic), query)
            : await videoTracks(topic),
          pending: [],
          next: null,
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
