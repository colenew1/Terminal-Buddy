/** Reproducible robot mascot, PNG and multi-resolution ICO. No extra dependencies. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { deflateSync } from 'node:zlib'

const BLUE = [110, 168, 254]
const PURPLE = [167, 139, 250]
const WHITE = [245, 248, 255]
const DARK = [25, 32, 61]
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

function segment(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay
  const t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1)
  return Math.hypot(x - ax - t * vx, y - ay - t * vy)
}

function pixel(x, y) {
  const circle = (cx, cy, r) => clamp(r - Math.hypot(x - cx, y - cy) + 0.5, 0, 1)
  const rounded = (left, top, right, bottom, r) => circle(clamp(x, left + r, right - r), clamp(y, top + r, bottom - r), r)
  const rgba = [0, 0, 0, 0]
  const paint = (color, alpha) => {
    if (alpha <= 0) return
    const oldAlpha = rgba[3] * (1 - alpha)
    const total = alpha + oldAlpha
    for (let i = 0; i < 3; i++) rgba[i] = (color[i] * alpha + rgba[i] * oldAlpha) / total
    rgba[3] = total
  }
  paint(PURPLE, rounded(242, 50, 270, 138, 14))
  paint([127, 238, 211], circle(256, 44, 28))
  paint(WHITE, circle(247, 35, 7))
  paint(BLUE, rounded(22, 224, 76, 320, 22))
  paint(PURPLE, rounded(436, 224, 490, 320, 22))
  const t = (x + y) / 1024
  const skin = BLUE.map((v, i) => v + (PURPLE[i] - v) * t)
  paint(DARK, rounded(52, 110, 460, 476, 110))
  paint(skin, rounded(60, 112, 452, 464, 102))
  paint(WHITE, circle(186, 264, 56))
  paint(WHITE, circle(326, 264, 56))
  paint(DARK, circle(194, 270, 29))
  paint(DARK, circle(318, 270, 29))
  paint(WHITE, circle(185, 260, 9))
  paint(WHITE, circle(309, 260, 9))
  paint([246, 163, 186], rounded(112, 328, 162, 348, 10))
  paint([246, 163, 186], rounded(350, 328, 400, 348, 10))
  const smile = Math.min(segment(x, y, 210, 365, 230, 382), segment(x, y, 230, 382, 256, 388),
    segment(x, y, 256, 388, 282, 382), segment(x, y, 282, 382, 302, 365))
  paint(DARK, clamp(10.5 - smile, 0, 1))
  return [...rgba.slice(0, 3), rgba[3] * 255]
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(tag, data) {
  const typeAndData = Buffer.concat([Buffer.from(tag), data])
  const length = Buffer.alloc(4), crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function render(size) {
  const raw = Buffer.alloc((1 + size * 4) * size)
  // Supersampling keeps the face and antenna crisp at taskbar and tray sizes.
  const samples = size <= 64 ? 4 : 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0]
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const p = pixel((x + (sx + 0.5) / samples) * 512 / size, (y + (sy + 0.5) / samples) * 512 / size)
        for (let c = 0; c < 3; c++) sum[c] += p[c] * p[3] / 255
        sum[3] += p[3]
      }
      const offset = y * (1 + size * 4) + 1 + x * 4
      for (let c = 0; c < 3; c++) raw[offset + c] = sum[3] ? Math.round(sum[c] * 255 / sum[3]) : 0
      raw[offset + 3] = Math.round(sum[3] / samples ** 2)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
  header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  console.log(`Generated ${path} (${data.length} bytes)`)
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(render)
const directory = Buffer.alloc(6 + 16 * sizes.length)
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4)
let offset = directory.length
sizes.forEach((size, i) => {
  const entry = 6 + i * 16
  directory[entry] = directory[entry + 1] = size % 256
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(images[i].length, entry + 8); directory.writeUInt32LE(offset, entry + 12)
  offset += images[i].length
})
write('build/icon.png', render(512))
write('build/icon.ico', Buffer.concat([directory, ...images]))
write('resources/icon.png', images[6])
write('resources/tray.png', images[2])
write('resources/tray@2x.png', images[4])
