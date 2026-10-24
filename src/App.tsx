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
  return {
    sections: resolveSectionInput(sectionsRaw || 'tutto'),
    mode: resolvedMode,
    autoplay,
    view: view as View,
    title: title.trim(),
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
    <div className="app">
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
            Safari blocca l’autoplay da Siri: un tap e parte.
          </span>
        </button>
      )}

      <nav className="top-nav" aria-label="Navigazione">
        <button type="button" className="nav-link" onClick={openSiriGuide}>
          Siri per titolo
        </button>
      </nav>

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
            Siri per titolo
          </button>
        </div>
      </header>

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
            Siri per titolo
          </button>
        </div>
      </section>

      <section className="siri-teaser" id="siri">
        <h2>Siri · riproduci per titolo</h2>
        <p className="section-lede">
          Usa <strong>Dettatura testo</strong> (non «Chiedi ogni volta», che
          spesso non capisce i titoli). Guida aggiornata con i passaggi giusti.
        </p>
        <div className="cta-row">
          <button type="button" className="btn primary" onClick={openSiriGuide}>
            Come configurarlo
          </button>
        </div>
      </section>

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
            Siri per titolo
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
  const origin = window.location.origin + window.location.pathname
  const titleBase = `${origin}?s=tutto&mode=shuffle&play=1&title=`
  const titleExample = makeTitleExample('Sorgerà', 'tutto', 'shuffle')

  const otherExamples = [
    {
      phrase: 'Hey Siri, riproduci da JW canzoni',
      url: makeExample('canzoni', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW musica internazionale',
      url: makeExample('musica-internazionale', 'shuffle'),
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
      <h1>Riproduci per titolo con Siri</h1>
      <p className="lede">
        Un solo comando per tutti i brani. Dici il titolo, parte da lì e poi
        continua da sola.
      </p>

      <div className="url-box highlight">
        <p className="label">Se vedi «URL non valido: Sorger%C3%A0»</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Significa che <strong>Apri URL</strong> sta aprendo solo il titolo
          codificato, non l’indirizzo completo. Non usare l’azione «URL» per
          costruire il link: usa <strong>Testo</strong> come sotto, e in Apri
          URL scegli la variabile <strong>Testo</strong> (quella lunga che
          inizia con https), <em>non</em> «Testo codificato URL».
        </p>
      </div>

      <h2>Configurazione corretta (4 azioni)</h2>
      <ol className="steps">
        <li>
          Apri <strong>Comandi</strong> → elimina il vecchio comando o
          ricrealo → <strong>+</strong>.
        </li>
        <li>
          <strong>Dettatura testo</strong> (cerca «Dettatura»). Arresto dopo
          una pausa.
        </li>
        <li>
          <strong>Codifica URL</strong> → input:{' '}
          <strong>Testo dettato</strong>.
        </li>
        <li>
          <strong>Testo</strong> (cerca «Testo», non «URL»). Incolla la base
          qui sotto, poi subito dopo (senza spazio) inserisci la variabile{' '}
          <strong>Testo codificato URL</strong>:
        </li>
      </ol>

      <div className="url-box">
        <p className="label">Incolla questo all’inizio dell’azione Testo</p>
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
          <strong>Apri URL</strong> → tocca il campo e scegli{' '}
          <strong>Testo</strong> (deve essere tutto il link https://…). Se
          compare solo «Testo codificato URL» / «Sorger%C3%A0», è sbagliato.
        </li>
        <li>
          <strong>⋯</strong> → <strong>Aggiungi a Siri</strong> → frase:{' '}
          <strong>riproduci da JW</strong>.
        </li>
      </ol>

      <div className="url-box">
        <p className="label">Ordine finale delle azioni</p>
        <p className="section-lede" style={{ margin: 0 }}>
          1) Dettatura testo → 2) Codifica URL → 3) Testo (base + variabile) →
          4) Apri URL (variabile Testo).
        </p>
      </div>

      <div className="url-box highlight">
        <p className="label">Come usarlo</p>
        <p className="phrase" style={{ margin: 0 }}>
          «Hey Siri, riproduci da JW»
        </p>
        <p className="section-lede" style={{ margin: 0 }}>
          Parte la dettatura → di’ il titolo (es. «Confido nel tuo amore
          leale» o «Sorgerà») → si apre l’app. Se vedi «Tocca per ascoltare»,
          un tap e parte (limite di Safari, non dell’app).
        </p>
      </div>

      <div className="url-box">
        <p className="label">Esempio fisso (solo Sorgerà)</p>
        <code>{titleExample}</code>
        <button
          className="btn ghost"
          onClick={() => void navigator.clipboard?.writeText(titleExample)}
        >
          Copia esempio Sorgerà
        </button>
      </div>

      <h2>Altri comandi (per sezione)</h2>
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
        <p className="label">URL della selezione attuale</p>
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
  return url.toString()
}
