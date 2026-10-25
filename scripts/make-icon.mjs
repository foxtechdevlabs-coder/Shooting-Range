#!/usr/bin/env node
/**
 * Generate build/icon.ico (+ build/icon.png, 256x256) from build/icon-source.png.
 *
 * Pure Node: decodes the source PNG with zlib, area-averages it down to each
 * icon size and writes a multi-resolution .ico (BMP entries 16-128, PNG for 256).
 *
 * Replace the artwork with your own square PNG and re-run:
 *   node scripts/make-icon.mjs            (source: build/icon-source.png)
 *   node scripts/make-icon.mjs my.png     (any square PNG, 256x256 or larger)
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.resolve(process.argv[2] ?? path.join(root, 'build', 'icon-source.png'))
const outIcon = path.join(root, 'build', 'icon.ico')
const outPng = path.join(root, 'build', 'icon.png')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

// --- PNG decoding ----------------------------------------------------------

function decodePng(buffer) {
  if (buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG file')
  let offset = 8
  let width = 0, height = 0, bitDepth = 8, colorType = 6
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii')
    const data = buffer.slice(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported')
      if (bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${bitDepth})`)
      if (colorType !== 2 && colorType !== 6) throw new Error('Only RGB/RGBA PNGs are supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break
    offset += 12 + length
  }

  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      switch (filter) {
        case 1: line[x] = (line[x] + left) & 0xff; break
        case 2: line[x] = (line[x] + up) & 0xff; break
        case 3: line[x] = (line[x] + ((left + up) >> 1)) & 0xff; break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft)
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
          line[x] = (line[x] + predictor) & 0xff
          break
        }
        default: break
      }
    }
    for (let x = 0; x < width; x++) {
      const source = x * channels
      const target = (y * width + x) * 4
      out[target] = line[source]
      out[target + 1] = line[source + 1]
      out[target + 2] = line[source + 2]
      out[target + 3] = channels === 4 ? line[source + 3] : 255
    }
    previous = line
  }
  return { width, height, data: out }
}

// --- Resize (area average, keeps edges clean) ------------------------------

function resize(image, size) {
  const { width, height, data } = image
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * height) / size), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / size))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * width) / size), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / size))
      let r = 0, g = 0, b = 0, a = 0, count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const index = (sy * width + sx) * 4
          const alpha = data[index + 3]
          r += data[index] * alpha
          g += data[index + 1] * alpha
          b += data[index + 2] * alpha
          a += alpha
          count++
        }
      }
      const target = (y * size + x) * 4
      const alphaAverage = a / count
      out[target] = a > 0 ? Math.round(r / a) : 0
      out[target + 1] = a > 0 ? Math.round(g / a) : 0
      out[target + 2] = a > 0 ? Math.round(b / a) : 0
      out[target + 3] = Math.round(alphaAverage)
    }
  }
  return out
}

// --- Encoders --------------------------------------------------------------

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let crcTable
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return crc ^ -1
}

/** BMP (DIB) entry for the .ico: bottom-up BGRA + 1-bit AND mask. */
function encodeIcoBmp(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // height doubled: XOR + AND mask
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)

  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const source = ((size - 1 - y) * size + x) * 4 // bottom-up
      const target = (y * size + x) * 4
      pixels[target] = rgba[source + 2]
      pixels[target + 1] = rgba[source + 1]
      pixels[target + 2] = rgba[source]
      pixels[target + 3] = rgba[source + 3]
    }
  }

  const maskStride = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskStride * size) // fully transparent mask -> use the alpha channel
  return Buffer.concat([header, pixels, mask])
}

// --- Main ------------------------------------------------------------------

const source = decodePng(fs.readFileSync(sourcePath))
if (source.width !== source.height) throw new Error(`Icon artwork must be square (got ${source.width}x${source.height})`)
if (source.width < 256) throw new Error('Icon artwork must be at least 256x256')

const entries = SIZES.map((size) => ({ size, rgba: resize(source, size) }))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(entries.length, 4)

const directory = Buffer.alloc(16 * entries.length)
const images = []
let offset = 6 + directory.length
entries.forEach((entry, index) => {
  const payload = entry.size >= 256 ? encodePng(entry.size, entry.rgba) : encodeIcoBmp(entry.size, entry.rgba)
  const base = index * 16
  directory[base] = entry.size >= 256 ? 0 : entry.size
  directory[base + 1] = entry.size >= 256 ? 0 : entry.size
  directory[base + 2] = 0 // palette
  directory[base + 3] = 0
  directory.writeUInt16LE(1, base + 4) // color planes
  directory.writeUInt16LE(32, base + 6) // bits per pixel
  directory.writeUInt32LE(payload.length, base + 8)
  directory.writeUInt32LE(offset, base + 12)
  images.push(payload)
  offset += payload.length
})

fs.mkdirSync(path.dirname(outIcon), { recursive: true })
fs.writeFileSync(outIcon, Buffer.concat([header, directory, ...images]))
fs.writeFileSync(outPng, encodePng(256, entries.find((entry) => entry.size === 256).rgba))

console.log(`[icon] source ${source.width}x${source.height} -> ${SIZES.join(', ')}`)
console.log(`[icon] wrote ${path.relative(root, outIcon)} (${(fs.statSync(outIcon).size / 1024).toFixed(0)} KB)`)
console.log(`[icon] wrote ${path.relative(root, outPng)}`)
