import { useEffect, useState } from 'react'
import { ArticleNarration } from './ArticleNarration'
import { loadBookmark } from './articleText'
import { formatDuration, normalizeTitle, type Track } from './catalog'

type Kind = 'articles' | 'videos'
type Topic = { id: string; name: string }
type Entry = Track & { source: string; topics: string[]; description?: string }
type Pending = { id: string; title: string; source: string; reason: string }
type Page = {
  tracks: Entry[]
  pending?: Pending[]
  next: number | null
  failed?: number
}

const themes = [
  ['Famiglia e figli', /famigli|matrimoni|figli|genitor|coniug|educaz/],
  ['Giovani e scuola', /giovan|ragazz|adolescent|scuola|bullismo|student/],
  ['Emozioni e difficoltà', /ansia|paura|depress|stress|lutto|dolore|solitudin|preoccup|perdon/],
  ['Fede e preghiera', /preghier|pregare|fiducia|\bfede\b|speranza|geova/],
  ['Bibbia e studio', /bibbi|scrittur|versett|prof[eé]z|studio|parola di dio/],
  ['Ministero e congregazione', /predic|minister|congregaz|adunanz|testimonianz/],
  ['Creazione e natura', /creazion|natura|animal|piante|pianeta|scienza/],
] as const

function tags(entry: Entry) {
  const title = normalizeTitle(entry.title)
  const description = normalizeTitle(entry.description ?? '')
  const matched = themes.filter(([, pattern]) => pattern.test(title))
  const relevant = matched.length ? matched : themes.filter(([, pattern]) => pattern.test(description))
  return relevant.length ? relevant.map(([name]) => name) : ['Altri temi']
}

async function api<T>(kind: Kind, signal: AbortSignal, topic?: string, offset = 0, query = ''): Promise<T> {
  const params = new URLSearchParams({ kind, offset: String(offset) })
  if (topic) params.set('topic', topic)
  if (query) params.set('q', query)
  const response = await fetch('/api/listening?' + params, { signal })
  if (!response.ok) throw new Error('Catalogo non disponibile. Riprova tra poco.')
  return response.json()
}

