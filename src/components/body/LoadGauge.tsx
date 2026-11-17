'use client'
import { SWEET_SPOT, type LoadBalance } from '@/lib/body'

/**
 * Training load on Progress: the headline and sentence first, then a single
 * track with the 0.8–1.3 sweet spot marked and a dot where this week sits.
 * Only rendered for watch users with enough history (load != null).
 */

const MAX_RATIO = 2

function pos(ratio: number): number {
  return (Math.max(0, Math.min(MAX_RATIO, ratio)) / MAX_RATIO) * 100
}

export default function LoadGauge({ load }: { load: LoadBalance }) {
  const inBand = load.band === 'building'
  const [a, b] = SWEET_SPOT
  return (
    <div style={{ padding: '0 16px', marginBottom: '16px' }}>
      <div
        className="swap-in"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '14px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
              Training load
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {load.percent > 0 ? '+' : ''}{load.percent}%
            </span>
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: '24px', letterSpacing: '1px', lineHeight: 1,
            color: inBand ? 'var(--accent-text)' : 'var(--text-primary)',
          }}>
            {load.headline.toUpperCase()}
          </div>
          <p style={{ fontSize: '13px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>{load.sentence}</p>
        </div>

        <div
          role="img"
          aria-label={`${load.headline}. This week is ${Math.abs(load.percent)}% ${load.percent >= 0 ? 'above' : 'below'} your monthly average; the sweet spot is 80 to 130%.`}
        >
          <div style={{ position: 'relative', height: '18px' }}>
            <div style={{
              position: 'absolute', left: 0, right: 0, top: '6px', height: '6px',
              borderRadius: '9999px', backgroundColor: 'var(--surface-elevated)',
            }} />
            <div style={{
              position: 'absolute', top: '6px', height: '6px',
              left: `${pos(a)}%`, width: `${pos(b) - pos(a)}%`,
              borderRadius: '9999px', backgroundColor: 'var(--accent)', opacity: 0.45,
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: `${pos(load.ratio)}%`,
              width: '16px', height: '16px', transform: 'translate(-50%, -50%)',
              borderRadius: '9999px',
              backgroundColor: inBand ? 'var(--accent)' : 'var(--text-primary)',
              boxShadow: '0 0 0 3px var(--surface)',
            }} />
          </div>
          <div aria-hidden="true" style={{ position: 'relative', height: '14px', marginTop: '6px' }}>
            <span style={{ position: 'absolute', left: 0, fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Light
            </span>
            <span style={{
              position: 'absolute', left: `${(pos(a) + pos(b)) / 2}%`, transform: 'translateX(-50%)',
              fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent-text)', whiteSpace: 'nowrap',
            }}>
              Sweet spot
            </span>
            <span style={{ position: 'absolute', right: 0, fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Hot
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
