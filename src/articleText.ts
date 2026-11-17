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
}

const STORAGE_KEY = 'jw-ascolta:narration-progress'

export function splitSentences(raw: string): ArticleSentence[] {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const parts: string[] = []
  const re = /[^.!?…]+(?:[.!?…]+["»”']?|(?=$))/g
  let match: RegExpExecArray | null
  while ((match = re.exec(clean))) {
    const piece = match[0].trim()
    if (piece) parts.push(piece)
  }
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
