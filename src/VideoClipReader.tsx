import { ArticleNarration } from './ArticleNarration'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from './catalog'
import { ShareAudioButtons } from './ShareAudioButtons'
import {
  clearVideoBookmark,
  loadVideoBookmark,
  pushRecent,
  saveVideoBookmark,
} from './recentStore'
import {
  cueMatchesQuery,
  fetchSubtitles,
  formatCueTime,
  wordMatchesQuery,
  type SubtitleCue,
} from './subtitles'

type SelectMode = 'start' | 'end'

function CueText({ text, query }: { text: string; query: string }) {
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, index) => {
        if (/^\s+$/.test(part) || !part) {
          return <span key={index}>{part}</span>
        }
        const hit = Boolean(query.trim()) && wordMatchesQuery(part, query)
        return (
          <span key={index} className={hit ? 'search-hit' : undefined}>
            {part}
          </span>
        )
      })}
    </>
  )
}

export function VideoClipReader({
  track,
  query = '',
  onClose,
  onPlayClip,
  onNarrationChange,
  currentTime = 0,
  playingTrackId = null,
}: {
  track: Track & { subtitleUrl: string; source?: string }
  query?: string
  onClose: () => void
  onNarrationChange?: (open: boolean) => void
  onPlayClip: (clip: Track, startSeconds: number) => void
  currentTime?: number
  playingTrackId?: string | null
}) {
  const [readerOpen, setReaderOpen] = useState(false)
  useEffect(() => {
    onNarrationChange?.(readerOpen)
    return () => onNarrationChange?.(false)
  }, [readerOpen, onNarrationChange])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [selectMode, setSelectMode] = useState<SelectMode>('start')
  const [startIndex, setStartIndex] = useState(0)
  const [endIndex, setEndIndex] = useState<number | null>(null)
  const [jumpNote, setJumpNote] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const firstHitRef = useRef<HTMLElement | null>(null)
  const saved = loadVideoBookmark(track.id)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setSavedNote('')
    fetchSubtitles(track.subtitleUrl, controller.signal)
      .then((parsed) => {
        if (controller.signal.aborted) return
        if (!parsed.length) throw new Error('Nessuna riga di sottotitoli trovata.')
        setCues(parsed)
        const bookmark = loadVideoBookmark(track.id)
        if (
          bookmark &&
          bookmark.startCueIndex >= 0 &&
          bookmark.startCueIndex < parsed.length
        ) {
          setStartIndex(bookmark.startCueIndex)
          setEndIndex(
            bookmark.endCueIndex != null && bookmark.endCueIndex < parsed.length
              ? bookmark.endCueIndex
              : bookmark.startCueIndex,
          )
          setSelectMode('end')
          setJumpNote(`Ripresa salvata · «${bookmark.snippet}»`)
        } else {
          const hit = query.trim()
            ? parsed.findIndex((cue) => cueMatchesQuery(cue.text, query))
            : -1
          if (hit >= 0) {
            setStartIndex(hit)
            setEndIndex(hit)
            setSelectMode('end')
            setJumpNote(`Prima occorrenza di «${query.trim()}» a ${formatCueTime(parsed[hit].start)}`)
          } else {
            setStartIndex(0)
            setEndIndex(null)
            setSelectMode('start')
            setJumpNote('')
          }
        }
        setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Caricamento sottotitoli non riuscito')
        setLoading(false)
      })
    return () => controller.abort()
  }, [track.subtitleUrl, query, track.id])

  useEffect(() => {
    if (loading || !firstHitRef.current) return
    firstHitRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [loading, cues, startIndex])

  const rangeEnd = endIndex === null ? cues.length - 1 : endIndex
  const startCue = cues[startIndex]
  const endCue = cues[rangeEnd]

  const activeCueIndex = useMemo(() => {
    if (playingTrackId !== track.id || !cues.length) return -1
    return cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end)
  }, [playingTrackId, track.id, cues, currentTime])

  function pickCue(index: number) {
    if (selectMode === 'start') {
      setStartIndex(index)
      setEndIndex((previous) =>
        previous === null ? previous : Math.max(index, previous),
      )
      setSelectMode('end')
      return
    }
    setEndIndex(Math.max(index, startIndex))
  }

  function resetRange() {
    setStartIndex(0)
    setEndIndex(null)
    setSelectMode('start')
    setJumpNote('')
  }

  function jumpToNextHit() {
    if (!query.trim() || !cues.length) return
    const from = Math.max(startIndex, endIndex ?? startIndex) + 1
    let next = cues.findIndex((cue, index) => index >= from && cueMatchesQuery(cue.text, query))
    if (next < 0) next = cues.findIndex((cue) => cueMatchesQuery(cue.text, query))
    if (next < 0) {
      setJumpNote('Nessuna altra occorrenza nei sottotitoli')
      return
    }
    setStartIndex(next)
    setEndIndex(next)
    setSelectMode('end')
    setJumpNote(`Occorrenza a ${formatCueTime(cues[next].start)}`)
  }

  function persistBookmark() {
    if (!startCue || !endCue) return
    saveVideoBookmark({
      trackId: track.id,
      title: track.title,
      url: track.url,
      source: track.source,
      subtitleUrl: track.subtitleUrl,
      duration: track.duration,
      sectionSlug: track.sectionSlug,
      sectionName: track.sectionName,
      clipStart: startCue.start,
      clipEnd: endCue.end,
      startCueIndex: startIndex,
      endCueIndex: endIndex,
      query: query.trim() || undefined,
      snippet: startCue.text.slice(0, 80),
      updatedAt: Date.now(),
    })
    setSavedNote('Brano salvato · riprendi da qui')
  }

  function playSelected() {
    if (!startCue || !endCue) return
    const clip: Track = {
      ...track,
      clipStart: startCue.start,
      clipEnd: endCue.end,
    }
    pushRecent({
      id: `video:${track.id}:${startCue.start}-${endCue.end}`,
      title: track.title,
      kind: 'video',
      track: clip,
      source: track.source,
      clipStart: startCue.start,
      clipEnd: endCue.end,
      query: query.trim() || undefined,
    })
    persistBookmark()
    onPlayClip(clip, startCue.start)
  }

  const hitCount = useMemo(
    () => (query.trim() ? cues.filter((cue) => cueMatchesQuery(cue.text, query)).length : 0),
    [cues, query],
  )

  if (readerOpen && cues.length && !loading && !error) {
    return <ArticleNarration key={track.id} articleId={'subtitles:' + track.id}
      title={track.title} source={track.source || track.url}
      transcript={cues.map(cue => cue.text).join(' ')} onClose={() => setReaderOpen(false)} />
  }

  return (
    <div className="article-narration video-clip-reader" role="region" aria-label="Sottotitoli video">
      <header className="article-narration-head">
        <button type="button" className="btn ghost small" onClick={onClose}>
          ← Chiudi
        </button>
        <h3>{track.title}</h3>
        {track.source && (
          <a href={track.source} target="_blank" rel="noreferrer">
            Apri su JW.org ↗
          </a>
        )}
      </header>

      {loading && <p role="status">Carico i sottotitoli…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          <button type="button" className="btn primary" onClick={() => setReaderOpen(true)}>
            Ascolta i sottotitoli con la voce salvata
          </button>
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
              Tutto il video
            </button>
            {hitCount > 0 && (
              <button type="button" className="btn ghost small" onClick={jumpToNextHit}>
                Prossima «{query.trim()}»
              </button>
            )}
          </div>

          <p className="section-lede narration-hint">
            Modalità <strong>{selectMode === 'start' ? 'Inizio' : 'Fine'}</strong>: tocca una riga
            dei sottotitoli.
            {startCue && endCue
              ? ` Brano da ${formatCueTime(startCue.start)} a ${formatCueTime(endCue.end)}.`
              : ''}
            {query.trim()
              ? hitCount
                ? ` «${query.trim()}» compare in ${hitCount} ${hitCount === 1 ? 'riga' : 'righe'}.`
                : ` «${query.trim()}» non compare nei sottotitoli.`
              : ''}
          </p>
          {jumpNote && <p className="narration-status">{jumpNote}</p>}

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
              In ascolto
            </span>
            {query.trim() && (
              <span>
                <span className="range-swatch hit" />
                Parola cercata
              </span>
            )}
          </p>

          <div className="narration-controls">
            <button type="button" className="btn primary" onClick={playSelected}>
              Ascolta il brano selezionato
            </button>
            <button type="button" className="btn ghost" onClick={persistBookmark}>
              Salva brano
            </button>
            {saved && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  clearVideoBookmark(track.id)
                  setSavedNote('Segnalibro rimosso')
                }}
              >
                Rimuovi salvataggio
              </button>
            )}
          </div>
          <div className="result-actions">
            <ShareAudioButtons
              track={{
                ...track,
                contentKind: 'video',
                clipStart: startCue?.start,
                clipEnd: endCue?.end,
              }}
            />
          </div>
          {savedNote && <p className="narration-status">{savedNote}</p>}

          <div className="article-body subtitle-cues">
            {cues.map((cue) => {
              const selected = cue.index >= startIndex && cue.index <= rangeEnd
              const isStart = cue.index === startIndex
              const isEnd = endIndex !== null && cue.index === endIndex
              const isCurrent = cue.index === activeCueIndex
              const isHit = Boolean(query.trim()) && cueMatchesQuery(cue.text, query)
              const isFirstHit =
                isHit &&
                cues.findIndex((item) => cueMatchesQuery(item.text, query)) === cue.index
              return (
                <article
                  key={cue.index}
                  className={[
                    'article-sentence',
                    'subtitle-cue',
                    selected ? 'in-range' : '',
                    isStart ? 'is-range-start' : '',
                    isEnd ? 'is-range-end' : '',
                    isCurrent ? 'is-current' : '',
                    isHit ? 'has-search-hit' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={(el) => {
                    if (isFirstHit) firstHitRef.current = el
                  }}
                >
                  <button
                    type="button"
                    className="sentence-pick"
                    onClick={() => pickCue(cue.index)}
                    aria-label={`Riga ${cue.index + 1}, ${formatCueTime(cue.start)}`}
                  >
                    <span>{formatCueTime(cue.start)}</span>
                    {isStart && <span className="sentence-marker">Inizio</span>}
                    {isEnd && <span className="sentence-marker">Fine</span>}
                  </button>
                  <button
                    type="button"
                    className="subtitle-cue-text"
                    onClick={() => pickCue(cue.index)}
                  >
                    <CueText text={cue.text} query={query} />
                  </button>
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
