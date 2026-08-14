'use client'

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import DayIcon from '@/components/DayIcon'
import { useTheme } from '@/lib/contexts/ThemeContext'
import {
  DAY_COLOR_PRESETS,
  NAMED_DAY_COLORS,
  onDayFill,
  resolveDayColor,
  resolveDayTextColor,
} from '@/lib/utils/dayColors'
import './lab.css'

const SAMPLE_EXERCISES = 'Barbell Squat, Dumbbell RDL, Leg Press, Walking Lunges, Calf Raises'

type Variant =
  | 'current'
  | 'glass'
  | 'heat'
  | 'liquid'
  | 'aurora'
  | 'sweep'
  | 'focus'
  | 'ice'
  | 'sheen'
  | 'parallax'
  | 'charge'

const EXPERIMENTS: {
  id: Variant
  n: string
  title: string
  hint: string
  pointer?: boolean
}[] = [
  { id: 'current', n: '00', title: 'Current', hint: 'The Log UP NEXT card as it ships today. Baseline — no motion.' },
  { id: 'glass', n: '01', title: 'Animated frosted glass', hint: 'Still glass plate. Thin caustic streaks drift underneath; hover pulls a specular highlight to the cursor.', pointer: true },
  { id: 'heat', n: '02', title: 'Heat / energy border', hint: 'A short ember rides the 2px border, always on. Interior stays clean.' },
  { id: 'liquid', n: '03', title: 'Liquid gradient', hint: 'Two sharp (unblurred) color sheets slide past each other over 28s. Dark card, occasional warm band.' },
  { id: 'aurora', n: '04', title: 'Aurora glow', hint: 'Two irregular, heavily blurred ribbons breathe on different clocks. The only “blob” treatment.' },
  { id: 'sweep', n: '05', title: 'Border sweep', hint: 'Card is otherwise identical to Current. Every ~8s a 4px tick runs the edge and vanishes.' },
  { id: 'focus', n: '06', title: 'Focus / target lock', hint: 'One-shot: scale 0.98→1, inset ring flash, pill pulse. Then it sits. Replay to see it again.' },
  { id: 'ice', n: '07', title: 'Ice / frost reveal', hint: 'Grain + white frost at rest. Hover or tap-hold clears the veil, sharpens type, and slides a reflection.', pointer: true },
  { id: 'sheen', n: '08', title: 'Glass reflection', hint: 'A 4–8% white band crosses once, then a long rest. No day-color wash.' },
  { id: 'parallax', n: '09', title: 'Micro-parallax', hint: 'No idle motion. Card 1.5px, wash 5px, icon 3px toward the cursor. Interior only.', pointer: true },
  { id: 'charge', n: '10', title: 'Charging', hint: 'A fill level rises from the bottom like a well, then snaps back. Not a floating glow.' },
]

function LabCard({
  variant,
  fill,
  label,
  onFill,
  paused,
  replayKey,
}: {
  variant: Variant
  fill: string
  label: string
  onFill: string
  paused: boolean
  replayKey: number
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const needsPointer = variant === 'glass' || variant === 'parallax' || variant === 'ice'

  const onMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = stageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width - 0.5) * 2
    const my = ((e.clientY - r.top) / r.height - 0.5) * 2
    el.style.setProperty('--lab-mx', String(Math.max(-1, Math.min(1, mx))))
    el.style.setProperty('--lab-my', String(Math.max(-1, Math.min(1, my))))
  }, [])

  const onLeave = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    el.style.setProperty('--lab-mx', '0')
    el.style.setProperty('--lab-my', '0')
    el.classList.remove('is-hot')
  }, [])

  const vars = {
    '--lab-fill': fill,
    '--lab-label': label,
    '--lab-on': onFill,
  } as CSSProperties

  const cardClass =
    variant === 'glass' ? 'lab-card lab-card--glass' :
    variant === 'heat' ? 'lab-card lab-card--heat' :
    variant === 'focus' ? 'lab-card lab-card--focus' :
    variant === 'ice' ? 'lab-card lab-card--ice' :
    variant === 'parallax' ? 'lab-card lab-card--parallax' :
    variant === 'charge' ? 'lab-card lab-card--charge' :
    variant === 'liquid' ? 'lab-card lab-card--liquid' :
    variant === 'aurora' ? 'lab-card lab-card--aurora' :
    variant === 'sheen' ? 'lab-card lab-card--sheen' :
    'lab-card'

  return (
    <div
      ref={stageRef}
      className={`lab-card-stage${paused ? ' lab-paused' : ''}`}
      style={vars}
      onPointerMove={needsPointer ? onMove : undefined}
      onPointerLeave={needsPointer ? onLeave : undefined}
      onPointerDown={variant === 'ice' ? e => e.currentTarget.classList.add('is-hot') : undefined}
      onPointerUp={variant === 'ice' ? e => e.currentTarget.classList.remove('is-hot') : undefined}
    >
      <div
        key={variant === 'focus' ? `focus-${replayKey}` : variant}
        className={cardClass}
        role="img"
        aria-label="LEGS up next preview"
      >
        {variant === 'glass' && (
          <>
            <div className="lab-glass-caustic" aria-hidden />
            <div className="lab-glass-caustic lab-glass-caustic--slow" aria-hidden />
            <div className="lab-glass-veil" aria-hidden />
            <div className="lab-glass-light" aria-hidden />
          </>
        )}
        {variant === 'heat' && <div className="lab-heat-ring" aria-hidden />}
        {variant === 'liquid' && (
          <>
            <div className="lab-liquid" aria-hidden />
            <div className="lab-liquid lab-liquid--alt" aria-hidden />
          </>
        )}
        {variant === 'aurora' && (
          <>
            <div className="lab-aurora lab-aurora--a" aria-hidden />
            <div className="lab-aurora lab-aurora--b" aria-hidden />
          </>
        )}
        {variant === 'sweep' && <div className="lab-sweep-tick" aria-hidden />}
        {variant === 'focus' && <div className="lab-focus-flash" aria-hidden />}
        {variant === 'ice' && (
          <>
            <div className="lab-ice-grain" aria-hidden />
            <div className="lab-ice-frost" aria-hidden />
            <div className="lab-ice-sheen" aria-hidden />
          </>
        )}
        {variant === 'sheen' && <div className="lab-sheen" aria-hidden />}
        {variant === 'parallax' && (
          <>
            <div className="lab-parallax-plane" aria-hidden />
            <div className="lab-parallax-spec" aria-hidden />
          </>
        )}
        {variant === 'charge' && (
          <>
            <div className="lab-charge" aria-hidden />
            <div className="lab-charge-lip" aria-hidden />
          </>
        )}

        <div className="lab-card__row">
          <div className="lab-card__title-wrap">
            <DayIcon dayKey="legs" category="legs" size={28} />
            <span className="lab-card__title">LEGS</span>
          </div>
          <span className="lab-card__pill">UP NEXT</span>
        </div>
        <div className="lab-card__desc">{SAMPLE_EXERCISES}</div>
      </div>
    </div>
  )
}

