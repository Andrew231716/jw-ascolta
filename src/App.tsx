import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SECTIONS,
  buildPlaylist,
  fetchTrackInLanguage,
  fetchTracksForSlugs,
  ensureMusicLanguages,
  filterMusicLanguages,
  formatDuration,
  getMusicLanguage,
  getMusicLanguages,
  isMusicLangCode,
  languagesForTrack,
  musicLanguageLabel,
  parsePlayMode,
  normalizeTitle,
  setMusicLanguage,
  trackMatchesQuery,
  trackPrimaryTitle,
  trackSecondaryTitle,
  type MusicLangCode,
  type Track,
  playlistStartingAtTitle,
  resolveSectionInput,
  type PlayMode,
  type SectionSlug,
} from './catalog'
import { ShareAudioButtons } from './ShareAudioButtons'
import { FavoriteButton } from './FavoriteButton'
import {
  FAVORITES_CHANGED,
  favoriteKindLabel,
  listFavorites,
  removeFavorite,
  type FavoriteItem,
} from './favoritesStore'
import { listBookmarks } from './articleText'
import { useAudioPlayer } from './useAudioPlayer'
import { ListeningLibrary } from './ListeningLibrary'
import {
  clearVideoBookmark,
  isStaticMirrorHost,
  listRecent,
  listVideoBookmarks,
  pushRecent,
  type RecentItem,
  type VideoClipBookmark,
} from './recentStore'
import './App.css'
import { DownloadButton } from './DownloadButton'
import { LibraryTools } from './LibraryTools'
import { requestPauseNarration } from './audioBus'
import { listeningProgress, PROGRESS_CHANGED } from './offlineLibrary.ts'

type View = 'home' | 'siri'
type HomeTab = 'music' | 'listening' | 'library'

type Session = { tracks: Track[]; index: number; position: number; updatedAt?: number }
type Collection = { id: string; name: string; tracks: Track[] }
type ResumeReader = { id: string; title: string; source: string }

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false
  const t = value as Track
  return typeof t.id === 'string' && typeof t.title === 'string' && typeof t.url === 'string'
}

function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem('jw-ascolta:' + key)
    if (!value) return fallback
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function readSession(): Session | null {
  const raw = readSaved<Session | null>('session', null)
  if (!raw || !Array.isArray(raw.tracks) || !raw.tracks.every(isTrack)) return null
  if (!Number.isFinite(raw.index) || !raw.tracks[raw.index]) return null
  return {
    tracks: raw.tracks,
    index: raw.index,
    position: Number(raw.position) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  }
}

function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem('jw-ascolta:' + key, JSON.stringify(value))
  } catch {
    // L'ascolto funziona anche senza spazio di archiviazione.
  }
}

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
  const articleUrl = params.get('articleUrl') || ''
  const articleId = params.get('article') || ''
  const articleTitle = params.get('articleTitle') || ''
  const musicLangParam = params.get('lang') || params.get('l') || ''
  const musicLang = isMusicLangCode(musicLangParam)
    ? musicLangParam.toUpperCase()
    : null
  const videoAudio = params.get('videoAudio') || ''
  const videoTitle = params.get('videoTitle') || ''
  const videoSource = params.get('videoSource') || ''
  const subtitleUrl = params.get('subtitleUrl') || ''
  const videoSection = params.get('videoSection') || 'tutto'
  const videoSectionName = params.get('videoSectionName') || 'Video'
  const clipStartRaw = params.get('vs')
  const clipEndRaw = params.get('ve')
  const openLibrary =
    params.get('view') === 'library' ||
    params.get('listening') === 'videos' ||
    params.get('listening') === 'articles' ||
    Boolean(articleUrl && articleId) ||
    Boolean(videoAudio && videoTitle)
  const sharedVideo: Track | null =
    videoAudio && videoTitle
      ? {
          id: `video-share-${videoTitle.slice(0, 40)}`,
          title: videoTitle,
          url: videoAudio,
          duration: 0,
          sectionSlug: (videoSection as SectionSlug) || 'tutto',
          sectionName: videoSectionName,
          source: videoSource || undefined,
          subtitleUrl: subtitleUrl || undefined,
          contentKind: 'video',
          clipStart: clipStartRaw != null ? Number(clipStartRaw) : undefined,
          clipEnd: clipEndRaw != null ? Number(clipEndRaw) : undefined,
        }
      : null
  return {
    sections: resolveSectionInput(sectionsRaw || 'tutto'),
    mode: resolvedMode,
    autoplay,
    view: view as View,
    title: title.trim(),
    siriFocus,
    openLibrary,
    musicLang,
    sharedVideo,
    initialKind:
      params.get('listening') === 'videos' || sharedVideo
        ? ('videos' as const)
        : ('articles' as const),
    initialReader:
      articleUrl && articleId
        ? { id: articleId, title: articleTitle || 'Articolo', source: articleUrl }
        : null,
  }
}

function buildShareUrl(
  sections: SectionSlug[],
  mode: PlayMode,
  title?: string,
  lang?: string,
) {
  const url = new URL(window.location.href)
  url.search = ''
  const s = sections.includes('tutto') ? 'tutto' : sections.join(',')
  url.searchParams.set('s', s)
  url.searchParams.set('mode', mode)
  url.searchParams.set('play', '1')
  if (title?.trim()) url.searchParams.set('title', title.trim())
  if (lang) url.searchParams.set('lang', lang)
  return url.toString()
}

