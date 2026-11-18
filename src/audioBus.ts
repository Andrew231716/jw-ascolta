/** Coordinate the music player and Isabella so only one audio source plays. */

const PAUSE_MUSIC = 'jw-ascolta:pause-music'
const PAUSE_NARRATION = 'jw-ascolta:pause-narration'

export function requestPauseMusic() {
  window.dispatchEvent(new Event(PAUSE_MUSIC))
}

export function requestPauseNarration() {
  window.dispatchEvent(new Event(PAUSE_NARRATION))
}

export function onPauseMusic(handler: () => void) {
  window.addEventListener(PAUSE_MUSIC, handler)
  return () => window.removeEventListener(PAUSE_MUSIC, handler)
}

export function onPauseNarration(handler: () => void) {
  window.addEventListener(PAUSE_NARRATION, handler)
  return () => window.removeEventListener(PAUSE_NARRATION, handler)
}
