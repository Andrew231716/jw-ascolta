import { useEffect, useState } from 'react'
import { exportBackup, LIBRARY_CHANGED, listDownloads, removeDownload, restoreBackup, savedArticles, type DownloadedTrack } from './offlineLibrary.ts'
import type { Track } from './catalog'

export function LibraryTools({ onPlay, onOpenArticle }: { onPlay: (tracks: Track[], index?: number) => void; onOpenArticle: (item: { id: string; title: string; source: string }) => void }) {
  const [downloads, setDownloads] = useState<DownloadedTrack[]>([])
  const [articles, setArticles] = useState<Array<{ id: string; title: string; source: string }>>([])
  const [message, setMessage] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = () => { void listDownloads().then(items => { if (alive) setDownloads(items) }).catch(error => { if (alive) setMessage(error.message) }) }
    refresh()
    void savedArticles().then(items => { if (alive) setArticles(items) }).catch(() => {})
    window.addEventListener(LIBRARY_CHANGED, refresh)
    return () => { alive = false; window.removeEventListener(LIBRARY_CHANGED, refresh) }
  }, [])
  return <div className="library-tools">
    <h3>Salvati offline</h3>
    <p>{downloads.length} contenuti · {(downloads.reduce((sum, item) => sum + item.bytes, 0) / 1048576).toFixed(1)} MB sul dispositivo</p>
    {!downloads.length && <p>Usa “Salva offline” sul lettore o sui risultati. I file saranno disponibili anche senza rete.</p>}
    <ul className="library-list">{downloads.map((item, index) => <li key={item.id}>
      <button className="queue-item" onClick={() => onPlay(downloads.map(download => download.track), index)}>{item.track.title}</button>
      <button className="btn ghost small" onClick={() => void removeDownload(item.id).catch(error => setMessage(error.message))} aria-label={'Rimuovi download di ' + item.track.title}>Rimuovi download</button>
    </li>)}</ul>
    {articles.length > 0 && <><h3>Testi salvati sul dispositivo</h3><ul className="library-list">{articles.map(item => <li key={item.id}><button className="queue-item" onClick={() => onOpenArticle(item)}>{item.title}</button></li>)}</ul></>}
    <details><summary>Backup della libreria</summary>
      <p>Salva preferiti, raccolte, cronologia e segnalibri. I file audio scaricati e il campione vocale si gestiscono sul dispositivo.</p>
      <button className="btn ghost small" onClick={exportBackup}>Esporta backup</button>
      <label className="file-label">Ripristina da backup
        <input type="file" accept=".json,application/json" onChange={event => {
          const file = event.target.files?.[0]
          if (!file) return
          if (!window.confirm('Ripristinare le liste presenti nel backup? Sostituiranno le corrispondenti liste attuali.')) return
          void restoreBackup(file).then(() => location.reload()).catch(error => setMessage(error.message))
        }} />
      </label>
    </details>
    {message && <p role="status">{message}</p>}
  </div>
}
