export const config = { runtime: 'edge', maxDuration: 60 }

/** Stream public JW media through the app so browser CORS cannot block saving it. */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 })
  try {
    let url = new URL(new URL(request.url).searchParams.get('url') || '')
    const allowed = (candidate: URL) => candidate.protocol === 'https:' && !candidate.username && !candidate.password &&
      !candidate.port && (candidate.hostname === 'jw-cdn.org' || candidate.hostname.endsWith('.jw-cdn.org'))
    if (!allowed(url)) return Response.json({ error: 'Sorgente audio non consentita.' }, { status: 400 })
    let response: Response | undefined
    for (let redirects = 0; redirects < 4; redirects++) {
      response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(50000)]) })
      if (response.status < 300 || response.status >= 400) break
      const location = response.headers.get('Location')
      await response.body?.cancel()
      if (!location) return new Response(null, { status: 502 })
      url = new URL(location, url)
      if (!allowed(url)) return new Response(null, { status: 400 })
    }
    if (!response?.ok) return Response.json({ error: 'File JW.org non disponibile. Riprova.' }, { status: 502 })
    const type = response.headers.get('Content-Type') || ''
    const size = Number(response.headers.get('Content-Length') || 0)
    if (!/^(audio|video)\//i.test(type) || size > 150 * 1024 * 1024) {
      await response.body?.cancel()
      return Response.json({ error: 'Formato o dimensione del file non supportati.' }, { status: 400 })
    }
    return new Response(response.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } })
  } catch {
    return Response.json({ error: 'Download interrotto. Controlla la connessione e riprova.' }, { status: 502 })
  }
}
