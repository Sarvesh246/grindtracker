import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '../public')

// Portrait-only (manifest orientation is 'portrait'). width/height are the
// device's physical pixel resolution; cssWidth/cssHeight + ratio are what the
// apple-touch-startup-image `media` query in layout.tsx needs to target it.
const SPLASH_SCREENS = [
  { width: 1290, height: 2796, cssWidth: 430, cssHeight: 932, ratio: 3, name: '1290x2796' }, // 14/15/16 Pro Max, 16 Plus
  { width: 1179, height: 2556, cssWidth: 393, cssHeight: 852, ratio: 3, name: '1179x2556' }, // 14 Pro, 15, 15 Pro, 16
  { width: 1170, height: 2532, cssWidth: 390, cssHeight: 844, ratio: 3, name: '1170x2532' }, // 12, 13, 14
  { width: 1284, height: 2778, cssWidth: 428, cssHeight: 926, ratio: 3, name: '1284x2778' }, // 12/13 Pro Max
  { width: 1125, height: 2436, cssWidth: 375, cssHeight: 812, ratio: 3, name: '1125x2436' }, // X, XS, 11 Pro
  { width: 1242, height: 2688, cssWidth: 414, cssHeight: 896, ratio: 3, name: '1242x2688' }, // XS Max, 11 Pro Max
  { width: 828, height: 1792, cssWidth: 414, cssHeight: 896, ratio: 2, name: '828x1792' }, // XR, 11
  { width: 750, height: 1334, cssWidth: 375, cssHeight: 667, ratio: 2, name: '750x1334' }, // 6/7/8, SE 2/3
  { width: 640, height: 1136, cssWidth: 320, cssHeight: 568, ratio: 2, name: '640x1136' }, // SE 1st gen, 5/5s
]

function makeSvg(width, height) {
  const fontSize = Math.round(Math.min(width, height) * 0.16)
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#0f0f0f"/>
    <text
      x="${width / 2}"
      y="${height / 2 + fontSize * 0.05}"
      font-family="Arial Black, Arial, sans-serif"
      font-weight="900"
      font-size="${fontSize}"
      fill="#c8f135"
      text-anchor="middle"
      dominant-baseline="middle"
    >G</text>
  </svg>`
}

mkdirSync(join(publicDir, 'splash'), { recursive: true })

for (const s of SPLASH_SCREENS) {
  const svg = Buffer.from(makeSvg(s.width, s.height))
  await sharp(svg).png().toFile(join(publicDir, 'splash', `${s.name}.png`))
  console.log(`Generated splash/${s.name}.png`)
}

console.log(JSON.stringify(SPLASH_SCREENS))
