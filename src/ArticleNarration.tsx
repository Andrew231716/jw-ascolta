import { hasPersonalVoiceToken, setPersonalVoiceToken, forgetVoiceSample, hasVoiceSample, saveVoiceSample } from './personalVoice'
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
  speakOriginalAudio,
  speakSentences,
  type NarrationRate,
  type NarrationVoiceId,
  type SpeakHandle,
  type SpeakProgress,
  type SpeechStatus,
} from './speechReader'

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
  markers = [],
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
  const hasOriginal = Boolean(audioUrl)
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
      : fetch('/api/article-text?' + articleTextQuery(source), { signal: controller.signal })
          .then(async res => {
            if (!res.ok) throw new Error('Impossibile leggere il testo dell’articolo.')
            return res.json() as Promise<ArticlePayload>
          })
    content
      .then((data) => {
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
  }, [articleId, source, title, transcript, audioUrl, audioDuration, markers])

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
      speechRef.current = await speakOriginalAudio({
        url: audioUrl,
        start: times.start,
        end: times.end,
        sentences,
        rate,
        onStatus,
        onProgress(p) {
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

  function downloadAudio() {
    const chunks = audioChunksRef.current
    if (!chunks.length) {
      setShareNote('Ascolta almeno una frase, poi scarica.')
      return
    }
    const personal = chunks[0].type.includes('wav')
    const blob = personal ? chunks[chunks.length - 1] : new Blob(chunks, { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(article?.title || title || 'articolo').slice(0, 60)}.${personal ? 'wav' : 'mp3'}`
    a.click()
    URL.revokeObjectURL(url)
    setShareNote('Download avviato')
  }

  const pausedHere = status === 'paused' && progress
  const currentSentence = progress?.sentenceIndex
  const currentWord = progress?.wordIndex

  const statusLine = useMemo(() => {
    if (status === 'loading') {
      return voice === 'jw' ? 'Avvio audio JW.org…' : 'Preparazione voce…'
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
    <div className="article-narration" role="region" aria-label="Lettura articolo">
      <header className="article-narration-head">
        <button type="button" className="btn ghost small" onClick={onClose}>
          ← Chiudi
        </button>
        <h3>{article?.title || title}</h3>
      </header>

      {loading && <p role="status">Carico il testo da JW.org…</p>}
      {error && <p className="error" role="alert">{error}</p>}

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

          <div className="narration-toolbar" role="group" aria-label="Selezione brano">
            <button
              type="button"
              className={selectMode === 'start' ? 'chip active' : 'chip'}
              aria-pressed={selectMode === 'start'}
              onClick={() => setSelectMode('start')}
            >
              Inizio
            </button>
            <button
              type="button"
              className={selectMode === 'end' ? 'chip active' : 'chip'}
              aria-pressed={selectMode === 'end'}
              onClick={() => setSelectMode('end')}
            >
              Fine
            </button>
            <button type="button" className="btn ghost small" onClick={resetRange}>
              Tutto l’articolo
            </button>
          </div>

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
                    try { localStorage.setItem('jw-narrator', next) } catch { /* session only */ }
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
                Ascolti la registrazione ufficiale JW.org dal punto che scegli, frase per frase.
              </p>
            )}
            {voice === 'personal' && <fieldset disabled={status === 'loading' || status === 'speaking' || status === 'paused'}>
              <legend>Il tuo memo vocale</legend>
              <p>Premendo Ascolta, il memo e il testo selezionato vengono inviati alla demo pubblica Chatterbox. La demo può avere code o limiti di utilizzo.</p>
              <label>{sampleReady ? 'Sostituisci memo' : 'Scegli un memo da File'}
                <input type="file" accept="audio/*,.m4a,.wav,.mp3" onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  e.target.value = ''
                  try { await saveVoiceSample(file); setSampleReady(true); setSampleError('') }
                  catch (err) { setSampleError(err instanceof Error ? err.message : 'Salvataggio non riuscito.') }
                }} />
              </label>
              {sampleReady && <small>Memo salvato su questo dispositivo.</small>}
              {sampleReady && <button type="button" className="btn ghost" onClick={() => {
                forgetVoiceSample(); setSampleReady(false)
              }}>Rimuovi memo dal dispositivo</button>}
              <details>
                <summary>Quota del mio account Hugging Face</summary>
                <p>Il token viene usato solo per Chatterbox e viene dimenticato ricaricando la pagina.</p>
                <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">Gestisci token su Hugging Face</a>
                {tokenSet ? <button type="button" className="btn ghost" onClick={() => {
                  setPersonalVoiceToken(''); setTokenSet(false)
                }}>Scollega account</button> : <div><label>Token personale
                  <input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false}
                    ref={tokenField} />
                  </label>
                  <button type="button" className="btn ghost" onClick={() => {
                      const value = tokenField.current?.value.trim()
                      if (!value) return
                      if (!/^hf_[a-zA-Z0-9]+$/.test(value)) {
                        setSampleError('Inserisci un token Hugging Face che inizi con hf_.')
                        return
                      }
                      setPersonalVoiceToken(value); setTokenSet(true); setSampleError('')
                    }}>Usa token</button>
                </div>}
              </details>
              {sampleError && <p role="alert">{sampleError}</p>}
            </fieldset>}
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
          </div>

          <p className="section-lede narration-hint">
            Modalità <strong>{selectMode === 'start' ? 'Inizio' : 'Fine'}</strong>:
            tocca una frase o una parola. Ora:{' '}
            {endSentence === null
              ? `da frase ${startSentence + 1} fino in fondo`
              : `frasi ${startSentence + 1}–${endSentence + 1}`}
            .
          </p>
          <p className="narration-range-legend" aria-hidden="true">
            <span>
              <span className="range-swatch start" />
              Inizio
            </span>
            <span>
              <span className="range-swatch end" />
              Fine / brano
            </span>
            <span>
              <span className="range-swatch play" />
              In lettura
            </span>
          </p>

          <div className="narration-controls">
            <button type="button" className="btn primary" disabled={status === 'loading' || !sentences.length}
              onClick={() => void startPlayback(false, true)}>
              {transcript === undefined ? 'Leggi tutto l’articolo' : 'Leggi tutti i sottotitoli'}
            </button>
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
                {status === 'loading' ? 'Preparazione…' : 'Ascolta il brano selezionato'}
              </button>
            )}
            {status === 'loading' && <button type="button" className="btn ghost" onClick={stopPlayback}>Annulla</button>}
            {transcript === undefined && <button type="button" className="btn ghost small" onClick={() => void shareRange()}>
              Condividi brano
            </button>}
            {voice !== 'jw' && (
              <button type="button" className="btn ghost small" onClick={downloadAudio}>
                {voice === 'personal' ? 'Scarica ultima frase pronta' : 'Scarica audio'}
              </button>
            )}
            {voice === 'jw' && audioUrl && (
              <a className="btn ghost small" href={audioUrl} target="_blank" rel="noreferrer">
                Apri MP3 JW.org ↗
              </a>
            )}
          </div>

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
                  ref={(el) => {
                    if (el && isCurrent) {
                      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                    }
                  }}
                >
                  <button
                    type="button"
                    className="sentence-pick"
                    onClick={() => pickSentence(sentence.index)}
                    aria-label={`Frase ${sentence.index + 1}${isStart ? ', inizio' : ''}${endSentence !== null && sentence.index === endSentence ? ', fine' : ''}`}
                  >
                    {sentence.index + 1}
                    {isStart && <span className="sentence-marker">Inizio</span>}
                    {endSentence !== null && sentence.index === endSentence && (
                      <span className="sentence-marker">Fine</span>
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
                        <button
                          key={wordItem.id}
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
                        </button>
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