export default function App() {
  const initial = useMemo(() => readQuery(), [])
  const [view, setView] = useState<View>(initial.view)
  const [selected, setSelected] = useState<SectionSlug[]>(
    initial.sections.includes('tutto') ? ['tutto'] : initial.sections,
  )
  const [mode, setMode] = useState<PlayMode>(initial.mode)
  const [musicLang, setMusicLang] = useState<MusicLangCode>(() => {
    if (initial.musicLang) return setMusicLanguage(initial.musicLang)
    return getMusicLanguage()
  })
  const [langPickerQuery, setLangPickerQuery] = useState('')
  const [langPickerOpen, setLangPickerOpen] = useState(false)
  const [musicLangCount, setMusicLangCount] = useState(() => getMusicLanguages().length)
  const [trackLangBusyId, setTrackLangBusyId] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [later, setLater] = useState(() => readSaved<Track[]>('later', []))
  const [speed, setSpeed] = useState(1)
  const [stopAtEnd, setStopAtEnd] = useState(true)
  const [homeTab, setHomeTab] = useState<HomeTab>(
    initial.openLibrary ? 'listening' : 'music',
  )
  const libraryOpen = homeTab === 'listening'
  const myLibraryOpen = homeTab === 'library'
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [titleQuery, setTitleQuery] = useState(initial.title)
  const [unifiedQuery, setUnifiedQuery] = useState('')
  const [listeningSearch, setListeningSearch] = useState('')
  const [listeningKind, setListeningKind] = useState<'articles' | 'videos'>(
    initial.initialKind || 'articles',
  )
  const sharedVideoStarted = useRef(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const siriFocus = initial.siriFocus
  const player = useAudioPlayer()
  const autoplayStarted = useRef(false)
  const [saved, setSaved] = useState(() => readSession())
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => listFavorites())
  const [collections, setCollections] = useState(() =>
    readSaved<Collection[]>('collections', []).filter(
      (c) => c && typeof c.id === 'string' && Array.isArray(c.tracks),
    ),
  )
  const [collectionName, setCollectionName] = useState('')
  const [unifiedMusicHits, setUnifiedMusicHits] = useState<Track[] | null>(null)
  const [readingOpen, setReadingOpen] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState('all')
  const [, setProgressVersion] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const [timer, setTimer] = useState<number | null>(null)
  const [minutes, setMinutes] = useState('30')
  const [timerFade, setTimerFade] = useState(true)
  const nowRef = useRef<HTMLElement>(null)
  const [showMini, setShowMini] = useState(false)
  const lastSession = useRef<Session | null>(null)
  const lastRecentId = useRef('')
  const [articleBookmarks, setArticleBookmarks] = useState(() => listBookmarks())
  const [videoBookmarks, setVideoBookmarks] = useState(() => listVideoBookmarks())
  const [recent, setRecent] = useState(() => listRecent())
  const [resumeReader, setResumeReader] = useState<ResumeReader | null>(
    initial.initialReader,
  )
  const staticMirror = useMemo(() => isStaticMirrorHost(), [])
  const { playlist, index, currentTime, pause } = player
  useEffect(() => {
    const refresh = () => setProgressVersion(value => value + 1)
    const network = () => setOnline(navigator.onLine)
    window.addEventListener(PROGRESS_CHANGED, refresh)
    window.addEventListener('online', network)
    window.addEventListener('offline', network)
    return () => {
      window.removeEventListener(PROGRESS_CHANGED, refresh)
      window.removeEventListener('online', network)
      window.removeEventListener('offline', network)
    }
  }, [])
  const progressRecords = listeningProgress()
  const visibleRecent = recent.filter(item => libraryFilter === 'all' ||
    (progressRecords[item.track?.id || item.id.replace(/^(article|video|music):/, '')]?.state || 'new') === libraryFilter)


  const setRepeat = player.setRepeat
  useEffect(() => {
    setRepeat(!stopAtEnd)
  }, [stopAtEnd, setRepeat])

  useEffect(() => {
    setArticleBookmarks(listBookmarks())
    setVideoBookmarks(listVideoBookmarks())
    setRecent(listRecent())
  }, [homeTab])

  useEffect(() => {
    let cancelled = false
    void ensureMusicLanguages().then((languages) => {
      if (!cancelled) setMusicLangCount(languages.length)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!playlist[index]) return
    lastSession.current = {
      tracks: playlist,
      index,
      position: currentTime,
      updatedAt: Date.now(),
    }
  }, [playlist, index, currentTime])

  useEffect(() => {
    const track = playlist[index]
    if (!track || currentTime < 1.5 || lastRecentId.current === track.id) return
    lastRecentId.current = track.id
    const kind = track.contentKind || (track.id.startsWith('video-') || track.clipStart != null ? 'video' : track.source ? 'article' : 'music')
    pushRecent({
      id: `${kind}:${track.id}`,
      title: track.title,
      kind,
      track,
      clipStart: track.clipStart,
      clipEnd: track.clipEnd,
    })
  }, [playlist, index, currentTime])

  useEffect(() => {
    const persist = () => {
      if (lastSession.current) {
        saveLocal('session', {
          ...lastSession.current,
          updatedAt: Date.now(),
        })
      }
    }
    const interval = window.setInterval(persist, 5000)
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', persist)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', persist)
    }
  }, [])

  useEffect(() => saveLocal('later', later), [later])

  useEffect(() => {
    const refresh = () => setFavorites(listFavorites())
    window.addEventListener(FAVORITES_CHANGED, refresh)
    return () => window.removeEventListener(FAVORITES_CHANGED, refresh)
  }, [])
  useEffect(() => saveLocal('collections', collections), [collections])

  const fadeOutAndPause = player.fadeOutAndPause
  useEffect(() => {
    if (timer === null) return
    let stopping = false
    const stop = () => {
      if (Date.now() < timer || stopping) return
      stopping = true
      void (async () => {
        requestPauseNarration()
        if (timerFade) await fadeOutAndPause(4500)
        else pause()
        setTimer(null)
      })()
    }
    const timeout = window.setTimeout(stop, Math.max(0, timer - Date.now()))
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [timer, pause, timerFade, fadeOutAndPause])

  useEffect(() => {
    if (view !== 'home' || !nowRef.current) return
    const observer = new IntersectionObserver(([entry]) => setShowMini(!entry.isIntersecting))
    observer.observe(nowRef.current)
    return () => observer.disconnect()
  }, [view, player.current?.id])

  function openFavorite(item: FavoriteItem) {
    if (item.kind === 'article' && (item.source || item.track?.source)) {
      setResumeReader({
        id: (item.track?.id || item.id).replace(/^article-/, '').replace(/^article:/, ''),
        title: item.title,
        source: item.source || item.track?.source || '',
      })
      setHomeTab('listening')
      setListeningKind('articles')
      return
    }
    if (item.track?.url) {
      playTracks(
        [item.track],
        0,
        item.clipStart ?? item.track.clipStart ?? 0,
      )
      return
    }
    setStatus('Questo preferito non ha audio riproducibile.')
  }

  const favoriteTracks = favorites
    .map((item) => item.track)
    .filter((track): track is Track => Boolean(track?.url))

  function playTracks(tracks: Track[], start = 0, position = 0) {
    setStatus(null)
    const track = tracks[start]
    if (track) {
      const kind = track.contentKind || (track.id.startsWith('video-') || track.clipStart != null ? 'video' : track.source ? 'article' : 'music')
      pushRecent({
        id: `${kind}:${track.id}`,
        title: track.title,
        kind,
        track,
        clipStart: track.clipStart,
        clipEnd: track.clipEnd,
      })
      setRecent(listRecent())
    }
    void player.setPlaylist(tracks, true, start, position)
  }

  function playRecentItem(item: RecentItem) {
    if (item.kind === 'article' && item.source) {
      setResumeReader({ id: item.id.replace(/^article:/, ''), title: item.title, source: item.source })
      setHomeTab('listening')
      return
    }
    if (item.track) {
      playTracks([item.track], 0, progressRecords[item.track.id]?.state === 'started' ? progressRecords[item.track.id].position : item.clipStart || item.track.clipStart || 0)
    }
  }

  function playVideoBookmark(bookmark: VideoClipBookmark) {
    const track: Track = {
      id: bookmark.trackId,
      title: bookmark.title,
      url: bookmark.url,
      duration: bookmark.duration,
      sectionSlug: (bookmark.sectionSlug || 'tutto') as Track['sectionSlug'],
      sectionName: bookmark.sectionName,
      subtitleUrl: bookmark.subtitleUrl,
      clipStart: bookmark.clipStart,
      clipEnd: bookmark.clipEnd,
    }
    playTracks([track], 0, bookmark.clipStart)
  }

  function exportQueueM3u() {
    const lines = ['#EXTM3U']
    for (const track of player.playlist) {
      lines.push(`#EXTINF:${Math.round(track.duration || -1)},${track.title}`)
      lines.push(track.url)
    }
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'jw-ascolta-coda.m3u'
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Coda esportata come M3U')
  }

  async function runUnifiedSearch() {
    const q = normalizeTitle(unifiedQuery)
    if (!q || catalogLoading) return
    setCatalogLoading(true)
    setUnifiedMusicHits(null)
    setStatus(null)
    try {
      const { tracks, unavailable } = await fetchTracksForSlugs(['tutto'])
      const hits = tracks.filter((track) => trackMatchesQuery(track, unifiedQuery))
      setUnifiedMusicHits(hits)
      const parts = [`${hits.length} brani musicali`]
      if (unavailable.length) parts.push(`categorie non disponibili: ${unavailable.join(', ')}`)
      setStatus(parts.join(' · '))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Catalogo non disponibile')
    } finally {
      setCatalogLoading(false)
    }
  }

  async function changeTrackLanguage(
    track: Track,
    langCode: string,
    options?: { playlistIndex?: number; searchIndex?: number },
  ) {
    if (!track.naturalKey || track.lang === langCode) return
    setTrackLangBusyId(track.id)
    setStatus(`Carico audio in ${musicLanguageLabel(langCode)}…`)
    try {
      const next = await fetchTrackInLanguage(track, langCode)
      if (!next) {
        setStatus(`Audio non disponibile in ${musicLanguageLabel(langCode)}`)
        return
      }
      if (options?.playlistIndex != null) {
        player.replaceTrackAt(options.playlistIndex, next, true)
      }
      if (options?.searchIndex != null) {
        setUnifiedMusicHits((prev) => {
          if (!prev) return prev
          const copy = [...prev]
          copy[options.searchIndex!] = next
          return copy
        })
      }
      setStatus(
        `Audio: ${musicLanguageLabel(langCode)} · ${trackPrimaryTitle(next)}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Cambio lingua non riuscito')
    } finally {
      setTrackLangBusyId(null)
    }
  }

  function closePlayback() {
    player.stopAndClear()
    lastSession.current = null
    setSaved(null)
    try {
      localStorage.removeItem('jw-ascolta:session')
    } catch {
      /* ignore */
    }
    setTimer(null)
    setStatus('Riproduzione chiusa · coda vuota')
    setQueueExpanded(false)
  }

  function clearLaterQueue() {
    setLater([])
    setStatus('Lista «Ascolta dopo» svuotata')
  }


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
      const { tracks, unavailable } = await fetchTracksForSlugs(slugs)
      let playlist = buildPlaylist(tracks, playMode)
      let matchedTitle: string | null = null

      if (startTitle?.trim()) {
        const { playlist: ordered, matched } = playlistStartingAtTitle(
          playlist,
          startTitle,
        )
        if (!matched) {
          setStatus(`Brano non trovato: «${startTitle.trim()}»`)
          return
        }
        playlist = ordered
        matchedTitle = matched.title
      }

      const baseStatus = playlist.length
        ? matchedTitle
          ? `Da «${matchedTitle}» · ${playlist.length} brani · poi continua`
          : `${playlist.length} brani · ${playMode === 'shuffle' ? 'casuale' : 'in ordine'}`
        : null
      setStatus(
        unavailable.length
          ? [baseStatus, `Categorie non disponibili: ${unavailable.join(', ')}`]
              .filter(Boolean)
              .join(' · ')
          : baseStatus,
      )
      if (playlist[0]) {
        pushRecent({
          id: `music:${playlist[0].id}`,
          title: playlist[0].title,
          kind: 'music',
          track: playlist[0],
        })
        setRecent(listRecent())
      }
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
      if (siriFocus) url.searchParams.set('siri', '1')
      const lang = getMusicLanguage()
      if (lang && lang !== 'I') url.searchParams.set('lang', lang)
      else url.searchParams.delete('lang')
      window.history.replaceState({}, '', url)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Errore di rete')
    } finally {
      setCatalogLoading(false)
    }
  }

  useEffect(() => {
    if (sharedVideoStarted.current || !initial.sharedVideo) return
    sharedVideoStarted.current = true
    autoplayStarted.current = true
    setHomeTab('listening')
    setListeningKind('videos')
    playTracks(
      [initial.sharedVideo],
      0,
      initial.sharedVideo.clipStart || 0,
    )
    setStatus(`Video condiviso · ${initial.sharedVideo.title}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.sharedVideo])

  useEffect(() => {
    if (!initial.autoplay || autoplayStarted.current || initial.sharedVideo) return
    autoplayStarted.current = true
    void startPlayback(
      initial.sections,
      initial.mode,
      true,
      initial.title || undefined,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.autoplay, initial.mode, initial.sections, initial.title, initial.sharedVideo])

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

  const clipStart = player.clipStart ?? 0
  const clipEnd = player.clipEnd ?? player.duration
  const clipSpan = Math.max(0.01, (clipEnd || 0) - clipStart)
  const progress =
    player.duration > 0 || player.clipEnd != null
      ? Math.min(1, Math.max(0, (player.currentTime - clipStart) / clipSpan))
      : 0
  const displayElapsed = Math.max(0, player.currentTime - clipStart)
  const displayDuration =
    player.clipEnd != null || player.clipStart != null
      ? clipSpan
      : player.duration
  const shareUrl = buildShareUrl(effectiveSlugs, mode, titleQuery, musicLang)
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
          <span className="gesture-sub">{trackPrimaryTitle(player.current)}</span>
          <span className="gesture-hint">
            Il browser richiede un tocco per avviare l’audio.
          </span>
        </button>
      )}

      {!online && <p className="offline-banner" role="status">Modalità offline · apri Libreria per i contenuti salvati.</p>}
      {!siriFocus && (
        <header className="hero">
          <div className="brand-lockup">
            <img src="/favicon.svg" width="56" height="56" alt="" />
            <h1 className="brand">JW Ascolta</h1>
          </div>
          <p className="lede">Musica, articoli audio e video da JW.org.</p>
          {(() => {
            if (player.current) return null
            const music = saved?.tracks[saved.index]
              ? {
                  kind: 'music' as const,
                  updatedAt: saved.updatedAt || 0,
                  title: saved.tracks[saved.index].title,
                  meta: formatDuration(saved.position),
                  run: () => playTracks(saved.tracks, saved.index, saved.position),
                }
              : null
            const article = articleBookmarks[0]
              ? {
                  kind: 'article' as const,
                  updatedAt: articleBookmarks[0].updatedAt || 0,
                  title: articleBookmarks[0].title,
                  meta: `Lettura · «${articleBookmarks[0].snippet}»`,
                  run: () => {
                    setResumeReader({
                      id: articleBookmarks[0].articleId,
                      title: articleBookmarks[0].title,
                      source: articleBookmarks[0].source,
                    })
                    setHomeTab('listening')
                  },
                }
              : null
            const video = videoBookmarks[0]
              ? {
                  kind: 'video' as const,
                  updatedAt: videoBookmarks[0].updatedAt || 0,
                  title: videoBookmarks[0].title,
                  meta: `Video · «${videoBookmarks[0].snippet}»`,
                  run: () => playVideoBookmark(videoBookmarks[0]),
                }
              : null
            const candidates = [music, article, video].filter(Boolean) as Array<{
              kind: string
              updatedAt: number
              title: string
              meta: string
              run: () => void
            }>
            const target = candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0]
            if (!target) return null
            return (
              <button
                className="btn primary resume-card"
                disabled={target.kind === 'music' && catalogLoading}
                onClick={target.run}
              >
                <span className="resume-label">▶ Riprendi ascolto</span>
                <span className="resume-meta">{target.meta}</span>
                <span className="resume-title">{target.title}</span>
              </button>
            )
          })()}
          {staticMirror && (
            <p className="pages-banner" role="status">
              Stai usando il mirror statico: catalogo articoli, Isabella e CarPlay
              funzionano su{' '}
              <a href="https://jw-ascolta.vercel.app">jw-ascolta.vercel.app</a>.
            </p>
          )}
          {createPortal(<nav className="top-nav" aria-label="Sezioni principali">
            <button type="button" className="nav-link" aria-pressed={homeTab === 'music'}
              onClick={() => {
                setHomeTab('music')
                setResumeReader(null)
              }}>Musica</button>
            <button type="button" className="nav-link" aria-pressed={homeTab === 'listening'}
              onClick={() => {
                setArticleBookmarks(listBookmarks())
                setVideoBookmarks(listVideoBookmarks())
                setHomeTab('listening')
              }}>Ascolta</button>
            <button type="button" className="nav-link" aria-pressed={homeTab === 'library'}
              onClick={() => {
                setRecent(listRecent())
                setVideoBookmarks(listVideoBookmarks())
                setHomeTab('library')
              }}>Libreria</button>
          </nav>, document.body)}
          {homeTab === 'music' && (
            <>
              <div className="music-lang-picker">
                <span className="music-lang-label">
                  Lingua audio predefinita
                  {musicLangCount > 40 ? ` · ${musicLangCount} lingue` : ''}
                </span>
                <input
                  type="search"
                  className="music-lang-search"
                  aria-label="Cerca lingua della musica"
                  placeholder="Cerca lingua (es. Twi)…"
                  value={langPickerOpen ? langPickerQuery : musicLanguageLabel(musicLang)}
                  disabled={catalogLoading}
                  onFocus={() => {
                    setLangPickerOpen(true)
                    setLangPickerQuery('')
                    void ensureMusicLanguages().then((languages) => {
                      setMusicLangCount(languages.length)
                    })
                  }}
                  onChange={(event) => {
                    setLangPickerOpen(true)
                    setLangPickerQuery(event.target.value)
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setLangPickerOpen(false), 150)
                  }}
                />
                {langPickerOpen && (
                  <ul className="music-lang-options" role="listbox" aria-label="Lingue disponibili">
                    {!langPickerQuery.trim() && (
                      <li className="music-lang-empty">
                        Digita per cercare tra {musicLangCount} lingue JW.org
                      </li>
                    )}
                    {filterMusicLanguages(langPickerQuery).map((lang) => (
                      <li key={lang.code}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={lang.code === musicLang}
                          className={lang.code === musicLang ? 'is-active' : undefined}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            const next = setMusicLanguage(lang.code)
                            setMusicLang(next)
                            setLangPickerQuery('')
                            setLangPickerOpen(false)
                            setUnifiedMusicHits(null)
                            setStatus(`Lingua musica: ${musicLanguageLabel(next)}`)
                            if (player.current) closePlayback()
                          }}
                        >
                          <span>{lang.name}</span>
                          {lang.vernacular && lang.vernacular !== lang.name ? (
                            <span className="music-lang-vernacular">{lang.vernacular}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                    {langPickerQuery.trim() &&
                      filterMusicLanguages(langPickerQuery).length === 0 && (
                      <li className="music-lang-empty">Nessuna lingua trovata</li>
                    )}
                  </ul>
                )}
              </div>
              <div className="cta-row">
                <button className="btn primary" disabled={catalogLoading}
                  onClick={() => void startPlayback(['tutto'], 'shuffle', true)}>
                  {catalogLoading ? 'Caricamento…' : 'Riproduci musica a caso'}
                </button>
                <button className="btn ghost" disabled={catalogLoading}
                  onClick={() => void startPlayback(['adunanze'], 'order', true)}>
                  Playlist riunione
                </button>
              </div>
            </>
          )}
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

      <section className="now" ref={nowRef} hidden={readingOpen || (!player.current && !status && !(siriFocus && saved?.tracks[saved.index]))}>
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
              <h2 className="now-title">{trackPrimaryTitle(player.current)}</h2>
              {trackSecondaryTitle(player.current) && (
                <p className="now-title-secondary">{trackSecondaryTitle(player.current)}</p>
              )}
              {player.current.naturalKey && (
                <label className="track-lang-picker">
                  Lingua di questo brano
                  <select
                    aria-label="Lingua audio del brano in riproduzione"
                    value={player.current.lang || musicLang}
                    disabled={trackLangBusyId === player.current.id || catalogLoading}
                    onChange={(event) => {
                      void changeTrackLanguage(player.current!, event.target.value, {
                        playlistIndex: player.index,
                      })
                    }}
                  >
                    {languagesForTrack(player.current).map((code) => (
                      <option key={code} value={code}>
                        {musicLanguageLabel(code)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="now-sub">
                {status ||
                  `${player.index + 1} / ${player.playlist.length} · ${
                    mode === 'shuffle' ? 'casuale' : 'in ordine'
                  }`}
              </p>
              <input
                className="seek-input"
                type="range"
                aria-label="Posizione di riproduzione"
                min={0}
                max={1000}
                value={Math.round(progress * 1000)}
                disabled={!player.duration}
                onChange={(event) => player.seek(Number(event.target.value) / 1000)}
              />
              <div className="times">
                <span>{formatDuration(displayElapsed)}</span>
                <span>{formatDuration(displayDuration)}</span>
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
              <div className="result-actions">
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={closePlayback}
                >
                  Chiudi riproduzione
                </button>
                <FavoriteButton track={player.current} />
              </div>
              <div className="result-actions">
                <ShareAudioButtons track={player.current} />
                <DownloadButton track={player.current} />
              </div>
              {player.error && <p className="error" role="alert">{player.error} <button className="btn ghost small" onClick={player.retry}>Riprova</button></p>}
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
            {siriFocus && saved?.tracks[saved.index] && (
              <button className="btn primary" disabled={catalogLoading}
                onClick={() => playTracks(saved.tracks, saved.index, saved.position)}>
                Riprendi · {saved.tracks[saved.index].title} · {formatDuration(saved.position)}
              </button>
            )}
          </div>
        )}
      </section>

      {(player.current || libraryOpen) && (
        <details className="chooser listening-tools">
          <summary>Opzioni riproduzione · timer e velocità</summary>
          <div className="listening-tools-body" aria-label="Timer di spegnimento">
            <div className="music-only-tools" hidden={!player.current}>
            <button className="btn ghost small" onClick={() => player.skip(-15)}>−15 s</button>
            <button className="btn ghost small" onClick={() => player.skip(15)}>+15 s</button>
            <label>Velocità <select value={speed} onChange={(event) => {
              const rate = Number(event.target.value)
              setSpeed(rate)
              player.setSpeed(rate)
            }}>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
            <label>
              <input
                type="checkbox"
                checked={stopAtEnd}
                onChange={(event) => setStopAtEnd(event.target.checked)}
              />{' '}
              Ferma a fine coda
            </label>
            <label>
              <input
                type="checkbox"
                checked={player.stopAfterCurrent}
                onChange={(event) => player.setStopAfterCurrent(event.target.checked)}
              />{' '}
              Ferma dopo questo brano
            </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={timerFade}
                onChange={(event) => setTimerFade(event.target.checked)}
              />{' '}
              Dissolvenza della musica al termine
            </label>
            <label>Timer <select value={minutes} onChange={(event) => setMinutes(event.target.value)}>
              {[15, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}
            </select></label>
            <button className="btn ghost small" onClick={() =>
              setTimer(timer === null ? Date.now() + Number(minutes) * 60_000 : null)}>
              {timer === null ? 'Avvia timer' : 'Annulla timer'}
            </button>
            {player.playlist.length > 0 && (
              <button type="button" className="btn ghost small" onClick={exportQueueM3u}>
                Esporta coda M3U
              </button>
            )}
            {timer !== null && <span role="status">Pausa alle {new Date(timer).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </details>
      )}

      {!siriFocus && <div hidden={!libraryOpen}>
        <ListeningLibrary
          active={libraryOpen}
          onReadingChange={setReadingOpen}
          initialReader={resumeReader}
          initialKind={listeningKind}
          initialSearch={listeningSearch}
          onReaderClose={() => {
            setResumeReader(null)
            setArticleBookmarks(listBookmarks())
            setListeningSearch('')
          }}
          onPlay={playTracks}
          onAppend={player.append}
          later={later}
          onLater={(track) => setLater((list) =>
            list.some((item) => item.id === track.id) ? list.filter((item) => item.id !== track.id) : [...list, track])}
          collections={collections}
          onSave={(id, track) => setCollections((list) => list.map((item) =>
            item.id === id && !item.tracks.some((savedTrack) => savedTrack.id === track.id)
              ? { ...item, tracks: [...item.tracks, track] } : item))}
          playbackTime={player.currentTime}
          playingTrackId={player.current?.id ?? null}
        />
      </div>}

      {!siriFocus && homeTab === 'music' && (
      <section className="chooser" id="scegli">
        <h2>Cerca un brano</h2>
        <form className="title-row" onSubmit={(event) => {
          event.preventDefault()
          void runUnifiedSearch()
        }}>
          <input
            type="search"
            aria-label="Cerca musica, articoli o video"
            placeholder="Titolo o parola…"
            value={unifiedQuery}
            maxLength={120}
            onChange={(event) => {
              setUnifiedQuery(event.target.value)
              setTitleQuery(event.target.value)
              setUnifiedMusicHits(null)
            }}
          />
          <button className="btn primary" disabled={!unifiedQuery.trim() || catalogLoading}>Cerca</button>
        </form>
        {status && <p role="status">{status}</p>}
        {unifiedMusicHits && (
          <div className="unified-results">
            <p className="section-lede">
              {unifiedMusicHits.length
                ? `${unifiedMusicHits.length} brani trovati`
                : 'Nessun brano in musica con questa parola.'}
            </p>
            {unifiedMusicHits.length > 0 && (
              <TrackList
                tracks={unifiedMusicHits.slice(0, 40)}
                onPlay={(i) => playTracks(unifiedMusicHits, i)}
                busyTrackId={trackLangBusyId}
                onChangeLanguage={(track, lang, index) => {
                  void changeTrackLanguage(track, lang, { searchIndex: index })
                }}
              />
            )}
            <div className="result-actions">
              <button type="button" className="btn ghost small" onClick={() => {
                setListeningKind('articles')
                setListeningSearch(unifiedQuery.trim())
                setHomeTab('listening')
              }}>Cerca in libri e articoli</button>
              <button type="button" className="btn ghost small" onClick={() => {
                setListeningKind('videos')
                setListeningSearch(unifiedQuery.trim())
                setHomeTab('listening')
              }}>Cerca nei video</button>
            </div>
          </div>
        )}

        <h2>Scegli cosa ascoltare</h2>
        <p className="section-lede">
          Tocca una o più sezioni, poi riproduci. Audio in{' '}
          <strong>{musicLanguageLabel(musicLang)}</strong>.
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
              )
            }
          >
            {catalogLoading ? 'Carico…' : 'Riproduci selezione'}
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
          <div className="queue-actions">
            <button type="button" className="btn ghost small" onClick={closePlayback}>
              Svuota coda e chiudi
            </button>
          </div>
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
                  <span className="q-title">{trackPrimaryTitle(t)}</span>
                  {trackSecondaryTitle(t) && (
                    <span className="q-title-secondary">{trackSecondaryTitle(t)}</span>
                  )}
                  <span className="q-meta">
                    {t.sectionName}
                    {t.duration ? ` · ${formatDuration(t.duration)}` : ''}
                  </span>
                </button>
                <FavoriteButton track={t} compact />
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

      {!siriFocus && myLibraryOpen && (
        <section className="chooser" id="libreria" aria-label="Libreria personale">
          <h2>La tua libreria</h2>
          <LibraryTools onPlay={playTracks} onOpenArticle={item => { setResumeReader(item); setHomeTab('listening') }} />
          <label>Filtra gli ascolti recenti
            <select value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)}>
              <option value="all">Tutti</option><option value="new">Da iniziare</option>
              <option value="started">In corso</option><option value="completed">Completati</option>
            </select>
          </label>
          {!recent.length && !videoBookmarks.length && !later.length && !favorites.length && !collections.length && (
            <p className="section-lede library-empty">
              Qui trovi recenti, preferiti e liste salvate. Inizia da Musica o Ascolta.
            </p>
          )}

          <h3 className="library-subhead">Recenti</h3>
          {recent.length ? (
            <ul className="library-list">
              {visibleRecent.slice(0, 12).map((item) => (
                <li key={item.id + item.updatedAt} className="library-track-row">
                  <button className="queue-item" onClick={() => playRecentItem(item)}>
                    <span className="q-title">{item.title}</span>
                    <span className="q-meta">
                      {item.kind === 'music' ? 'Musica' : item.kind === 'video' ? 'Video' : 'Articolo'}
                    </span>
                  </button>
                  {item.track ? (
                    <FavoriteButton track={item.track} kind={item.kind} compact />
                  ) : item.source ? (
                    <FavoriteButton
                      title={item.title}
                      kind={item.kind}
                      source={item.source}
                      compact
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="library-empty-line">Ancora nessun ascolto recente.</p>
          )}

          {videoBookmarks.length > 0 && (
            <>
              <h3 className="library-subhead">Brani video</h3>
              <ul className="library-list">
                {videoBookmarks.map((bookmark) => (
                  <li key={bookmark.trackId}>
                    <button className="queue-item" onClick={() => playVideoBookmark(bookmark)}>
                      <span className="q-title">{bookmark.title}</span>
                      <span className="q-meta">«{bookmark.snippet}»</span>
                    </button>
                    <button
                      className="btn ghost small"
                      aria-label={`Elimina ${bookmark.title}`}
                      onClick={() => {
                        clearVideoBookmark(bookmark.trackId)
                        setVideoBookmarks(listVideoBookmarks())
                      }}
                    >
                      Elimina
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="library-subhead">Ascolta dopo</h3>
          {later.length ? (
            <>
              <div className="queue-actions">
                <button type="button" className="btn ghost small" onClick={clearLaterQueue}>
                  Svuota lista
                </button>
              </div>
              <TrackList
                tracks={later}
                onPlay={(index) => playTracks(later, index)}
                onRemove={(track) =>
                  setLater((list) => list.filter((item) => item.id !== track.id))
                }
              />
            </>
          ) : (
            <p className="library-empty-line">Vuota · salva qualcosa da Ascolta.</p>
          )}

          <h3 className="library-subhead">Preferiti</h3>
          {favorites.length ? (
            <>
              <p className="section-lede">
                Restano salvati finché non li rimuovi tu · {favorites.length} elementi
              </p>
              {favoriteTracks.length > 0 && (
                <button
                  className="btn ghost small"
                  onClick={() => playTracks(favoriteTracks)}
                >
                  Riproduci preferiti con audio
                </button>
              )}
              <ul className="library-list">
                {favorites.map((item) => (
                  <li key={item.id} className="library-track-row">
                    <button className="queue-item" onClick={() => openFavorite(item)}>
                      <span className="q-title">{item.title}</span>
                      <span className="q-meta">{favoriteKindLabel(item.kind)}</span>
                    </button>
                    <div className="result-actions">
                      {item.track?.url && <ShareAudioButtons track={item.track} compact />}
                      <button
                        type="button"
                        className="btn ghost small"
                        aria-label={`Rimuovi ${item.title} dai preferiti`}
                        onClick={() => setFavorites(removeFavorite(item.id))}
                      >
                        Rimuovi
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="library-empty-line">
              Aggiungi musica, articoli o video con ☆ Preferiti. Restano qui finché non li elimini.
            </p>
          )}

          {playlist.length > 0 && (
            <form className="title-row" onSubmit={(event) => {
              event.preventDefault()
              const name = collectionName.trim()
              if (!name) return
              setCollections((previous) => [...previous, { id: crypto.randomUUID(), name, tracks: playlist }])
              setCollectionName('')
            }}>
              <input aria-label="Nome raccolta" placeholder="Nome raccolta" value={collectionName}
                maxLength={80} onChange={(event) => setCollectionName(event.target.value)} />
              <button className="btn primary small" disabled={!collectionName.trim()}>Salva coda</button>
            </form>
          )}
          {collections.length > 0 && (
            <>
              <h3 className="library-subhead">Raccolte</h3>
              <ul className="library-list">
                {collections.map((collection) => (
                  <li className="collection-editor" key={collection.id}>
                    <button className="queue-item" onClick={() => playTracks(collection.tracks)}>
                      {collection.name} · {collection.tracks.length} brani
                    </button>
                    <details>
                      <summary>Modifica</summary>
                      <form className="title-row" onSubmit={(event) => {
                        event.preventDefault()
                        const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
                        if (name) setCollections((list) => list.map((item) => item.id === collection.id ? { ...item, name } : item))
                      }}>
                        <input name="name" aria-label="Nome raccolta" defaultValue={collection.name} maxLength={80} required />
                        <button className="btn ghost small">Rinomina</button>
                      </form>
                      <TrackList tracks={collection.tracks} onPlay={(index) => playTracks(collection.tracks, index)}
                        onRemove={(track) => setCollections((list) => list.map((item) => item.id === collection.id
                          ? { ...item, tracks: item.tracks.filter((entry) => entry.id !== track.id) } : item))} />
                    </details>
                    <button className="btn ghost small" aria-label={`Elimina ${collection.name}`}
                      onClick={() => setCollections((list) => list.filter((item) => item.id !== collection.id))}>Elimina</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {showMini && player.current && !readingOpen && (
        <aside className="mini-player" aria-label="Lettore compatto">
          <button className="queue-item" onClick={() => nowRef.current?.scrollIntoView({ block: 'center' })}>
            <span className="q-title">{trackPrimaryTitle(player.current)}</span>
            {trackSecondaryTitle(player.current) && (
              <span className="q-title-secondary">{trackSecondaryTitle(player.current)}</span>
            )}
          </button>
          <button className="icon-btn" aria-label={player.playing ? 'Pausa' : 'Riproduci'}
            onClick={() => void player.toggle()}>{player.playing ? '❚❚' : '▶'}</button>
          <button className="icon-btn" aria-label="Indietro di 15 secondi" onClick={() => player.skip(-15)}>−15</button>
          <button className="icon-btn" aria-label="Avanti di 15 secondi" onClick={() => player.skip(15)}>+15</button>
          <button className="icon-btn" aria-label="Successivo" onClick={player.playNext}>›</button>
          <button
            className="icon-btn"
            aria-label="Chiudi riproduzione"
            onClick={closePlayback}
          >
            ✕
          </button>
        </aside>
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

function TrackList({ tracks, onPlay, onRemove, onChangeLanguage, busyTrackId }: {
  tracks: Track[]
  onPlay: (index: number) => void
  onRemove?: (track: Track) => void
  onChangeLanguage?: (track: Track, lang: string, index: number) => void
  busyTrackId?: string | null
}) {
  return (
    <ul className="library-list">
      {tracks.map((track, index) => (
        <li key={track.id} className="library-track-row">
          <button className="queue-item" onClick={() => onPlay(index)}>
            <span className="q-title">{trackPrimaryTitle(track)}</span>
            {trackSecondaryTitle(track) && (
              <span className="q-title-secondary">{trackSecondaryTitle(track)}</span>
            )}
            <span className="q-meta">{track.sectionName}</span>
          </button>
          {onChangeLanguage && track.naturalKey && (
            <label className="track-lang-picker compact">
              <span className="sr-only">Lingua audio di {trackPrimaryTitle(track)}</span>
              <select
                aria-label={`Lingua audio di ${trackPrimaryTitle(track)}`}
                value={track.lang || getMusicLanguage()}
                disabled={busyTrackId === track.id}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  event.stopPropagation()
                  onChangeLanguage(track, event.target.value, index)
                }}
              >
                {languagesForTrack(track).map((code) => (
                  <option key={code} value={code}>
                    {musicLanguageLabel(code)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="result-actions">
            <FavoriteButton track={track} compact />
            <ShareAudioButtons track={track} compact />
          </div>
          {onRemove && <button className="btn ghost small" aria-label={`Rimuovi ${trackPrimaryTitle(track)}`}
            onClick={() => onRemove(track)}>Rimuovi</button>}
        </li>
      ))}
    </ul>
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
  const [copyStatus, setCopyStatus] = useState('')
  const [manualLink, setManualLink] = useState('')
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setManualLink('')
      setCopyStatus('Link copiato.')
    } catch {
      setCopyStatus('Copia automatica non disponibile. Seleziona il link qui sopra e copialo.')
      setManualLink(url)
    }
  }
  const origin = window.location.origin
  const carplayTitleBase = `${origin}/api/carplay?s=tutto&mode=shuffle&title=`
  const webTitleBase = `${origin}/?s=tutto&mode=shuffle&play=1&siri=1&title=`
  const titleExample = makeTitleExample('Sorgerà', 'tutto', 'shuffle')

  const carplayCommands = [
    {
      phrase: 'Hey Siri, riproduci da JW canzoni',
      url: makeCarplayUrl('canzoni', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW musica internazionale',
      url: makeCarplayUrl('musica-internazionale', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW musica in modo casuale',
      url: makeCarplayUrl('tutto', 'shuffle'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW adunanze',
      url: makeCarplayUrl('adunanze', 'order'),
    },
    {
      phrase: 'Hey Siri, riproduci da JW bambini',
      url: makeCarplayUrl('bambini', 'shuffle'),
    },
  ]

  return (
    <main className="siri-page">
      <button className="btn ghost back" onClick={onBack}>
        ← Indietro
      </button>
      <p className="brand">JW Ascolta</p>
      <h1>Siri e CarPlay</h1>
      <div className="copy-feedback">
        {manualLink && <input aria-label="Link da copiare" readOnly value={manualLink}
          onFocus={(event) => event.currentTarget.select()} />}
        <span role="status">{copyStatus}</span>
      </div>
      <p className="lede">
        Scorciatoia rapida: crea un comando iPhone con sola azione «Apri URL»,
        incolla uno dei link sotto e aggiungilo a Siri.
      </p>
      <div className="url-box highlight">
        <p className="label">Partenza in 1 tocco · Canzoni casuali (CarPlay)</p>
        <code>{makeCarplayUrl('canzoni', 'shuffle')}</code>
        <button className="btn primary" onClick={() => void copyLink(makeCarplayUrl('canzoni', 'shuffle'))}>
          Copia e usa in Comandi
        </button>
      </div>
      <div className="url-box">
        <p className="label">Playlist riunione · Adunanze in ordine</p>
        <code>{makeCarplayUrl('adunanze', 'order')}</code>
        <button className="btn ghost" onClick={() => void copyLink(makeCarplayUrl('adunanze', 'order'))}>
          Copia URL riunione
        </button>
      </div>

      <div className="url-box highlight">
        <p className="label">Regola unica per CarPlay</p>
        <p className="section-lede" style={{ margin: 0 }}>
          Per <strong>ogni</strong> comando (sezione, casuale, per titolo): in
          Comandi usa <strong>Apri URL</strong> verso{' '}
          <code style={{ display: 'inline' }}>/api/carplay</code>. La gestione
          della playlist dipende dall’app che apre il link su iPhone.
        </p>
      </div>

      <h2>1) Comandi fissi (sezione / casuale)</h2>
      <ol className="steps">
        <li>
          In <strong>Comandi</strong> → Nuovo comando → solo{' '}
          <strong>Apri URL</strong>.
        </li>
        <li>Incolla uno degli URL sotto.</li>
        <li>
          Dettagli comando → attiva esecuzione con schermo bloccato /{' '}
          <strong>Mostra in CarPlay</strong> se compare.
        </li>
        <li>
          <strong>Aggiungi a Siri</strong> con la frase desiderata.
        </li>
      </ol>

      <ul className="examples">
        {carplayCommands.map((ex) => (
          <li key={ex.phrase}>
            <p className="phrase">«{ex.phrase}»</p>
            <code>{ex.url}</code>
            <button
              className="btn ghost small"
              onClick={() => void copyLink(ex.url)}
            >
              Copia URL CarPlay
            </button>
          </li>
        ))}
      </ul>

      <h2>2) Per titolo (anche in auto)</h2>
      <ol className="steps">
        <li>
          <strong>Dettatura testo</strong>
        </li>
        <li>
          <strong>Codifica URL</strong> ← Testo dettato
        </li>
        <li>
          <strong>Testo</strong> = base sotto + variabile{' '}
          <strong>Testo codificato URL</strong>
        </li>
        <li>
          <strong>Apri URL</strong> ← variabile Testo
        </li>
        <li>
          <strong>Aggiungi a Siri</strong> → <strong>riproduci da JW</strong>
        </li>
      </ol>

      <div className="url-box highlight">
        <p className="label">Base CarPlay per titolo + coda</p>
        <code>{carplayTitleBase}</code>
        <button
          className="btn primary"
          onClick={() => void copyLink(carplayTitleBase)}
        >
          Copia base CarPlay
        </button>
      </div>

      <div className="url-box">
        <p className="label">Prova fissa (Sorgerà + coda)</p>
        <code>{makeCarplayUrl('tutto', 'shuffle', 'Sorgerà')}</code>
        <button
          className="btn ghost"
          onClick={() =>
            void copyLink(
              makeCarplayUrl('tutto', 'shuffle', 'Sorgerà'),
            )
          }
        >
          Copia
        </button>
      </div>

      <h2>3) In auto</h2>
      <ol className="steps">
        <li>Collega CarPlay.</li>
        <li>
          Di’ il comando Siri (es. «riproduci da JW canzoni» o «riproduci da JW»
          + titolo).
        </li>
        <li>
          Se la riproduzione si avvia, puoi usare «In riproduzione» per mettere
          in pausa o cambiare brano.
        </li>
      </ol>

      <div className="url-box">
        <p className="label">Nota Apple</p>
        <p className="section-lede" style={{ margin: 0 }}>
          JW Ascolta non può comparire come icona CarPlay (serve un’app nativa
          approvata da Apple). Con Siri + <strong>Apri URL</strong> verso{' '}
          <code style={{ display: 'inline' }}>/api/carplay</code> ottieni però
          gli stessi comandi vocali e la coda in Now Playing.
        </p>
      </div>

      <h2>Opzionale · app web a casa</h2>
      <p className="section-lede">
        A casa puoi ancora usare l’app (coda riordinabile, sezioni). Per Siri
        verso la pagina web: Mostra pagina web + base sotto (può servire un
        tap).
      </p>
      <div className="url-box">
        <p className="label">Base app web (non CarPlay)</p>
        <code>{webTitleBase}</code>
        <button
          className="btn ghost"
          onClick={() => void copyLink(webTitleBase)}
        >
          Copia base web
        </button>
      </div>
      <div className="url-box">
        <p className="label">Esempio web Sorgerà</p>
        <code>{titleExample}</code>
        <button
          className="btn ghost"
          onClick={() => void copyLink(titleExample)}
        >
          Copia
        </button>
      </div>
      <div className="url-box">
        <p className="label">URL selezione attuale (app)</p>
        <code>{shareUrl}</code>
        <button
          className="btn ghost"
          onClick={() => void copyLink(shareUrl)}
        >
          Copia URL
        </button>
      </div>
    </main>
  )
}

function makeCarplayUrl(sections: string, mode: PlayMode, title?: string) {
  const url = new URL(window.location.origin + '/api/carplay')
  url.searchParams.set('s', sections)
  url.searchParams.set('mode', mode)
  if (title?.trim()) url.searchParams.set('title', title.trim())
  return url.toString()
}

function makeTitleExample(title: string, sections: string, mode: PlayMode) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('s', sections)
  url.searchParams.set('mode', mode)
  url.searchParams.set('title', title)
  url.searchParams.set('play', '1')
  url.searchParams.set('siri', '1')
  return url.toString()
}
