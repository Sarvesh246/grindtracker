'use client'
import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import DayIcon from '@/components/DayIcon'
import {
  DAY_ICON_KINDS,
  DAY_ICON_META,
  resolveDayIconKind,
  type DayIconKind,
} from '@/lib/utils/dayIcons'

const swatch: CSSProperties = {
  width: '56px',
  height: '56px',
  borderRadius: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

export default function IconGallery() {
  const router = useRouter()
  const [probe, setProbe] = useState('abs')
  const [category, setCategory] = useState<'none' | 'push' | 'pull' | 'legs' | 'other'>('none')

  const resolved = useMemo(
    () => resolveDayIconKind(probe, category === 'none' ? null : category),
    [probe, category],
  )

  return (
    <div className="page page--wide" style={{ fontFamily: "'DM Sans', sans-serif", padding: '24px 16px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={() => router.push('/profile/settings')}
          aria-label="Back to settings"
          data-haptic="light"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px', margin: '-4px',
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-display-md)',
            color: 'var(--text-primary)', letterSpacing: '1px', lineHeight: 1,
          }}>
            DAY ICONS
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Developer gallery · 24×24 · stroke 1.8
          </div>
        </div>
      </div>

      <div style={{
        margin: '20px 0 24px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div style={{
          fontSize: '11px', letterSpacing: 'var(--tracking-label)',
          color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
        }}>
          Try a day name
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={probe}
            onChange={e => setProbe(e.target.value)}
            placeholder="abs, upper_a, day1…"
            aria-label="Day name to resolve"
            style={{
              flex: '1 1 160px',
              height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: '0 12px',
              outline: 'none',
            }}
          />
          <select
            value={category}
            onChange={e => setCategory(e.target.value as typeof category)}
            aria-label="Leaderboard category"
            style={{
              height: '40px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              padding: '0 10px',
            }}
          >
            <option value="none">No category</option>
            <option value="push">push</option>
            <option value="pull">pull</option>
            <option value="legs">legs</option>
            <option value="other">other</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            ...swatch,
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--accent-text)',
          }}>
            <DayIcon kind={resolved} size={28} />
          </span>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: '22px',
              letterSpacing: '1px', color: 'var(--text-primary)', lineHeight: 1,
            }}>
              {resolved.toUpperCase()}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {DAY_ICON_META[resolved].glyph}
            </div>
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gap: '12px',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      }}>
        {DAY_ICON_KINDS.map((kind: DayIconKind) => {
          const meta = DAY_ICON_META[kind]
          return (
            <div
              key={kind}
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: '22px',
                  letterSpacing: '1px', color: 'var(--text-primary)', lineHeight: 1,
                }}>
                  {kind.toUpperCase()}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{meta.glyph}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    ...swatch,
                    backgroundColor: 'var(--surface-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--accent-text)',
                  }}>
                    <DayIcon kind={kind} size={28} />
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'center' }}>
                    Log
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    ...swatch,
                    backgroundColor: 'var(--accent)',
                    color: 'var(--on-accent)',
                  }}>
                    <DayIcon kind={kind} size={32} color="var(--on-accent)" />
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'center' }}>
                    Home START
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-primary)',
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                  }}>
                    <DayIcon kind={kind} size={28} />
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'center' }}>
                    Size check
                  </span>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {meta.matches.join(' · ')}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
