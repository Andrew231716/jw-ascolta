/** Voce narrativa neurale cloud — non quella del dispositivo. */

export type SpeechStatus =
  | 'idle'
  | 'loading'
  | 'speaking'
  | 'paused'
  | 'error'
  | 'completed'
export type NarrationVoiceId = 'isabella' | 'elsa' | 'diego' | 'giuseppe'
export type NarrationRate = '-15%' | '-8%' | '+0%' | '+10%'

export const NARRATION_VOICES: Array<{ id: NarrationVoiceId; label: string }> = [
  { id: 'isabella', label: 'Isabella (narrativa)' },
  { id: 'elsa', label: 'Elsa (chiara)' },
  { id: 'diego', label: 'Diego (maschile)' },
  { id: 'giuseppe', label: 'Giuseppe (multilingue)' },
]

export const NARRATION_RATES: Array<{ id: NarrationRate; label: string }> = [
  { id: '-15%', label: 'Più lenta' },
  { id: '-8%', label: 'Narrativa' },
  { id: '+0%', label: 'Normale' },
  { id: '+10%', label: 'Più veloce' },
]

export type SpeakProgress = {
  sentenceIndex: number
  wordIndex: number
  queueIndex: number
  queueLength: number
}

export type SpeakHandle = {
  stop: (opts?: { completed?: boolean }) => void
  pause: () => void
  resume: () => void
  getProgress: () => SpeakProgress | null
}

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
  el.style.display = 'none'
  try {
    document.body.appendChild(el)
  } catch {
    /* ignore SSR / early */
  }
  primedAudio = el
  return el
}

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

async function fetchNeuralChunk(
  text: string,
  voice: NarrationVoiceId,
  rate: NarrationRate,
): Promise<Blob> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate }),
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

