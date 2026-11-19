import { useEffect, useRef, useState } from 'react'
import { ArticleNarration } from './ArticleNarration'
import {
  clearBookmark,
  listBookmarks,
  loadBookmark,
  type NarrationBookmark,
} from './articleText'
import { formatDuration, normalizeTitle, type Track } from './catalog'
import { VideoClipReader } from './VideoClipReader'

type Kind = 'articles' | 'videos'
type BrowseKind = 'book' | 'magazine' | 'articles' | 'videos'
type BrowseItem = { id: string; name: string; kind: BrowseKind }
type BrowseSection = { id: string; name: string; hint: string; items: BrowseItem[] }
type AudioMarker = { pid: number; start: number; end: number }
type Entry = Track & {
  source: string
  topics: string[]
  description?: string
  matchIn?: string
  subtitleUrl?: string
  docid?: string
  canRead?: boolean
  markers?: AudioMarker[]
}
type Pending = {
  id: string
  title: string
  source: string
  reason: string
  matchIn?: string
}
type Page = {
  tracks: Entry[]
  pending?: Pending[]
  next: number | null
  failed?: number
}

type ReaderTarget = {
  id: string
  title: string
  source: string
  audioUrl?: string
  markers?: AudioMarker[]
  audioDuration?: number
}
type VideoReaderTarget = Entry & { subtitleUrl: string }

type Crumb = { label: string; action?: () => void }

function canOpenText(entry: Entry) {
  if (entry.canRead) return true
  if (entry.docid) return true
  try {
    const path = new URL(entry.source).pathname
    return (
      path.includes('/biblioteca-digitale/articoli/') ||
      path.includes('/cosa-dice-la-Bibbia/') ||
      /\/biblioteca-digitale\/libri\/.+\/.+\/.+/.test(path)
    )
  } catch {
    return false
  }
}

async function api<T>(
  kind: Kind,
  signal: AbortSignal,
  opts: { topic?: string; offset?: number; query?: string; browse?: boolean } = {},
): Promise<T> {
  const params = new URLSearchParams({ kind, offset: String(opts.offset ?? 0) })
  if (opts.topic) params.set('topic', opts.topic)
  if (opts.query) params.set('q', opts.query)
  if (opts.browse) params.set('browse', '1')
  const response = await fetch('/api/listening?' + params, { signal })
  if (!response.ok) throw new Error('Catalogo non disponibile. Riprova tra poco.')
  return response.json()
}

