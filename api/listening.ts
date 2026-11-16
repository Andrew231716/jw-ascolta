export const config = { runtime: 'edge' }

const site = 'https://www.jw.org'
const cdn = 'https://b.jw-cdn.org'
const articles = '/it/biblioteca-digitale/articoli/'
const bible = '/it/cosa-dice-la-Bibbia/'

async function read(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) })
  if (!response.ok) throw new Error('Fonte JW.org non disponibile')
  return response
}

function label(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/&(?:amp|quot|nbsp|apos|#\d+);/g, (entity) => {
    if (entity.startsWith('&#')) return String.fromCharCode(Number(entity.slice(2, -1)))
    return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity] ?? entity
  }).trim()
}

function links(html: string) {
  return Array.from(html.matchAll(/<a\b[^>]*href="(\/it\/[^"#?]+\/)"[^>]*>([\s\S]*?)<\/a>/g), ([, path, title]) => ({ path, name: label(title) }))
}

async function articleTopics() {
  const html = await (await read(site + articles)).text()
  const topics = new Map<string, string>()
  for (const { path, name } of links(html)) {
    if (!name || name.length > 100) continue
    const root = path.startsWith(articles) ? articles : path.startsWith(bible) ? bible : ''
    if (root && /^[^/]+\/$/.test(path.slice(root.length)) && !topics.has(path)) topics.set(path, name)
  }
  return Array.from(topics, ([id, name]) => ({ id, name }))
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
    files?: Array<{ mimetype: string; frameHeight: number; progressiveDownloadURL: string; subtitles?: { url: string } }>
  }>
}

async function category(key: string): Promise<Category> {
  const data = await (await read(cdn + '/apis/mediator/v1/categories/I/' + key + '?detailed=1&clientType=www')).json()
  return data.category
}

async function videoTracks(key: string) {
  const root = await category(key)
  const seen = new Set<string>()
  const tracks: Array<{
    id: string; title: string; url: string; duration: number
    topics: string[]; description?: string; source: string
  }> = []
  function collect(node: Category, path: string[]) {
    const topics = [...path, node.name]
    for (const media of node.media ?? []) {
      if (seen.has(media.guid) || media.type !== 'video') continue
      const files = (media.files ?? []).filter((file) => file.mimetype === 'video/mp4' && file.progressiveDownloadURL)
      if (!files.some((file) => file.subtitles?.url) && key !== 'VODAudioDescriptions') continue
      const file = files.sort((a, b) => a.frameHeight - b.frameHeight)[0]
      if (!file) continue
      seen.add(media.guid)
      tracks.push({
        id: 'video-' + media.guid, title: media.title, url: file.progressiveDownloadURL,
        duration: media.duration, topics, description: media.description,
        source: site + '/finder?lank=' + encodeURIComponent(media.naturalKey) + '&wtlocale=I',
      })
    }
    for (const child of node.subcategories ?? []) collect(child, topics)
  }
  collect(root, [])
  return tracks
}

function matches(title: string, query: string) {
  const normalize = (value: string) => value.toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const text = normalize(title)
  return normalize(query).split(' ').every((word) => text.includes(word))
}

async function articleTracks(path: string, offset: number, query = '', name = '') {
  const html = await (await read(site + path)).text()
  const documentIds = new Map<string, string>()
  for (const match of html.matchAll(/<a\b[^>]*href="(\/it\/[^"#?]+\/)"[^>]*data-page-id="mid(\d+)"[^>]*>/g)) {
    if (match[1] !== path) documentIds.set(match[2], match[1])
  }
  const titles = new Map<string, string>()
  if (query) for (const link of links(html)) {
    if (link.name && matches(link.name, query)) titles.set(link.path, link.name)
  }
  const candidates = [...documentIds].filter(([, path]) => !query || titles.has(path))
  const batch = candidates.slice(offset, offset + 12)
  const results = await Promise.allSettled(batch.map(async ([id, permalink]) => {
    const params = new URLSearchParams({ docid: id, output: 'json', fileformat: 'MP3', alllangs: '0', track: '1', langwritten: 'I', txtCMSLang: 'I' })
    const response = await fetch(cdn + '/apis/pub-media/GETPUBMEDIALINKS?' + params, { signal: AbortSignal.timeout(8000) })
    if (response.status === 404) return null
    if (!response.ok) throw new Error('Audio non verificato')
    const data = await response.json()
    const file = data.files?.I?.MP3?.find((item: { mimetype?: string; file?: { url?: string } }) =>
      item.mimetype === 'audio/mpeg' && item.file?.url?.startsWith('https://'))
    return file ? {
      id: 'article-' + id, title: file.title, url: file.file.url,
      duration: file.duration ?? 0, source: site + permalink, topics: name ? [name] : [],
    } : null
  }))
  const failed = results.filter((result) => result.status === 'rejected').length
  return {
    tracks: results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []),
    next: offset + batch.length < candidates.length ? offset + batch.length : null,
    failed,
  }
}

export default async function handler(request: Request) {
  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind')
  const topic = searchParams.get('topic')
  const query = (searchParams.get('q') ?? '').trim().slice(0, 120)
  const offset = Number(searchParams.get('offset') ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0) return new Response(null, { status: 400 })
  const headers = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
  try {
    if ((kind === 'articles' || kind === 'videos') && query && !topic) {
      const topics = kind === 'articles' ? await articleTopics()
        : (await category('VideoOnDemand')).subcategories?.map(({ key, name }) => ({ id: key, name })) ?? []
      const group = Math.floor(offset / 1024) * 4
      const page = offset % 1024
      const batch = topics.slice(group, group + 4)
      const results = await Promise.allSettled(batch.map(async ({ id, name }) => {
        if (kind === 'articles') {
          const result = await articleTracks(id, page * 12, query, name)
          return { ...result, more: result.next !== null }
        }
        return { tracks: (await videoTracks(id)).filter((track) => matches(track.title, query)), failed: 0, more: false }
      }))
      const available = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      const failed = results.length - available.length + available.reduce((sum, result) => sum + result.failed, 0)
      const tracks = [...new Map(available.flatMap((result) => result.tracks).map((track) => [track.id, track])).values()]
      return Response.json({
        tracks, failed,
        next: available.some((result) => result.more) && page < 1023 ? offset + 1
          : group + batch.length < topics.length ? (group / 4 + 1) * 1024 : null,
      }, failed ? {} : { headers })
    }
    if (kind === 'articles') {
      if (!topic) return Response.json({ topics: await articleTopics() }, { headers })
      if (!/^\/it\/(?:biblioteca-digitale\/articoli|cosa-dice-la-Bibbia)\/[\p{L}\d-]+\/$/u.test(topic)) return new Response(null, { status: 400 })
      const result = await articleTracks(topic, offset, query)
      return Response.json(result, result.failed ? {} : { headers })
    }
    if (kind === 'videos') {
      if (!topic) {
        const root = await category('VideoOnDemand')
        return Response.json({ topics: root.subcategories?.map(({ key, name }) => ({ id: key, name })) ?? [] }, { headers })
      }
      if (!/^VOD[A-Za-z]+$/.test(topic)) return new Response(null, { status: 400 })
      return Response.json({ tracks: (await videoTracks(topic)).filter((track) => !query || matches(track.title, query)), next: null }, { headers })
    }
    return new Response(null, { status: 400 })
  } catch {
    return Response.json({ error: 'Catalogo JW.org temporaneamente non disponibile.' }, { status: 502 })
  }
}
