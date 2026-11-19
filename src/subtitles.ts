export type SubtitleCue = {
  index: number
  start: number
  end: number
  text: string
}

function normalizeQuery(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const ITALIAN_SUFFIXES = [
  'mente',
  'ienza',
  'ienze',
  'enza',
  'enze',
  'anti',
  'ante',
  'enti',
  'ente',
  'are',
  'ere',
  'ire',
  'ati',
  'ate',
  'ato',
  'ata',
  'iti',
  'ite',
  'ito',
  'ita',
  'oni',
  'one',
  'i',
  'e',
  'a',
  'o',
]

function stemCandidates(token: string) {
  const out = new Set<string>([token])
  if (token.length >= 5 && /[aeiou]$/.test(token)) out.add(token.slice(0, -1))
  for (const suffix of ITALIAN_SUFFIXES) {
    if (!token.endsWith(suffix)) continue
    const stem = token.slice(0, -suffix.length)
    if (stem.length < 4) continue
    out.add(stem)
    if (stem.length >= 5 && /[aeiou]$/.test(stem)) out.add(stem.slice(0, -1))
    break
  }
  return out
}

function stemsCompatible(a: string, b: string) {
  if (a === b) return a.length >= 4
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < 4) return false
  if (longer.startsWith(shorter)) return true
  let shared = 0
  const limit = Math.min(a.length, b.length)
  while (shared < limit && a[shared] === b[shared]) shared += 1
  return shared >= 4 && shared >= limit - 1
}

function tokenMatches(hayToken: string, needle: string) {
  if (!hayToken || !needle) return false
  if (hayToken.includes(needle)) return true
  if (needle.length >= 4 && hayToken.length >= 4 && needle.includes(hayToken)) return true
  if (needle.length >= 4 && hayToken.startsWith(needle)) return true
  for (const left of stemCandidates(hayToken)) {
    for (const right of stemCandidates(needle)) {
      if (stemsCompatible(left, right)) return true
    }
  }
  return false
}

const ITALIAN_STOPWORDS = new Set([
  'a', 'ad', 'al', 'alla', 'alle', 'ai', 'agli', 'con', 'da', 'dal', 'dalla', 'dalle', 'dai',
  'dagli', 'di', 'del', 'della', 'delle', 'dei', 'degli', 'e', 'ed', 'che', 'chi', 'cui', 'come',
  'in', 'nel', 'nella', 'nelle', 'nei', 'negli', 'su', 'sul', 'sulla', 'sulle', 'sui', 'sugli',
  'per', 'tra', 'fra', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'ma', 'o', 'od',
  'se', 'sia', 'sono', 'è', 'ha', 'ho', 'hai', 'hanno', 'non', 'si', 'mi', 'ti', 'ci', 'vi', 'ne',
])

export function queryWords(query: string) {
  return normalizeQuery(query)
    .split(' ')
    .filter(Boolean)
    .filter((word) => word.length >= 4 && !ITALIAN_STOPWORDS.has(word))
}

export function wordMatchesQuery(word: string, query: string) {
  const needles = queryWords(query)
  if (!needles.length) return false
  const token = normalizeQuery(word)
  if (!token) return false
  return needles.some((needle) => tokenMatches(token, needle))
}

export function cueMatchesQuery(text: string, query: string) {
  const needles = queryWords(query)
  if (!needles.length) return false
  const hay = normalizeQuery(text)
  if (!hay) return false
  if (needles.every((needle) => hay.includes(needle))) return true
  const tokens = hay.split(' ').filter(Boolean)
  return needles.every((needle) => tokens.some((token) => tokenMatches(token, needle)))
}

function parseTimestamp(value: string) {
  const parts = value.trim().split(':')
  if (parts.length < 2) return NaN
  const secondsPart = parts.at(-1)!.replace(',', '.')
  const minutes = Number(parts.at(-2))
  const hours = parts.length > 2 ? Number(parts.at(-3)) : 0
  const seconds = Number(secondsPart)
  if (![hours, minutes, seconds].every(Number.isFinite)) return NaN
  return hours * 3600 + minutes * 60 + seconds
}

/** Parse WEBVTT into timed cues (text only, no positioning metadata). */
export function parseVtt(vtt: string): SubtitleCue[] {
  const body = vtt.replace(/^\uFEFF?WEBVTT[^\n]*\n?/i, '')
  const blocks = body.split(/\n\s*\n/)
  const cues: SubtitleCue[] = []
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.length) continue
    const timeLine = lines.find((line) => line.includes('-->'))
    if (!timeLine) continue
    const match = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})/,
    )
    if (!match) continue
    const start = parseTimestamp(match[1])
    const end = parseTimestamp(match[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const text = lines
      .filter((line) => line !== timeLine && !/^\d+$/.test(line))
      .map((line) => line.replace(/<[^>]+>/g, ' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    cues.push({ index: cues.length, start, end, text })
  }
  return cues
}

export function formatCueTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export async function fetchSubtitles(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Sottotitoli non disponibili')
  return parseVtt(await response.text())
}
