/** Voce narrativa neurale cloud (Isabella) — non quella del dispositivo. */

export type SpeechStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'error'
export type NarrationVoiceId = 'isabella' | 'elsa' | 'diego' | 'giuseppe'

export const NARRATION_VOICES: Array<{ id: NarrationVoiceId; label: string }> = [
  { id: 'isabella', label: 'Isabella (narrativa)' },
  { id: 'elsa', label: 'Elsa (chiara)' },
  { id: 'diego', label: 'Diego (maschile)' },
  { id: 'giuseppe', label: 'Giuseppe (multilingue)' },
]

export type SpeakHandle = {
  stop: () => void
  pause: () => void
  resume: () => void
}

/** Silent WAV — unlocks Web Audio autoplay during a user gesture. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

let primedAudio: HTMLAudioElement | null = null

function ensureAudioElement(): HTMLAudioElement {
  if (primedAudio) return primedAudio
  const el = new Audio()
  el.preload = 'auto'
  el.setAttribute('playsinline', 'true')
  el.setAttribute('webkit-playsinline', 'true')
  ;(el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
  primedAudio = el
  return el
}

/**
 * Call synchronously inside the click handler (before any await)
 * so Safari/Chrome keep the audio unlock across the TTS fetch.
 */
export function primeNarrationAudio(): void {
  const el = ensureAudioElement()
  try {
    el.muted = true
    el.src = SILENT_WAV
    const play = el.play()
    if (play && typeof play.then === 'function') {
      void play
        .then(() => {
          el.pause()
          el.muted = false
          el.removeAttribute('src')
          el.load()
        })
        .catch(() => {
          el.muted = false
        })
    }
  } catch {
    try {
      el.muted = false
    } catch {
      /* ignore */
    }
  }
}

function chunkText(text: string, maxLen = 1800): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= maxLen) return [clean]
  const parts: string[] = []
  let rest = clean
  while (rest.length > maxLen) {
    const slice = rest.slice(0, maxLen)
    const breakAt = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf('; '),
      slice.lastIndexOf(', '),
      slice.lastIndexOf(' '),
    )
    const cut = breakAt > maxLen * 0.35 ? breakAt + 1 : maxLen
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function fetchNeuralChunk(text: string, voice: NarrationVoiceId): Promise<Blob> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: string }
      detail = j.error || ''
    } catch {
      detail = await res.text()
    }
    throw new Error(detail || `TTS HTTP ${res.status}`)
  }
  return res.blob()
}

export async function speakArticle(
  text: string,
  opts: {
    title?: string
    voice?: NarrationVoiceId
    onStatus?: (status: SpeechStatus, detail?: string) => void
  } = {},
): Promise<SpeakHandle> {
  const { title, voice = 'isabella', onStatus } = opts
  const payload = [title, text].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim()
  const parts = chunkText(payload)
  if (!parts.length) {
    onStatus?.('error', 'Testo vuoto.')
    return { stop() {}, pause() {}, resume() {} }
  }

  let aborted = false
  const audioEl = ensureAudioElement()
  const objectUrls: string[] = []
  let playIndex = 0
  let chunkQueue: Blob[] = []
  let waitingGesture = false

  const revokeUrls = () => {
    for (const url of objectUrls) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
    objectUrls.length = 0
  }

  const detach = () => {
    try {
      audioEl.onended = null
      audioEl.onerror = null
      audioEl.pause()
      audioEl.removeAttribute('src')
      audioEl.load()
    } catch {
      /* ignore */
    }
  }

  const cleanup = () => {
    waitingGesture = false
    detach()
    revokeUrls()
    chunkQueue = []
    playIndex = 0
  }

  const playNext = () => {
    if (aborted) return
    if (playIndex >= chunkQueue.length) {
      cleanup()
      onStatus?.('idle')
      return
    }
    const url = URL.createObjectURL(chunkQueue[playIndex])
    objectUrls.push(url)
    audioEl.onended = () => {
      playIndex += 1
      playNext()
    }
    audioEl.onerror = () => {
      playIndex += 1
      playNext()
    }
    audioEl.muted = false
    audioEl.src = url
    void audioEl.play().then(
      () => {
        waitingGesture = false
        onStatus?.('speaking', voiceLabel(voice))
      },
      () => {
        // Keep audio ready; next tap on the button calls resume().
        waitingGesture = true
        onStatus?.('paused', 'Tocca di nuovo per ascoltare')
      },
    )
  }

  onStatus?.('loading', voiceLabel(voice))
  try {
    const blobs: Blob[] = []
    for (const part of parts) {
      if (aborted) return { stop() {}, pause() {}, resume() {} }
      blobs.push(await fetchNeuralChunk(part, voice))
    }
    if (aborted) return { stop() {}, pause() {}, resume() {} }
    chunkQueue = blobs
    playIndex = 0
    playNext()
  } catch (err) {
    cleanup()
    onStatus?.(
      'error',
      err instanceof Error ? err.message : 'Voce neurale non disponibile.',
    )
  }

  return {
    stop() {
      aborted = true
      cleanup()
      onStatus?.('idle')
    },
    pause() {
      if (audioEl && !audioEl.paused) {
        audioEl.pause()
        onStatus?.('paused', voiceLabel(voice))
      }
    },
    resume() {
      if (aborted) return
      if (waitingGesture || audioEl.paused) {
        void audioEl.play().then(
          () => {
            waitingGesture = false
            onStatus?.('speaking', voiceLabel(voice))
          },
          () => onStatus?.('paused', 'Tocca di nuovo per ascoltare'),
        )
      }
    },
  }
}

function voiceLabel(id: NarrationVoiceId): string {
  return NARRATION_VOICES.find((v) => v.id === id)?.label || id
}
