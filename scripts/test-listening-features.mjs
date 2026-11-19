import assert from 'node:assert/strict'
import { timedPlaylist, titleThemes } from '../src/listeningThemes.ts'
import { cachedGeneration } from '../src/generatedAudio.ts'
import { localResponse, listeningProgress, recordProgress, restoreBackup } from '../src/offlineLibrary.ts'
import articleHandler from '../api/article-text.ts'
import listeningHandler from '../api/listening.ts'
import downloadHandler from '../api/download.ts'
import { articleDocid, sameArticleTitle } from '../api/lib/article-metadata.js'
import { generationResult } from '../src/personalVoice.ts'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
}
globalThis.window = new EventTarget()
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
const responses = new Map()
globalThis.caches = {
  open: async name => ({
    match: async url => responses.get(name + ':' + url)?.clone(),
    put: async (url, response) => { responses.set(name + ':' + url, response.clone()) },
    keys: async () => [],
  }),
}
const sample = (duration, id) => ({ id, duration, title: id, url: 'https://example.org/a.mp3' })
assert.deepEqual(timedPlaylist([sample(360, 'a'), sample(300, 'b'), sample(180, 'c'), sample(0, 'd')], 10).map(t => t.id), ['a', 'c'])
assert.ok(titleThemes('Speranza e coraggio per la famiglia').includes('Famiglia'))
recordProgress('a', 20)
assert.equal(listeningProgress().a.state, 'started')
recordProgress('a', 100, true)
recordProgress('a', 2)
assert.equal(listeningProgress().a.state, 'completed')

let generated = 0
const render = async () => { generated++; return new Blob(['audio']) }
await cachedGeneration('https://app.test/audio', render)
navigator.onLine = false
assert.equal(await (await cachedGeneration('https://app.test/audio', render)).text(), 'audio')
assert.equal(generated, 1)
await assert.rejects(cachedGeneration('https://app.test/missing', render), /richiede Internet/)
navigator.onLine = true
globalThis.fetch = async () => new Response('{"text":"articolo"}', { headers: { 'Content-Type': 'application/json' } })
await localResponse('https://app.test/text')
navigator.onLine = false
assert.equal((await (await localResponse('https://app.test/text')).json()).text, 'articolo')
const controller = new AbortController()
controller.abort()
await assert.rejects(localResponse('https://app.test/text', controller.signal), error => error.name === 'AbortError')

const backup = data => ({ size: 1, text: async () => JSON.stringify(data) })
values.set('jw-ascolta:favorites', '[]')
await assert.rejects(restoreBackup(backup({ app: 'jw-ascolta', version: 1, values: { 'jw-ascolta:favorites': '[{"url":"javascript:alert(1)"}]' } })))
assert.equal(values.get('jw-ascolta:favorites'), '[]')
await restoreBackup(backup({ app: 'jw-ascolta', version: 1, values: { 'jw-ascolta:favorites': JSON.stringify([sample(20, 'saved')]) } }))
assert.equal(JSON.parse(values.get('jw-ascolta:favorites'))[0].id, 'saved')
assert.throws(() => generationResult('data: {"event_id":"1","msg":"process_completed","success":false,"output":{"error":"GPU quota exceeded"}}', '1'), /Quota Chatterbox/)
console.log('ok · offline content, cached narration, backup validation, progress and listening paths')

assert.equal(articleDocid('<a data-page-id="mid999999999"></a><article class="docId-501100133 docClass-142">'), '501100133')
assert.equal(articleDocid('<a data-page-id="mid999999999"></a>'), null)
assert.equal(sameArticleTitle('Chi è Geova?', 'Cybercrime: qual è la soluzione?'), false)
assert.equal(sameArticleTitle('Cybercrime: qual è la soluzione?', 'CYBERCRIME — QUAL È LA SOLUZIONE?'), true)

assert.equal((await downloadHandler(new Request('https://app.test/api/download?url=https://evil.test/a.mp3'))).status, 400)
globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/a.mp3' } })
assert.equal((await downloadHandler(new Request('https://app.test/api/download?url=https://cfp2.jw-cdn.org/a.mp3'))).status, 400)
globalThis.fetch = async () => new Response('MP3data', { headers: { 'Content-Type': 'audio/mpeg' } })
const download = await downloadHandler(new Request('https://app.test/api/download?url=https://cfp2.jw-cdn.org/a.mp3'))
assert.equal(download.status, 200)
assert.equal(await download.text(), 'MP3data')
console.log('ok · media download and article identity')

const articleHtml = '<a data-page-id="mid999999999"></a><main><article class="docId-501100133"><h1>Ultimo articolo</h1><div class="bodyTxt"><p data-pid="1">Un testo da leggere.</p></div></article></main>'
globalThis.fetch = async url => {
  if (String(url).includes('GETPUBMEDIALINKS')) return Response.json({ files: { I: { MP3: [{ title: 'Un altro articolo', mimetype: 'audio/mpeg', file: { url: 'https://cfp2.jw-cdn.org/wrong.mp3' } }] } } })
  return new Response(articleHtml)
}
const wrongAudio = await articleHandler(new Request('https://app.test/api/article-text?path=/it/biblioteca-digitale/articoli/tema/ultimo/&audio=1'))
const correctText = await wrongAudio.json()
assert.equal(correctText.text, 'Un testo da leggere.')
assert.equal(correctText.audio, undefined)

globalThis.fetch = async url => {
  if (String(url).includes('/it/cosa-nuovo/')) return new Response('<a href="/it/biblioteca-digitale/articoli/tema/vecchio/" data-page-id="mid999999999">Navigazione</a><main><a href="/it/biblioteca-digitale/articoli/tema/ultimo/" data-page-id="mid501100133">Ultimo articolo</a></main>')
  assert.ok(String(url).includes('docid=501100133'))
  return Response.json({ files: { I: { MP3: [{ title: 'Ultimo articolo', mimetype: 'audio/mpeg', duration: 100, file: { url: 'https://cfp2.jw-cdn.org/right.mp3' } }] } } })
}
const latestResponse = await listeningHandler(new Request('https://app.test/api/listening?kind=articles&latest=1'))
const latest = await latestResponse.json()
assert.equal(latest.tracks.length, 1)
assert.equal(latest.tracks[0].title, 'Ultimo articolo')
console.log('ok · latest publications and matching article audio')
