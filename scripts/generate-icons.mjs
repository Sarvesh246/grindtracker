import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Wrap a PNG buffer in a single-image ICO (Windows Vista+). */
function pngToIco(pngBuffer, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngBuffer.length, 8)
  entry.writeUInt32LE(22, 12)

  return Buffer.concat([header, entry, pngBuffer])
}

function makeSvg(size) {
  const fontSize = Math.round(size * 0.55)
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#0f0f0f"/>
    <text
      x="${size / 2}"
      y="${size / 2 + size * 0.05}"
      font-family="Arial Black, Arial, sans-serif"
      font-weight="900"
      font-size="${fontSize}"
      fill="#c8f135"
      text-anchor="middle"
      dominant-baseline="middle"
    >G</text>
  </svg>`
}

mkdirSync(join(__dirname, '../public'), { recursive: true })

const publicDir = join(__dirname, '../public')

for (const size of [192, 512]) {
  const svg = Buffer.from(makeSvg(size))
  await sharp(svg).png().toFile(join(publicDir, `icon-${size}.png`))
  console.log(`Generated icon-${size}.png`)
}

const favicon32 = await sharp(Buffer.from(makeSvg(32))).png().toBuffer()
writeFileSync(join(publicDir, 'favicon.ico'), pngToIco(favicon32, 32))
console.log('Generated public/favicon.ico')
