import { useEffect, useRef, useState } from 'react'
import type { Track } from './catalog'
import { LIBRARY_CHANGED, listDownloads, saveDownload } from './offlineLibrary.ts'

export function DownloadButton({ track }: { track: Track }) {
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = () => { void listDownloads().then(items => { if (alive) setSaved(items.some(item => item.id === track.id)) }).catch(() => {}) }
    refresh()
    window.addEventListener(LIBRARY_CHANGED, refresh)
    return () => { alive = false; controller.current?.abort(); window.removeEventListener(LIBRARY_CHANGED, refresh) }
  }, [track.id])
  async function download() {
    if (busy) { controller.current?.abort(); return }
    controller.current = new AbortController()
    setBusy(true)
    setMessage('')
    try {
      await saveDownload(track, controller.current.signal)
      setSaved(true)
      setMessage('Disponibile offline')
    } catch (error) {
      setMessage(controller.current.signal.aborted ? 'Download annullato' : error instanceof Error ? error.message : 'Download non riuscito')
    } finally { setBusy(false) }
  }
  return <span className="download-control">
    <button type="button" className="btn ghost small" disabled={saved} onClick={() => void download()}>
      {saved ? '✓ Offline' : busy ? 'Annulla download' : '↓ Salva offline'}
    </button>
    {message && <span role="status">{message}</span>}
  </span>
}
