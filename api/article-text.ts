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
  return /^\/it\/(?:biblioteca-digitale\/(?:articoli|riviste)|cosa-dice-la-Bibbia)\/[\p{L}\d%/._-]+\/?$/u.test(
    path,
  )
}

/**
 * Extracts readable Italian article text from JW.org for on-device TTS.
 * Query: path=/it/.../ or url=https://www.jw.org/it/...
 */
export default async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  let path = (searchParams.get('path') || '').trim()
  const urlParam = (searchParams.get('url') || '').trim()

  if (!path && urlParam) {
    try {
      const parsed = new URL(urlParam)
      if (parsed.hostname !== 'www.jw.org' && parsed.hostname !== 'jw.org') {
        return Response.json({ error: 'host_not_allowed' }, { status: 400 })
      }
      path = parsed.pathname
    } catch {
      return Response.json({ error: 'invalid_url' }, { status: 400 })
    }
  }

  if (!path.startsWith('/')) path = '/' + path
  if (!path.endsWith('/')) path += '/'
  if (!allowedPath(path)) {
    return Response.json({ error: 'path_not_allowed' }, { status: 400 })
  }

  try {
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

    let body = ''
    const bodyMatch = html.match(
      /<div class="bodyTxt">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
    )
    if (bodyMatch) body = strip(bodyMatch[1])
    if (!body) {
      const paragraphs = Array.from(
        html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi),
        (m) => strip(m[1]),
      ).filter(Boolean)
      body = paragraphs.join('\n\n')
    }

    if (!title && !body) {
      return Response.json({ error: 'empty' }, { status: 404 })
    }

    return Response.json(
      {
        title,
        text: body,
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
