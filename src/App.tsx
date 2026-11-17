import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SECTIONS,
  buildPlaylist,
  fetchTracksForSlugs,
  formatDuration,
  parsePlayMode,
  normalizeTitle,
  type Track,
  playlistStartingAtTitle,
  resolveSectionInput,
  type PlayMode,
  type SectionSlug,
} from './catalog'
import { listBookmarks } from './articleText'
import { useAudioPlayer } from './useAudioPlayer'
import { ListeningLibrary } from './ListeningLibrary'
import './App.css'

type View = 'home' | 'siri'

type Session = { tracks: Track[]; index: number; position: number; updatedAt?: number }
type Collection = { id: string; name: string; tracks: Track[] }
type ResumeReader = { id: string; title: string; source: string }

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false
  const t = value as Track
  return typeof t.id === 'string' && typeof t.title === 'string' && typeof t.url === 'string'
}

function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem('jw-ascolta:' + key)
    if (!value) return fallback
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function readSession(): Session | null {
  const raw = readSaved<Session | null>('session', null)
  if (!raw || !Array.isArray(raw.tracks) || !raw.tracks.every(isTrack)) return null
  if (!Number.isFinite(raw.index) || !raw.tracks[raw.index]) return null
  return {
    tracks: raw.tracks,
    index: raw.index,
    position: Number(raw.position) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  }
}

function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem('jw-ascolta:' + key, JSON.stringify(value))
  } catch {
    // L'ascolto funziona anche senza spazio di archiviazione.
  }
}

function readQuery() {
  const params = new URLSearchParams(window.location.search)
  const sectionsRaw =
    params.get('s') ||
    params.get('section') ||
    params.get('sezioni') ||
    params.get('q') ||
    ''
  const mode = parsePlayMode(
    params.get('mode') || params.get('ordine') || params.get('shuffle'),
  )
  const shuffleParam = params.get('shuffle')
  const resolvedMode: PlayMode =
    shuffleParam === '0' || shuffleParam === 'false'
      ? 'order'
      : shuffleParam === '1' || shuffleParam === 'true'
        ? 'shuffle'
        : mode
  const autoplay =
    params.get('play') === '1' ||
    params.get('autoplay') === '1' ||
    params.get('play') === 'true'
  const view = params.get('view') === 'siri' ? 'siri' : 'home'
  const title =
    params.get('title') ||
    params.get('t') ||
    params.get('brano') ||
    params.get('canzone') ||
    ''
  const siriFocus =
    params.get('siri') === '1' ||
    params.get('focus') === '1' ||
    params.get('carplay') === '1' ||
    (autoplay && Boolean(title.trim()))
  const articleUrl = params.get('articleUrl') || ''
  const articleId = params.get('article') || ''
  const articleTitle = params.get('articleTitle') || ''
  const openLibrary =
    params.get('view') === 'library' || Boolean(articleUrl && articleId)
  return {
    sections: resolveSectionInput(sectionsRaw || 'tutto'),
    mode: resolvedMode,
    autoplay,
    view: view as View,
    title: title.trim(),
    siriFocus,
    openLibrary,
    initialReader:
      articleUrl && articleId
        ? { id: articleId, title: articleTitle || 'Articolo', source: articleUrl }
        : null,
  }
}

function buildShareUrl(
  sections: SectionSlug[],
  mode: PlayMode,
  title?: string,
) {
  const url = new URL(window.location.href)
  url.search = ''
  const s = sections.includes('tutto') ? 'tutto' : sections.join(',')
  url.searchParams.set('s', s)
  url.searchParams.set('mode', mode)
  url.searchParams.set('play', '1')
  if (title?.trim()) url.searchParams.set('title', title.trim())
  return url.toString()
}

