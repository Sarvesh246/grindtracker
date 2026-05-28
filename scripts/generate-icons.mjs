import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

for (const size of [192, 512]) {
  const svg = Buffer.from(makeSvg(size))
  await sharp(svg).png().toFile(join(__dirname, `../public/icon-${size}.png`))
  console.log(`Generated icon-${size}.png`)
}
