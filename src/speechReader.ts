import { personalRenderer } from './personalVoice'
import { audioKey, cachedGeneration } from './generatedAudio.ts'
import type { ArticleSentence } from './articleText'
import { onPauseNarration, requestPauseMusic } from './audioBus'

/** Voce narrativa neurale cloud — non quella del dispositivo. */

export type SpeechStatus =
  | 'idle'
  | 'loading'
  | 'speaking'
  | 'paused'
  | 'error'
  | 'completed'
export type NarrationVoiceId = 'jw' | 'isabella' | 'elsa' | 'diego' | 'giuseppe' | 'personal'
export type NarrationRate = '-15%' | '-8%' | '+0%' | '+10%'

export const NARRATION_VOICES: Array<{ id: NarrationVoiceId; label: string }> = [
  { id: 'isabella', label: 'Isabella (narrativa)' },
  { id: 'personal', label: 'La mia voce (Chatterbox)' },
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
          if (el.src !== SILENT_WAV) return
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

let activeNarrationPause: (() => void) | null = null

/** Stop Isabella / neural TTS without destroying the shared element. */
export function pauseNarrationAudio(): void {
  try {
    activeNarrationPause?.()
  } catch {
    /* ignore */
  }
  const el = primedAudio
  if (!el) return
  try {
    el.pause()
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  onPauseNarration(() => pauseNarrationAudio())
}

async function fetchNeuralChunk(
  text: string,
  voice: NarrationVoiceId,
  rate: NarrationRate,
  signal: AbortSignal,
): Promise<Blob> {
  const res = await fetch('/api/tts', {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate }),
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = ''
    try {
      const j = JSON.parse(body) as { error?: string }
      detail = j.error || ''
    } catch {
      detail = body.slice(0, 160)
    }
    throw new Error(detail || `TTS HTTP ${res.status}`)
  }
  return res.blob()
}

function voiceLabel(id: NarrationVoiceId): string {
  if (id === 'jw') return 'Audio JW.org'
  return NARRATION_VOICES.find((v) => v.id === id)?.label || id
}

function rateToPlayback(rate: NarrationRate): number {
  const n = Number.parseInt(rate, 10)
  return Number.isFinite(n) ? 1 + n / 100 : 1
}

type QueueItem = {
  text: string
  /** Absolute word index at the start of this clip. */
  wordBase: number
  wordsInClip: number
  /** Map local word → sentence index for live highlight. */
  sentenceAtWord: number[]
}

/**
 * Join selected sentences into continuous TTS clips (few large blobs)
 * so playback has no pause between every sentence.
 */
function buildContinuousQueue(
  texts: string[],
  sentenceIndexes: number[],
  firstWordOffset: number,
  maxLen: number,
): QueueItem[] {
  type WordRef = { word: string; sentenceIndex: number }
  const words: WordRef[] = []
  texts.forEach((text, i) => {
    const parts = text.split(/\s+/).filter(Boolean)
    const sentenceIndex = sentenceIndexes[i] ?? i
    parts.forEach((word, wi) => {
      if (i === 0 && wi < firstWordOffset) return
      words.push({ word, sentenceIndex })
    })
  })
  if (!words.length) return []

  const queue: QueueItem[] = []
  let cursor = 0
  while (cursor < words.length) {
    let end = cursor
    let length = 0
    while (end < words.length) {
      const nextLen = length + words[end].word.length + (length ? 1 : 0)
      if (length > 0 && nextLen > maxLen) break
      length = nextLen
      end += 1
      if (length >= maxLen) break
    }
    if (end === cursor) end = cursor + 1
    const slice = words.slice(cursor, end)
    queue.push({
      text: slice.map((item) => item.word).join(' '),
      wordBase: cursor === 0 ? firstWordOffset : firstWordOffset + cursor,
      wordsInClip: slice.length,
      sentenceAtWord: slice.map((item) => item.sentenceIndex),
    })
    cursor = end
  }
  return queue
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

  const controller = new AbortController()
  const render =
    voice === 'personal'
      ? personalRenderer(controller.signal)
      : async (text: string) => cachedGeneration(await audioKey([voice, rate, text]), () => fetchNeuralChunk(text, voice, rate, controller.signal))

  // Match /api/tts MAX_CHARS so Isabella & co. get one continuous synthesis
  // whenever the selection fits; longer texts are stitched into a single MP3.
  const maxLen = voice === 'personal' ? 300 : 1000
  const queue = buildContinuousQueue(texts, sentenceIndexes, firstWordOffset, maxLen)

  if (!queue.length) {
    onStatus?.('error', 'Testo vuoto.')
    return { stop() {}, pause() {}, resume() {}, getProgress: () => null }
  }

  requestPauseMusic()

  let aborted = false
  let pausedGate: Promise<void> | null = null
  let resumeGate: (() => void) | null = null
  const audioEl = ensureAudioElement()
  let currentUrl: string | null = null
  let playIndex = 0
  let currentWord = firstWordOffset
  let currentSentence = queue[0]?.sentenceAtWord[0] ?? sentenceIndexes[0] ?? 0
  let finished = false
  const queueLength = queue.length

  const progressNow = (): SpeakProgress | null => {
    if (finished || !queue.length) return null
    return {
      sentenceIndex: currentSentence,
      wordIndex: currentWord,
      queueIndex: playIndex,
      queueLength,
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
    if (activeNarrationPause === handle.pause) activeNarrationPause = null
  }

  const waitIfPaused = async () => {
    while (pausedGate && !aborted) {
      await pausedGate
    }
  }

  const playBlob = (blob: Blob, item: QueueItem) =>
    new Promise<'ok' | 'error'>((resolve) => {
      if (aborted) {
        resolve('ok')
        return
      }
      revokeCurrent()
      const url = URL.createObjectURL(blob)
      currentUrl = url
      currentWord = item.wordBase
      currentSentence = item.sentenceAtWord[0] ?? currentSentence
      emitProgress()

      let settled = false
      const done = (result: 'ok' | 'error') => {
        if (settled) return
        settled = true
        controller.signal.removeEventListener('abort', cancel)
        audioEl.onended = null
        audioEl.onerror = null
        audioEl.ontimeupdate = null
        resolve(result)
      }

      const cancel = () => done('ok')
      controller.signal.addEventListener('abort', cancel, { once: true })

      audioEl.ontimeupdate = () => {
        if (!audioEl.duration || !Number.isFinite(audioEl.duration)) return
        const ratio = Math.min(1, Math.max(0, audioEl.currentTime / audioEl.duration))
        const local = Math.min(
          item.wordsInClip - 1,
          Math.floor(ratio * item.wordsInClip),
        )
        currentWord = item.wordBase + local
        currentSentence = item.sentenceAtWord[local] ?? currentSentence
        emitProgress()
      }
      audioEl.onended = () => done('ok')
      audioEl.onerror = () => done('error')
      audioEl.muted = false
      audioEl.src = url
      audioEl.playbackRate = voice === 'personal' ? rateToPlayback(rate) : 1

      void audioEl.play().then(
        () => {
          if (aborted || pausedGate) return
          onStatus?.('speaking', voiceLabel(voice))
          emitProgress()
        },
        () => {
          if (aborted) return
          onStatus?.('paused', 'Tocca di nuovo per ascoltare')
          emitProgress()
        },
      )
    })

  onStatus?.('loading', voiceLabel(voice))

  const run = async () => {
    try {
      // Start the first clip as soon as it is ready and prepare one ahead.
      const blobs: Array<Promise<Blob> | null> = queue.map(() => null)
      blobs[0] = render(queue[0].text)
      void blobs[0]!.catch(() => {})

      for (let i = 0; i < queue.length; i += 1) {
        if (aborted) return
        playIndex = i
        currentWord = queue[i].wordBase
        currentSentence = queue[i].sentenceAtWord[0] ?? currentSentence
        emitProgress()

        if (!pausedGate) onStatus?.('loading', 'Preparazione lettura ' + (i + 1) + ' di ' + queue.length)
        const blob = await (blobs[i] ?? render(queue[i].text))
        blobs[i] = null
        if (aborted) return
        onChunkReady?.(blob, i)

        if (i + 1 < queue.length && !blobs[i + 1]) {
          blobs[i + 1] = render(queue[i + 1].text)
          void blobs[i + 1]!.catch(() => {})
        }

        await waitIfPaused()
        if (aborted) return

        const result = await playBlob(blob, queue[i])
        if (aborted) return
        if (result === 'error') {
          controller.abort()
          cleanup()
          onStatus?.('error', 'Errore audio su questa frase. Riprova o salta avanti.')
          return
        }
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

  const handle: SpeakHandle = {
    stop(opts) {
      controller.abort()
      aborted = true
      finished = true
      if (activeNarrationPause === handle.pause) activeNarrationPause = null
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
      requestPauseMusic()
      if (resumeGate) {
        resumeGate()
        resumeGate = null
        pausedGate = null
      }
      void audioEl.play().then(
        () => {
          if (aborted || pausedGate) return
          onStatus?.('speaking', voiceLabel(voice))
          emitProgress()
        },
        () => onStatus?.('paused', 'Tocca di nuovo per ascoltare'),
      )
    },
    getProgress: () => progressNow(),
  }
  activeNarrationPause = handle.pause
  void run()
  return handle
}

/** Play a JW.org MP3 range with live sentence highlight from markers. */
export async function speakOriginalAudio(opts: {
  url: string
  start: number
  end: number
  sentences: ArticleSentence[]
  rate?: NarrationRate
  onStatus?: (status: SpeechStatus, detail?: string) => void
  onProgress?: (progress: SpeakProgress) => void
}): Promise<SpeakHandle> {
  const { url, start, end, sentences, rate = '+0%', onStatus, onProgress } = opts
  const audioEl = ensureAudioElement()
  const controller = new AbortController()
  let aborted = false
  let finished = false
  let pausedGate: Promise<void> | null = null
  let resumeGate: (() => void) | null = null
  let currentSentence = 0
  let currentWord = 0

  const timed = sentences.filter(
    (item) => item.startTime != null && item.endTime != null && item.endTime > item.startTime!,
  )
  const findAt = (time: number) => {
    for (let i = 0; i < timed.length; i += 1) {
      const s = timed[i]
      if (time >= (s.startTime ?? 0) && time < (s.endTime ?? 0)) {
        const span = Math.max(0.01, (s.endTime ?? 0) - (s.startTime ?? 0))
        const ratio = (time - (s.startTime ?? 0)) / span
        const wordIndex = Math.min(
          Math.max(0, s.words.length - 1),
          Math.floor(ratio * s.words.length),
        )
        return { sentenceIndex: s.index, wordIndex }
      }
    }
    const last = timed[timed.length - 1]
    return {
      sentenceIndex: last?.index ?? 0,
      wordIndex: Math.max(0, (last?.words.length ?? 1) - 1),
    }
  }

  const progressNow = (): SpeakProgress | null => {
    if (finished) return null
    return {
      sentenceIndex: currentSentence,
      wordIndex: currentWord,
      queueIndex: 0,
      queueLength: 1,
    }
  }

  const emitProgress = () => {
    const p = progressNow()
    if (p) onProgress?.(p)
  }

  const cleanup = () => {
    try {
      audioEl.ontimeupdate = null
      audioEl.onended = null
      audioEl.onerror = null
      audioEl.pause()
    } catch {
      /* ignore */
    }
    if (activeNarrationPause === handle.pause) activeNarrationPause = null
  }

  requestPauseMusic()
  onStatus?.('loading', voiceLabel('jw'))

  const at = findAt(start)
  currentSentence = at.sentenceIndex
  currentWord = at.wordIndex
  emitProgress()

  const handle: SpeakHandle = {
    stop(opts) {
      aborted = true
      finished = true
      controller.abort()
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
      onStatus?.('paused', voiceLabel('jw'))
      emitProgress()
    },
    resume() {
      if (aborted) return
      requestPauseMusic()
      if (resumeGate) {
        resumeGate()
        resumeGate = null
        pausedGate = null
      }
      void audioEl.play().then(
        () => {
          if (aborted || pausedGate) return
          onStatus?.('speaking', voiceLabel('jw'))
          emitProgress()
        },
        () => onStatus?.('paused', 'Tocca di nuovo per ascoltare'),
      )
    },
    getProgress: () => progressNow(),
  }
  activeNarrationPause = handle.pause

  const run = async () => {
    try {
      audioEl.muted = false
      audioEl.playbackRate = rateToPlayback(rate)
      if (audioEl.src !== url) {
        audioEl.src = url
        audioEl.load()
      }
      await new Promise<void>((resolve, reject) => {
        if (audioEl.readyState >= 1) {
          resolve()
          return
        }
        const ok = () => {
          audioEl.removeEventListener('loadedmetadata', ok)
          audioEl.removeEventListener('error', fail)
          resolve()
        }
        const fail = () => {
          audioEl.removeEventListener('loadedmetadata', ok)
          audioEl.removeEventListener('error', fail)
          reject(new Error('Audio JW.org non caricabile.'))
        }
        audioEl.addEventListener('loadedmetadata', ok, { once: true })
        audioEl.addEventListener('error', fail, { once: true })
      })
      if (aborted) return

      audioEl.ontimeupdate = () => {
        if (aborted) return
        const t = audioEl.currentTime
        if (t >= end - 0.05) {
          audioEl.pause()
          finished = true
          cleanup()
          onStatus?.('completed')
          return
        }
        const hit = findAt(t)
        currentSentence = hit.sentenceIndex
        currentWord = hit.wordIndex
        emitProgress()
      }
      audioEl.onended = () => {
        if (aborted) return
        finished = true
        cleanup()
        onStatus?.('completed')
      }
      audioEl.onerror = () => {
        if (aborted) return
        cleanup()
        onStatus?.('error', 'Errore audio JW.org.')
      }

      audioEl.currentTime = Math.max(0, start)
      void audioEl.play().then(
        () => {
          if (aborted || pausedGate) return
          onStatus?.('speaking', voiceLabel('jw'))
          emitProgress()
        },
        () => {
          if (aborted) return
          onStatus?.('paused', 'Tocca di nuovo per ascoltare')
          emitProgress()
        },
      )
    } catch (err) {
      if (aborted) return
      cleanup()
      onStatus?.(
        'error',
        err instanceof Error ? err.message : 'Audio JW.org non disponibile.',
      )
    }
  }

  void run()
  return handle
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

/** Seek the active narration, including its existing progress listeners. */
export function skipNarrationAudio(seconds: number) {
  const audio = primedAudio
  if (!audio || !Number.isFinite(audio.duration)) return
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
}
