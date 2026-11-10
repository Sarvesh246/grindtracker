'use client'
import { useState } from 'react'

/** A profile photo with a fallback when the URL is missing or fails. */
export default function Avatar({ src, name, size, fontSize }: {
  src?: string | null; name: string; size: number; fontSize: number
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {src && src !== failedSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async"
          onError={() => setFailedSrc(src)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span aria-hidden="true" style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize, color: 'var(--text-secondary)' }}>
          {initials}
        </span>
      )}
    </div>
  )
}
