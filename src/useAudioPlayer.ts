import { useEffect, useRef, useState, useEffectEvent } from 'react'
import type { Track } from './catalog'

export interface PlayerState {
  playlist: Track[]
  index: number
  playing: boolean
  loading: boolean
  error: string | null
  currentTime: number
  duration: number
}

const initial: PlayerState = {
  playlist: [],
  index: 0,
  playing: false,
  loading: false,
  error: null,
  currentTime: 0,
  duration: 0,
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<PlayerState>(initial)
  const playlistRef = useRef<Track[]>([])
  const indexRef = useRef(0)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audioRef.current = audio

    const onTime = () =>
      setState((s) => ({
        ...s,
        currentTime: audio.currentTime,
        duration: audio.duration || s.duration,
      }))
    const onPlay = () => setState((s) => ({ ...s, playing: true, loading: false }))
    const onPause = () => setState((s) => ({ ...s, playing: false }))
    const onWaiting = () => setState((s) => ({ ...s, loading: true }))
    const onCanPlay = () => setState((s) => ({ ...s, loading: false }))
    const onError = () =>
      setState((s) => ({
        ...s,
        loading: false,
        playing: false,
        error: 'Errore di riproduzione. Prova il brano successivo.',
      }))

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)

    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
      audioRef.current = null
    }
  }, [])

  const loadAndPlay = useEffectEvent(async (track: Track, autoplay: boolean) => {
    const audio = audioRef.current
    if (!audio) return
    setState((s) => ({
      ...s,
      loading: true,
      error: null,
      currentTime: 0,
      duration: track.duration || 0,
    }))
    audio.src = track.url
    audio.load()
    updateMediaSession(track)
    if (autoplay) {
      try {
        await audio.play()
      } catch {
        setState((s) => ({
          ...s,
          loading: false,
          playing: false,
          error: 'Tocca ▶ per avviare l’audio (blocco autoplay del browser).',
        }))
      }
    } else {
      setState((s) => ({ ...s, loading: false, playing: false }))
    }
  })

  const playNext = useEffectEvent(() => {
    const list = playlistRef.current
    if (list.length === 0) return
    const next = (indexRef.current + 1) % list.length
    indexRef.current = next
    setState((s) => ({ ...s, index: next }))
    void loadAndPlay(list[next], true)
  })

  const playPrev = useEffectEvent(() => {
    const audio = audioRef.current
    const list = playlistRef.current
    if (list.length === 0) return
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const prev = (indexRef.current - 1 + list.length) % list.length
    indexRef.current = prev
    setState((s) => ({ ...s, index: prev }))
    void loadAndPlay(list[prev], true)
  })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => playNext()
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [playNext])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', () => {
      void audioRef.current?.play()
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause()
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev())
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext())
  }, [playNext, playPrev])

  async function setPlaylist(tracks: Track[], autoplay: boolean) {
    playlistRef.current = tracks
    indexRef.current = 0
    setState((s) => ({
      ...s,
      playlist: tracks,
      index: 0,
      error: tracks.length ? null : 'Nessun brano trovato per le sezioni scelte.',
    }))
    if (tracks[0]) await loadAndPlay(tracks[0], autoplay)
  }

  async function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setState((s) => ({
          ...s,
          error: 'Impossibile avviare la riproduzione.',
        }))
      }
    } else {
      audio.pause()
    }
  }

  function seek(ratio: number) {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration
  }

  function jumpTo(index: number) {
    const list = playlistRef.current
    if (!list[index]) return
    indexRef.current = index
    setState((s) => ({ ...s, index }))
    void loadAndPlay(list[index], true)
  }

  const current = state.playlist[state.index] ?? null

  return {
    ...state,
    current,
    setPlaylist,
    toggle,
    playNext,
    playPrev,
    seek,
    jumpTo,
  }
}

function updateMediaSession(track: Track) {
  if (!('mediaSession' in navigator)) return
  const artwork = track.image
    ? [{ src: track.image, sizes: '512x512', type: 'image/jpeg' }]
    : []
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: 'JW Ascolta',
    album: track.sectionName,
    artwork,
  })
}