function voiceLabel(id: NarrationVoiceId): string {
  return NARRATION_VOICES.find((v) => v.id === id)?.label || id
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export async function speakSentences(
  texts: string[],
  opts: {
    sentenceIndexes: number[]
    firstWordOffset?: number
    voice?: NarrationVoiceId
    rate?: NarrationRate
    onStatus?: (status: SpeechStatus, detail?: string) => void
    onProgress?: (progress: SpeakProgress) => void
    onChunkReady?: (blob: Blob, queueIndex: number) => void
  },
): Promise<SpeakHandle> {
  const {
    sentenceIndexes,
    firstWordOffset = 0,
    voice = 'isabella',
    rate = '-8%',
    onStatus,
    onProgress,
    onChunkReady,
  } = opts

  const queue = texts
    .map((text, i) => ({
      text: text.replace(/\s+/g, ' ').trim(),
      sentenceIndex: sentenceIndexes[i] ?? i,
    }))
    .filter((item) => item.text)

  if (!queue.length) {
    onStatus?.('error', 'Testo vuoto.')
    return { stop() {}, pause() {}, resume() {}, getProgress: () => null }
  }

  let aborted = false
  let pausedGate: Promise<void> | null = null
  let resumeGate: (() => void) | null = null
  const audioEl = ensureAudioElement()
  let currentUrl: string | null = null
  let playIndex = 0
  let currentWord = firstWordOffset
  let finished = false

  const progressNow = (): SpeakProgress | null => {
    if (finished || !queue.length || playIndex >= queue.length) return null
    return {
      sentenceIndex: queue[playIndex].sentenceIndex,
      wordIndex: currentWord,
      queueIndex: playIndex,
      queueLength: queue.length,
    }
  }

  const emitProgress = () => {
    const p = progressNow()
    if (p) onProgress?.(p)
  }

  const revokeCurrent = () => {
    if (!currentUrl) return
    try {
      URL.revokeObjectURL(currentUrl)
    } catch {
      /* ignore */
    }
    currentUrl = null
  }

  const detach = () => {
    try {
      audioEl.onended = null
      audioEl.onerror = null
      audioEl.ontimeupdate = null
      audioEl.pause()
      audioEl.removeAttribute('src')
      audioEl.load()
    } catch {
      /* ignore */
    }
    revokeCurrent()
  }

  const cleanup = () => {
    if (resumeGate) {
      resumeGate()
      resumeGate = null
      pausedGate = null
    }
    detach()
    playIndex = 0
    currentWord = 0
  }

  const waitIfPaused = async () => {
    while (pausedGate && !aborted) {
      await pausedGate
    }
  }

  const playBlob = (blob: Blob, wordsInClip: number, wordBase: number) =>
    new Promise<'ok' | 'error'>((resolve) => {
      if (aborted) {
        resolve('ok')
        return
      }
      revokeCurrent()
      const url = URL.createObjectURL(blob)
      currentUrl = url
      currentWord = wordBase
      emitProgress()

      let settled = false
      const done = (result: 'ok' | 'error') => {
        if (settled) return
        settled = true
        window.clearInterval(abortWatch)
        audioEl.onended = null
        audioEl.onerror = null
        audioEl.ontimeupdate = null
        resolve(result)
      }

      const abortWatch = window.setInterval(() => {
        if (aborted) done('ok')
      }, 120)

      audioEl.ontimeupdate = () => {
        if (!audioEl.duration || !Number.isFinite(audioEl.duration)) return
        const ratio = Math.min(1, Math.max(0, audioEl.currentTime / audioEl.duration))
        const local = Math.min(wordsInClip - 1, Math.floor(ratio * wordsInClip))
        currentWord = wordBase + local
        emitProgress()
      }
      audioEl.onended = () => done('ok')
      audioEl.onerror = () => done('error')
      audioEl.muted = false
      audioEl.src = url

      void audioEl.play().then(
        () => {
          onStatus?.('speaking', voiceLabel(voice))
          emitProgress()
        },
        () => {
          onStatus?.('paused', 'Tocca di nuovo per ascoltare')
          emitProgress()
        },
      )
    })

  onStatus?.('loading', voiceLabel(voice))

  const run = async () => {
    try {
      let prefetch: Promise<Blob> | null = fetchNeuralChunk(queue[0].text, voice, rate)

      for (let i = 0; i < queue.length; i += 1) {
        if (aborted) return
        playIndex = i
        currentWord = i === 0 ? firstWordOffset : 0
        emitProgress()

        const blob = await (prefetch ?? fetchNeuralChunk(queue[i].text, voice, rate))
        prefetch = null
        if (aborted) return
        onChunkReady?.(blob, i)

        if (i + 1 < queue.length) {
          prefetch = fetchNeuralChunk(queue[i + 1].text, voice, rate)
        }

        await waitIfPaused()
        if (aborted) return

        const wordsInClip = countWords(queue[i].text) || 1
        const wordBase = i === 0 ? firstWordOffset : 0
        const result = await playBlob(blob, wordsInClip, wordBase)
        if (aborted) return
        if (result === 'error') {
          onStatus?.('error', 'Errore audio su questa frase. Riprova o salta avanti.')
          return
        }
        await waitIfPaused()
        if (aborted) return
      }

      if (!aborted) {
        finished = true
        cleanup()
        onStatus?.('completed')
      }
    } catch (err) {
      if (aborted) return
      cleanup()
      onStatus?.(
        'error',
        err instanceof Error ? err.message : 'Voce neurale non disponibile.',
      )
    }
  }

  void run()

  return {
    stop(opts) {
      aborted = true
      finished = true
      cleanup()
      onStatus?.(opts?.completed ? 'completed' : 'idle')
    },
    pause() {
      if (!audioEl.paused) audioEl.pause()
      if (!pausedGate) {
        pausedGate = new Promise<void>((resolve) => {
          resumeGate = resolve
        })
      }
      onStatus?.('paused', voiceLabel(voice))
      emitProgress()
    },
    resume() {
      if (aborted) return
      if (resumeGate) {
        resumeGate()
        resumeGate = null
        pausedGate = null
      }
      void audioEl.play().then(
        () => {
          onStatus?.('speaking', voiceLabel(voice))
          emitProgress()
        },
        () => onStatus?.('paused', 'Tocca di nuovo per ascoltare'),
      )
    },
    getProgress: () => progressNow(),
  }
}

export async function speakArticle(
  text: string,
  opts: {
    title?: string
    voice?: NarrationVoiceId
    rate?: NarrationRate
    onStatus?: (status: SpeechStatus, detail?: string) => void
  } = {},
): Promise<SpeakHandle> {
  const payload = [opts.title, text].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim()
  return speakSentences([payload], {
    sentenceIndexes: [0],
    voice: opts.voice,
    rate: opts.rate,
    onStatus: opts.onStatus,
  })
}
