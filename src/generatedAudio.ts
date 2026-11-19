const CACHE = 'jw-ascolta-generated-v1'
export async function audioKey(parts: string[]) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return location.origin + '/__generated-audio/' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function cachedGeneration(key: string, generate: () => Promise<Blob>) {
  const cache = await caches.open(CACHE).catch(() => null)
  const saved = await cache?.match(key)
  if (saved) return saved.blob()
  if (!navigator.onLine) throw new Error('Questa parte della lettura richiede Internet. Gli audio già generati restano disponibili offline.')
  const blob = await generate()
  if (cache) {
    await cache.put(key, new Response(blob)).catch(() => {})
    const entries = await cache.keys()
    // Bound generated clips while keeping the latest reading sessions.
    for (const entry of entries.slice(0, Math.max(0, entries.length - 100))) await cache.delete(entry)
  }
  return blob
}
export async function clearGeneratedAudio() {
  await caches.delete(CACHE)
}
