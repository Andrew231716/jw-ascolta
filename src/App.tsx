import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SECTIONS,
  buildPlaylist,
  fetchTracksForSlugs,
  formatDuration,
  parsePlayMode,
  playlistStartingAtTitle,
  resolveSectionInput,
  type PlayMode,
  type SectionSlug,
} from './catalog'
import { useAudioPlayer } from './useAudioPlayer'
import './App.css'

type View = 'home' | 'siri'

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
  return {
    sections: resolveSectionInput(sectionsRaw || 'tutto'),
    mode: resolvedMode,
    autoplay,
    view: view as View,
    title: title.trim(),
    siriFocus,
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
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [titleQuery, setTitleQuery] = useState(initial.title)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [siriFocus, setSiriFocus] = useState(initial.siriFocus)
  const player = useAudioPlayer()
  const autoplayStarted = useRef(false)

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
      const tracks = await fetchTracksForSlugs(slugs)
      let playlist = buildPlaylist(tracks, playMode)
      let matchedTitle: string | null = null

      if (startTitle?.trim()) {
        const { playlist: ordered, matched } = playlistStartingAtTitle(
          playlist,
          startTitle,
        )
        if (!matched) {
          setStatus(`Brano non trovato: «${startTitle.trim()}»`)
          await player.setPlaylist([], false)
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
      if (siriFocus || matchedTitle) url.searchParams.set('siri', '1')
      window.history.replaceState({}, '', url)
      if (matchedTitle) setSiriFocus(true)
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
            iPhone blocca l’audio automatico da Siri. Un tap e continua anche
            coi brani successivi.
          </span>
        </button>
      )}

      {!siriFocus && (
        <nav className="top-nav" aria-label="Navigazione">
          <button type="button" className="nav-link" onClick={openSiriGuide}>
            Siri e CarPlay
          </button>
        </nav>
      )}

      {!siriFocus && (
        <header className="hero">
          <p className="brand">JW Ascolta</p>
          <h1 className="headline">Musica per lodare, quando vuoi.</h1>
          <p className="lede">
            Cantici, canzoni e musica internazionale da JW.org — in ordine, a
            caso, per titolo, o con Siri.
          </p>
          <div className="cta-row">
            <button
              className="btn primary"
              disabled={catalogLoading}
              onClick={() => void startPlayback(['tutto'], 'shuffle', true)}
            >
              Riproduci tutto a caso
            </button>
            <button type="button" className="btn ghost" onClick={openSiriGuide}>
              Siri e CarPlay
            </button>
          </div>
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

      <section className="now" aria-live="polite">
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
              <div
                className="seek"
                role="slider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                tabIndex={0}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  player.seek((e.clientX - rect.left) / rect.width)
                }}
              >
                <div className="seek-bar" style={{ width: `${progress * 100}%` }} />
              </div>
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
              {player.error && <p className="error">{player.error}</p>}
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
          </div>
        )}
      </section>

      {!siriFocus && (
      <section className="chooser" id="scegli">
        <h2>Sezioni</h2>
        <p className="section-lede">
          Seleziona una o più sezioni, oppure avvia da un titolo: poi continua
          da solo con il resto della coda.
        </p>

        <label className="title-search">
          <span>Avvia da titolo</span>
          <div className="title-row">
            <input
              type="search"
              placeholder="es. Sorgerà"
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && titleQuery.trim()) {
                  void startPlayback(
                    effectiveSlugs,
                    mode,
                    true,
                    titleQuery.trim(),
                  )
                }
              }}
            />
            <button
              className="btn primary"
              disabled={catalogLoading || !titleQuery.trim()}
              onClick={() =>
                void startPlayback(
                  effectiveSlugs,
                  mode,
                  true,
                  titleQuery.trim(),
                )
              }
            >
              Riproduci titolo
            </button>
          </div>
        </label>

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
                titleQuery.trim() || undefined,
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

      {!siriFocus && (
      <section className="siri-teaser" id="siri">
        <h2>Siri e CarPlay</h2>
        <p className="section-lede">
          Stesso comando «riproduci da JW» anche in auto: audio sul telefono, Now
          Playing su CarPlay. Guida sotto.
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
  const origin = window.location.origin
  const titleBase = `${origin}/?s=tutto&mode=shuffle&play=1&siri=1&title=`
  const carplayTitleBase = `${origin}/?s=tutto&mode=shuffle&play=1&siri=1&carplay=1&title=`
  const directPlayBase = `${origin}/api/play?title=`
  const playlistBase = `${origin}/api/playlist?mode=shuffle&title=`
  const titleExample = makeTitleExample('Sorgerà', 'tutto', 'shuffle')

  const otherExamples = [
    {
      phrase: 'Hey Siri, riproduci da JW canzoni',
      url: makeExample('canzoni', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW musica in modo casuale',
      url: makeExample('tutto', 'shuffle'),
    },
  ]

  return (
    <main className="siri-page">
      <button className="btn ghost back" onClick={onBack}>
        ← Indietro
      </button>
      <p className="brand">JW Ascolta</p>
      <h1>Siri e CarPlay</h1>
      <p className="lede">
        Stesso comando vocale a casa e in auto. L’audio parte dal telefono e
        CarPlay mostra Now Playing (play, pausa, avanti, indietro).
      </p>

      <div className="url-box highlight">
        <p className="label">Come funziona in auto</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Apple non permette alle web app di apparire come app CarPlay. Siri e
          i Comandi sì: dici «Hey Siri, riproduci da JW», l’audio esce sul
          sistema dell’auto e i controlli restano su Now Playing.
        </p>
      </div>

      <h2>CarPlay · uso consigliato</h2>
      <ol className="steps">
        <li>
          <strong>Prima di partire</strong> (o fermo): avvia JW Ascolta sul
          telefono e tocca una volta «Tocca per ascoltare» se compare.
        </li>
        <li>
          Collega CarPlay: l’audio passa all’auto e compare{' '}
          <strong>Now Playing</strong> con titolo e controlli.
        </li>
        <li>
          In viaggio: <strong>«Hey Siri, riproduci da JW»</strong> + titolo. Usa
          il comando con MP3 diretto (sotto) così non serve lo schermo del
          telefono.
        </li>
        <li>
          Nei Comandi, attiva <strong>Mostra in CarPlay</strong> / esecuzione
          mentre è bloccato, così Siri può lanciare il comando dall’auto.
        </li>
      </ol>

      <div className="url-box highlight">
        <p className="label">Comando CarPlay (1 brano, senza Chrome)</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Stesso schema: Dettatura → Codifica URL → Testo (base qui sotto +
          testo codificato) → <strong>Apri URL</strong> oppure Mostra pagina.
          L’MP3 parte subito e l’auto lo prende in Now Playing. Non continua con
          la coda.
        </p>
        <code>{directPlayBase}</code>
        <button
          className="btn primary"
          onClick={() => void navigator.clipboard?.writeText(directPlayBase)}
        >
          Copia base MP3 (CarPlay)
        </button>
      </div>

      <div className="url-box">
        <p className="label">Coda completa + CarPlay (app web)</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Per titolo + resto della coda: base sotto con{' '}
          <strong>Mostra pagina web</strong>. Serve il tap iniziale sul telefono
          (regola Apple); poi Now Playing su CarPlay controlla play/pausa e
          brani.
        </p>
        <code>{carplayTitleBase}</code>
        <button
          className="btn ghost"
          onClick={() => void navigator.clipboard?.writeText(carplayTitleBase)}
        >
          Copia base coda + CarPlay
        </button>
      </div>

      <div className="url-box">
        <p className="label">Playlist M3U (opzionale)</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Elenco MP3 a partire da un titolo. Alcuni player / Comandi possono
          aprirlo; utile se preferisci un file playlist invece della pagina.
        </p>
        <code>{playlistBase}</code>
        <button
          className="btn ghost"
          onClick={() => void navigator.clipboard?.writeText(playlistBase)}
        >
          Copia base playlist
        </button>
      </div>

      <h2>1) Aggiungi l’app a Home (da Safari)</h2>
      <ol className="steps">
        <li>
          Apri <strong>Safari</strong> (non Chrome) →{' '}
          <a href="https://jw-ascolta.vercel.app">jw-ascolta.vercel.app</a>
        </li>
        <li>
          Condividi → <strong>Aggiungi a Home</strong>
        </li>
      </ol>

      <h2>2) Ricrea il comando (senza Chrome)</h2>
      <ol className="steps">
        <li>
          In <strong>Comandi</strong>, cancella il vecchio «Riproduci da JW» e
          creane uno nuovo.
        </li>
        <li>
          <strong>Dettatura testo</strong>
        </li>
        <li>
          <strong>Codifica URL</strong> ← Testo dettato
        </li>
        <li>
          <strong>Testo</strong> = base qui sotto + variabile{' '}
          <strong>Testo codificato URL</strong> (attaccata subito dopo):
        </li>
      </ol>

      <div className="url-box">
        <p className="label">Base app + coda (casa / prima di guidare)</p>
        <code>{titleBase}</code>
        <button
          className="btn primary"
          onClick={() => void navigator.clipboard?.writeText(titleBase)}
        >
          Copia base URL
        </button>
      </div>

      <ol className="steps" start={5}>
        <li>
          Per la coda: <strong>Mostra pagina web</strong> (non «Apri URL» /
          Chrome). Input = variabile <strong>Testo</strong>.
        </li>
        <li>
          Per CarPlay a 1 brano: usa la base MP3 e{' '}
          <strong>Apri URL</strong> (l’audio parte senza UI).
        </li>
        <li>
          <strong>Aggiungi a Siri</strong> → frase:{' '}
          <strong>riproduci da JW</strong>
        </li>
      </ol>

      <div className="url-box highlight">
        <p className="label">Ordine azioni (coda)</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Dettatura testo → Codifica URL → Testo →{' '}
          <strong>Mostra pagina web</strong> (variabile Testo).
        </p>
      </div>

      <div className="url-box">
        <p className="label">Limite iPhone</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Le pagine web non possono far partire l’audio da Siri senza un tap.
          L’MP3 diretto (`/api/play`) di solito sì — ed è il percorso migliore
          in CarPlay. Con la coda serve un tocco, poi Now Playing sull’auto.
        </p>
      </div>

      <div className="url-box">
        <p className="label">Esempio fisso Sorgerà (app + coda)</p>
        <code>{titleExample}</code>
        <button
          className="btn ghost"
          onClick={() => void navigator.clipboard?.writeText(titleExample)}
        >
          Copia
        </button>
      </div>

      <h2>Altri comandi</h2>
      <ul className="examples">
        {otherExamples.map((ex) => (
          <li key={ex.phrase}>
            <p className="phrase">«{ex.phrase}»</p>
            <code>{ex.url}</code>
            <button
              className="btn ghost small"
              onClick={() => void navigator.clipboard?.writeText(ex.url)}
            >
              Copia
            </button>
          </li>
        ))}
      </ul>

      <div className="url-box">
        <p className="label">URL selezione attuale</p>
        <code>{shareUrl}</code>
        <button
          className="btn ghost"
          onClick={() => void navigator.clipboard?.writeText(shareUrl)}
        >
          Copia URL
        </button>
      </div>
    </main>
  )
}

function makeExample(sections: string, mode: PlayMode) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('s', sections)
  url.searchParams.set('mode', mode)
  url.searchParams.set('play', '1')
  return url.toString()
}

function makeTitleExample(title: string, sections: string, mode: PlayMode) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('s', sections)
  url.searchParams.set('mode', mode)
  url.searchParams.set('title', title)
  url.searchParams.set('play', '1')
  url.searchParams.set('siri', '1')
  url.searchParams.set('carplay', '1')
  return url.toString()
}
