/** Split article text into sentences/words and persist narration progress. */

export type ArticleWord = {
  id: number
  text: string
  sentenceIndex: number
}

export type ArticleSentence = {
  index: number
  text: string
  words: ArticleWord[]
  /** Seconds in original JW MP3 when markers are available. */
  startTime?: number
  endTime?: number
  pid?: number
}

export type AudioMarker = { pid: number; start: number; end: number }

export type ArticleParagraph = { pid: number; text: string }

/** Build sentences with optional JW audio timing from paragraph markers. */
export function sentencesFromParagraphs(
  paragraphs: ArticleParagraph[],
  markers: AudioMarker[] = [],
  fallbackDuration = 0,
): ArticleSentence[] {
  if (!paragraphs.length) return []
  const byPid = new Map(markers.map((item) => [item.pid, item]))
  const hasMarkers = markers.length > 0
  const totalChars =
    paragraphs.reduce((sum, item) => sum + item.text.length, 0) || 1
  let cursor = 0
  let index = 0
  const out: ArticleSentence[] = []

  for (const para of paragraphs) {
    const units = splitSentences(para.text)
    if (!units.length) continue
    const marker = byPid.get(para.pid)
    const paraChars = units.reduce((sum, item) => sum + item.text.length, 0) || 1
    let paraStart: number
    let paraEnd: number
    if (marker) {
      paraStart = marker.start
      paraEnd = Math.max(marker.start, marker.end)
    } else if (hasMarkers) {
      // Paragraph without a marker: keep zero-width so sync skips it.
      paraStart = cursor
      paraEnd = cursor
    } else if (fallbackDuration > 0) {
      paraStart = (cursor / totalChars) * fallbackDuration
      paraEnd = ((cursor + para.text.length) / totalChars) * fallbackDuration
    } else {
      paraStart = 0
      paraEnd = 0
    }
    cursor += para.text.length
    const span = Math.max(0, paraEnd - paraStart)
    let local = 0
    for (const unit of units) {
      const share = unit.text.length / paraChars
      const startTime = paraStart + span * local
      local += share
      const endTime = paraStart + span * local
      out.push({
        index,
        text: unit.text,
        words: unit.words.map((word) => ({ ...word, sentenceIndex: index })),
        startTime,
        endTime,
        pid: para.pid,
      })
      index += 1
    }
  }
  return out
}

/** Evenly map sentences onto a full MP3 when paragraph markers are missing. */
export function assignProportionalTimes(
  sentences: ArticleSentence[],
  duration: number,
): ArticleSentence[] {
  if (!sentences.length || !(duration > 0)) return sentences
  const total = sentences.reduce((sum, item) => sum + item.text.length, 0) || 1
  let cursor = 0
  return sentences.map((item) => {
    const startTime = (cursor / total) * duration
    cursor += item.text.length
    const endTime = (cursor / total) * duration
    return { ...item, startTime, endTime }
  })
}

/** Start/end seconds for a sentence (and optional word) selection. */
export function timeRangeForSelection(
  sentences: ArticleSentence[],
  startSentence: number,
  startWord: number,
  endSentence: number | null,
  endWord: number | null,
): { start: number; end: number } | null {
  if (!sentences.length) return null
  const from = Math.max(0, Math.min(startSentence, sentences.length - 1))
  const to =
    endSentence === null
      ? sentences.length - 1
      : Math.max(from, Math.min(endSentence, sentences.length - 1))
  const first = sentences[from]
  const last = sentences[to]
  if (
    first?.startTime == null ||
    first?.endTime == null ||
    last?.startTime == null ||
    last?.endTime == null
  ) {
    return null
  }
  const wordRatio = (sentence: ArticleSentence, wordIndex: number, atEnd: boolean) => {
    const count = Math.max(1, sentence.words.length)
    if (atEnd) {
      return Math.min(1, (Math.min(wordIndex, count - 1) + 1) / count)
    }
    return Math.min(1, Math.max(0, wordIndex) / count)
  }
  const start =
    first.startTime +
    (first.endTime - first.startTime) * wordRatio(first, startWord, false)
  const end =
    endWord === null
      ? last.endTime
      : last.startTime +
        (last.endTime - last.startTime) * wordRatio(last, endWord, true)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { start: first.startTime, end: Math.max(first.endTime, last.endTime) }
  }
  return { start, end }
}