export function ListeningLibrary({
  active,
  onPlay,
  onAppend,
  later,
  onLater,
  collections,
  onSave,
  initialReader = null,
  onReaderClose,
  playbackTime = 0,
  playingTrackId = null,
  initialKind = 'articles',
  initialSearch = '',
}: {
  active: boolean
  onPlay: (tracks: Track[], index?: number, position?: number) => void
  onAppend: (track: Track) => void
  later: Track[]
  onLater: (track: Track) => void
  collections: { id: string; name: string }[]
  onSave: (id: string, track: Track) => void
  initialReader?: ReaderTarget | null
  onReaderClose?: () => void
  playbackTime?: number
  playingTrackId?: string | null
  initialKind?: Kind
  initialSearch?: string
}) {
  const [kind, setKind] = useState<Kind>(initialKind)
  const [sections, setSections] = useState<BrowseSection[]>([])
  const [sectionId, setSectionId] = useState('')
  const [topic, setTopic] = useState('')
  const [topicName, setTopicName] = useState('')
  const [topicKind, setTopicKind] = useState<BrowseKind | ''>('')
  const [tracks, setTracks] = useState<Entry[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingBrowse, setLoadingBrowse] = useState(true)
  const [query, setQuery] = useState(initialSearch)
  const [submitted, setSubmitted] = useState('')
  const [official, setOfficial] = useState('')
  const [reader, setReader] = useState<ReaderTarget | null>(initialReader)
  const [videoReader, setVideoReader] = useState<VideoReaderTarget | null>(null)
  const [bookmarks, setBookmarks] = useState<NarrationBookmark[]>(() => listBookmarks())
  const [bookmarkTick, setBookmarkTick] = useState(0)

  const browsing = !submitted
  const activeSection = sections.find((item) => item.id === sectionId) ?? null
  const atHome = browsing && !sectionId && !topic
  const atSection = browsing && Boolean(sectionId) && !topic
  const atTopic = Boolean(topic) || Boolean(submitted)

  useEffect(() => {
    if (initialReader) setReader(initialReader)
  }, [initialReader])

  const lastExternalSearch = useRef('')
  useEffect(() => {
    if (!active) return
    const nextQuery = initialSearch.trim()
    if (!nextQuery || nextQuery === lastExternalSearch.current) return
    lastExternalSearch.current = nextQuery
    setKind(initialKind)
    setQuery(nextQuery)
    setSectionId('')
    setTopic('')
    setTopicName('')
    setTopicKind('')
    setTracks([])
    setPending([])
    setNext(null)
    setOffset(0)
    setError('')
    setOfficial('')
    setLoading(true)
    setSubmitted(nextQuery)
    setRetry((value) => value + 1)
  }, [active, initialSearch, initialKind])

  useEffect(() => {
    if (!active) {
      setReader(null)
      setVideoReader(null)
    }
  }, [active])

  useEffect(() => {
    setBookmarks(listBookmarks())
  }, [bookmarkTick, active, reader])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoadingBrowse(true)
    api<{ sections: BrowseSection[] }>(kind, controller.signal, { browse: true })
      .then((data) => {
        const nextSections = data.sections ?? []
        setSections(nextSections)
        // Video: una sola sezione → mostra subito le categorie (come JW.org).
        if (kind === 'videos' && nextSections.length === 1 && !submitted && !topic) {
          setSectionId(nextSections[0].id)
        }
        setLoadingBrowse(false)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          setLoadingBrowse(false)
        }
      })
    return () => controller.abort()
  }, [active, kind])

  useEffect(() => {
    if (!topic && !submitted) return
    const controller = new AbortController()
    api<Page>(kind, controller.signal, {
      topic: topic || undefined,
      offset,
      query: submitted || undefined,
    })
      .then((data) => {
        if (controller.signal.aborted) return
        const entries = data.tracks.map(
          (track): Entry => ({
            ...track,
            sectionSlug: 'tutto',
            sectionName: track.topics.at(-1) ?? topicName,
          }),
        )
        setTracks((previous) =>
          [...new Map([...previous, ...entries].map((entry) => [entry.id, entry])).values()],
        )
        setPending((previous) =>
          [
            ...new Map(
              [...previous, ...(data.pending ?? [])].map((item) => [item.id, item]),
            ).values(),
          ],
        )
        setNext(data.next)
        setError(
          data.failed
            ? 'Alcuni audio non sono stati verificati. Riprova per completare questa pagina.'
            : '',
        )
        if (
          !topic &&
          submitted &&
          data.next !== null &&
          !data.failed &&
          !(data.tracks?.length) &&
          !(data.pending?.length)
        ) {
          setOffset(data.next)
          return
        }
        setLoading(false)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [kind, topic, offset, retry, submitted, topicName])

  function resetList() {
    setTracks([])
    setPending([])
    setOffset(0)
    setNext(null)
    setError('')
    setOfficial('')
  }

  function goHome() {
    setSectionId('')
    setTopic('')
    setTopicName('')
    setTopicKind('')
    setSubmitted('')
    setQuery('')
    resetList()
    setLoading(false)
  }

  function openSection(id: string) {
    setSectionId(id)
    setTopic('')
    setTopicName('')
    setTopicKind('')
    setSubmitted('')
    setQuery('')
    resetList()
    setLoading(false)
  }

  function openItem(item: BrowseItem) {
    setTopic(item.id)
    setTopicName(item.name)
    setTopicKind(item.kind)
    setSubmitted('')
    setQuery('')
    resetList()
    setLoading(true)
  }

  function openReader(target: ReaderTarget) {
    setReader(target)
  }

  const visible = tracks.filter(
    (track) => !official || track.topics.includes(official),
  )
  const officialOptions = [...new Set(tracks.flatMap((track) => track.topics.slice(1)))].sort()

  const crumbs: Crumb[] = [{ label: 'Ascolta', action: goHome }]
  if (activeSection) {
    crumbs.push({
      label: activeSection.name,
      action: topic || submitted ? () => openSection(activeSection.id) : undefined,
    })
  }
  if (topicName) crumbs.push({ label: topicName })
  if (submitted && !topic) crumbs.push({ label: `Ricerca «${submitted}»` })

  if (reader) {
    return (
      <section className="chooser listening-library">
        <ArticleNarration
          articleId={reader.id}
          title={reader.title}
          source={reader.source}
          audioUrl={reader.audioUrl}
          markers={reader.markers}
          audioDuration={reader.audioDuration}
          onClose={() => {
            setReader(null)
            setBookmarkTick((n) => n + 1)
            onReaderClose?.()
            const url = new URL(window.location.href)
            ;['article', 'articleUrl', 'articleTitle', 'ns', 'ne'].forEach((k) =>
              url.searchParams.delete(k),
            )
            window.history.replaceState({}, '', url)
          }}
        />
      </section>
    )
  }

  if (videoReader) {
    return (
      <section className="chooser listening-library">
        <VideoClipReader
          track={videoReader}
          query={submitted}
          currentTime={playbackTime}
          playingTrackId={playingTrackId}
          onClose={() => setVideoReader(null)}
          onPlayClip={(clip, startSeconds) => onPlay([clip], 0, startSeconds)}
        />
      </section>
    )
  }

  const sectionFilter = query.trim()
    ? (activeSection?.items ?? []).filter((item) =>
        normalizeTitle(item.name).includes(normalizeTitle(query)),
      )
    : activeSection?.items ?? []

  return (
    <section className="chooser listening-library">
      <h2>Ascolta</h2>

      {bookmarks.length > 0 && (
        <div className="narration-resume-banner">
          <div className="resume-banner-head">
            <p>
              <strong>In ascolto · riprendi</strong>
            </p>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                for (const item of listBookmarks()) clearBookmark(item.articleId)
                setBookmarks([])
                setBookmarkTick((n) => n + 1)
              }}
            >
              Elimina tutti
            </button>
          </div>
          <ul className="bookmark-list">
            {bookmarks.slice(0, 5).map((item) => (
              <li key={item.articleId} className="bookmark-row">
                <button
                  type="button"
                  className="btn ghost small bookmark-open"
                  onClick={() =>
                    openReader({
                      id: item.articleId,
                      title: item.title,
                      source: item.source,
                    })
                  }
                >
                  {item.title}
                  <span className="q-meta"> · «{item.snippet}»</span>
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Elimina ripresa di ${item.title}`}
                  onClick={() => {
                    clearBookmark(item.articleId)
                    setBookmarks(listBookmarks())
                    setBookmarkTick((n) => n + 1)
                  }}
                >
                  Elimina
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mode-toggle" role="group" aria-label="Tipo di contenuto">
        {(
          [
            ['articles', 'Testi'],
            ['videos', 'Video'],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            className={id === kind ? 'chip active' : 'chip'}
            aria-pressed={id === kind}
            onClick={() => {
              if (kind === id) return
              setKind(id)
              goHome()
              setLoadingBrowse(true)
              setSections([])
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <form
        className="title-row"
        onSubmit={(event) => {
          event.preventDefault()
          const title = normalizeTitle(query) ? query.trim() : ''
          if (!title && !topic) return
          // While browsing a section grid, filter locally first when possible.
          if (atSection && activeSection && title) {
            const localHits = activeSection.items.filter((item) =>
              normalizeTitle(item.name).includes(normalizeTitle(title)),
            )
            if (localHits.length === 1) {
              openItem(localHits[0])
              return
            }
            if (localHits.length > 1) {
              // Keep section view; sectionFilter already narrows the grid.
              return
            }
          }
          resetList()
          setSectionId('')
          if (!topic) {
            setTopicName('')
            setTopicKind('')
          }
          setLoading(true)
          setSubmitted(title)
          setRetry((value) => value + 1)
        }}
      >
        <input
          type="search"
          aria-label="Cerca parola o frase"
          placeholder={
            atSection
              ? 'Filtra in questa sezione…'
              : 'Cerca titolo o frase…'
          }
          maxLength={120}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn primary" disabled={!query.trim() && !topic}>
          Cerca
        </button>
      </form>

      <nav className="browse-crumbs" aria-label="Percorso">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="browse-crumb">
            {index > 0 && <span className="browse-crumb-sep" aria-hidden="true">›</span>}
            {crumb.action ? (
              <button type="button" className="browse-crumb-btn" onClick={crumb.action}>
                {crumb.label}
              </button>
            ) : (
              <span className="browse-crumb-current">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      {(loading || loadingBrowse) && (
        <p role="status">
          {loading && submitted && !topic && offset > 0
            ? kind === 'videos'
              ? `Cerco ancora nei sottotitoli… · ${tracks.length} trovati finora`
              : `Cerco ancora in altre categorie JW.org… · ${tracks.length + pending.length} trovati finora`
            : loading && submitted
              ? `Ricerca «${submitted}» in corso…`
              : loading
                ? 'Carico capitoli e articoli…'
                : 'Caricamento da JW.org…'}
        </p>
      )}

      {error && (
        <p role="alert">
          {error}{' '}
          <button
            className="btn ghost small"
            onClick={() => {
              setLoading(Boolean(topic || submitted))
              setError('')
              setRetry((value) => value + 1)
            }}
          >
            Riprova
          </button>
        </p>
      )}

      {atHome && !loadingBrowse && (
        <>
          <p className="section-lede">Scegli una sezione, poi un titolo.</p>
          <div className="browse-grid browse-sections" role="list">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className="browse-card browse-section-card"
                role="listitem"
                aria-label={`Apri sezione ${section.name}`}
                onClick={() => openSection(section.id)}
              >
                <span className="browse-card-mark" aria-hidden="true">
                  {section.id === 'books' ? 'L' : section.id === 'magazines' ? 'R' : section.id === 'videos' ? 'V' : 'A'}
                </span>
                <span className="browse-card-title">{section.name}</span>
                <span className="browse-card-meta">
                  {section.items.length}{' '}
                  {section.id === 'books'
                    ? 'libri'
                    : section.id === 'magazines'
                      ? 'riviste'
                      : section.id === 'videos'
                        ? 'categorie'
                        : 'sezioni'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {atSection && activeSection && (
        <>
          <p className="section-lede">
            {query.trim()
              ? `${sectionFilter.length} risultat${sectionFilter.length === 1 ? 'o' : 'i'} in ${activeSection.name}`
              : activeSection.hint}
          </p>
          <div className="browse-grid" role="list">
            {sectionFilter.map((item) => (
              <button
                key={item.id}
                type="button"
                className="browse-card"
                role="listitem"
                aria-label={
                  item.kind === 'book'
                    ? `Apri libro ${item.name}`
                    : item.kind === 'magazine'
                      ? `Apri rivista ${item.name}`
                      : item.kind === 'videos'
                        ? `Apri categoria video ${item.name}`
                        : `Apri categoria ${item.name}`
                }
                onClick={() => openItem(item)}
              >
                <span className="browse-card-mark" aria-hidden="true">
                  {(item.name.trim()[0] || '?').toLocaleUpperCase('it-IT')}
                </span>
                <span className="browse-card-title">{item.name}</span>
              </button>
            ))}
          </div>
          {query.trim() && !sectionFilter.length && (
            <p role="status">Nessun titolo corrisponde. Prova «Cerca» per cercare in tutto il catalogo.</p>
          )}
          <button type="button" className="btn ghost small" onClick={goHome}>
            ← Sezioni
          </button>
        </>
      )}

      {atTopic && (
        <>
          {!submitted && topicName && (
            <p className="section-lede">
              {topicKind === 'book'
                ? 'Tocca Ascolta oppure Frase per frase.'
                : topicKind === 'videos'
                  ? 'Tocca Ascolta oppure Frase per frase (sottotitoli).'
                  : 'Tocca Ascolta se c’è l’MP3, altrimenti Frase per frase.'}
            </p>
          )}

          {!loading && (submitted || topic) && (tracks.length > 0 || pending.length > 0) && (
            <p className="section-lede audio-summary" role="status">
              <span className="audio-badge has-audio">{visible.length} con audio</span>
              {kind === 'articles' && pending.length > 0 && (
                <span className="audio-badge no-audio">{pending.length} solo testo</span>
              )}
            </p>
          )}

          {tracks.length > 0 && officialOptions.length > 0 && (
            <label>
              Sottosezione
              <select value={official} onChange={(event) => setOfficial(event.target.value)}>
                <option value="">Tutte</option>
                {officialOptions.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          )}

          {(topic || submitted) &&
            next === null &&
            !loading &&
            !visible.length &&
            !pending.length &&
            !error && <p>Nessun contenuto trovato.</p>}

          {visible.length > 0 && (
            <div className="available-audio">
              <div className="browse-list-head">
                <h3>{topicKind === 'book' ? 'Capitoli' : 'Con audio'}</h3>
                <button className="btn primary small" onClick={() => onPlay(visible)}>
                  Ascolta tutti
                </button>
              </div>
              <ul className="library-list browse-chapter-list">
                {visible.map((track, index) => {
                  const readable = canOpenText(track)
                  return (
                    <li className="listening-result has-jw-audio browse-chapter" key={track.id}>
                      <button className="queue-item" onClick={() => onPlay(visible, index)}>
                        <span className="q-title">{track.title}</span>
                        <span className="q-meta">
                          {formatDuration(track.duration)}
                          {track.matchIn ? ` · ${track.matchIn}` : ''}
                        </span>
                      </button>
                      <div className="result-actions">
                        <button className="btn primary small" onClick={() => onPlay(visible, index)}>
                          Ascolta
                        </button>
                        {kind === 'articles' && readable && (
                          <button
                            className="btn ghost small"
                            onClick={() =>
                              openReader({
                                id: track.id,
                                title: track.title,
                                source: track.source,
                                audioUrl: track.url,
                                markers: track.markers,
                                audioDuration: track.duration,
                              })
                            }
                          >
                            Frase per frase
                          </button>
                        )}
                        {kind === 'videos' && track.subtitleUrl && (
                          <button
                            className="btn ghost small"
                            onClick={() =>
                              setVideoReader({ ...track, subtitleUrl: track.subtitleUrl! })
                            }
                          >
                            Frase per frase
                          </button>
                        )}
                        <details className="more-actions">
                          <summary>Altro</summary>
                          <div className="result-actions">
                            <button className="btn ghost small" onClick={() => onAppend(track)}>
                              In coda
                            </button>
                            <button
                              className="btn ghost small"
                              aria-pressed={later.some((item) => item.id === track.id)}
                              onClick={() => onLater(track)}
                            >
                              {later.some((item) => item.id === track.id)
                                ? 'Rimuovi da dopo'
                                : 'Ascolta dopo'}
                            </button>
                            {collections.length > 0 && (
                              <select
                                value=""
                                aria-label={`Salva ${track.title} in raccolta`}
                                onChange={(event) => onSave(event.target.value, track)}
                              >
                                <option value="">Salva in raccolta</option>
                                {collections.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <a
                              href={track.source}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Apri ${track.title} su JW.org`}
                            >
                              JW.org ↗
                            </a>
                          </div>
                        </details>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {pending.length > 0 && (
            <div className="pending-audio">
              <h3>Solo testo</h3>
              <ul className="library-list">
                {pending.map((item) => {
                  const saved = loadBookmark(item.id)
                  return (
                    <li className="listening-result pending" key={item.id}>
                      <div className="queue-item">
                        <span className="q-title">{item.title}</span>
                        <span className="q-meta">
                          {saved ? `Riprendi · «${saved.snippet}»` : 'Senza MP3 JW.org'}
                        </span>
                      </div>
                      <div className="result-actions">
                        <button className="btn primary small" onClick={() => openReader(item)}>
                          {saved ? 'Riprendi' : 'Frase per frase'}
                        </button>
                        <a href={item.source} target="_blank" rel="noreferrer">
                          JW.org ↗
                        </a>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {next !== null && (
            <button
              className="btn ghost"
              disabled={loading || Boolean(error)}
              onClick={() => {
                setLoading(true)
                setOffset(next)
              }}
            >
              {submitted && !topic
                ? kind === 'videos'
                  ? 'Cerca altri nei sottotitoli'
                  : 'Continua la ricerca'
                : 'Carica altri'}
            </button>
          )}

          {(sectionId || topic) && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                if (topic && activeSection) openSection(activeSection.id)
                else goHome()
              }}
            >
              ← Indietro
            </button>
          )}
        </>
      )}
    </section>
  )
}
