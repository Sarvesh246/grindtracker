'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ALL_BADGES } from '@/lib/utils/badges'
import { useUnit } from '@/lib/contexts/UnitContext'
import {
  getLevel,
  getXpInCurrentLevel,
  getXpRequiredForLevel,
  getXpToNextLevel,
} from '@/lib/utils/gamification'

/**
 * The post-workout summary sheet.
 *
 * Structure is deliberate: a FIXED header, a SCROLLING body, and a FIXED footer.
 * The previous version put everything — including the only way out — inside one
 * scrolling box, so a session with a few PRs and a badge pushed "Back to home"
 * below the fold on a phone. Anything the user must be able to reach is now
 * outside the scroll region, and the footer clears the home-indicator safe area.
 *
 * Reading order matches what a lifter actually wants to know, most-important
 * first: what did I earn → am I closer to the next level → what did I do → what
 * did I beat → what did I unlock.
 */

export interface CompletionData {
  xpEarned: number
  /** Authoritative post-completion total — drives the level bar. */
  xpTotal: number
  leveledUp: boolean
  newLevel: number
  prCount: number
  prExercises: { name: string; weight: number }[]
  newBadges: string[]
  /** Seconds. */
  duration: number
  setsCompleted: number
  /** Working-set volume (weight × reps) in canonical lbs; warm-ups excluded. */
  volume: number
  currentStreak: number
  longestStreak: number
  /** Raw day key, e.g. `push` or `upper-body`. */
  dayType: string
  /**
   * Epoch ms until the finish can still be reopened, or null when it can't be.
   * Gating on this is what stopped "Resume workout" from being a dead button
   * once the 10-minute undo token had expired.
   */
  undoUntil: number | null
}

// ── "a completion sheet is open" signal ──────────────────────────────────────
// `FinishUndoBanner` is rendered globally in the app layout at z-index 400 and
// offers the SAME resume action this sheet does. Without this it floated over the
// sheet's footer the moment a workout finished — two competing undo affordances
// stacked on top of each other. The banner subscribes here and stands down while
// the sheet is up; it's for after you've navigated away, which is exactly when
// this is closed.
let openSheets = 0
const OVERLAY_EVENT = 'grind:completion-overlay'

export function isCompletionSheetOpen(): boolean {
  return openSheets > 0
}

export function subscribeCompletionSheet(cb: () => void): () => void {
  window.addEventListener(OVERLAY_EVENT, cb)
  return () => window.removeEventListener(OVERLAY_EVENT, cb)
}

function announceSheets() {
  try { window.dispatchEvent(new Event(OVERLAY_EVENT)) } catch { /* non-browser */ }
}