export type NarrationBookmark = {
  articleId: string
  title: string
  source: string
  sentenceIndex: number
  wordIndex: number
  endSentenceIndex: number | null
  endWordIndex: number | null
  startSentenceIndex: number
  startWordIndex: number
  snippet: string
  updatedAt: number
  voice?: string
  rate?: string
}

const STORAGE_KEY = 'jw-ascolta:narration-progress'

/** Italian abbreviations that end with a period but are not sentence ends. */
const ABBREV =
  /^(?:sig|sigg|dott|prof|ing|geom|avv|n|nº|num|art|pag|pagg|ecc|etc|cfr|ca|cap|vol|ss|spett|gent|ill|on|dr|mrs?|ms|vs|es)\.$/i

export function splitSentences(raw: string): ArticleSentence[] {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const parts: string[] = []
  let buf = ''
  const tokens = clean.split(/(\s+)/)

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    buf += token
    const trimmed = buf.trim()
    if (!trimmed) continue

    const words = trimmed.split(/\s+/)
    const last = words[words.length - 1] || ''
    const ends =
      /[.!?…]["»”']?$/.test(last) &&
      !ABBREV.test(last.replace(/["»”']$/g, '')) &&
      !/^\d+[.)]$/.test(last)

    if (ends) {
      parts.push(trimmed)
      buf = ''
    }
  }
  if (buf.trim()) parts.push(buf.trim())
  if (!parts.length) parts.push(clean)

  let wordId = 0
  return parts.map((text, index) => {
    const words = text
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => {
        const word: ArticleWord = { id: wordId++, text: w, sentenceIndex: index }
        return word
      })
    return { index, text, words }
  })
}

/** Split oversized sentences so each TTS request stays under the API limit. */
export function chunkForTts(text: string, maxLen = 1800): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= maxLen) return [clean]
  const parts: string[] = []
  let rest = clean
  while (rest.length > maxLen) {
    const slice = rest.slice(0, maxLen)
    const breakAt = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('; '),
      slice.lastIndexOf(', '),
      slice.lastIndexOf(' '),
    )
    const cut = breakAt > maxLen * 0.35 ? breakAt + 1 : maxLen
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

export function sliceRange(
  sentences: ArticleSentence[],
  startSentence: number,
  startWord: number,
  endSentence: number | null,
  endWord: number | null,
): {
  texts: string[]
  sentenceIndexes: number[]
  from: number
  to: number
  firstWord: number
  lastWord: number | null
} {
  if (!sentences.length) {
    return {
      texts: [],
      sentenceIndexes: [],
      from: 0,
      to: -1,
      firstWord: 0,
      lastWord: null,
    }
  }
  const from = Math.max(0, Math.min(startSentence, sentences.length - 1))
  const to =
    endSentence === null
      ? sentences.length - 1
      : Math.max(from, Math.min(endSentence, sentences.length - 1))

  const texts: string[] = []
  const sentenceIndexes: number[] = []
  for (let i = from; i <= to; i += 1) {
    const words = sentences[i].words
    let slice = words
    if (i === from && startWord > 0) {
      slice = words.slice(Math.min(startWord, words.length - 1))
    }
    if (i === to && endWord !== null) {
      const end = Math.min(endWord + 1, words.length)
      const begin = i === from ? Math.min(startWord, words.length - 1) : 0
      slice = words.slice(begin, Math.max(begin + 1, end))
    }
    const text = slice.map((w) => w.text).join(' ').trim()
    if (text) {
      texts.push(text)
      sentenceIndexes.push(i)
    }
  }

  return {
    texts,
    sentenceIndexes,
    from,
    to,
    firstWord: Math.max(0, startWord),
    lastWord: endWord,
  }
}

export function snippetAt(
  sentences: ArticleSentence[],
  sentenceIndex: number,
  wordIndex = 0,
): string {
  const sentence = sentences[sentenceIndex]
  if (!sentence) return ''
  const from = Math.max(0, Math.min(wordIndex, sentence.words.length - 1))
  return sentence.words
    .slice(from, from + 12)
    .map((w) => w.text)
    .join(' ')
}

function readAll(): Record<string, NarrationBookmark> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, NarrationBookmark>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadBookmark(articleId: string): NarrationBookmark | null {
  return readAll()[articleId] ?? null
}

export function listBookmarks(): NarrationBookmark[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveBookmark(bookmark: NarrationBookmark): void {
  try {
    const all = readAll()
    all[bookmark.articleId] = bookmark
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* ignore quota */
  }
}

export function clearBookmark(articleId: string): void {
  try {
    const all = readAll()
    delete all[articleId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}
