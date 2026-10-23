import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/** Minimal 180×180 PNG apple-touch-icon (solid + circle), no external deps. */
const W = 180
const H = 180

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  const row = y * (W * 4 + 1)
  raw[row] = 0
  for (let x = 0; x < W; x++) {
    const i = row + 1 + x * 4
    const cx = x - W / 2
    const cy = y - H / 2
    const d = Math.sqrt(cx * cx + cy * cy)
    // background #0c2429
    let r = 12,
      g = 36,
      b = 41
    if (d < 52 && d > 44) {
      // gold ring
      r = 212
      g = 164
      b = 90
    } else if (Math.abs(cx + 8) < 10 && cy > -22 && cy < 22) {
      // play triangle stem-ish
      r = 232
      g = 242
      b = 240
    } else if (cx > -4 && cx < 28 && Math.abs(cy) < 18 - cx * 0.35) {
      r = 232
      g = 242
      b = 240
    }
    raw[i] = r
    raw[i + 1] = g
    raw[i + 2] = b
    raw[i + 3] = 255
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), png)
console.log('Wrote apple-touch-icon.png')
