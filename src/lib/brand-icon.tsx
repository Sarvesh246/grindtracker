/** Shared JSX for Next.js `ImageResponse` app icons (favicon, apple-touch). */
export function brandIconElement(size: number) {
  const fontSize = Math.round(size * 0.55)
  const borderRadius = size * 0.2

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f0f0f',
        borderRadius,
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: 900,
          color: '#c8f135',
          fontFamily: 'Arial Black, Arial, sans-serif',
          marginTop: size * 0.05,
        }}
      >
        G
      </span>
    </div>
  )
}
