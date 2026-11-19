import { audioKey, cachedGeneration } from './generatedAudio.ts'
// The sample stays on this device until the user starts personal narration.
const key = 'jw-ascolta.personal-voice.v1'
const origin = 'https://resembleai-chatterbox-multilingual-tts.hf.space'
const api = origin + '/gradio_api'

// Keep optional Hugging Face credentials in memory for this page only.
let sessionToken = ''
export function setPersonalVoiceToken(value: string) {
  sessionToken = value.trim()
}
export function hasPersonalVoiceToken() {
  return Boolean(sessionToken)
}

export function generationResult(events: string, eventId: string) {
  for (const line of events.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const event = JSON.parse(line.slice(5))
    if (event.event_id !== eventId || event.msg !== 'process_completed') continue
    if (event.success && event.output?.data?.[0]) return event.output.data[0]
    const error = String(event.output?.error || event.title || '')
    if (/quota|runs limit/i.test(error)) {
      throw new Error('Quota Chatterbox esaurita. Attendi il rinnovo oppure usa un account Hugging Face con quota disponibile.')
    }
    throw new Error('Chatterbox non ha potuto generare la frase. La posizione è disponibile per il prossimo tentativo.')
  }
  throw new Error('Collegamento a Chatterbox interrotto prima della risposta.')
}

export function hasVoiceSample() {
  try { return Boolean(localStorage.getItem(key)) } catch { return false }
}

export function forgetVoiceSample() {
  localStorage.removeItem(key)
  void caches.open('jw-ascolta-voice-v1').then(cache => cache.delete('/__voice/sample')).catch(() => {})
}

export async function saveVoiceSample(file: File) {
  if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('Scegli un breve memo audio entro 2 MB.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Impossibile leggere il memo.'))
    reader.readAsDataURL(file)
  })
  if (!/^(audio|video)\//.test(file.type) && !/\.(wav|mp3|m4a|ogg|webm|aac)$/i.test(file.name)) throw new Error('Scegli un file audio.')
  const cache = await caches.open('jw-ascolta-voice-v1')
  await cache.put('/__voice/sample', new Response(JSON.stringify({ data, name: file.name })))
  localStorage.setItem(key, JSON.stringify({ name: file.name, cached: true }))
  void navigator.storage?.persist?.().catch(() => {})
}

export function personalRenderer(signal: AbortSignal) {
  const token = sessionToken
  let functionIndex: number | undefined
  let uploaded: string | undefined
  let sampleHash: Promise<string> | undefined
  let sample: Promise<{ data: string; name: string }> | undefined
  const readSample = () => sample ||= (async () => {
    const stored = localStorage.getItem(key)
    if (!stored) throw new Error('Seleziona prima il tuo memo vocale.')
    const metadata = JSON.parse(stored)
    if (metadata.data) return metadata
    const saved = await (await caches.open('jw-ascolta-voice-v1')).match('/__voice/sample')
    if (!saved) throw new Error('Il memo non è più sul dispositivo. Selezionalo di nuovo.')
    return saved.json()
  })()
  return async (text: string) => {
    const { data, name } = await readSample()
    sampleHash ||= audioKey([data])
    const cacheKey = await audioKey(['personal', await sampleHash, text])
    return cachedGeneration(cacheKey, async () => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(180000)])
    const request = async (url: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers)
      if (token) headers.set('Authorization', 'Bearer ' + token)
      const response = await fetch(url, { ...options, headers, signal: requestSignal })
      if (response.status === 401 || response.status === 403) throw new Error('Hugging Face ha rifiutato l’accesso. Controlla il token inserito.')
      if (!response.ok) throw new Error('Chatterbox non disponibile o quota esaurita. Riprova più tardi o scegli Isabella.')
      return response
    }
    if (!uploaded) {
      const form = new FormData()
      form.append('files', await (await fetch(data)).blob(), name)
      const paths = await (await request(api + '/upload', { method: 'POST', body: form })).json()
      uploaded = paths[0]
      if (!uploaded) throw new Error('Chatterbox non ha ricevuto il memo.')
    }
    if (functionIndex === undefined) {
      const config = await (await request(origin + '/config')).json()
      functionIndex = config.dependencies.find((d: { api_name: string }) => d.api_name === 'generate_tts_audio')?.id
      if (typeof functionIndex !== 'number') throw new Error('Funzione di lettura Chatterbox non disponibile.')
    }
    const session = crypto.randomUUID()
    const job = await (await request(api + '/queue/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fn_index: functionIndex, session_hash: session,
        data: [text, 'it', { path: uploaded, meta: { _type: 'gradio.FileData' } }, 0.5, 0.8, 0, 0.5] }),
    })).json()
    if (!job.event_id) throw new Error('Chatterbox non ha accettato la richiesta.')
    const eventResponse = await request(api + '/queue/data?session_hash=' + session)
    const reader = eventResponse.body?.getReader()
    if (!reader) throw new Error('Collegamento Chatterbox non disponibile.')
    const decoder = new TextDecoder()
    let pending = ''
    let result
    try {
      while (!result) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Chatterbox ha chiuso il collegamento. Riprova dalla posizione salvata.')
        pending += decoder.decode(chunk.value, { stream: true })
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const event = JSON.parse(line.slice(5))
          if (event.event_id === job.event_id && event.msg === 'process_completed') {
            result = generationResult(line, job.event_id)
            break
          }
        }
      }
    } finally { await reader.cancel().catch(() => {}) }
    const url = new URL(result.url || api + '/file=' + result.path, origin)
    if (url.origin !== origin) throw new Error('Indirizzo audio inatteso.')
    return (await request(url.href)).blob()
    })
  }
}
