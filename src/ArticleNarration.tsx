import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clearBookmark,
  loadBookmark,
  saveBookmark,
  sliceRange,
  snippetAt,
  splitSentences,
  type ArticleSentence,
  type NarrationBookmark,
} from './articleText'
import {
  primeNarrationAudio,
  speakSentences,
  type SpeakHandle,
  type SpeakProgress,
  type SpeechStatus,
} from './speechReader'

type SelectMode = 'start' | 'end'

type ArticlePayload = {
  title: string
  text: string
  source: string
}

export function ArticleNarration({
  articleId,
  title,
  source,
  onClose,
}: {
  articleId: string
  title: string
  source: string
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [article, setArticle] = useState<ArticlePayload | null>(null)
  const [sentences, setSentences] = useState<ArticleSentence[]>([])
  const [selectMode, setSelectMode] = useState<SelectMode>('start')
  const [startSentence, setStartSentence] = useState(0)
  const [startWord, setStartWord] = useState(0)
  const [endSentence, setEndSentence] = useState<number | null>(null)
  const [endWord, setEndWord] = useState<number | null>(null)
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [detail, setDetail] = useState('')
  const [progress, setProgress] = useState<SpeakProgress | null>(null)
  const [bookmark, setBookmark] = useState<NarrationBookmark | null>(null)
  const speechRef = useRef<SpeakHandle | null>(null)
  const sentencesRef = useRef<ArticleSentence[]>([])
  const rangeRef = useRef({ startSentence: 0, startWord: 0, endSentence: null as number | null, endWord: null as number | null })
  const articleMeta = useRef({ articleId, title, source })

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
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const path = new URL(source).pathname
    fetch('/api/article-text?' + new URLSearchParams({ path }), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Impossibile leggere il testo dell’articolo.')
        return res.json() as Promise<{ title?: string; text?: string; source?: string }>
      })
      .then((data) => {
        if (!data.text?.trim()) throw new Error('Testo articolo non trovato.')
        const payload: ArticlePayload = {
          title: data.title || title,
          text: data.text,
          source: data.source || source,
        }
        const units = splitSentences(payload.text)
        setArticle(payload)
        setSentences(units)
        const saved = loadBookmark(articleId)
        setBookmark(saved)
        if (saved && saved.sentenceIndex < units.length) {
          setStartSentence(saved.sentenceIndex)
          setStartWord(Math.min(saved.wordIndex, Math.max(0, units[saved.sentenceIndex].words.length - 1)))
          setEndSentence(
            saved.endSentenceIndex !== null && saved.endSentenceIndex < units.length
              ? saved.endSentenceIndex
              : null,
          )
          setEndWord(saved.endWordIndex)
          setSelectMode('start')
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
  }, [articleId, source, title])

  function persistFromProgress(p: SpeakProgress | null, units = sentencesRef.current) {
    if (!p || !units.length) return
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
    }
    saveBookmark(next)
    setBookmark(next)
  }

  useEffect(() => {
    const onHide = () => {
      const handle = speechRef.current
      if (!handle) return
      handle.pause()
      persistFromProgress(handle.getProgress())
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      onHide()
      speechRef.current?.stop()
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

  async function startPlayback(fromBookmark = false) {
    if (!sentences.length || status === 'loading') return
    primeNarrationAudio()
    speechRef.current?.stop()

    let from = startSentence
    let word = startWord
    let to = endSentence
    let toWord = endWord

    if (fromBookmark && bookmark) {
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
      sentenceIndex: sliced.from,
      wordIndex: sliced.firstWord,
      queueIndex: 0,
      queueLength: sliced.texts.length,
    })

    speechRef.current = await speakSentences(sliced.texts, {
      sentenceIndexes: sliced.sentenceIndexes,
      firstWordOffset: sliced.firstWord,
      voice: 'isabella',
      onStatus(next, info) {
        setStatus(next)
        if (info) setDetail(info)
        if (next === 'paused' || next === 'speaking') {
          persistFromProgress(speechRef.current?.getProgress() ?? null)
        }
        if (next === 'idle') {
          clearBookmark(articleId)
          setBookmark(null)
          setProgress(null)
        }
      },
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
    if (status === 'paused') {
      primeNarrationAudio()
      speechRef.current?.resume()
    }
  }

  function stopPlayback() {
    const p = speechRef.current?.getProgress() ?? progress
    persistFromProgress(p)
    speechRef.current?.stop()
    speechRef.current = null
    setStatus('idle')
    setDetail('')
  }

  function resetRange() {
    setStartSentence(0)
    setStartWord(0)
    setEndSentence(null)
    setEndWord(null)
    setSelectMode('start')
  }

  const pausedHere = status === 'paused' && progress
  const currentSentence = progress?.sentenceIndex
  const currentWord = progress?.wordIndex

  const statusLine = useMemo(() => {
    if (status === 'loading') return 'Preparazione voce Isabella…'
    if (status === 'speaking' && progress) {
      return `In lettura · frase ${progress.sentenceIndex + 1} di ${sentences.length}`
    }
    if (pausedHere && progress) {
      return `In pausa qui: «${snippetAt(sentences, progress.sentenceIndex, progress.wordIndex)}»`
    }
    if (detail) return detail
    return ''
  }, [status, progress, pausedHere, sentences, detail])

  return (
    <div className="article-narration" role="region" aria-label="Lettura articolo con Isabella">
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
          {bookmark && status === 'idle' && (
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

          <p className="section-lede narration-hint">
            Tocca una <strong>frase</strong> o una <strong>parola</strong> per segnare{' '}
            {selectMode === 'start' ? 'dove far partire' : 'dove far terminare'} l’audio.
            {endSentence === null
              ? ` Inizio: frase ${startSentence + 1}. Fine: fino in fondo.`
              : ` Brano: frasi ${startSentence + 1}–${endSentence + 1}.`}
          </p>

          <div className="narration-controls">
            {status === 'speaking' || status === 'paused' ? (
              <>
                <button type="button" className="btn primary" onClick={togglePause}>
                  {status === 'speaking'
                    ? 'Pausa'
                    : detail.includes('Tocca')
                      ? 'Tocca per ascoltare'
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
          </div>

          {statusLine && (
            <p className="narration-status" role="status">
              {statusLine}
            </p>
          )}
          {status === 'error' && detail && (
            <p className="error" role="alert">
              {detail}
            </p>
          )}

          <article className="article-body">
            {sentences.map((sentence) => {
              const isCurrent = currentSentence === sentence.index
              const isPaused = Boolean(pausedHere && isCurrent)
              const selected = inRange(sentence.index)
              return (
                <p
                  key={sentence.index}
                  className={[
                    'article-sentence',
                    selected ? 'in-range' : '',
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
                    aria-label={`Frase ${sentence.index + 1}: seleziona come ${selectMode === 'start' ? 'inizio' : 'fine'}`}
                  >
                    {sentence.index + 1}
                  </button>
                  <span className="sentence-words">
                    {sentence.words.map((word, wi) => {
                      const wordCurrent =
                        isCurrent && currentWord !== undefined && wi === currentWord
                      const wordSelected = inRange(sentence.index, wi)
                      return (
                        <button
                          key={word.id}
                          type="button"
                          className={[
                            'article-word',
                            wordSelected ? 'in-range' : '',
                            wordCurrent ? 'is-current' : '',
                            isPaused && wordCurrent ? 'is-paused' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => pickWord(sentence.index, wi)}
                        >
                          {word.text}
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