/** "1h 12m" / "48m" / "40s". Seconds only matter for a workout that barely was. */
function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${safe}s`
}

/** Whole minutes left on the undo window, floored at 1 while any time remains. */
function minutesLeft(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 60000))
}

function dayTitle(dayType: string): string {
  return dayType.replace(/-/g, ' ').toUpperCase()
}

export default function CompletionModal({
  data,
  onDone,
  onUndo,
}: {
  data: CompletionData
  onDone: () => void
  /** Reopens the session. Resolves false when the server refused. */
  onUndo?: () => Promise<boolean>
}) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { unitLabel, toDisplay } = useUnit()
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    openSheets += 1
    announceSheets()
    return () => {
      openSheets -= 1
      announceSheets()
    }
  }, [])

  // Focus the primary action so the sheet is immediately keyboard-operable and
  // screen readers land inside it rather than on the page behind.
  useEffect(() => {
    const id = window.setTimeout(() => primaryRef.current?.focus(), 320)
    return () => window.clearTimeout(id)
  }, [])

  // Tick only while an undo window is actually open, so the countdown is honest
  // and the button disappears the moment it expires instead of failing silently.
  const undoWindowOpen = data.undoUntil !== null && data.undoUntil > now
  useEffect(() => {
    if (data.undoUntil === null || data.undoUntil <= Date.now()) return
    const id = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(id)
  }, [data.undoUntil])

  // Refs, not the state flags, guard the re-entrancy: `setLeaving(true)` doesn't
  // land before a second tap in the same tick could read it, and putting the
  // guard inside a state updater would make the updater impure (React invokes
  // updaters twice in development, which would fire the navigation twice).
  const leavingRef = useRef(false)
  const undoingRef = useRef(false)

  const finish = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    onDone()
  }, [onDone])

  // Escape mirrors the primary action rather than doing nothing: there is nothing
  // destructive here, and a dialog you can't dismiss with Escape feels broken.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  async function handleUndo() {
    if (!onUndo || undoingRef.current || leavingRef.current) return
    undoingRef.current = true
    setUndoing(true)
    setUndoError(null)
    try {
      const ok = await onUndo()
      // On success the parent unmounts this sheet; on failure we stay put and
      // say so HERE. The old code surfaced that error as a page toast rendered
      // *behind* the overlay, which no one could see.
      if (!ok) setUndoError("Couldn't reopen the workout. Check your connection and try again.")
    } catch {
      setUndoError("Couldn't reopen the workout. Check your connection and try again.")
    } finally {
      undoingRef.current = false
      setUndoing(false)
    }
  }

  const level = getLevel(data.xpTotal)
  const xpInLevel = getXpInCurrentLevel(data.xpTotal)
  const levelSize = getXpRequiredForLevel(level)
  const xpToNext = getXpToNextLevel(data.xpTotal)
  const levelPercent = levelSize > 0 ? Math.min(100, (xpInLevel / levelSize) * 100) : 0

  const volumeDisplay = Math.round(toDisplay(data.volume)).toLocaleString()

  const stats = [
    { label: 'TIME', value: formatDuration(data.duration) },
    { label: 'SETS', value: String(data.setsCompleted) },
    { label: 'VOLUME', value: volumeDisplay, unit: unitLabel },
    { label: 'PRS', value: String(data.prCount), accent: data.prCount > 0 },
  ]

  const sectionLabel: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-label)',
    marginBottom: '10px',
  }

  return (
    <div className="done-backdrop" role="presentation">
      <div
        className="done-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completion-title"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* ── Header (fixed) ──────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          padding: '14px 24px 16px',
          borderBottom: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <span
            aria-hidden
            style={{
              display: 'block', width: '36px', height: '4px', margin: '0 auto 14px',
              borderRadius: '9999px', backgroundColor: 'var(--border-strong)',
            }}
          />
          <div
            id="completion-title"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '30px',
              color: 'var(--accent-text)',
              letterSpacing: '2px',
              lineHeight: 1,
            }}
          >
            WORKOUT COMPLETE
          </div>
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px',
            letterSpacing: '0.4px',
          }}>
            {dayTitle(data.dayType)} · {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>

        {/* ── Body (scrolls) ──────────────────────────────────────────────── */}
        <div className="done-scroll" style={{ padding: '22px 20px 24px' }}>

          {/* XP earned + progress toward the next level. The bar answers the
              question the big number provokes ("…and how far does that get me?")
              without making the user go look. */}
          <div style={{ textAlign: 'center', marginBottom: '18px' }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '68px', lineHeight: 1,
              color: 'var(--text-primary)',
            }}>
              <span style={{ color: 'var(--accent-text)' }}>+</span>{data.xpEarned}
            </div>
            <div style={{
              fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px',
              fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '2px',
            }}>
              XP EARNED
            </div>
          </div>

          {data.leveledUp ? (
            <div style={{
              backgroundColor: 'var(--accent-wash)',
              border: '1px solid var(--accent-deep)',
              borderRadius: 'var(--radius-md)',
              padding: '14px',
              textAlign: 'center',
              marginBottom: '18px',
            }}>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '26px', color: 'var(--accent-text)', letterSpacing: '1px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                lineHeight: 1,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                LEVEL UP — LEVEL {data.newLevel}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                {xpToNext} XP to Level {level + 1}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '18px' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontSize: '11px', color: 'var(--text-muted)', marginBottom: '7px',
                textTransform: 'uppercase', letterSpacing: '1px',
              }}>
                <span>Level {level}</span>
                <span style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {xpToNext} XP to Level {level + 1}
                </span>
              </div>
              <div style={{
                width: '100%', height: '8px',
                backgroundColor: 'var(--border)',
                borderRadius: '9999px', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${levelPercent}%`,
                  backgroundColor: 'var(--accent)',
                  borderRadius: '9999px',
                  transition: 'width 700ms ease',
                }} />
              </div>
            </div>
          )}

          {/* What you actually did. Two-up on a phone, four-up once there's room —
              four 25%-wide tiles at 360px would truncate "VOLUME" and its number. */}
          <div className="done-stats" style={{ marginBottom: '18px' }}>
            {stats.map(stat => (
              <div key={stat.label} style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '13px 10px',
                textAlign: 'center',
                minWidth: 0,
              }}>
                <div style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '26px', lineHeight: 1, marginBottom: '4px',
                  color: stat.accent ? 'var(--accent-text)' : 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {stat.value}
                  {stat.unit && (
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '3px' }}>
                      {stat.unit}
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: '10px', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.6px',
                }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Streak — the one stat that's about tomorrow rather than today. */}
          {data.currentStreak > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '13px 16px',
              marginBottom: '18px',
            }}>
              <span style={{ color: 'var(--accent-text)', display: 'flex', flexShrink: 0 }} aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
                  <path d="M12 12c0 2-1.5 3-1.5 4.5a1.5 1.5 0 0 0 3 0C13.5 15 12 14 12 12z" />
                </svg>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {data.currentStreak} day streak
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {data.currentStreak >= data.longestStreak
                    ? 'Your best run yet.'
                    : `Best: ${data.longestStreak} days`}
                </div>
              </div>
            </div>
          )}

          {/* PRs. Capped-height scroll so a huge session can't push the badges
              (and the sheet's whole lower half) into an unreachable column. */}
          {data.prExercises.length > 0 && (
            <div style={{ marginBottom: '18px' }}>
              <div style={sectionLabel}>
                NEW PERSONAL {data.prExercises.length === 1 ? 'RECORD' : 'RECORDS'}
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '6px',
                maxHeight: '196px', overflowY: 'auto',
              }}>
                {data.prExercises.map((pr, i) => (
                  <div key={`${pr.name}-${i}`} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: '10px',
                    padding: '11px 13px',
                    backgroundColor: 'var(--accent-wash)',
                    border: '1px solid var(--accent-deep)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <span style={{
                      fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500,
                      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {pr.name}
                    </span>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '14px', color: 'var(--accent-text)',
                    }}>
                      {Math.round(toDisplay(pr.weight) * 10) / 10} {unitLabel}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="8 6 12 2 16 6" /><path d="M12 2v10" />
                        <path d="M5 17l1.5-5h11L19 17" /><path d="M3 22h18" />
                      </svg>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.newBadges.length > 0 && (
            <div>
              <div style={sectionLabel}>
                {data.newBadges.length === 1 ? 'BADGE EARNED' : 'BADGES EARNED'}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {data.newBadges.map(badgeId => {
                  const badge = ALL_BADGES.find(b => b.id === badgeId)
                  if (!badge) return null
                  return (
                    <div key={badgeId} style={{
                      backgroundColor: 'var(--accent-wash)',
                      border: '1px solid var(--accent-deep)',
                      borderRadius: '9999px',
                      padding: '7px 14px',
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <span style={{ fontSize: '13px', color: 'var(--accent-text)', fontWeight: 600 }}>
                        {badge.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer (fixed) ──────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          padding: '14px 20px calc(14px + env(safe-area-inset-bottom))',
          backgroundColor: 'var(--surface)',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          {undoError && (
            <div role="alert" style={{
              fontSize: '12px', color: 'var(--danger)',
              backgroundColor: 'var(--danger-bg)',
              border: '1px solid var(--danger-bg-hover)',
              borderRadius: 'var(--radius-sm)',
              padding: '9px 11px', lineHeight: 1.4,
            }}>
              {undoError}
            </div>
          )}

          <button
            ref={primaryRef}
            onClick={finish}
            disabled={leaving || undoing}
            style={{
              width: '100%', height: '54px',
              backgroundColor: 'var(--accent)',
              color: 'var(--on-accent)',
              border: 'none', borderRadius: 'var(--radius-md)',
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '22px', letterSpacing: '1px',
              cursor: leaving || undoing ? 'default' : 'pointer',
              opacity: leaving || undoing ? 0.6 : 1,
              transition: 'opacity 150ms ease',
            }}
          >
            {leaving ? 'GOING HOME…' : 'DONE'}
          </button>

          {/* Only rendered while reopening is genuinely possible. */}
          {onUndo && undoWindowOpen && data.undoUntil !== null && (
            <button
              onClick={handleUndo}
              disabled={undoing || leaving}
              style={{
                width: '100%', height: '44px',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px', fontWeight: 600,
                cursor: undoing || leaving ? 'default' : 'pointer',
                opacity: undoing || leaving ? 0.6 : 1,
              }}
            >
              {undoing
                ? 'Reopening…'
                : `Finished by mistake? Resume workout (${minutesLeft(data.undoUntil, now)}m left)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
