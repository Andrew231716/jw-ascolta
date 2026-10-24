export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  const incoming = new URL(req.url)
  const title = incoming.searchParams.get('title') || ''
  if (!title.trim()) {
    return new Response('missing title', { status: 400 })
  }

  const resolveUrl = new URL('/api/resolve', incoming.origin)
  resolveUrl.searchParams.set('title', title)
  const res = await fetch(resolveUrl.toString())
  if (!res.ok) {
    return new Response('brano non trovato', { status: 404 })
  }
  const data = (await res.json()) as { audioUrl?: string }
  if (!data.audioUrl) {
    return new Response('brano non trovato', { status: 404 })
  }
  return Response.redirect(data.audioUrl, 302)
}
