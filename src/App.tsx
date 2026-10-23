import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SECTIONS,
  buildPlaylist,
  fetchTracksForSlugs,
  formatDuration,
  parsePlayMode,
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
  // shuffle=1 legacy
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
  return {
    sections: resolveSectionInput(sectionsRaw || 'tutto'),
    mode: resolvedMode,
    autoplay,
    view: view as View,
  }
}

function buildShareUrl(sections: SectionSlug[], mode: PlayMode) {
  const url = new URL(window.location.href)
  url.search = ''
  const s = sections.includes('tutto') ? 'tutto' : sections.join(',')
  url.searchParams.set('s', s)
  url.searchParams.set('mode', mode)
  url.searchParams.set('play', '1')
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
  ) {
    setCatalogLoading(true)
    setStatus('Carico il catalogo da JW.org…')
    try {
      const tracks = await fetchTracksForSlugs(slugs)
      const playlist = buildPlaylist(tracks, playMode)
      setStatus(
        playlist.length
          ? `${playlist.length} brani · ${playMode === 'shuffle' ? 'casuale' : 'in ordine'}`
          : null,
      )
      await player.setPlaylist(playlist, autoplay)
      const url = new URL(window.location.href)
      url.searchParams.set(
        's',
        slugs.includes('tutto') ? 'tutto' : slugs.join(','),
      )
      url.searchParams.set('mode', playMode)
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
    void startPlayback(initial.sections, initial.mode, true)
    // startPlayback is stable enough for one-shot deep-link boot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.autoplay, initial.mode, initial.sections])

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
  const shareUrl = buildShareUrl(effectiveSlugs, mode)

  if (view === 'siri') {
    return (
      <div className="app">
        <Atmosphere />
        <SiriGuide
          shareUrl={shareUrl}
          onBack={() => {
            setView('home')
            const url = new URL(window.location.href)
            url.searchParams.delete('view')
            window.history.replaceState({}, '', url)
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <Atmosphere />

      <header className="hero">
        <p className="brand">JW Ascolta</p>
        <h1 className="headline">Musica per lodare, quando vuoi.</h1>
        <p className="lede">
          Cantici, canzoni e musica internazionale da JW.org — in ordine, a
          caso, o con Siri.
        </p>
        <div className="cta-row">
          <button
            className="btn primary"
            disabled={catalogLoading}
            onClick={() => void startPlayback(['tutto'], 'shuffle', true)}
          >
            Riproduci tutto a caso
          </button>
          <a className="btn ghost" href="#scegli">
            Scegli sezioni
          </a>
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
          Seleziona una o più sezioni, poi scegli casuale o in ordine.
        </p>

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
              void startPlayback(effectiveSlugs, mode, true)
            }
          >
            {catalogLoading ? 'Carico…' : 'Riproduci selezione'}
          </button>
          <button className="btn ghost" onClick={() => setView('siri')}>
            Comandi Siri
          </button>
        </div>
      </section>

      {player.playlist.length > 0 && (
        <section className="queue">
          <h2>In coda · {player.playlist.length}</h2>
          <ul>
            {player.playlist.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <button
                  className={i === player.index ? 'queue-item active' : 'queue-item'}
                  onClick={() => player.jumpTo(i)}
                >
                  <span className="q-title">{t.title}</span>
                  <span className="q-meta">
                    {t.sectionName}
                    {t.duration ? ` · ${formatDuration(t.duration)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
  const examples = [
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
    {
      phrase: 'Hey Siri, riproduci da JW adunanze in ordine',
      url: makeExample('adunanze', 'order'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW canzoni e bambini',
      url: makeExample('canzoni,bambini', 'shuffle'),
    },
  ]

  return (
    <main className="siri-page">
      <button className="btn ghost back" onClick={onBack}>
        ← Indietro
      </button>
      <p className="brand">JW Ascolta</p>
      <h1>Comandi Siri</h1>
      <p className="lede">
        Su iPhone, crea un comando rapido che apre un link di questa app. Poi
        assegna la frase che preferisci.
      </p>

      <ol className="steps">
        <li>
          Apri l’app <strong>Comandi</strong> (Shortcuts).
        </li>
        <li>
          Tocca <strong>+</strong> → aggiungi l’azione{' '}
          <strong>Apri URL</strong>.
        </li>
        <li>Incolla uno degli URL qui sotto (o quello della selezione attuale).</li>
        <li>
          Tocca <strong>⋯</strong> / dettagli → <strong>Aggiungi a Siri</strong> e
          registra la frase, ad esempio «riproduci da JW canzoni».
        </li>
        <li>
          Consigliato: in Safari, <strong>Condividi → Aggiungi a Home</strong>{' '}
          così JW Ascolta si apre a schermo intero.
        </li>
      </ol>

      <div className="url-box">
        <p className="label">URL della selezione attuale</p>
        <code>{shareUrl}</code>
        <button
          className="btn primary"
          onClick={() => void navigator.clipboard?.writeText(shareUrl)}
        >
          Copia URL
        </button>
      </div>

      <h2>Esempi pronti</h2>
      <ul className="examples">
        {examples.map((ex) => (
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

      <p className="note">
        Su iOS, se l’audio non parte da solo, tocca una volta Riproduci: Safari
        richiede spesso un gesto. Dopo il primo avvio, i controlli funzionano
        anche dalla schermata di blocco.
      </p>
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
