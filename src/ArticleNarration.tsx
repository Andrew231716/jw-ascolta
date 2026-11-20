import { createPortal } from 'react-dom'
import { hasPersonalVoiceToken, setPersonalVoiceToken, forgetVoiceSample, hasVoiceSample, saveVoiceSample } from './personalVoice'
import { localResponse, offlineAudio, recordProgress, rememberArticle } from './offlineLibrary.ts'
import { DownloadButton } from './DownloadButton'
import { ShareAudioButtons } from './ShareAudioButtons'
import { shareOrDownloadMp3 } from './shareAudio'
import { clearGeneratedAudio } from './generatedAudio.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clearBookmark,
  loadBookmark,
  saveBookmark,
  assignProportionalTimes,
  sentencesFromParagraphs,
  sliceRange,
  snippetAt,
  splitSentences,
  timeRangeForSelection,
  type ArticleParagraph,
  type ArticleSentence,
  type AudioMarker,
  type NarrationBookmark,
} from './articleText'
import {
  NARRATION_RATES,
  NARRATION_VOICES,
  primeNarrationAudio,
  skipNarrationAudio,
  speakOriginalAudio,
  speakSentences,
  type NarrationRate,
  type NarrationVoiceId,
  type SpeakHandle,
  type SpeakProgress,
  type SpeechStatus,
} from './speechReader'

const NO_MARKERS: AudioMarker[] = []

type SelectMode = 'start' | 'end'

type ArticlePayload = {
  title: string
  text: string
  source: string
  paragraphs?: ArticleParagraph[]
}

/** Build article-text query from a JW.org page URL or finder?docid= link. */
function articleTextQuery(source: string) {
  try {
    const url = new URL(source)
    const docid = url.searchParams.get('docid')
    if (docid && /^\d{6,12}$/.test(docid)) {
      return new URLSearchParams({ docid })
    }
    return new URLSearchParams({ path: url.pathname })
  } catch {
    return new URLSearchParams({ path: source })
  }
}

