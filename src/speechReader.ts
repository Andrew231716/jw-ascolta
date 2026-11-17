/** Voce narrativa neurale cloud (Isabella) — non quella del dispositivo. */

export type SpeechStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'error'
export type NarrationVoiceId = 'isabella' | 'elsa' | 'diego' | 'giuseppe'

export const NARRATION_VOICES: Array<{ id: NarrationVoiceId; label: string }> = [
  { id: 'isabella', label: 'Isabella (narrativa)' },
  { id: 'elsa', label: 'Elsa (chiara)' },
  { id: 'diego', label: 'Diego (maschile)' },
  { id: 'giuseppe', label: 'Giuseppe (multilingue)' },
]

export type SpeakProgress = {
  /** Absolute sentence index in the article. */
  sentenceIndex: number
  /** Word index within that sentence. */
  wordIndex: number
  /** Index within the current play queue (0-based). */
  queueIndex: number
  queueLength: number
}

export type SpeakHandle = {
  stop: () => void
  pause: () => void
  resume: () => void
  getProgress: () => SpeakProgress | null
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

function voiceLabel(id: NarrationVoiceId): string {
  return NARRATION_VOICES.find((v) => v.id === id)?.label || id
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Speaks sentence texts one-by-one (fetch → play → prefetch next).
 * `sentenceIndexes[i]` maps queue item i → absolute article sentence index.
 */
export async function speakSentences(
  texts: string[],
  opts: {
    sentenceIndexes: number[]
    firstWordOffset?: number
    voice?: NarrationVoiceId
    onStatus?: (status: SpeechStatus, detail?: string) => void
    onProgress?: (progress: SpeakProgress) => void
  },
): Promise<SpeakHandle> {
  const {
    sentenceIndexes,
    firstWordOffset = 0,
    voice = 'isabella',
    onStatus,
    onProgress,
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
  const objectUrls: string[] = []
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
      audioEl.ontimeupdate = null
      audioEl.pause()
      audioEl.removeAttribute('src')
      audioEl.load()
    } catch {
      /* ignore */
    }
  }

  const cleanup = () => {
    if (resumeGate) {
      resumeGate()
      resumeGate = null
      pausedGate = null
    }
    detach()
    revokeUrls()
    playIndex = 0
    currentWord = 0
  }

  const waitIfPaused = async () => {
    while (pausedGate && !aborted) {
      await pausedGate
    }
  }

  const playBlob = (blob: Blob, wordsInClip: number, wordBase: number) =>
    new Promise<void>((resolve) => {
      if (aborted) {
        resolve()
        return
      }
      const url = URL.createObjectURL(blob)
      objectUrls.push(url)
      currentWord = wordBase
      emitProgress()

      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        window.clearInterval(abortWatch)
        audioEl.onended = null
        audioEl.onerror = null
        audioEl.ontimeupdate = null
        resolve()
      }

      const abortWatch = window.setInterval(() => {
        if (aborted) done()
      }, 120)

      audioEl.ontimeupdate = () => {
        if (!audioEl.duration || !Number.isFinite(audioEl.duration)) return
        const ratio = Math.min(1, Math.max(0, audioEl.currentTime / audioEl.duration))
        const local = Math.min(wordsInClip - 1, Math.floor(ratio * wordsInClip))
        currentWord = wordBase + local
        emitProgress()
      }
      audioEl.onended = () => done()
      audioEl.onerror = () => done()
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
      let prefetch: Promise<Blob> | null = fetchNeuralChunk(queue[0].text, voice)

      for (let i = 0; i < queue.length; i += 1) {
        if (aborted) return
        playIndex = i
        currentWord = i === 0 ? firstWordOffset : 0
        emitProgress()

        const blob = await (prefetch ?? fetchNeuralChunk(queue[i].text, voice))
        prefetch = null
        if (aborted) return

        // Prefetch next while current plays.
        if (i + 1 < queue.length) {
          prefetch = fetchNeuralChunk(queue[i + 1].text, voice)
        }

        await waitIfPaused()
        if (aborted) return

        const wordsInClip = countWords(queue[i].text) || 1
        const wordBase = i === 0 ? firstWordOffset : 0
        await playBlob(blob, wordsInClip, wordBase)
        await waitIfPaused()
        if (aborted) return
      }

      if (!aborted) {
        finished = true
        cleanup()
        onStatus?.('idle')
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
    stop() {
      aborted = true
      finished = true
      cleanup()
      onStatus?.('idle')
    },
    pause() {
      if (!audioEl.paused) {
        audioEl.pause()
      }
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

/** @deprecated Prefer speakSentences — kept for simple whole-text calls. */
export async function speakArticle(
  text: string,
  opts: {
    title?: string
    voice?: NarrationVoiceId
    onStatus?: (status: SpeechStatus, detail?: string) => void
  } = {},
): Promise<SpeakHandle> {
  const payload = [opts.title, text].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim()
  return speakSentences([payload], {
    sentenceIndexes: [0],
    voice: opts.voice,
    onStatus: opts.onStatus,
  })
}
