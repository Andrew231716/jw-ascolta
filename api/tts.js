/**
 * Voce narrativa neurale (Microsoft Edge Read Aloud) — senza API key.
 * Fallback: Google Translate TTS.
 */
import { EdgeTTS } from 'node-edge-tts'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink } from 'node:fs/promises'

const VOICES = {
  isabella: { voice: 'it-IT-IsabellaNeural', lang: 'it-IT' },
  elsa: { voice: 'it-IT-ElsaNeural', lang: 'it-IT' },
  diego: { voice: 'it-IT-DiegoNeural', lang: 'it-IT' },
  giuseppe: { voice: 'it-IT-GiuseppeMultilingualNeural', lang: 'it-IT' },
}

const MAX_CHARS = 2200

function pickVoice(raw) {
  const key = String(raw || '').toLowerCase().trim()
  return VOICES[key] || VOICES.isabella
}

async function synthesizeEdge(text, voiceCfg) {
  const tts = new EdgeTTS({
    voice: voiceCfg.voice,
    lang: voiceCfg.lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    saveSubtitles: false,
    // Ritmo narrativo: leggermente più lento e calmo
    rate: '-8%',
    pitch: '+0Hz',
    timeout: 45000,
  })

  if (typeof tts.streamAudio === 'function') {
    const chunks = []
    for await (const chunk of tts.streamAudio(text)) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk)
    }
    if (!chunks.length) throw new Error('Nessun audio ricevuto')
    return Buffer.concat(chunks)
  }

  const out = join(tmpdir(), `jw-ascolta-tts-${randomUUID()}.mp3`)
  try {
    await tts.ttsPromise(text, out)
    return await readFile(out)
  } finally {
    try {
      await unlink(out)
    } catch {
      /* ignore */
    }
  }
}

async function synthesizeGoogle(text) {
  const parts = []
  let rest = text.trim()
  while (rest) {
    let cut = Math.min(160, rest.length)
    if (rest.length > 160) {
      const slice = rest.slice(0, 160)
      const breakAt = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf(', '),
        slice.lastIndexOf(' '),
      )
      if (breakAt > 40) cut = breakAt + 1
    }
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  const buffers = []
  for (const part of parts) {
    const url =
      'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=it&q=' +
      encodeURIComponent(part)
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) throw new Error(`Google TTS ${res.status}`)
    buffers.push(Buffer.from(await res.arrayBuffer()))
  }
  return Buffer.concat(buffers)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    let text = ''
    let voice = 'isabella'

    if (req.method === 'GET') {
      text = String(req.query.text || '')
      voice = String(req.query.voice || 'isabella')
    } else {
      const body =
        typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      text = String(body.text || '')
      voice = String(body.voice || 'isabella')
    }

    text = text.replace(/\s+/g, ' ').trim()
    if (!text) {
      res.status(400).json({ error: 'Testo mancante' })
      return
    }
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)

    const voiceCfg = pickVoice(voice)
    let audio
    let engine = 'edge-neural'
    try {
      audio = await synthesizeEdge(text, voiceCfg)
    } catch (edgeErr) {
      try {
        audio = await synthesizeGoogle(text)
        engine = 'google'
      } catch {
        throw edgeErr
      }
    }

    res
      .status(200)
      .setHeader('Content-Type', 'audio/mpeg')
      .setHeader('Cache-Control', 'no-store')
      .setHeader('X-TTS-Engine', engine)
      .setHeader('X-TTS-Voice', voiceCfg.voice)
      .send(audio)
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