export function ArticleNarration({
  articleId,
  title,
  source,
  transcript,
  audioUrl,
  markers = NO_MARKERS,
  audioDuration = 0,
  onClose,
}: {
  articleId: string
  title: string
  source: string
  transcript?: string
  /** JW.org MP3 for the same article/chapter when available. */
  audioUrl?: string
  markers?: AudioMarker[]
  audioDuration?: number
  onClose: () => void
}) {
  const offlineOriginalUrl = useRef<string | null>(null)
  useEffect(() => () => { if (offlineOriginalUrl.current) URL.revokeObjectURL(offlineOriginalUrl.current) }, [])
  const hasOriginal = Boolean(audioUrl)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [advanced, setAdvanced] = useState(false)
  const [followReading, setFollowReading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [article, setArticle] = useState<ArticlePayload | null>(null)
  const [sentences, setSentences] = useState<ArticleSentence[]>([])
  const [selectMode, setSelectMode] = useState<SelectMode>('start')
  const [startSentence, setStartSentence] = useState(0)
  const [startWord, setStartWord] = useState(0)
  const [endSentence, setEndSentence] = useState<number | null>(null)
  const [endWord, setEndWord] = useState<number | null>(null)
  const [voice, setVoice] = useState<NarrationVoiceId>(() => {
    if (audioUrl) return 'jw'
    try {
      return NARRATION_VOICES.find((v) => v.id === localStorage.getItem('jw-narrator'))?.id ?? 'isabella'
    } catch {
      return 'isabella'
    }
  })
  const [sampleReady, setSampleReady] = useState(hasVoiceSample)
  const tokenField = useRef<HTMLInputElement>(null)
  const [tokenSet, setTokenSet] = useState(hasPersonalVoiceToken)
  const [sampleError, setSampleError] = useState('')
  const [rate, setRate] = useState<NarrationRate>('-8%')
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [detail, setDetail] = useState('')
  const [progress, setProgress] = useState<SpeakProgress | null>(null)
  const [bookmark, setBookmark] = useState<NarrationBookmark | null>(null)
  const [shareNote, setShareNote] = useState('')
  const audioChunksRef = useRef<Blob[]>([])
  const speechRef = useRef<SpeakHandle | null>(null)
  const playRevision = useRef(0)
  const sentencesRef = useRef<ArticleSentence[]>([])
  const rangeRef = useRef({
    startSentence: 0,
    startWord: 0,
    endSentence: null as number | null,
    endWord: null as number | null,
  })
  const articleMeta = useRef({ articleId, title, source })
  const voiceRef = useRef(voice)
  const rateRef = useRef(rate)

  useEffect(() => {
    articleMeta.current = { articleId, title, source }
  }, [articleId, title, source])
  useEffect(() => {
    sentencesRef.current = sentences
  }, [sentences])
  useEffect(() => {
    rangeRef.current = { startSentence, startWord, endSentence, endWord }
  }, [startSentence, startWord, endSentence, endWord])
  useEffect(() => {
    voiceRef.current = voice
  }, [voice])
  useEffect(() => {
    rateRef.current = rate
  }, [rate])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const content: Promise<ArticlePayload> = transcript !== undefined
      ? Promise.resolve({ text: transcript, title, source })
      : localResponse('/api/article-text?' + articleTextQuery(source), controller.signal)
          .then(async res => {
            if (!res.ok) throw new Error('Impossibile leggere il testo dell’articolo.')
            return res.json() as Promise<ArticlePayload>
          })
    content
      .then((data) => {
        if (controller.signal.aborted) return
        if (!data.text?.trim()) throw new Error('Testo articolo non trovato.')
        const payload: ArticlePayload = {
          title: data.title || title,
          text: data.text,
          source: data.source || source,
          paragraphs: data.paragraphs,
        }
        let units =
          payload.paragraphs?.length
            ? sentencesFromParagraphs(
                payload.paragraphs,
                markers,
                audioUrl ? audioDuration : 0,
              )
            : splitSentences(payload.text)
        if (
          audioUrl &&
          audioDuration > 0 &&
          units.some((item) => item.startTime == null || item.endTime == null)
        ) {
          units = assignProportionalTimes(units, audioDuration)
        }
        void rememberArticle({ id: articleId, title: payload.title, source: payload.source, audioUrl, audioDuration, markers }).catch(() => {})
        setArticle(payload)
        setSentences(units)
        if (audioUrl) setVoice('jw')

        const params = new URLSearchParams(window.location.search)
        const qStart = params.has('ns') ? Number(params.get('ns')) : NaN
        const qEnd = params.has('ne') ? Number(params.get('ne')) : NaN
        const saved = loadBookmark(articleId)
        setBookmark(saved)

        if (transcript === undefined && Number.isFinite(qStart) && qStart >= 0 && qStart < units.length) {
          setStartSentence(qStart)
          setStartWord(0)
          if (Number.isFinite(qEnd) && qEnd >= qStart && qEnd < units.length) {
            setEndSentence(qEnd)
            setEndWord(null)
          }
        } else if (saved && saved.sentenceIndex < units.length) {
          setStartSentence(saved.sentenceIndex)
          setStartWord(
            Math.min(saved.wordIndex, Math.max(0, units[saved.sentenceIndex].words.length - 1)),
          )
          setEndSentence(
            saved.endSentenceIndex !== null && saved.endSentenceIndex < units.length
              ? saved.endSentenceIndex
              : null,
          )
          setEndWord(saved.endWordIndex)
          if (saved.rate && NARRATION_RATES.some((r) => r.id === saved.rate)) {
            setRate(saved.rate as NarrationRate)
          }
        } else {
          setStartSentence(0)
          setStartWord(0)
          setEndSentence(null)
          setEndWord(null)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Caricamento non riuscito')
        setLoading(false)
      })
    return () => controller.abort()
  }, [articleId, source, title, transcript, audioUrl, audioDuration, markers, loadAttempt])

  function persistFromProgress(p: SpeakProgress | null, units = sentencesRef.current) {
    if (transcript !== undefined || !p || !units.length) return
    const meta = articleMeta.current
    const range = rangeRef.current
    const next: NarrationBookmark = {
      articleId: meta.articleId,
      title: meta.title,
      source: meta.source,
      sentenceIndex: p.sentenceIndex,
      wordIndex: p.wordIndex,
      endSentenceIndex: range.endSentence,
      endWordIndex: range.endWord,
      startSentenceIndex: range.startSentence,
      startWordIndex: range.startWord,
      snippet: snippetAt(units, p.sentenceIndex, p.wordIndex),
      updatedAt: Date.now(),
      voice: voiceRef.current,
      rate: rateRef.current,
    }
    saveBookmark(next)
    setBookmark(next)
  }

  useEffect(() => {
    // Keep Isabella playing in background; only snapshot progress.
    const persistOnly = () => {
      const handle = speechRef.current
      if (!handle) return
      persistFromProgress(handle.getProgress())
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistOnly()
    }
    window.addEventListener('pagehide', persistOnly)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', persistOnly)
      document.removeEventListener('visibilitychange', onVisibility)
      const handle = speechRef.current
      if (handle) {
        persistFromProgress(handle.getProgress())
        // Closing the reader stops audio; backgrounding does not.
        handle.stop()
      }
      playRevision.current += 1
      speechRef.current = null
    }
  }, [articleId])

  const rangeEnd = endSentence === null ? sentences.length - 1 : endSentence

  const inRange = (sentenceIndex: number, wordIndex?: number) => {
    if (sentenceIndex < startSentence || sentenceIndex > rangeEnd) return false
    if (wordIndex === undefined) return true
    if (sentenceIndex === startSentence && wordIndex < startWord) return false
    if (
      endSentence !== null &&
      endWord !== null &&
      sentenceIndex === endSentence &&
      wordIndex > endWord
    ) {
      return false
    }
    return true
  }

  function pickSentence(sentenceIndex: number) {
    if (selectMode === 'start') {
      setStartSentence(sentenceIndex)
      setStartWord(0)
      if (endSentence !== null && sentenceIndex > endSentence) {
        setEndSentence(null)
        setEndWord(null)
      }
      setSelectMode('end')
    } else {
      if (sentenceIndex < startSentence) {
        setStartSentence(sentenceIndex)
        setStartWord(0)
        return
      }
      setEndSentence(sentenceIndex)
      setEndWord(null)
    }
  }

  function pickWord(sentenceIndex: number, wordIndex: number) {
    if (selectMode === 'start') {
      setStartSentence(sentenceIndex)
      setStartWord(wordIndex)
      if (endSentence !== null && sentenceIndex > endSentence) {
        setEndSentence(null)
        setEndWord(null)
      }
      setSelectMode('end')
    } else {
      if (
        sentenceIndex < startSentence ||
        (sentenceIndex === startSentence && wordIndex < startWord)
      ) {
        setStartSentence(sentenceIndex)
        setStartWord(wordIndex)
        return
      }
      setEndSentence(sentenceIndex)
      setEndWord(wordIndex)
    }
  }

  async function startPlayback(fromBookmark = false, entire = false) {
    const revision = ++playRevision.current
    if (!sentences.length || status === 'loading') return
    if (voice === 'personal' && !sampleReady) {
      setSampleError('Scegli prima il memo con la tua voce.')
      return
    }
    const retry = status === 'error' ? speechRef.current?.getProgress() : null
    speechRef.current?.stop()
    primeNarrationAudio()
    audioChunksRef.current = []

    let from = startSentence
    let word = startWord
    let to = endSentence
    let toWord = endWord

    if (entire) {
      from = word = 0
      to = toWord = null
      resetRange()
    }
    if (fromBookmark && retry) {
      from = retry.sentenceIndex
      word = retry.wordIndex
    } else if (fromBookmark && bookmark) {
      from = bookmark.sentenceIndex
      word = bookmark.wordIndex
      to = bookmark.endSentenceIndex
      toWord = bookmark.endWordIndex
      setStartSentence(from)
      setStartWord(word)
      setEndSentence(to)
      setEndWord(toWord)
    }

    const sliced = sliceRange(sentences, from, word, to, toWord)
    if (!sliced.texts.length) {
      setStatus('error')
      setDetail('Seleziona almeno una frase.')
      return
    }

    setStatus('loading')
    setDetail('')
    setProgress({
      sentenceIndex: sliced.sentenceIndexes[0] ?? sliced.from,
      wordIndex: sliced.firstWord,
      queueIndex: 0,
      queueLength: sliced.texts.length,
    })

    const onStatus = (next: SpeechStatus, info?: string) => {
      setStatus(next)
      if (info) setDetail(info)
      if (next === 'paused' || next === 'speaking') {
        persistFromProgress(speechRef.current?.getProgress() ?? null)
      }
      if (next === 'completed') {
        recordProgress(articleId, sentences.length, to === null || (to >= sentences.length - 1 && (toWord === null || toWord >= (sentences.at(-1)?.words.length || 1) - 1)))
        clearBookmark(articleId)
        setBookmark(null)
        setProgress(null)
        setDetail('Lettura completata')
      }
      if (next === 'idle') {
        setProgress(speechRef.current?.getProgress() ?? progress)
      }
    }

    if (voice === 'jw' && audioUrl) {
      const times = timeRangeForSelection(sentences, from, word, to, toWord)
      if (!times) {
        setStatus('error')
        setDetail('Tempi audio non disponibili per questo brano.')
        return
      }
      const savedAudio = await offlineAudio(articleId).catch(() => undefined)
      if (revision !== playRevision.current) return
      if (offlineOriginalUrl.current) URL.revokeObjectURL(offlineOriginalUrl.current)
      offlineOriginalUrl.current = savedAudio ? URL.createObjectURL(savedAudio) : null
      speechRef.current = await speakOriginalAudio({
        url: offlineOriginalUrl.current || audioUrl,
        start: times.start,
        end: times.end,
        sentences,
        rate,
        onStatus,
        onProgress(p) {
          recordProgress(articleId, p.sentenceIndex + p.wordIndex / 100)
        setProgress(p)
        },
      })
      return
    }

    speechRef.current = await speakSentences(sliced.texts, {
      sentenceIndexes: sliced.sentenceIndexes,
      firstWordOffset: sliced.firstWord,
      voice,
      rate,
      onChunkReady(blob) {
        if (voice === 'personal') audioChunksRef.current = [blob]
        else audioChunksRef.current.push(blob)
      },
      onStatus,
      onProgress(p) {
        recordProgress(articleId, p.sentenceIndex + p.wordIndex / 100)
        setProgress(p)
      },
    })
  }

  function togglePause() {
    if (status === 'speaking') {
      speechRef.current?.pause()
      persistFromProgress(speechRef.current?.getProgress() ?? null)
      return
    }
    if (status === 'paused' || status === 'error') {
      if (status === 'error') {
        void startPlayback(true)
        return
      }
      speechRef.current?.resume()
    }
  }

  function stopPlayback() {
    playRevision.current += 1
    const p = speechRef.current?.getProgress() ?? progress
    persistFromProgress(p)
    speechRef.current?.stop()
    speechRef.current = null
    setStatus('idle')
    setDetail('Posizione salvata')
  }

  function resetRange() {
    setStartSentence(0)
    setStartWord(0)
    setEndSentence(null)
    setEndWord(null)
    setSelectMode('start')
  }

  async function shareRange() {
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'library')
    url.searchParams.set('article', articleId)
    url.searchParams.set('articleUrl', source)
    url.searchParams.set('articleTitle', article?.title || title)
    url.searchParams.set('ns', String(startSentence))
    if (endSentence !== null) url.searchParams.set('ne', String(endSentence))
    else url.searchParams.delete('ne')
    const link = url.toString()
    try {
      if (navigator.share) {
        await navigator.share({ title: article?.title || title, url: link })
      } else {
        await navigator.clipboard.writeText(link)
      }
      setShareNote('Link al brano copiato')
    } catch {
      setShareNote(link)
    }
  }

  async function downloadAudio() {
    const chunks = audioChunksRef.current
    if (!chunks.length) {
      setShareNote('Ascolta almeno una frase, poi scarica.')
      return
    }
    const personal = chunks[0].type.includes('wav')
    const mime = personal ? 'audio/wav' : 'audio/mpeg'
    const blob = personal
      ? chunks[chunks.length - 1]
      : new Blob(chunks, { type: mime })
    const filename = `${(article?.title || title || 'articolo').slice(0, 60)}.${personal ? 'wav' : 'mp3'}`
    const file = new File([blob], filename, { type: mime })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: article?.title || title,
          text: article?.title || title,
        })
        setShareNote('Audio condiviso')
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setShareNote('Download avviato')
  }

  async function shareOriginalMp3() {
    if (!audioUrl) {
      setShareNote('Nessun MP3 originale disponibile.')
      return
    }
    setShareNote('Preparazione MP3…')
    try {
      const result = await shareOrDownloadMp3({
        id: articleId,
        title: article?.title || title,
        url: audioUrl,
        duration: audioDuration || 0,
        sectionSlug: 'tutto',
        sectionName: 'Articolo',
        source,
        contentKind: 'article',
      })
      setShareNote(result === 'shared' ? 'MP3 condiviso' : 'Download MP3 avviato')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setShareNote('')
        return
      }
      setShareNote(error instanceof Error ? error.message : 'Download MP3 non riuscito')
    }
  }

  const pausedHere = status === 'paused' && progress
  const currentSentence = progress?.sentenceIndex
  const currentWord = progress?.wordIndex
  useEffect(() => {
    if (!followReading || currentSentence === undefined) return
    document.querySelector('[data-sentence="' + currentSentence + '"]')?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [currentSentence, followReading])

  const statusLine = useMemo(() => {
    if (status === 'loading') {
      return voice === 'jw' ? 'Avvio audio JW.org…' : detail.startsWith('Preparazione lettura') ? detail : 'Preparazione voce…'
    }
    if (status === 'speaking' && progress) {
      return `In lettura · frase ${progress.sentenceIndex + 1} di ${sentences.length}`
    }
    if (pausedHere && progress) {
      return `In pausa qui: «${snippetAt(sentences, progress.sentenceIndex, progress.wordIndex)}»`
    }
    if (status === 'completed') return detail || 'Lettura completata'
    if (detail) return detail
    return ''
  }, [status, progress, pausedHere, sentences, detail, voice])

  return (
    <div className={advanced ? "article-narration selecting" : "article-narration reading"} role="region" aria-label="Lettura articolo">
      <header className="article-narration-head">
        <button type="button" className="btn ghost small" onClick={onClose}>
          ← Chiudi
        </button>
        <h3>{article?.title || title}</h3>
      </header>

      {loading && <p role="status">Carico il testo da JW.org…</p>}
      {error && <p className="error" role="alert">{error} <button type="button" className="btn ghost small" onClick={() => setLoadAttempt(value => value + 1)}>Riprova</button></p>}
      {loading && <button type="button" className="btn ghost small" onClick={onClose}>Annulla caricamento</button>}

      {!loading && !error && (
        <>
          {bookmark && (status === 'idle' || status === 'completed') && (
            <div className="narration-resume-banner">
              <p>
                Riprendi da: <em>«{bookmark.snippet}»</em>
              </p>
              <button
                type="button"
                className="btn primary small"
                onClick={() => void startPlayback(true)}
              >
                Riprendi ascolto
              </button>
            </div>
          )}

          <label className="follow-reading"><input type="checkbox" checked={followReading} onChange={event => setFollowReading(event.target.checked)} /> Segui la lettura</label>
          <button type="button" className="btn ghost small" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>
            {advanced ? 'Chiudi selezione del brano' : 'Scegli inizio e fine del brano'}
          </button>
          <div hidden={!advanced}>
          <div
            className={`narration-step-card mode-${selectMode}`}
            role="status"
            aria-live="polite"
          >
            <p className="narration-step-title">
              {selectMode === 'start'
                ? '1 · Dove vuoi iniziare?'
                : endSentence === null
                  ? '2 · Dove vuoi fermarti?'
                  : 'Brano pronto'}
            </p>
            <p className="narration-step-body">
              {selectMode === 'start'
                ? 'Tocca nel testo la frase (o la parola) da cui partire.'
                : endSentence === null
                  ? 'Tocca la frase finale, oppure premi Ascolta per arrivare fino in fondo.'
                  : `Ascolterai dalle frasi ${startSentence + 1} a ${endSentence + 1}.`}
            </p>
            <div className="narration-range-summary">
              <div>
                <span className="range-label">Inizio</span>
                <strong>
                  Frase {startSentence + 1}
                  {startWord > 0 ? ` · parola ${startWord + 1}` : ''}
                </strong>
                <em>«{snippetAt(sentences, startSentence, startWord)}»</em>
              </div>
              <div>
                <span className="range-label">Fine</span>
                <strong>
                  {endSentence === null
                    ? 'Fino alla fine'
                    : `Frase ${endSentence + 1}${endWord !== null ? ` · parola ${endWord + 1}` : ''}`}
                </strong>
                {endSentence !== null && (
                  <em>«{snippetAt(sentences, endSentence, endWord ?? 0)}»</em>
                )}
              </div>
            </div>
            <div className="narration-toolbar" role="group" aria-label="Cosa stai scegliendo">
              <button
                type="button"
                className={selectMode === 'start' ? 'chip active start-chip' : 'chip'}
                aria-pressed={selectMode === 'start'}
                onClick={() => setSelectMode('start')}
              >
                Cambia inizio
              </button>
              <button
                type="button"
                className={selectMode === 'end' ? 'chip active end-chip' : 'chip'}
                aria-pressed={selectMode === 'end'}
                onClick={() => setSelectMode('end')}
              >
                Cambia fine
              </button>
              <button type="button" className="btn ghost small" onClick={resetRange}>
                Tutto il testo
              </button>
            </div>
          </div>

          </div>
          <div className="narration-controls">
            {status === 'speaking' || status === 'paused' || status === 'error' ? (
              <>
                <button type="button" className="btn primary" onClick={togglePause}>
                  {status === 'speaking'
                    ? 'Pausa'
                    : detail.includes('Tocca')
                      ? 'Tocca per ascoltare'
                      : status === 'error'
                        ? 'Riprova da qui'
                        : 'Riprendi'}
                </button>
                <button type="button" className="btn ghost" onClick={stopPlayback}>
                  Stop · salva posizione
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={status === 'loading' || !sentences.length}
                onClick={() => void startPlayback(false)}
              >
                {status === 'loading'
                  ? 'Preparazione…'
                  : endSentence === null
                    ? startSentence === 0 && startWord === 0 ? 'Ascolta articolo' : `Ascolta dalla frase ${startSentence + 1}`
                    : `Ascolta frasi ${startSentence + 1}–${endSentence + 1}`}
              </button>
            )}
            {status === 'loading' && (
              <button type="button" className="btn ghost" onClick={stopPlayback}>
                Annulla
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              disabled={status === 'loading' || !sentences.length}
              onClick={() => void startPlayback(false, true)}
            >
              {transcript === undefined ? 'Ascolta tutto' : 'Ascolta tutti i sottotitoli'}
            </button>
          </div>

          <details className="narration-more">
            <summary>Voce, velocità e altro</summary>
            <div className="narration-options">
              <label>
                Voce
                <select
                  value={voice}
                  onChange={(e) => {
                    audioChunksRef.current = []
                    speechRef.current?.stop()
                    const next = e.target.value as NarrationVoiceId
                    setVoice(next)
                    setStatus('idle')
                    setDetail('')
                    if (next !== 'jw') {
                      try {
                        localStorage.setItem('jw-narrator', next)
                      } catch {
                        /* session only */
                      }
                    }
                  }}
                  disabled={status === 'loading' || status === 'speaking'}
                >
                  {hasOriginal && (
                    <option value="jw">Audio JW.org (originale)</option>
                  )}
                  {NARRATION_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              {voice === 'jw' && (
                <p className="section-lede">
                  Registrazione ufficiale JW.org sul brano scelto.
                </p>
              )}
              {voice === 'personal' && (
                <fieldset
                  disabled={
                    status === 'loading' || status === 'speaking' || status === 'paused'
                  }
                >
                  <legend>Il tuo memo vocale</legend>
                  <p>
                    Premendo Ascolta, il memo e il testo selezionato vengono inviati alla demo
                    pubblica Chatterbox.
                  </p>
                  <label>
                    {sampleReady ? 'Sostituisci memo' : 'Scegli un memo da File'}
                    <input
                      type="file"
                      accept="audio/*,.m4a,.wav,.mp3"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        e.target.value = ''
                        try {
                          await saveVoiceSample(file)
                          setSampleReady(true)
                          setSampleError('')
                        } catch (err) {
                          setSampleError(
                            err instanceof Error ? err.message : 'Salvataggio non riuscito.',
                          )
                        }
                      }}
                    />
                  </label>
                  {sampleReady && <small>Memo salvato su questo dispositivo.</small>}
                  {sampleReady && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        forgetVoiceSample()
                        setSampleReady(false)
                      }}
                    >
                      Rimuovi memo dal dispositivo
                    </button>
                  )}
                  <details>
                    <summary>Quota del mio account Hugging Face</summary>
                    <p>
                      Il token viene usato solo per Chatterbox e viene dimenticato ricaricando la
                      pagina.
                    </p>
                    <a
                      href="https://huggingface.co/settings/tokens"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Gestisci token su Hugging Face
                    </a>
                    {tokenSet ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          setPersonalVoiceToken('')
                          setTokenSet(false)
                        }}
                      >
                        Scollega account
                      </button>
                    ) : (
                      <div>
                        <label>
                          Token personale
                          <input
                            type="password"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            ref={tokenField}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => {
                            const value = tokenField.current?.value.trim()
                            if (!value) return
                            if (!/^hf_[a-zA-Z0-9]+$/.test(value)) {
                              setSampleError(
                                'Inserisci un token Hugging Face che inizi con hf_.',
                              )
                              return
                            }
                            setPersonalVoiceToken(value)
                            setTokenSet(true)
                            setSampleError('')
                          }}
                        >
                          Usa token
                        </button>
                      </div>
                    )}
                  </details>
                  {sampleError && <p role="alert">{sampleError}</p>}
                </fieldset>
              )}
              <label>
                Velocità
                <select
                  value={rate}
                  onChange={(e) => setRate(e.target.value as NarrationRate)}
                  disabled={status === 'loading' || status === 'speaking'}
                >
                  {NARRATION_RATES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              {transcript === undefined && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => void shareRange()}
                >
                  Condividi link brano
                </button>
              )}
              {voice !== 'jw' && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => void downloadAudio()}
                >
                  {voice === 'personal' ? 'Scarica ultima frase pronta' : 'Scarica / condividi MP3'}
                </button>
              )}
              {audioUrl && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => void shareOriginalMp3()}
                >
                  Scarica / condividi MP3 originale
                </button>
              )}
            </div>
          </details>

          <p className="narration-text-prompt" aria-hidden="true">
            {selectMode === 'start'
              ? '↓ Tocca qui sotto la frase di inizio'
              : '↓ Tocca qui sotto la frase di fine'}
          </p>

          {status !== 'error' && statusLine && (
            <p className="narration-status" role="status">
              {statusLine}
            </p>
          )}
          {shareNote && (
            <p className="narration-status" role="status">
              {shareNote}
            </p>
          )}
          {status === 'error' && detail && (
            <p className="error" role="alert">
              {detail}
            </p>
          )}

          {audioUrl && (
            <div className="result-actions">
              <ShareAudioButtons
                track={{
                  id: articleId,
                  title: article?.title || title,
                  url: audioUrl,
                  duration: audioDuration || 0,
                  sectionSlug: 'tutto',
                  sectionName: 'Articolo',
                  source,
                  contentKind: 'article',
                }}
              />
              <DownloadButton
                track={{
                  id: articleId,
                  title: article?.title || title,
                  url: audioUrl,
                  duration: audioDuration || 0,
                  sectionSlug: 'tutto',
                  sectionName: 'Articolo',
                  source,
                  contentKind: 'article',
                }}
              />
            </div>
          )}
          {(status === 'speaking' || status === 'paused') && createPortal(<aside className="narration-dock" aria-label="Lettore compatto articolo">
            <strong>{article?.title || title}</strong>
            <button className="icon-btn" aria-label="Indietro di 15 secondi" onClick={() => skipNarrationAudio(-15)}>−15</button>
            <button className="icon-btn" aria-label={status === 'speaking' ? 'Pausa lettura' : 'Riprendi lettura'} onClick={togglePause}>{status === 'speaking' ? '❚❚' : '▶'}</button>
            <button className="icon-btn" aria-label="Avanti di 15 secondi" onClick={() => skipNarrationAudio(15)}>+15</button>
          </aside>, document.body)}
          {voice === 'personal' && <button className="btn ghost small" onClick={() => void clearGeneratedAudio().then(() => setShareNote('Audio generati rimossi dal dispositivo'))}>Libera memoria degli audio generati</button>}
          {status === 'error' && voice === 'personal' && <div className="narration-controls">
            <button className="btn ghost" type="button" onClick={async () => {
              const selection = sliceRange(sentences, startSentence, startWord, endSentence, endWord)
              try {
                await navigator.clipboard.writeText(selection.texts[0]?.slice(0, 300) || '')
                setShareNote('Primo estratto copiato per la demo.')
              } catch { setShareNote('Puoi selezionare e copiare il testo qui sotto.') }
            }}>Copia estratto per la demo</button>
            <a className="btn ghost" href="https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS" target="_blank" rel="noreferrer">Apri demo Chatterbox</a>
          </div>}

          <article className="article-body">
            {sentences.map((sentence) => {
              const isCurrent = currentSentence === sentence.index
              const isPaused = Boolean(pausedHere && isCurrent)
              const selected = inRange(sentence.index)
              const isStart = sentence.index === startSentence
              return (
                <p
                  key={sentence.index}
                  className={[
                    'article-sentence',
                    selected ? 'in-range' : '',
                    isStart ? 'is-range-start' : '',
                    endSentence !== null && sentence.index === endSentence
                      ? 'is-range-end'
                      : '',
                    isCurrent ? 'is-current' : '',
                    isPaused ? 'is-paused' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-sentence={sentence.index}
                >
                  <button
                    type="button"
                    className="sentence-pick"
                    onClick={() => pickSentence(sentence.index)}
                    aria-label={`Frase ${sentence.index + 1}${isStart ? ', inizio' : ''}${endSentence !== null && sentence.index === endSentence ? ', fine' : ''}`}
                  >
                    <span className="sentence-num">{sentence.index + 1}</span>
                    {isStart && <span className="sentence-marker start">INIZIO</span>}
                    {endSentence !== null && sentence.index === endSentence && (
                      <span className="sentence-marker end">FINE</span>
                    )}
                  </button>
                  <span className="sentence-words">
                    {sentence.words.map((wordItem, wi) => {
                      const wordCurrent =
                        isCurrent && currentWord !== undefined && wi === currentWord
                      const wordSelected = inRange(sentence.index, wi)
                      const wordStart =
                        isStart && wi === startWord
                      const wordEnd =
                        endSentence !== null &&
                        endWord !== null &&
                        sentence.index === endSentence &&
                        wi === endWord
                      return (
                        <span key={wordItem.id} className="word-wrapper">
                        {advanced ? <button
                          type="button"
                          className={[
                            'article-word',
                            wordSelected ? 'in-range' : '',
                            wordStart ? 'is-word-start' : '',
                            wordEnd ? 'is-word-end' : '',
                            wordCurrent ? 'is-current' : '',
                            isPaused && wordCurrent ? 'is-paused' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => pickWord(sentence.index, wi)}
                        >
                          {wordItem.text}
                        </button> : <span className={wordCurrent ? 'reading-word is-current' : 'reading-word'}>{wordItem.text} </span>}
                        </span>
                      )
                    })}
                  </span>
                </p>
              )
            })}
          </article>
        </>
      )}
    </div>
  )
}
