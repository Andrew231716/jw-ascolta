import { normalizeTitle, type Track } from './catalog.ts'

export const LISTENING_THEMES = [
  {
    name: 'Incoraggiamento',
    query: 'incoraggiamento',
    words: /incoraggi|speranza|coraggio|fiducia|non.*solo|ansia|paura/,
  },
  { name: 'Famiglia', query: 'famiglia', words: /famigli|matrimonio|coniuge|figli|genitor/ },
  { name: 'Amicizia', query: 'amicizia', words: /amici|amicizia|perdon|amore|uniti/ },
  { name: 'Fede', query: 'fede', words: /fede|pregh|bibbia|geova|gesu/ },
  { name: 'Giovani', query: 'ragazzi', words: /giovan|ragazz|scuola|pressioni/ },
]
export function titleThemes(title: string) {
  const text = normalizeTitle(title)
  return LISTENING_THEMES.filter((theme) => theme.words.test(text)).map((theme) => theme.name)
}
export function timedPlaylist<T extends Track>(tracks: T[], minutes: number) {
  const result: T[] = []
  let remaining = minutes * 60
  for (const track of tracks) {
    if (!(track.duration > 0) || track.duration > remaining) continue
    result.push(track)
    remaining -= track.duration
  }
  return result
}
