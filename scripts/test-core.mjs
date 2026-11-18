/** Lightweight regression checks for search/stemming/VTT (no test runner required). */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname

async function main() {
  let subtitles
  let catalog
  try {
    subtitles = await import(pathToFileURL(`${root}/src/subtitles.ts`).href)
    catalog = await import(pathToFileURL(`${root}/src/catalog.ts`).href)
  } catch (error) {
    console.error('Import TS failed; run with: node --experimental-strip-types scripts/test-core.mjs')
    console.error(error)
    process.exit(1)
  }

  const vtt = `WEBVTT

00:00:02.085 --> 00:00:04.220
Nel programma di questo mese

00:00:04.421 --> 00:00:08.358
parleremo di una qualità
molto importante, la pazienza.
`
  const cues = subtitles.parseVtt(vtt)
  assert.equal(cues.length, 2)
  assert.ok(subtitles.cueMatchesQuery(cues[1].text, 'pazienza'))
  assert.ok(subtitles.wordMatchesQuery('paziente', 'pazienza'))
  assert.ok(subtitles.wordMatchesQuery('pazienti', 'pazienza'))
  assert.equal(subtitles.formatCueTime(125), '2:05')

  assert.equal(catalog.normalizeTitle('  Sorgerà  '), 'sorgera')
  assert.deepEqual(catalog.resolveSectionInput('canzoni,bambini'), ['canzoni', 'bambini'])
  assert.deepEqual(catalog.resolveSectionInput('tutto'), ['tutto'])

  console.log('ok · stemming, VTT, section aliases')
}

main()