export function ListeningLibrary({ active, onPlay, onAppend, later, onLater, collections, onSave }: {
  active: boolean
  onPlay: (tracks: Track[], index?: number) => void
  onAppend: (track: Track) => void
  later: Track[]
  onLater: (track: Track) => void
  collections: { id: string; name: string }[]
  onSave: (id: string, track: Track) => void
}) {
  const [kind, setKind] = useState<Kind>('articles')
  const [topics, setTopics] = useState<Topic[]>([])
  const [topic, setTopic] = useState('')
  const [tracks, setTracks] = useState<Entry[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingTopics, setLoadingTopics] = useState(true)
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [theme, setTheme] = useState('')
  const [official, setOfficial] = useState('')
  const [reader, setReader] = useState<Pending | null>(null)
  const [bookmarkTick, setBookmarkTick] = useState(0)

  useEffect(() => {
    if (!active) setReader(null)
  }, [active])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoadingTopics(true)
    api<{ topics: Topic[] }>(kind, controller.signal)
      .then((data) => { setTopics(data.topics); setLoadingTopics(false) })
      .catch((err) => {
        if (!controller.signal.aborted) { setError(err.message); setLoadingTopics(false) }
      })
    return () => controller.abort()
  }, [active, kind])

  useEffect(() => {
    if (!topic && !submitted) return
    const controller = new AbortController()
    const sectionName = topics.find((item) => item.id === topic)?.name ?? ''
    api<Page>(kind, controller.signal, topic, offset, submitted)
      .then((data) => {
        if (controller.signal.aborted) return
        const entries = data.tracks.map((track): Entry => ({
          ...track, sectionSlug: 'tutto', sectionName: track.topics.at(-1) ?? sectionName,
        }))
        setTracks((previous) => [...new Map([...previous, ...entries].map((entry) => [entry.id, entry])).values()])
        setPending((previous) => [...new Map([
          ...previous,
          ...(data.pending ?? []),
        ].map((item) => [item.id, item])).values()])
        setNext(data.next)
        setError(data.failed ? 'Alcuni audio non sono stati verificati. Riprova per completare questa pagina.' : '')
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
        if (!controller.signal.aborted) { setError(err.message); setLoading(false) }
      })
    return () => controller.abort()
  }, [kind, topic, offset, retry, submitted])

  function selectTopic(value: string) {
    setTopic(value)
    setTracks([])
    setPending([])
    setOffset(0)
    setNext(null)
    setError('')
    setTheme('')
    setOfficial('')
    setSubmitted('')
    setLoading(Boolean(value))
  }

  const visible = tracks.filter((track) =>
    (!theme || tags(track).includes(theme)) &&
    (!official || track.topics.includes(official)),
  )
  const themeOptions = [...new Set(tracks.flatMap(tags))].sort()
  const officialOptions = [...new Set(tracks.flatMap((track) => track.topics.slice(1)))].sort()

  if (reader) {
    return (
      <section className="chooser listening-library">
        <ArticleNarration
          articleId={reader.id}
          title={reader.title}
          source={reader.source}
          onClose={() => {
            setReader(null)
            setBookmarkTick((n) => n + 1)
          }}
        />
      </section>
    )
  }

  return (
    <section className="chooser listening-library">
      <h2>Articoli e video</h2>
      <div className="mode-toggle" role="group" aria-label="Tipo di contenuto">
        {([['articles', 'Articoli audio'], ['videos', 'Audio dei video']] as const).map(([id, name]) => (
          <button key={id} className={id === kind ? 'chip active' : 'chip'} aria-pressed={id === kind} onClick={() => {
            if (kind === id) return
            selectTopic('')
            setQuery('')
            setTopics([])
            setLoadingTopics(true)
            setKind(id)
          }}>{name}</button>
        ))}
      </div>
      <form className="title-row" onSubmit={(event) => {
        event.preventDefault()
        const title = normalizeTitle(query) ? query.trim() : ''
        if (!title && !topic) return
        setTracks([])
        setPending([])
        setNext(null)
        setOffset(0)
        setError('')
        setTheme('')
        setOfficial('')
        setLoading(true)
        setSubmitted(title)
        setRetry((value) => value + 1)
      }}>
        <input type="search" aria-label="Cerca per titolo" placeholder="es. Cybercrime, Torre di Guardia…"
          maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="btn primary" disabled={!query.trim() && !topic}>Cerca</button>
      </form>
      <label>Categoria JW.org (facoltativa)
        <select value={topic} onChange={(event) => selectTopic(event.target.value)}>
          <option value="">Tutte le categorie</option>
          {topics.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      {tracks.length > 0 && <>
        {officialOptions.length > 0 && <label>Sottocategoria JW.org
          <select value={official} onChange={(event) => setOfficial(event.target.value)}>
            <option value="">Tutte</option>
            {officialOptions.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>}
        <label>Tema suggerito
          <select value={theme} onChange={(event) => setTheme(event.target.value)}>
            <option value="">Tutti</option>
            {themeOptions.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
      </>}
      {(loading || loadingTopics) && (
        <p role="status">
          {loading && submitted && !topic && offset > 0
            ? 'Cerco ancora in altre categorie JW.org…'
            : 'Caricamento da JW.org…'}
        </p>
      )}
      {error && <p role="alert">{error} <button className="btn ghost small" onClick={() => {
        setLoading(Boolean(topic || submitted))
        setError('')
        setRetry((value) => value + 1)
      }}>Riprova</button></p>}
      {(topic || submitted) && next === null && !loading && !visible.length && !pending.length && !error && (
        <p>Nessun contenuto trovato in questo gruppo.</p>
      )}
      {visible.length > 0 && <button className="btn primary small" onClick={() => onPlay(visible)}>Ascolta i risultati</button>}
      <ul className="library-list">
        {visible.map((track, index) => <li className="listening-result" key={track.id}>
          <button className="queue-item" onClick={() => onPlay(visible, index)}>
            <span className="q-title">{track.title}</span>
            <span className="q-meta">{kind === 'articles' ? 'Articolo audio' : 'Audio del video'} · {formatDuration(track.duration)} · {tags(track).join(' · ')}</span>
          </button>
          <a href={track.source} target="_blank" rel="noreferrer" aria-label={`Apri ${track.title} su JW.org`}>JW.org ↗</a>
          <div className="result-actions">
            <button className="btn ghost small" onClick={() => onAppend(track)}>Aggiungi alla coda</button>
            <button className="btn ghost small" aria-pressed={later.some((item) => item.id === track.id)}
              onClick={() => onLater(track)}>{later.some((item) => item.id === track.id) ? 'Salvato · rimuovi' : 'Ascolta dopo'}</button>
            {collections.length > 0 && <select value="" aria-label={`Salva ${track.title} in raccolta`}
              onChange={(event) => onSave(event.target.value, track)}>
              <option value="">Salva in raccolta</option>
              {collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>}
          </div>
        </li>)}
      </ul>
      {pending.length > 0 && (
        <div className="pending-audio">
          <h3>Senza audio JW.org · voce narrativa Isabella</h3>
          <p className="section-lede">
            Apri l’articolo, scegli da quale frase o parola far partire e terminare
            l’ascolto. In pausa vedi dove sei; se esci, riprendi da lì.
          </p>
          <ul className="library-list">
            {pending.map((item) => {
              const saved = bookmarkTick >= 0 ? loadBookmark(item.id) : null
              return (
                <li className="listening-result pending" key={item.id}>
                  <div className="queue-item">
                    <span className="q-title">{item.title}</span>
                    <span className="q-meta">
                      Nessun audio JW.org · {item.reason}
                      {saved ? ` · riprendi: «${saved.snippet}»` : ''}
                    </span>
                  </div>
                  <div className="result-actions">
                    <button
                      className="btn primary small"
                      onClick={() => setReader(item)}
                    >
                      {saved ? 'Riprendi con Isabella' : 'Apri testo · Isabella'}
                    </button>
                    <a href={item.source} target="_blank" rel="noreferrer">
                      Apri su JW.org ↗
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {next !== null && <button className="btn ghost" disabled={loading || Boolean(error)} onClick={() => {
        setLoading(true)
        setOffset(next)
      }}>{submitted && !topic ? 'Continua la ricerca' : 'Carica altri'}</button>}
      {kind === 'videos' && (
        <p className="section-lede">
          Mostra i video del catalogo JW.org (stream a bassa risoluzione, utili
          da ascoltare).
        </p>
      )}
    </section>
  )
}
