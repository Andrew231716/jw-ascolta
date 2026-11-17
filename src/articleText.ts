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
      // Keep sentence index aligned even when we further chunk for TTS.
      for (const piece of chunkForTts(text)) {
        texts.push(piece)
        sentenceIndexes.push(i)
      }
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
