import { useRef, useState } from 'react'
import type { Track } from './catalog'
import { shareLink, shareOrDownloadMp3 } from './shareAudio'

export function ShareAudioButtons({
  track,
  compact = false,
}: {
  track: Track
  compact?: boolean
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'link' | 'mp3' | null>(null)
  const controller = useRef<AbortController | null>(null)
  const canShareMp3 = Boolean(track.url)

  async function onShareLink() {
    setBusy('link')
    setNote('')
    try {
      const result = await shareLink(track)
      setNote(result === 'shared' ? 'Link condiviso' : 'Link copiato')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNote('')
      } else {
        setNote(error instanceof Error ? error.message : 'Condivisione link non riuscita')
      }
    } finally {
      setBusy(null)
    }
  }

  async function onShareMp3() {
    if (busy === 'mp3') {
      controller.current?.abort()
      return
    }
    if (!track.url) {
      setNote('Nessun MP3 disponibile per questo contenuto.')
      return
    }
    controller.current = new AbortController()
    setBusy('mp3')
    setNote('Preparazione MP3…')
    try {
      const result = await shareOrDownloadMp3(track, controller.current.signal)
      setNote(result === 'shared' ? 'MP3 condiviso' : 'Download MP3 avviato')
    } catch (error) {
      if (
        controller.current.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        setNote('Download annullato')
      } else {
        setNote(error instanceof Error ? error.message : 'Download MP3 non riuscito')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <span className={compact ? 'share-audio compact' : 'share-audio'}>
      <button
        type="button"
        className="btn ghost small"
        disabled={busy === 'link'}
        onClick={() => void onShareLink()}
      >
        {busy === 'link' ? 'Link…' : 'Condividi link'}
      </button>
      {canShareMp3 && (
        <button
          type="button"
          className="btn ghost small"
          onClick={() => void onShareMp3()}
        >
          {busy === 'mp3' ? 'Annulla MP3' : 'Scarica / condividi MP3'}
        </button>
      )}
      {note && (
        <span className="share-audio-note" role="status">
          {note}
        </span>
      )}
    </span>
  )
}
