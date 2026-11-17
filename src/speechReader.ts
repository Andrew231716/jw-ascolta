export type SpeechStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'error'

function chunkText(text: string, maxLen = 180): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const sentences = cleaned.split(/(?<=[.!?…:;])\s+/)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (!sentence) continue
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim()
    } else {
      if (current) chunks.push(current)
      if (sentence.length <= maxLen) current = sentence
      else {
        for (let i = 0; i < sentence.length; i += maxLen) {
          chunks.push(sentence.slice(i, i + maxLen))
        }
        current = ''
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function pickItalianVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const it = voices.filter((v) => /^it([-_]|$)/i.test(v.lang) || /italian|italiano/i.test(v.name))
  if (!it.length) return null
  const preferred = [
    /neural/i,
    /enhanced/i,
    /premium/i,
    /natural/i,
    /google/i,
    /siri/i,
    /alice/i,
    /eddy/i,
    /flo/i,
    /reed/i,
    /sandy/i,
    /shelley/i,
    /microsoft.*(elsa|diego|elsa)/i,
  ]
  for (const pattern of preferred) {
    const hit = it.find((v) => pattern.test(v.name))
    if (hit) return hit
  }
  return it.find((v) => v.localService) || it[0]
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([])
  }
  const existing = window.speechSynthesis.getVoices()
  if (existing.length) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    // Safari sometimes never fires voiceschanged if already ready
    window.setTimeout(() => resolve(window.speechSynthesis.getVoices()), 700)
  })
}

export type SpeakHandle = {
  stop: () => void
  pause: () => void
  resume: () => void
}

export async function speakArticle(
  text: string,
  opts: {
    title?: string
    rate?: number
    onStatus?: (status: SpeechStatus, detail?: string) => void
  } = {},
): Promise<SpeakHandle> {
  const { title, rate = 0.95, onStatus } = opts
  if (!('speechSynthesis' in window)) {
    onStatus?.('error', 'Questo dispositivo non supporta la lettura vocale.')
    return { stop() {}, pause() {}, resume() {} }
  }

  window.speechSynthesis.cancel()
  const voices = await loadVoices()
  const voice = pickItalianVoice(voices)
  const payload = [title, text].filter(Boolean).join('. ')
  const parts = chunkText(payload)
  if (!parts.length) {
    onStatus?.('error', 'Testo vuoto.')
    return { stop() {}, pause() {}, resume() {} }
  }

  let index = 0
  let stopped = false

  const speakNext = () => {
    if (stopped) return
    if (index >= parts.length) {
      onStatus?.('idle')
      return
    }
    const utter = new SpeechSynthesisUtterance(parts[index])
    utter.lang = voice?.lang || 'it-IT'
    if (voice) utter.voice = voice
    utter.rate = rate
    utter.pitch = 1
    utter.onstart = () => onStatus?.('speaking', voice?.name)
    utter.onend = () => {
      index += 1
      speakNext()
    }
    utter.onerror = () => {
      if (stopped) return
      onStatus?.('error', 'Lettura interrotta.')
    }
    window.speechSynthesis.speak(utter)
  }

  onStatus?.('speaking', voice?.name || 'it-IT')
  speakNext()

  return {
    stop() {
      stopped = true
      window.speechSynthesis.cancel()
      onStatus?.('idle')
    },
    pause() {
      window.speechSynthesis.pause()
      onStatus?.('paused')
    },
    resume() {
      window.speechSynthesis.resume()
      onStatus?.('speaking', voice?.name)
    },
  }
}