export default function App() {
  const initial = useMemo(() => readQuery(), [])
  const [view, setView] = useState<View>(initial.view)
  const [selected, setSelected] = useState<SectionSlug[]>(
    initial.sections.includes('tutto') ? ['tutto'] : initial.sections,
  )
  const [mode, setMode] = useState<PlayMode>(initial.mode)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [later, setLater] = useState(() => readSaved<Track[]>('later', []))
  const [speed, setSpeed] = useState(1)
  const [stopAtEnd, setStopAtEnd] = useState(true)
  const [libraryOpen, setLibraryOpen] = useState(Boolean(initial.openLibrary))
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [titleQuery, setTitleQuery] = useState(initial.title)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const siriFocus = initial.siriFocus
  const player = useAudioPlayer()
  const autoplayStarted = useRef(false)
  const [saved] = useState(() => readSession())
  const [favorites, setFavorites] = useState(() =>
    readSaved<Track[]>('favorites', []).filter(isTrack),
  )
  const [collections, setCollections] = useState(() =>
    readSaved<Collection[]>('collections', []).filter(
      (c) => c && typeof c.id === 'string' && Array.isArray(c.tracks),
    ),
  )
  const [collectionName, setCollectionName] = useState('')
  const [results, setResults] = useState<Track[] | null>(null)
  const [timer, setTimer] = useState<number | null>(null)
  const [minutes, setMinutes] = useState('30')
  const nowRef = useRef<HTMLElement>(null)
  const [showMini, setShowMini] = useState(false)
  const lastSession = useRef<Session | null>(null)
  const [articleBookmarks, setArticleBookmarks] = useState(() => listBookmarks())
  const [resumeReader, setResumeReader] = useState<ResumeReader | null>(
    initial.initialReader,
  )
  const { playlist, index, currentTime, pause } = player

  useEffect(() => {
    player.setRepeat(!stopAtEnd)
  }, [stopAtEnd])

  useEffect(() => {
    setArticleBookmarks(listBookmarks())
  }, [libraryOpen])

  useEffect(() => {
    if (!playlist[index]) return
    lastSession.current = {
      tracks: playlist,
      index,
      position: currentTime,
      updatedAt: Date.now(),
    }
  }, [playlist, index, currentTime])

  useEffect(() => {
    const persist = () => {
      if (lastSession.current) {
        saveLocal('session', {
          ...lastSession.current,
          updatedAt: Date.now(),
        })
      }
    }
    const interval = window.setInterval(persist, 5000)
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', persist)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', persist)
    }
  }, [])

  useEffect(() => saveLocal('later', later), [later])

  useEffect(() => saveLocal('favorites', favorites), [favorites])
  useEffect(() => saveLocal('collections', collections), [collections])

  useEffect(() => {
    if (timer === null) return
    const stop = () => {
      if (Date.now() < timer) return
      pause()
      setTimer(null)
    }
    const timeout = window.setTimeout(stop, Math.max(0, timer - Date.now()))
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [timer, pause])

  useEffect(() => {
    if (view !== 'home' || !nowRef.current) return
    const observer = new IntersectionObserver(([entry]) => setShowMini(!entry.isIntersecting))
    observer.observe(nowRef.current)
    return () => observer.disconnect()
  }, [view])

  function toggleFavorite(track: Track) {
    setFavorites((previous) =>
      previous.some((item) => item.id === track.id)
        ? previous.filter((item) => item.id !== track.id)
        : [...previous, track],
    )
  }

  async function searchCatalog() {
    const query = normalizeTitle(titleQuery)
    if (!query || catalogLoading) return
    setCatalogLoading(true)
    setResults(null)
    setStatus(null)
    try {
      const { tracks, unavailable } = await fetchTracksForSlugs(effectiveSlugs)
      if (unavailable.length) setStatus(`Categorie non disponibili: ${unavailable.join(", ")}`)
      setResults(tracks.filter((track) => normalizeTitle(track.title).includes(query)))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Catalogo non disponibile')
    } finally {
      setCatalogLoading(false)
    }
  }

  function playTracks(tracks: Track[], start = 0, position = 0) {
    setStatus(null)
    void player.setPlaylist(tracks, true, start, position)
  }


  const effectiveSlugs: SectionSlug[] = selected.includes('tutto')
    ? ['tutto']
    : selected.length
      ? selected
      : ['tutto']

  async function startPlayback(
    slugs: SectionSlug[],
    playMode: PlayMode,
    autoplay: boolean,
    startTitle?: string,
  ) {
    setCatalogLoading(true)
    setStatus('Carico il catalogo da JW.org…')
    try {
      const { tracks, unavailable } = await fetchTracksForSlugs(slugs)
      let playlist = buildPlaylist(tracks, playMode)
      let matchedTitle: string | null = null

      if (startTitle?.trim()) {
        const { playlist: ordered, matched } = playlistStartingAtTitle(
          playlist,
          startTitle,
        )
        if (!matched) {
          setStatus(`Brano non trovato: «${startTitle.trim()}»`)
          return
        }
        playlist = ordered
        matchedTitle = matched.title
      }

      setStatus(
        playlist.length
          ? matchedTitle
            ? `Da «${matchedTitle}» · ${playlist.length} brani · poi continua`
            : `${playlist.length} brani · ${playMode === 'shuffle' ? 'casuale' : 'in ordine'}`
          : null,
      )
      if (unavailable.length) setStatus(`Categorie non disponibili: ${unavailable.join(", ")}`)
      await player.setPlaylist(playlist, autoplay, 0)

      const url = new URL(window.location.href)
      url.searchParams.set(
        's',
        slugs.includes('tutto') ? 'tutto' : slugs.join(','),
      )
      url.searchParams.set('mode', playMode)
      if (matchedTitle) url.searchParams.set('title', matchedTitle)
      else url.searchParams.delete('title')
      if (autoplay) url.searchParams.set('play', '1')
      else url.searchParams.delete('play')
      if (siriFocus) url.searchParams.set('siri', '1')
      window.history.replaceState({}, '', url)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Errore di rete')
    } finally {
      setCatalogLoading(false)
    }
  }

  useEffect(() => {
    if (!initial.autoplay || autoplayStarted.current) return
    autoplayStarted.current = true
    void startPlayback(
      initial.sections,
      initial.mode,
      true,
      initial.title || undefined,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.autoplay, initial.mode, initial.sections, initial.title])

  function toggleSection(slug: SectionSlug) {
    setResults(null)
    if (slug === 'tutto') {
      setSelected(['tutto'])
      return
    }
    setSelected((prev) => {
      const withoutAll = prev.filter((s) => s !== 'tutto')
      if (withoutAll.includes(slug)) {
        const next = withoutAll.filter((s) => s !== slug)
        return next.length ? next : ['tutto']
      }
      return [...withoutAll, slug]
    })
  }

  const progress =
    player.duration > 0 ? player.currentTime / player.duration : 0
  const shareUrl = buildShareUrl(effectiveSlugs, mode, titleQuery)
  const visibleCount = queueExpanded ? player.playlist.length : 40

  function openSiriGuide() {
    setView('siri')
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'siri')
    window.history.replaceState({}, '', url)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function closeSiriGuide() {
    setView('home')
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    window.history.replaceState({}, '', url)
  }

  if (view === 'siri') {
    return (
      <div className="app">
        <Atmosphere />
        <SiriGuide shareUrl={shareUrl} onBack={closeSiriGuide} />
      </div>
    )
  }

  return (
    <div className={siriFocus ? 'app siri-focus' : 'app'}>
      <Atmosphere />

      {player.needsGesture && player.current && (
        <button
          type="button"
          className="gesture-overlay"
          onClick={() => void player.resumeFromGesture()}
        >
          <span className="gesture-play">▶</span>
          <span className="gesture-title">Tocca per ascoltare</span>
          <span className="gesture-sub">{player.current.title}</span>
          <span className="gesture-hint">
            Il browser richiede un tocco per avviare l’audio.
          </span>
        </button>
      )}

      {!siriFocus && (
        <header className="hero">
          <div className="brand-lockup">
            <img src="/favicon.svg" width="56" height="56" alt="" />
            <h1 className="brand">JW Ascolta</h1>
          </div>
          <p className="lede">Musica, articoli audio e video da JW.org.</p>
          {(() => {
            if (player.current) return null
            const music = saved?.tracks[saved.index]
              ? {
                  kind: 'music' as const,
                  updatedAt: saved.updatedAt || 0,
                  title: saved.tracks[saved.index].title,
                  meta: formatDuration(saved.position),
                  run: () => playTracks(saved.tracks, saved.index, saved.position),
                }
              : null
            const article = articleBookmarks[0]
              ? {
                  kind: 'article' as const,
                  updatedAt: articleBookmarks[0].updatedAt || 0,
                  title: articleBookmarks[0].title,
                  meta: `Isabella · «${articleBookmarks[0].snippet}»`,
                  run: () => {
                    setResumeReader({
                      id: articleBookmarks[0].articleId,
                      title: articleBookmarks[0].title,
                      source: articleBookmarks[0].source,
                    })
                    setLibraryOpen(true)
                  },
                }
              : null
            const target =
              music && article
                ? article.updatedAt >= music.updatedAt
                  ? article
                  : music
                : music || article
            if (!target) return null
            return (
              <button
                className="btn primary resume-card"
                disabled={target.kind === 'music' && catalogLoading}
                onClick={target.run}
              >
                <span>▶ Riprendi ascolto</span>
                <span>{target.meta}</span>
                <span className="resume-title">{target.title}</span>
              </button>
            )
          })()}
          <nav className="top-nav" aria-label="Libreria">
            <button type="button" className="nav-link" aria-pressed={!libraryOpen}
              onClick={() => {
                setLibraryOpen(false)
                setResumeReader(null)
                setArticleBookmarks(listBookmarks())
              }}>Musica</button>
            <button type="button" className="nav-link" aria-pressed={libraryOpen}
              onClick={() => {
                setArticleBookmarks(listBookmarks())
                setLibraryOpen(true)
              }}>Articoli e video</button>
            <button type="button" className="nav-link" onClick={openSiriGuide}>Siri e CarPlay</button>
            <a className="nav-link" href="#libreria">La mia libreria</a>
          </nav>
          {!libraryOpen && <div className="cta-row">
            <button className="btn primary" disabled={catalogLoading}
              onClick={() => void startPlayback(['tutto'], 'shuffle', true)}>
              {catalogLoading ? 'Caricamento…' : 'Riproduci musica a caso'}
            </button>
          </div>}
        </header>
      )}

      {siriFocus && (
        <header className="siri-focus-bar">
          <p className="brand compact">JW Ascolta</p>
          <button type="button" className="nav-link" onClick={openSiriGuide}>
            Siri · CarPlay
          </button>
        </header>
      )}

      <section className="now" ref={nowRef} hidden={!player.current && !status && !(siriFocus && saved?.tracks[saved.index])}>
        {player.current ? (
          <>
            <div className="now-art-wrap">
              {player.current.image ? (
                <img
                  className="now-art"
                  src={player.current.image}
                  alt=""
                  width={120}
                  height={120}
                />
              ) : (
                <div className="now-art placeholder" />
              )}
            </div>
            <div className="now-meta">
              <p className="now-section">{player.current.sectionName}</p>
              <h2 className="now-title">{player.current.title}</h2>
              <p className="now-sub">
                {status ||
                  `${player.index + 1} / ${player.playlist.length} · ${
                    mode === 'shuffle' ? 'casuale' : 'in ordine'
                  }`}
              </p>
              <input
                className="seek-input"
                type="range"
                aria-label="Posizione di riproduzione"
                min={0}
                max={1000}
                value={Math.round(progress * 1000)}
                disabled={!player.duration}
                onChange={(event) => player.seek(Number(event.target.value) / 1000)}
              />
              <div className="times">
                <span>{formatDuration(player.currentTime)}</span>
                <span>{formatDuration(player.duration)}</span>
              </div>
              <div className="controls">
                <button className="icon-btn" onClick={player.playPrev} aria-label="Precedente">
                  ‹
                </button>
                <button
                  className="icon-btn play"
                  onClick={() => void player.toggle()}
                  aria-label={player.playing ? 'Pausa' : 'Riproduci'}
                >
                  {player.loading ? '…' : player.playing ? '❚❚' : '▶'}
                </button>
                <button className="icon-btn" onClick={player.playNext} aria-label="Successivo">
                  ›
                </button>
              </div>
              <button className="btn ghost small" onClick={() => toggleFavorite(player.current!)}
                aria-pressed={favorites.some((track) => track.id === player.current?.id)}>
                {favorites.some((track) => track.id === player.current?.id) ? '★ Nei preferiti' : '☆ Aggiungi ai preferiti'}
              </button>
              {player.error && <p className="error" role="alert">{player.error}</p>}
              {player.needsGesture && (
                <p className="gesture-inline">
                  Tocca ▶ qui sopra oppure il pulsante grande per avviare.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="now-empty">
            <p>{status || 'Nessun brano in riproduzione.'}</p>
            {siriFocus && saved?.tracks[saved.index] && (
              <button className="btn primary" disabled={catalogLoading}
                onClick={() => playTracks(saved.tracks, saved.index, saved.position)}>
                Riprendi · {saved.tracks[saved.index].title} · {formatDuration(saved.position)}
              </button>
            )}
          </div>
        )}
      </section>

      {player.current && (
        <section className="chooser listening-tools" aria-label="Timer di spegnimento">
          <button className="btn ghost small" onClick={() => player.skip(-15)}>−15 s</button>
          <button className="btn ghost small" onClick={() => player.skip(15)}>+15 s</button>
          <label>Velocità <select value={speed} onChange={(event) => {
            const rate = Number(event.target.value)
            setSpeed(rate)
            player.setSpeed(rate)
          }}>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
          <label>
            <input
              type="checkbox"
              checked={stopAtEnd}
              onChange={(event) => setStopAtEnd(event.target.checked)}
            />{' '}
            Ferma a fine coda
          </label>
          <label>Timer <select value={minutes} onChange={(event) => setMinutes(event.target.value)}>
            {[15, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}
          </select></label>
          <button className="btn ghost small" onClick={() =>
            setTimer(timer === null ? Date.now() + Number(minutes) * 60_000 : null)}>
            {timer === null ? 'Avvia timer' : 'Annulla timer'}
          </button>
          {timer !== null && <span role="status">Pausa alle {new Date(timer).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>}
        </section>
      )}

      {!siriFocus && <div hidden={!libraryOpen}>
        <ListeningLibrary
          active={libraryOpen}
          initialReader={resumeReader}
          onReaderClose={() => {
            setResumeReader(null)
            setArticleBookmarks(listBookmarks())
          }}
          onPlay={playTracks}
          onAppend={player.append}
          later={later}
          onLater={(track) => setLater((list) =>
            list.some((item) => item.id === track.id) ? list.filter((item) => item.id !== track.id) : [...list, track])}
          collections={collections}
          onSave={(id, track) => setCollections((list) => list.map((item) =>
            item.id === id && !item.tracks.some((savedTrack) => savedTrack.id === track.id)
              ? { ...item, tracks: [...item.tracks, track] } : item))}
        />
      </div>}

      {!siriFocus && !libraryOpen && (
      <section className="chooser" id="scegli">
        <h2>Sezioni</h2>
        <p className="section-lede">
          Seleziona una o più sezioni, oppure avvia da un titolo: poi continua
          da solo con il resto della coda.
        </p>

        <label className="title-search">
          <span>Cerca un brano</span>
          <div className="title-row">
            <input
              type="search"
              placeholder="es. Sorgerà"
              value={titleQuery}
              onChange={(e) => { setTitleQuery(e.target.value); setResults(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void searchCatalog() }}
            />
            <button className="btn primary" disabled={catalogLoading || !titleQuery.trim()}
              onClick={() => void searchCatalog()}>Cerca</button>
          </div>
        </label>
        {status && <p role="status">{status}</p>}
        {results && (
          <div aria-live="polite">
            <p>{results.length ? `Risultati: ${results.length}` : 'Nessun risultato nelle sezioni selezionate.'}</p>
            <TrackList tracks={results} onPlay={(i) => playTracks(results, i)} />
          </div>
        )}

        <div className="mode-toggle" role="group" aria-label="Modalità">
          <button
            className={mode === 'shuffle' ? 'chip active' : 'chip'}
            onClick={() => setMode('shuffle')}
          >
            Casuale
          </button>
          <button
            className={mode === 'order' ? 'chip active' : 'chip'}
            onClick={() => setMode('order')}
          >
            In ordine
          </button>
        </div>

        <div className="section-grid">
          <button
            className={
              selected.includes('tutto') ? 'section active' : 'section'
            }
            onClick={() => toggleSection('tutto')}
          >
            <span className="section-name">Tutto</span>
            <span className="section-hint">Tutte le sezioni audio</span>
          </button>
          {SECTIONS.map((s) => (
            <button
              key={s.slug}
              className={
                !selected.includes('tutto') && selected.includes(s.slug)
                  ? 'section active'
                  : 'section'
              }
              onClick={() => toggleSection(s.slug)}
            >
              <span className="section-name">{s.shortName}</span>
              <span className="section-hint">{s.name}</span>
            </button>
          ))}
        </div>

        <div className="cta-row sticky-actions">
          <button
            className="btn primary"
            disabled={catalogLoading}
            onClick={() =>
              void startPlayback(
                effectiveSlugs,
                mode,
                true,
              )
            }
          >
            {catalogLoading ? 'Carico…' : 'Riproduci selezione'}
          </button>
          <button type="button" className="btn ghost" onClick={openSiriGuide}>
            Siri e CarPlay
          </button>
        </div>
      </section>
      )}

      {!siriFocus && !libraryOpen && (
      <section className="siri-teaser" id="siri">
        <h2>Siri e CarPlay</h2>
        <p className="section-lede">
          Tutti i comandi (sezione, casuale, per titolo) funzionano in auto con
          Apri URL → /api/carplay. Guida sotto.
        </p>
        <div className="cta-row">
          <button type="button" className="btn primary" onClick={openSiriGuide}>
            Come configurarlo
          </button>
        </div>
      </section>
      )}

      {player.playlist.length > 0 && (
        <section className="queue">
          <h2>In coda · {player.playlist.length}</h2>
          <p className="section-lede">
            Trascina i brani o usa ↑ ↓ per cambiare ordine. La riproduzione
            continua da sola dopo il brano corrente.
          </p>
          <ul>
            {player.playlist.slice(0, visibleCount).map((t, i) => (
              <li
                key={`${t.id}-${i}`}
                className={
                  dragFrom === i
                    ? 'queue-row dragging'
                    : i === player.index
                      ? 'queue-row active'
                      : 'queue-row'
                }
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null) player.moveTrack(dragFrom, i)
                  setDragFrom(null)
                }}
                onDragEnd={() => setDragFrom(null)}
              >
                <span className="drag-handle" aria-hidden="true">
                  ⋮⋮
                </span>
                <button
                  className="queue-item"
                  onClick={() => player.jumpTo(i)}
                >
                  <span className="q-title">{t.title}</span>
                  <span className="q-meta">
                    {t.sectionName}
                    {t.duration ? ` · ${formatDuration(t.duration)}` : ''}
                  </span>
                </button>
                <div className="queue-move">
                  <button
                    type="button"
                    className="move-btn"
                    aria-label="Sposta su"
                    disabled={i === 0}
                    onClick={() => player.moveTrackBy(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="move-btn"
                    aria-label="Sposta giù"
                    disabled={i >= player.playlist.length - 1}
                    onClick={() => player.moveTrackBy(i, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!queueExpanded && player.playlist.length > 40 && (
            <button
              className="btn ghost small"
              onClick={() => setQueueExpanded(true)}
            >
              Mostra tutti i {player.playlist.length} brani
            </button>
          )}
        </section>
      )}

      {!siriFocus && (
        <section className="chooser" id="libreria" aria-label="Libreria personale">
          <h2>Ascolta dopo</h2>
          {later.length ? <TrackList tracks={later} onPlay={(index) => playTracks(later, index)}
            onRemove={(track) => setLater((list) => list.filter((item) => item.id !== track.id))} />
            : <p>Salva un articolo o un video dal catalogo per ritrovarlo qui.</p>}
          <h2>Preferiti e raccolte</h2>
          {favorites.length ? (
            <>
              <button className="btn ghost small" onClick={() => playTracks(favorites)}>Riproduci preferiti</button>
              <TrackList tracks={favorites} onPlay={(i) => playTracks(favorites, i)} onRemove={toggleFavorite} />
            </>
          ) : <p>Aggiungi un brano ai preferiti dal lettore.</p>}
          {playlist.length > 0 && (
            <form className="title-row" onSubmit={(event) => {
              event.preventDefault()
              const name = collectionName.trim()
              if (!name) return
              setCollections((previous) => [...previous, { id: crypto.randomUUID(), name, tracks: playlist }])
              setCollectionName('')
            }}>
              <input aria-label="Nome raccolta" placeholder="Nome raccolta" value={collectionName}
                maxLength={80} onChange={(event) => setCollectionName(event.target.value)} />
              <button className="btn primary small" disabled={!collectionName.trim()}>Salva coda</button>
            </form>
          )}
          <ul className="library-list">
            {collections.map((collection) => (
              <li className="collection-editor" key={collection.id}>
                <details>
                  <summary>Modifica {collection.name}</summary>
                  <form className="title-row" onSubmit={(event) => {
                    event.preventDefault()
                    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
                    if (name) setCollections((list) => list.map((item) => item.id === collection.id ? { ...item, name } : item))
                  }}>
                    <input name="name" aria-label="Nome raccolta" defaultValue={collection.name} maxLength={80} required />
                    <button className="btn ghost small">Rinomina</button>
                  </form>
                  <TrackList tracks={collection.tracks} onPlay={(index) => playTracks(collection.tracks, index)}
                    onRemove={(track) => setCollections((list) => list.map((item) => item.id === collection.id
                      ? { ...item, tracks: item.tracks.filter((entry) => entry.id !== track.id) } : item))} />
                </details>
                <button className="queue-item" onClick={() => playTracks(collection.tracks)}>
                  {collection.name} · {collection.tracks.length} brani
                </button>
                <button className="btn ghost small" aria-label={`Elimina ${collection.name}`}
                  onClick={() => setCollections((list) => list.filter((item) => item.id !== collection.id))}>Elimina</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showMini && player.current && (
        <aside className="mini-player" aria-label="Lettore compatto">
          <button className="queue-item" onClick={() => nowRef.current?.scrollIntoView({ block: 'center' })}>
            {player.current.title}
          </button>
          <button className="icon-btn" aria-label={player.playing ? 'Pausa' : 'Riproduci'}
            onClick={() => void player.toggle()}>{player.playing ? '❚❚' : '▶'}</button>
          <button className="icon-btn" aria-label="Successivo" onClick={player.playNext}>›</button>
        </aside>
      )}

      <footer className="foot">
        <p>
          Audio fornito pubblicamente da{' '}
          <a href="https://www.jw.org/it/biblioteca-digitale/musica/" rel="noreferrer" target="_blank">
            JW.org
          </a>
          . Uso personale. Non affiliato a Watch Tower.
        </p>
        <p>
          <button type="button" className="foot-link" onClick={openSiriGuide}>
            Siri e CarPlay
          </button>
        </p>
      </footer>
    </div>
  )
}

function TrackList({ tracks, onPlay, onRemove }: {
  tracks: Track[]
  onPlay: (index: number) => void
  onRemove?: (track: Track) => void
}) {
  return (
    <ul className="library-list">
      {tracks.map((track, index) => (
        <li key={track.id}>
          <button className="queue-item" onClick={() => onPlay(index)}>
            <span className="q-title">{track.title}</span>
            <span className="q-meta">{track.sectionName}</span>
          </button>
          {onRemove && <button className="btn ghost small" aria-label={`Rimuovi ${track.title} dai preferiti`}
            onClick={() => onRemove(track)}>Rimuovi</button>}
        </li>
      ))}
    </ul>
  )
}

function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <div className="mesh" />
    </div>
  )
}

function SiriGuide({
  shareUrl,
  onBack,
}: {
  shareUrl: string
  onBack: () => void
}) {
  const [copyStatus, setCopyStatus] = useState('')
  const [manualLink, setManualLink] = useState('')
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setManualLink('')
      setCopyStatus('Link copiato.')
    } catch {
      setCopyStatus('Copia automatica non disponibile. Seleziona il link qui sopra e copialo.')
      setManualLink(url)
    }
  }
  const origin = window.location.origin
  const carplayTitleBase = `${origin}/api/carplay?s=tutto&mode=shuffle&title=`
  const webTitleBase = `${origin}/?s=tutto&mode=shuffle&play=1&siri=1&title=`
  const titleExample = makeTitleExample('Sorgerà', 'tutto', 'shuffle')

  const carplayCommands = [
    {
      phrase: 'Hey Siri, riproduci da JW canzoni',
      url: makeCarplayUrl('canzoni', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW musica internazionale',
      url: makeCarplayUrl('musica-internazionale', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW musica in modo casuale',
      url: makeCarplayUrl('tutto', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW adunanze',
      url: makeCarplayUrl('adunanze', 'order'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW bambini',
      url: makeCarplayUrl('bambini', 'shuffle'),
    },
  ]

  return (
    <main className="siri-page">
      <button className="btn ghost back" onClick={onBack}>
        ← Indietro
      </button>
      <p className="brand">JW Ascolta</p>
      <h1>Siri e CarPlay</h1>
      <div className="copy-feedback">
        {manualLink && <input aria-label="Link da copiare" readOnly value={manualLink}
          onFocus={(event) => event.currentTarget.select()} />}
        <span role="status">{copyStatus}</span>
      </div>
      <p className="lede">
        Per iniziare, copia uno degli URL CarPlay qui sotto e incollalo
        nell’azione «Apri URL» di un nuovo comando su iPhone. Provalo prima di partire.
      </p>

      <div className="url-box highlight">
        <p className="label">Regola unica per CarPlay</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Per <strong>ogni</strong> comando (sezione, casuale, per titolo): in
          Comandi usa <strong>Apri URL</strong> verso{' '}
          <code style={{ display: 'inline' }}>/api/carplay</code>. La gestione
          della playlist dipende dall’app che apre il link su iPhone.
        </p>
      </div>

      <h2>1) Comandi fissi (sezione / casuale)</h2>
      <ol className="steps">
        <li>
          In <strong>Comandi</strong> → Nuovo comando → solo{' '}
          <strong>Apri URL</strong>.
        </li>
        <li>Incolla uno degli URL sotto.</li>
        <li>
          Dettagli comando → attiva esecuzione con schermo bloccato /{' '}
          <strong>Mostra in CarPlay</strong> se compare.
        </li>
        <li>
          <strong>Aggiungi a Siri</strong> con la frase desiderata.
        </li>
      </ol>

      <ul className="examples">
        {carplayCommands.map((ex) => (
          <li key={ex.phrase}>
            <p className="phrase">«{ex.phrase}»</p>
            <code>{ex.url}</code>
            <button
              className="btn ghost small"
              onClick={() => void copyLink(ex.url)}
            >
              Copia URL CarPlay
            </button>
          </li>
        ))}
      </ul>

      <h2>2) Per titolo (anche in auto)</h2>
      <ol className="steps">
        <li>
          <strong>Dettatura testo</strong>
        </li>
        <li>
          <strong>Codifica URL</strong> ← Testo dettato
        </li>
        <li>
          <strong>Testo</strong> = base sotto + variabile{' '}
          <strong>Testo codificato URL</strong>
        </li>
        <li>
          <strong>Apri URL</strong> ← variabile Testo
        </li>
        <li>
          <strong>Aggiungi a Siri</strong> → <strong>riproduci da JW</strong>
        </li>
      </ol>

      <div className="url-box highlight">
        <p className="label">Base CarPlay per titolo + coda</p>
        <code>{carplayTitleBase}</code>
        <button
          className="btn primary"
          onClick={() => void copyLink(carplayTitleBase)}
        >
          Copia base CarPlay
        </button>
      </div>

      <div className="url-box">
        <p className="label">Prova fissa (Sorgerà + coda)</p>
        <code>{makeCarplayUrl('tutto', 'shuffle', 'Sorgerà')}</code>
        <button
          className="btn ghost"
          onClick={() =>
            void copyLink(
              makeCarplayUrl('tutto', 'shuffle', 'Sorgerà'),
            )
          }
        >
          Copia
        </button>
      </div>

      <h2>3) In auto</h2>
      <ol className="steps">
        <li>Collega CarPlay.</li>
        <li>
          Di’ il comando Siri (es. «riproduci da JW canzoni» o «riproduci da JW»
          + titolo).
        </li>
        <li>
          Se la riproduzione si avvia, puoi usare «In riproduzione» per mettere
          in pausa o cambiare brano.
        </li>
      </ol>

      <div className="url-box">
        <p className="label">Nota Apple</p>
        <p className="section-lede" style={{ margin: 0 }}>
          JW Ascolta non può comparire come icona CarPlay (serve un’app nativa
          approvata da Apple). Con Siri + <strong>Apri URL</strong> verso{' '}
          <code style={{ display: 'inline' }}>/api/carplay</code> ottieni però
          gli stessi comandi vocali e la coda in Now Playing.
        </p>
      </div>

      <h2>Opzionale · app web a casa</h2>
      <p className="section-lede">
        A casa puoi ancora usare l’app (coda riordinabile, sezioni). Per Siri
        verso la pagina web: Mostra pagina web + base sotto (può servire un
        tap).
      </p>
      <div className="url-box">
        <p className="label">Base app web (non CarPlay)</p>
        <code>{webTitleBase}</code>
        <button
          className="btn ghost"
          onClick={() => void copyLink(webTitleBase)}
        >
          Copia base web
        </button>
      </div>
      <div className="url-box">
        <p className="label">Esempio web Sorgerà</p>
        <code>{titleExample}</code>
        <button
          className="btn ghost"
          onClick={() => void copyLink(titleExample)}
        >
          Copia
        </button>
      </div>
      <div className="url-box">
        <p className="label">URL selezione attuale (app)</p>
        <code>{shareUrl}</code>
        <button
          className="btn ghost"
          onClick={() => void copyLink(shareUrl)}
        >
          Copia URL
        </button>
      </div>
    </main>
  )
}

function makeCarplayUrl(sections: string, mode: PlayMode, title?: string) {
  const url = new URL(window.location.origin + '/api/carplay')
  url.searchParams.set('s', sections)
  url.searchParams.set('mode', mode)
  if (title?.trim()) url.searchParams.set('title', title.trim())
  return url.toString()
}

function makeTitleExample(title: string, sections: string, mode: PlayMode) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('s', sections)
  url.searchParams.set('mode', mode)
  url.searchParams.set('title', title)
  url.searchParams.set('play', '1')
  url.searchParams.set('siri', '1')
  return url.toString()
}
