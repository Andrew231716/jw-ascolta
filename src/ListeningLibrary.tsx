import { useEffect, useState } from 'react'
import { formatDuration, normalizeTitle, type Track } from './catalog'

type Kind = 'articles' | 'videos'
type Topic = { id: string; name: string }
type Entry = Track & { source: string; topics: string[]; description?: string }
type Page = { tracks: Entry[]; next: number | null; failed?: number }

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

async function api<T>(kind: Kind, signal: AbortSignal, topic?: string, offset = 0): Promise<T> {
  const params = new URLSearchParams({ kind, offset: String(offset) })
  if (topic) params.set('topic', topic)
  const response = await fetch('/api/listening?' + params, { signal })
  if (!response.ok) throw new Error('Catalogo non disponibile. Riprova tra poco.')
  return response.json()
}

export function ListeningLibrary({ onPlay }: { onPlay: (tracks: Track[], index?: number) => void }) {
  const [kind, setKind] = useState<Kind>('articles')
  const [topics, setTopics] = useState<Topic[]>([])
  const [topic, setTopic] = useState('')
  const [tracks, setTracks] = useState<Entry[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState('')
  const [official, setOfficial] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api<{ topics: Topic[] }>(kind, controller.signal)
      .then((data) => { setTopics(data.topics); setLoading(false) })
      .catch((err) => {
        if (!controller.signal.aborted) { setError(err.message); setLoading(false) }
      })
    return () => controller.abort()
  }, [kind, retry])

  useEffect(() => {
    if (!topic) return
    const controller = new AbortController()
    api<Page>(kind, controller.signal, topic, offset)
      .then((data) => {
        const sectionName = topics.find((item) => item.id === topic)?.name ?? ''
        const entries = data.tracks.map((track): Entry => ({
          ...track, sectionSlug: 'tutto', sectionName: track.topics.at(-1) ?? sectionName,
        }))
        setTracks((previous) => [...new Map([...previous, ...entries].map((entry) => [entry.id, entry])).values()])
        setNext(data.next)
        setError(data.failed ? 'Alcuni audio non sono stati verificati. Riprova per completare questa pagina.' : '')
        setLoading(false)
      })
      .catch((err) => {
        if (!controller.signal.aborted) { setError(err.message); setLoading(false) }
      })
    return () => controller.abort()
  }, [kind, topic, topics, offset, retry])

  function selectTopic(value: string) {
    setTopic(value)
    setTracks([])
    setOffset(0)
    setNext(null)
    setError('')
    setTheme('')
    setOfficial('')
    setLoading(Boolean(value))
  }

  const visible = tracks.filter((track) =>
    (!theme || tags(track).includes(theme)) &&
    (!official || track.topics.includes(official)) &&
    normalizeTitle(track.title).includes(normalizeTitle(query)),
  )
  const themeOptions = [...new Set(tracks.flatMap(tags))].sort()
  const officialOptions = [...new Set(tracks.flatMap((track) => track.topics.slice(1)))].sort()

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
            setLoading(true)
            setKind(id)
          }}>{name}</button>
        ))}
      </div>
      <label>Categoria JW.org
        <select value={topic} onChange={(event) => selectTopic(event.target.value)}>
          <option value="">Scegli una categoria</option>
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
        <label>Cerca tra i contenuti caricati
          <input type="search" placeholder="Titolo" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </>}
      {loading && <p role="status">Caricamento da JW.org…</p>}
      {error && <p role="alert">{error} <button className="btn ghost small" onClick={() => {
        setLoading(true)
        setError('')
        setRetry((value) => value + 1)
      }}>Riprova</button></p>}
      {topic && !loading && !visible.length && !error && <p>Nessun contenuto trovato in questo gruppo.</p>}
      {visible.length > 0 && <button className="btn primary small" onClick={() => onPlay(visible)}>Ascolta i risultati</button>}
      <ul className="library-list">
        {visible.map((track, index) => <li key={track.id}>
          <button className="queue-item" onClick={() => onPlay(visible, index)}>
            <span className="q-title">{track.title}</span>
            <span className="q-meta">{formatDuration(track.duration)} · {tags(track).join(' · ')}</span>
          </button>
          <a href={track.source} target="_blank" rel="noreferrer" aria-label={`Apri ${track.title} su JW.org`}>JW.org ↗</a>
        </li>)}
      </ul>
      {next !== null && <button className="btn ghost" disabled={loading || Boolean(error)} onClick={() => {
        setLoading(true)
        setOffset(next)
      }}>Carica altri articoli</button>}
      {kind === 'videos' && <p className="section-lede">Il catalogo mostra i video con sottotitoli disponibili e quelli della categoria Audiodescrizioni.</p>}
    </section>
  )
}
