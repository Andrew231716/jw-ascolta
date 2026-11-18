// The sample stays on this device until the user starts personal narration.
const key = 'jw-ascolta.personal-voice.v1'
const origin = 'https://resembleai-chatterbox-multilingual-tts.hf.space'
const api = origin + '/gradio_api'

export function hasVoiceSample() {
  try { return Boolean(localStorage.getItem(key)) } catch { return false }
}

export function forgetVoiceSample() {
  localStorage.removeItem(key)
}

export async function saveVoiceSample(file: File) {
  if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('Scegli un breve memo audio entro 2 MB.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Impossibile leggere il memo.'))
    reader.readAsDataURL(file)
  })
  localStorage.setItem(key, JSON.stringify({ data, name: file.name }))
}

export function personalRenderer(signal: AbortSignal) {
  let uploaded: string | undefined
  return async (text: string) => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(180000)])
    const request = async (url: string, options?: RequestInit) => {
      const response = await fetch(url, { ...options, signal: requestSignal })
      if (!response.ok) throw new Error('Chatterbox non disponibile o quota esaurita. Riprova più tardi o scegli Isabella.')
      return response
    }
    if (!uploaded) {
      const stored = localStorage.getItem(key)
      if (!stored) throw new Error('Seleziona prima il tuo memo vocale.')
      const { data, name } = JSON.parse(stored)
      const form = new FormData()
      form.append('files', await (await fetch(data)).blob(), name)
      const paths = await (await request(api + '/upload', { method: 'POST', body: form })).json()
      uploaded = paths[0]
      if (!uploaded) throw new Error('Chatterbox non ha ricevuto il memo.')
    }
    const endpoint = api + '/call/generate_tts_audio'
    const job = await (await request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [text, 'it', { path: uploaded, meta: { _type: 'gradio.FileData' } }, 0.5, 0.8, 0, 0.5] }),
    })).json()
    const events = await (await request(endpoint + '/' + encodeURIComponent(job.event_id))).text()
    const complete = events.match(/event: complete\r?\ndata: ([^\r\n]+)/)
    if (!complete) throw new Error('La demo Chatterbox non ha generato la frase. Riprova più tardi o scegli Isabella.')
    const result = JSON.parse(complete[1])[0]
    const url = new URL(result.url || api + '/file=' + result.path, origin)
    if (url.origin !== origin) throw new Error('Indirizzo audio inatteso.')
    return (await request(url.href)).blob()
  }
}