export default function CardLab() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const [hex, setHex] = useState(NAMED_DAY_COLORS.legs)
  const [paused, setPaused] = useState(false)
  const [replayKey, setReplayKey] = useState(0)

  const fill = resolveDayColor('legs', [], isLight, hex)
  const label = resolveDayTextColor('legs', [], isLight, hex)
  const onFill = onDayFill(fill)

  return (
    <div className="page page--wide" style={{ fontFamily: "'DM Sans', sans-serif", padding: '24px 16px 64px' }}>
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
            CARD LAB
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Developer · UP NEXT treatments · color-aware
          </div>
        </div>
      </div>

      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 4,
        margin: '18px 0 28px',
        padding: '14px 16px',
        backgroundColor: 'color-mix(in srgb, var(--bg) 88%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
      }}>
        <div style={{
          fontSize: '11px', letterSpacing: 'var(--tracking-label)',
          color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 500,
          marginBottom: '10px',
        }}>
          Day color
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {DAY_COLOR_PRESETS.map(c => (
            <button
              key={c}
              type="button"
              data-haptic="light"
              aria-label={`Use ${c}`}
              aria-pressed={hex === c}
              onClick={() => setHex(c)}
              style={{
                width: '28px', height: '28px', borderRadius: '50%',
                background: c, padding: 0, cursor: 'pointer',
                border: hex === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                boxShadow: hex === c ? `0 0 0 2px var(--bg), 0 0 0 3px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,0.18)',
              }}
            />
          ))}
          <label style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: '8px',
            height: '28px', padding: '0 10px 0 4px',
            borderRadius: '9999px',
            border: '1px solid var(--border)',
            background: 'var(--surface-elevated)',
            cursor: 'pointer',
          }}>
            <input
              type="color"
              value={hex}
              aria-label="Custom day color"
              onChange={e => setHex(e.target.value)}
              style={{
                width: '20px', height: '20px', padding: 0, border: 0,
                background: 'none', cursor: 'pointer',
              }}
            />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              color: 'var(--text-secondary)',
            }}>
              {hex.toUpperCase()}
            </span>
          </label>
          <button
            type="button"
            data-haptic="light"
            className="press"
            onClick={() => setPaused(p => !p)}
            style={{
              marginLeft: 'auto',
              height: '28px', padding: '0 10px',
              borderRadius: '9999px',
              border: '1px solid var(--border)',
              background: paused ? 'var(--accent-wash)' : 'var(--surface-elevated)',
              color: paused ? 'var(--accent-text)' : 'var(--text-secondary)',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {paused ? 'Animations paused' : 'Pause loops'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {EXPERIMENTS.map(exp => (
          <section key={exp.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '20px',
                letterSpacing: '1px',
                color: 'var(--text-primary)',
              }}>
                <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>{exp.n}</span>
                {exp.title}
              </div>
              {exp.id === 'focus' && (
                <button
                  type="button"
                  data-haptic="light"
                  className="press"
                  onClick={() => setReplayKey(k => k + 1)}
                  style={{
                    height: '28px', padding: '0 10px',
                    borderRadius: '9999px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-elevated)',
                    color: 'var(--text-secondary)',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Replay
                </button>
              )}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
              {exp.hint}
            </p>
            <LabCard
              variant={exp.id}
              fill={fill}
              label={label}
              onFill={onFill}
              paused={paused}
              replayKey={replayKey}
            />
          </section>
        ))}
      </div>
    </div>
  )
}
