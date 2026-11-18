import { useEffect, useRef, useState, useCallback } from 'react'
import type { Track } from './catalog'

export interface PlayerState {
  playlist: Track[]
  index: number
  playing: boolean
  loading: boolean
  error: string | null
  currentTime: number
  duration: number
  /** True when browser blocked autoplay; waiting for a tap */
  needsGesture: boolean
}

const initial: PlayerState = {
  playlist: [],
  index: 0,
  playing: false,
  loading: false,
  error: null,
  currentTime: 0,
  duration: 0,
  needsGesture: false,
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<PlayerState>(initial)
  const playlistRef = useRef<Track[]>([])
  const indexRef = useRef(0)
  const needsGestureRef = useRef(false)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.setAttribute('playsinline', 'true')
    audio.setAttribute('webkit-playsinline', 'true')
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    // Keep element in the DOM so iOS/Android are less likely to suspend background audio.
    audio.style.display = 'none'
    document.body.appendChild(audio)
    audioRef.current = audio

    const onTime = () =>
      setState((s) => ({
        ...s,
        currentTime: audio.currentTime,
        duration: audio.duration || s.duration,
      }))
    const onPlay = () => {
      needsGestureRef.current = false
      setState((s) => ({
        ...s,
        playing: true,
        loading: false,
        needsGesture: false,
        error: null,
      }))
    }
    const onPause = () => setState((s) => ({ ...s, playing: false }))
    const onWaiting = () => setState((s) => ({ ...s, loading: true }))
    const onCanPlay = () => setState((s) => ({ ...s, loading: false }))
    const onError = () => {
      setState((s) => ({
        ...s,
        loading: false,
        playing: false,
        error: 'Errore di riproduzione. Passo al successivo…',
      }))
      if (autoSkipTimer.current) window.clearTimeout(autoSkipTimer.current)
      autoSkipTimer.current = window.setTimeout(() => {
        const list = playlistRef.current
        if (!list.length) return
        const hasNext = indexRef.current + 1 < list.length
        if (hasNext || repeat.current) playNextRef.current()
      }, 700)
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)

    return () => {
      if (autoSkipTimer.current) window.clearTimeout(autoSkipTimer.current)
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
      try {
        audio.remove()
      } catch {
        /* ignore */
      }
      audioRef.current = null
    }
  }, [])

  const repeat = useRef(false)
  const speed = useRef(1)
  const pendingSeek = useRef<(() => void) | null>(null)
  const autoSkipTimer = useRef<number | null>(null)
  const playNextRef = useRef<() => void>(() => {})

  const loadAndPlay = useCallback(async (track: Track, autoplay: boolean, position = 0) => {
    const audio = audioRef.current
    if (!audio) return
    needsGestureRef.current = false
    setState((s) => ({
      ...s,
      loading: true,
      error: null,
      needsGesture: false,
      currentTime: 0,
      duration: track.duration || 0,
    }))
    if (pendingSeek.current) audio.removeEventListener('loadedmetadata', pendingSeek.current)
    pendingSeek.current = null
    audio.src = track.url
    audio.load()
    audio.playbackRate = speed.current
    if (position > 0) {
      const restore = () => {
        pendingSeek.current = null
        audio.currentTime = Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position)
      }
      if (audio.readyState >= 1) restore()
      else {
        pendingSeek.current = restore
        audio.addEventListener('loadedmetadata', restore, { once: true })
      }
    }
    updateMediaSession(track)
    if (autoplay) {
      try {
        await audio.play()
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const blocked = error instanceof Error && error.name === 'NotAllowedError'
        needsGestureRef.current = blocked
        setState((s) => ({
          ...s,
          loading: false,
          playing: false,
          needsGesture: blocked,
          error: blocked ? null : navigator.onLine ? 'Brano non disponibile. Riprova o passa al successivo.' : 'Connessione assente.',
        }))
      }
    } else {
      setState((s) => ({ ...s, loading: false, playing: false }))
    }
  }, [])

  const playNext = useCallback(() => {
    const list = playlistRef.current
    if (list.length === 0) return
    const next = (indexRef.current + 1) % list.length
    indexRef.current = next
    setState((s) => ({ ...s, index: next, error: null }))
    void loadAndPlay(list[next], true)
  }, [loadAndPlay])

  playNextRef.current = playNext

  const playPrev = useCallback(() => {
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
  }, [loadAndPlay])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => {
      if (repeat.current || indexRef.current + 1 < playlistRef.current.length) playNext()
    }
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
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.max(
        0,
        audio.currentTime - (details.seekOffset || 10),
      )
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.min(
        audio.duration || audio.currentTime + 10,
        audio.currentTime + (details.seekOffset || 10),
      )
    })
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        const audio = audioRef.current
        if (!audio || details.seekTime == null) return
        audio.currentTime = details.seekTime
      })
    } catch {
      /* older Safari */
    }
  }, [playNext, playPrev])

  // Keep Now Playing / CarPlay position in sync.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !('mediaSession' in navigator)) return
    const sync = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(audio.currentTime, audio.duration),
        })
      } catch {
        /* ignore */
      }
      navigator.mediaSession.playbackState = audio.paused
        ? 'paused'
        : 'playing'
    }
    audio.addEventListener('timeupdate', sync)
    audio.addEventListener('play', sync)
    audio.addEventListener('pause', sync)
    audio.addEventListener('durationchange', sync)
    return () => {
      audio.removeEventListener('timeupdate', sync)
      audio.removeEventListener('play', sync)
      audio.removeEventListener('pause', sync)
      audio.removeEventListener('durationchange', sync)
    }
  }, [])

  // Keep playback alive when the app goes to background (lock screen / other apps).
  useEffect(() => {
    let wake: WakeLockSentinel | null = null
    const request = async () => {
      try {
        if ('wakeLock' in navigator && !audioRef.current?.paused) {
          wake = await navigator.wakeLock.request('screen')
        }
      } catch {
        /* unsupported / denied */
      }
    }
    const onPlay = () => void request()
    const onPause = () => {
      void wake?.release()
      wake = null
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && audioRef.current && !audioRef.current.paused) {
        void request()
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing'
        }
      }
    }
    // Do not pause on hide — let Media Session / OS continue audio.
    const audio = audioRef.current
    audio?.addEventListener('play', onPlay)
    audio?.addEventListener('pause', onPause)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      audio?.removeEventListener('play', onPlay)
      audio?.removeEventListener('pause', onPause)
      document.removeEventListener('visibilitychange', onVisible)
      void wake?.release()
    }
  }, [])

  // Any first tap/key while waiting for gesture unlocks audio (Siri → Safari).
  useEffect(() => {
    const tryUnlock = () => {
      if (!needsGestureRef.current) return
      const audio = audioRef.current
      if (!audio) return
      void audio
        .play()
        .then(() => {
          needsGestureRef.current = false
        })
        .catch(() => {
          /* keep overlay */
        })
    }
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', tryUnlock, opts)
    window.addEventListener('touchend', tryUnlock, opts)
    window.addEventListener('keydown', tryUnlock, opts)
    return () => {
      window.removeEventListener('pointerdown', tryUnlock, opts)
      window.removeEventListener('touchend', tryUnlock, opts)
      window.removeEventListener('keydown', tryUnlock, opts)
    }
  }, [])

  async function setPlaylist(
    tracks: Track[],
    autoplay: boolean,
    startIndex = 0,
    position = 0,
  ) {
    const safeIndex =
      tracks.length === 0
        ? 0
        : Math.max(0, Math.min(startIndex, tracks.length - 1))
    playlistRef.current = tracks
    indexRef.current = safeIndex
    setState((s) => ({
      ...s,
      playlist: tracks,
      index: safeIndex,
      error: tracks.length ? null : 'Nessun brano trovato per le sezioni scelte.',
    }))
    if (tracks[safeIndex]) await loadAndPlay(tracks[safeIndex], autoplay, position)
    else {
      audioRef.current?.pause()
      audioRef.current?.removeAttribute('src')
      audioRef.current?.load()
    }
  }

  async function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
        needsGestureRef.current = false
        setState((s) => ({ ...s, needsGesture: false, error: null }))
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const blocked = error instanceof Error && error.name === 'NotAllowedError'
        needsGestureRef.current = blocked
        setState((s) => ({
          ...s,
          needsGesture: blocked,
          error: blocked ? null : navigator.onLine ? 'Brano non disponibile.' : 'Connessione assente.',
        }))
      }
    } else {
      audio.pause()
    }
  }

  async function resumeFromGesture() {
    const audio = audioRef.current
    if (!audio) return false
    try {
      await audio.play()
      needsGestureRef.current = false
      setState((s) => ({ ...s, needsGesture: false, error: null }))
      return true
    } catch {
      return false
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

  function moveTrack(from: number, to: number) {
    const list = [...playlistRef.current]
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= list.length ||
      to >= list.length
    ) {
      return
    }
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)

    let nextIndex = indexRef.current
    if (from === nextIndex) nextIndex = to
    else if (from < nextIndex && to >= nextIndex) nextIndex -= 1
    else if (from > nextIndex && to <= nextIndex) nextIndex += 1

    playlistRef.current = list
    indexRef.current = nextIndex
    setState((s) => ({ ...s, playlist: list, index: nextIndex }))
  }

  function moveTrackBy(from: number, delta: number) {
    moveTrack(from, from + delta)
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
    moveTrack,
    moveTrackBy,
    setRepeat: (enabled: boolean) => {
      repeat.current = enabled
    },
    getRepeat: () => repeat.current,
    setSpeed: (rate: number) => {
      speed.current = rate
      if (audioRef.current) audioRef.current.playbackRate = rate
    },
    skip: (seconds: number) => {
      const audio = audioRef.current
      if (audio && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + seconds))
      }
    },
    append: (track: Track) => {
      if (!playlistRef.current.length) { void setPlaylist([track], false); return }
      const playlist = [...playlistRef.current, track]
      playlistRef.current = playlist
      setState((state) => ({ ...state, playlist }))
    },
    resumeFromGesture,
    pause: () => audioRef.current?.pause(),
    /** Stop playback and empty the queue (music, articles, or video audio). */
    stopAndClear() {
      if (autoSkipTimer.current) window.clearTimeout(autoSkipTimer.current)
      const audio = audioRef.current
      if (audio) {
        try {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        } catch {
          /* ignore */
        }
      }
      playlistRef.current = []
      indexRef.current = 0
      needsGestureRef.current = false
      setState({
        playlist: [],
        index: 0,
        playing: false,
        loading: false,
        error: null,
        currentTime: 0,
        duration: 0,
        needsGesture: false,
      })
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = null
          navigator.mediaSession.playbackState = 'none'
        } catch {
          /* ignore */
        }
      }
    },
  }
}

function updateMediaSession(track: Track) {
  if (!('mediaSession' in navigator)) return
  const artwork = track.image
    ? [
        { src: track.image, sizes: '96x96', type: 'image/jpeg' },
        { src: track.image, sizes: '128x128', type: 'image/jpeg' },
        { src: track.image, sizes: '256x256', type: 'image/jpeg' },
        { src: track.image, sizes: '512x512', type: 'image/jpeg' },
      ]
    : []
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: 'JW Ascolta',
    album: track.sectionName,
    artwork,
  })
  try {
    navigator.mediaSession.playbackState = 'playing'
  } catch {
    /* ignore */
  }
}
