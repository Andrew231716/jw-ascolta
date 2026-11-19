export const config = { runtime: 'edge' }

const site = 'https://www.jw.org'

function decode(html: string) {
  return html
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:[a-z]+);/gi, ' ')
}

function strip(html: string) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function allowedPath(path: string) {
  return /^\/it\/(?:biblioteca-digitale\/(?:articoli|riviste|libri)|cosa-dice-la-Bibbia)\/[\p{L}\d%/._-]+\/?$/u.test(
    path,
  )
}

async function resolveDocid(docid: string): Promise<string | null> {
  if (!/^\d{6,12}$/.test(docid)) return null
  const response = await fetch(
    `${site}/finder?wtlocale=I&docid=${docid}&prefer=lang`,
    {
      signal: AbortSignal.timeout(12000),
      headers: { 'Accept-Language': 'it' },
      redirect: 'follow',
    },
  )
  if (!response.ok) return null
  try {
    const finalPath = new URL(response.url).pathname
    if (!allowedPath(finalPath.endsWith('/') ? finalPath : finalPath + '/')) return null
    return finalPath.endsWith('/') ? finalPath : finalPath + '/'
  } catch {
    return null
  }
}

function extractBodyHtml(html: string): string {
  const opening = /<div\b[^>]*\bclass=["'][^"']*\bbodyTxt\b[^"']*["'][^>]*>/i.exec(html)
  if (!opening) return html
  const start = opening.index + opening[0].length
  const tags = /<\/?div\b[^>]*>/gi
  tags.lastIndex = start
  let depth = 1
  let tag
  while ((tag = tags.exec(html))) {
    depth += tag[0][1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(start, tag.index)
  }
  return html.slice(start)
}

/** Paragraphs with JW MEPS ids (data-pid / id=pN) for audio marker sync. */
function extractParagraphs(html: string): Array<{ pid: number; text: string }> {
  const body = extractBodyHtml(html)
  const out: Array<{ pid: number; text: string }> = []
  for (const match of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attrs = match[1] || ''
    const pidMatch =
      attrs.match(/\bdata-pid=["']?(\d+)/i) || attrs.match(/\bid=["']p(\d+)/i)
    if (!pidMatch) continue
    const text = strip(match[2])
    if (!text) continue
    out.push({ pid: Number(pidMatch[1]), text })
  }
  return out
}

/**
 * Extracts readable Italian article text from JW.org for on-device TTS.
 * Query: path=/it/.../ or url=https://www.jw.org/it/... or docid=1102…
 */
export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  let path = (searchParams.get('path') || '').trim()
  const urlParam = (searchParams.get('url') || '').trim()
  const docid = (searchParams.get('docid') || '').trim()

  try {
    if (!path && docid) {
      const resolved = await resolveDocid(docid)
      if (!resolved) {
        return Response.json({ error: 'docid_not_found' }, { status: 404 })
      }
      path = resolved
    }

    if (!path && urlParam) {
      try {
        const parsed = new URL(urlParam)
        if (parsed.hostname !== 'www.jw.org' && parsed.hostname !== 'jw.org') {
          return Response.json({ error: 'host_not_allowed' }, { status: 400 })
        }
        const fromQuery = parsed.searchParams.get('docid')
        if (fromQuery && parsed.pathname.includes('finder')) {
          const resolved = await resolveDocid(fromQuery)
          if (!resolved) {
            return Response.json({ error: 'docid_not_found' }, { status: 404 })
          }
          path = resolved
        } else {
          path = parsed.pathname
        }
      } catch {
        return Response.json({ error: 'invalid_url' }, { status: 400 })
      }
    }

    if (!path.startsWith('/')) path = '/' + path
    if (!path.endsWith('/')) path += '/'
    if (!allowedPath(path)) {
      return Response.json({ error: 'path_not_allowed' }, { status: 400 })
    }

    const response = await fetch(site + path, {
      signal: AbortSignal.timeout(12000),
      headers: { 'Accept-Language': 'it' },
    })
    if (!response.ok) {
      return Response.json({ error: 'fetch_failed' }, { status: 502 })
    }
    const html = await response.text()
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    const title = titleMatch ? strip(titleMatch[1]) : ''

    const paragraphs = extractParagraphs(html)
    let body = paragraphs.map((item) => item.text).join('\n\n')
    if (!body) {
      const opening = /<div\b[^>]*\bclass=["'][^"']*\bbodyTxt\b[^"']*["'][^>]*>/i.exec(html)
      if (opening) {
        const start = opening.index + opening[0].length
        const tags = /<\/?div\b[^>]*>/gi
        tags.lastIndex = start
        let depth = 1
        let tag
        while ((tag = tags.exec(html))) {
          depth += tag[0][1] === '/' ? -1 : 1
          if (depth === 0) {
            body = strip(html.slice(start, tag.index))
            break
          }
        }
      }
    }
    if (!body) {
      body = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (m) => strip(m[1]))
        .filter(Boolean)
        .join('\n\n')
    }

    if (!title && !body) {
      return Response.json({ error: 'empty' }, { status: 404 })
    }

    let audio: { url: string; duration: number } | undefined
    const pageDocid = html.match(/data-page-id=["']mid(\d+)/i)?.[1]
    if (searchParams.get('audio') === '1' && pageDocid) {
      try {
        const params = new URLSearchParams({ docid: pageDocid, output: 'json', fileformat: 'MP3', alllangs: '0', langwritten: 'I', txtCMSLang: 'I' })
        const response = await fetch('https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?' + params, { signal: AbortSignal.timeout(8000) })
        const data = response.ok ? await response.json() : {}
        const file = data.files?.I?.MP3?.find((item: { mimetype: string; file?: { url: string } }) => item.mimetype === 'audio/mpeg' && item.file?.url?.startsWith('https://'))
        if (file) audio = { url: file.file.url, duration: Number(file.duration || 0) }
      } catch { /* Text remains readable if audio verification is unavailable. */ }
    }
    return Response.json(
      {
        title,
        audio,
        text: body,
        paragraphs,
        source: site + path,
        truncated: false,
        chars: body.length,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      },
    )
  } catch {
    return Response.json({ error: 'article_text_failed' }, { status: 502 })
  }
}
