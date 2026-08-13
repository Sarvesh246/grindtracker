/**
 * Paint a dark-branded GRIND rank card to a canvas and return a PNG blob.
 * Avoids html-to-image / CORS-tainted <img> by drawing initials when the
 * avatar can't be loaded cross-origin.
 */

export type ShareCardImageInput = {
  displayName: string
  username: string
  rank: number
  categoryLabel: string
  statLabel: string
  statValue: string
  level: number
  streak: number
  workouts: number
  avatarUrl?: string | null
  rankColor?: string
  heroText?: string
  heroSub?: string
}

function initials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

async function tryLoadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export async function renderShareCardPng(input: ShareCardImageInput): Promise<Blob> {
  const w = 640
  const h = 960
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  const bg = '#0f0f0f'
  const accent = '#c8f135'
  const text = '#f0f0f0'
  const muted = '#555555'
  const border = '#2e2e2e'
  const rankColor = input.rankColor ?? accent

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = accent
  ctx.lineWidth = 6
  ctx.strokeRect(12, 12, w - 24, h - 24)

  ctx.fillStyle = accent
  ctx.font = '700 64px Bebas Neue, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('GRIND', w / 2, 100)

  ctx.fillStyle = muted
  ctx.font = '700 18px DM Sans, sans-serif'
  ctx.fillText(input.categoryLabel, w / 2, 140)

  // Avatar circle
  const cx = w / 2
  const cy = 230
  const r = 56
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#242424'
  ctx.fill()
  ctx.strokeStyle = border
  ctx.lineWidth = 3
  ctx.stroke()

  let drewAvatar = false
  if (input.avatarUrl) {
    const img = await tryLoadImage(input.avatarUrl)
    if (img) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r - 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2)
      ctx.restore()
      drewAvatar = true
    }
  }
  if (!drewAvatar) {
    ctx.fillStyle = text
    ctx.font = '700 28px DM Sans, sans-serif'
    ctx.fillText(initials(input.displayName || input.username), cx, cy + 10)
  }

  ctx.fillStyle = text
  ctx.font = '700 28px DM Sans, sans-serif'
  ctx.fillText(input.displayName, w / 2, 320)
  ctx.fillStyle = muted
  ctx.font = '400 22px DM Sans, sans-serif'
  ctx.fillText(`@${input.username}`, w / 2, 352)

  ctx.fillStyle = rankColor
  ctx.font = '700 140px Bebas Neue, Impact, sans-serif'
  const hero = input.heroText ?? `#${input.rank}`
  ctx.fillText(hero, w / 2, 520)
  if (input.heroSub) {
    ctx.fillStyle = muted
    ctx.font = '400 18px DM Sans, sans-serif'
    ctx.fillText(input.heroSub, w / 2, 552)
  }

  ctx.fillStyle = text
  ctx.font = '700 48px JetBrains Mono, monospace'
  ctx.fillText(input.statValue, w / 2, input.heroSub ? 620 : 600)
  ctx.fillStyle = muted
  ctx.font = '400 18px DM Sans, sans-serif'
  ctx.fillText(input.statLabel, w / 2, input.heroSub ? 652 : 632)

  ctx.strokeStyle = border
  ctx.beginPath()
  ctx.moveTo(80, 680)
  ctx.lineTo(w - 80, 680)
  ctx.stroke()

  const cols = [
    { v: String(input.level), l: 'LEVEL' },
    { v: String(input.streak), l: 'DAY STREAK' },
    { v: String(input.workouts), l: 'WORKOUTS' },
  ]
  cols.forEach((c, i) => {
    const x = 140 + i * 180
    ctx.fillStyle = accent
    ctx.font = '700 40px Bebas Neue, Impact, sans-serif'
    ctx.fillText(c.v, x, 760)
    ctx.fillStyle = muted
    ctx.font = '400 14px DM Sans, sans-serif'
    ctx.fillText(c.l, x, 790)
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))),
      'image/png',
    )
  })
}
