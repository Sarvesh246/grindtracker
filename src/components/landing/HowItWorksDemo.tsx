'use client'

import { useEffect, useRef, useState } from 'react'
import DayIcon from '@/components/DayIcon'
import FlameIcon from '@/components/FlameIcon'
import CoachFabIcon from '@/components/coach/CoachFabIcon'

/** Must match the CSS loop length on `.landing-how__scene`. */
const LOOP_MS = 16_000
/** Log scene is on-screen; rest bar is visible until finish swaps in. */
const REST_START_MS = 2_560
/** Hits 0:00 / REST DONE just before the finish bar takes the bottom edge. */
const REST_ZERO_MS = 10_560
const REST_DURATION_MS = 8_000
const REST_LOW_MS = 2_000

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('reduce-motion')
  )
}

function fmtRest(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function restMsAt(elapsed: number): number {
  if (elapsed < REST_START_MS) return REST_DURATION_MS
  if (elapsed >= REST_ZERO_MS) return 0
  const t = (elapsed - REST_START_MS) / (REST_ZERO_MS - REST_START_MS)
  return Math.max(0, (1 - t) * REST_DURATION_MS)
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function RestChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

function PrTrophy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="8 6 12 2 16 6" />
      <path d="M12 2v10" />
      <path d="M5 17l1.5-5h11L19 17" />
      <path d="M3 22h18" />
    </svg>
  )
}

function NavIcon({ name, active }: { name: 'home' | 'log' | 'progress' | 'profile' | 'ranks'; active?: boolean }) {
  const color = active ? 'var(--accent-text)' : 'var(--text-muted)'
  const props = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'home') {
    return (
      <svg {...props}>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  }
  if (name === 'log') {
    return (
      <svg {...props}>
        <line x1="8" y1="6" x2="8" y2="18" />
        <line x1="16" y1="6" x2="16" y2="18" />
        <line x1="5" y1="9" x2="8" y2="9" />
        <line x1="16" y1="9" x2="19" y2="9" />
        <line x1="5" y1="15" x2="8" y2="15" />
        <line x1="16" y1="15" x2="19" y2="15" />
        <line x1="8" y1="9" x2="16" y2="9" />
        <line x1="8" y1="15" x2="16" y2="15" />
      </svg>
    )
  }
  if (name === 'progress') {
    return (
      <svg {...props}>
        <polyline points="3 17 9 11 13 15 21 7" />
      </svg>
    )
  }
  if (name === 'profile') {
    return (
      <svg {...props}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    )
  }
  return (
    <svg {...props}>
      <rect x="2" y="13" width="6" height="8" rx="1" />
      <rect x="9" y="9" width="6" height="12" rx="1" />
      <rect x="16" y="5" width="6" height="16" rx="1" />
    </svg>
  )
}

function MiniNav({ active }: { active: 'home' | 'log' }) {
  const tabs = [
    { id: 'home' as const, label: 'Home' },
    { id: 'log' as const, label: 'Log' },
    { id: 'progress' as const, label: 'Progress' },
    { id: 'profile' as const, label: 'Profile' },
    { id: 'ranks' as const, label: 'Ranks' },
  ]
  return (
    <div className="landing-how-nav">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`landing-how-nav__tab${tab.id === active ? ' landing-how-nav__tab--on' : ''}`}
        >
          <span className="landing-how-nav__icon">
            <NavIcon name={tab.id} active={tab.id === active} />
          </span>
          <span>{tab.label}</span>
        </div>
      ))}
    </div>
  )
}

function SetRow({
  n,
  weight,
  reps,
  state,
}: {
  n: number
  weight: string
  reps: string
  state: 'done' | 'live'
}) {
  return (
    <div className={`landing-how-set${state === 'done' ? ' landing-how-set--done' : ' landing-how-set--live'}`}>
      <span className="landing-how-set__label">SET {n}</span>
      <span className="landing-how-set__box">{weight}</span>
      <span className="landing-how-set__reps">
        <span className="landing-how-set__box">{reps}</span>
        {state === 'live' ? <span className="landing-how-set__pr">PR</span> : null}
      </span>
      <span className="landing-how-set__check">
        <CheckIcon />
      </span>
    </div>
  )
}

/**
 * ~16s loop that mirrors the real app: home → log a set → PR → completion sheet.
 * Bottom chrome (nav, rest, finish, sheet) is pinned to the phone screen edge.
 * Reduce-motion holds on the home screen.
 */
export default function HowItWorksDemo() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [restMs, setRestMs] = useState(REST_DURATION_MS)

  useEffect(() => {
    // Client-only motion preference (SSR shows animated-capable markup).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduceMotion(prefersReducedMotion())
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const root = el.closest('.landing')
    const io = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle('landing-demo--active', entry.isIntersecting)
        setActive(entry.isIntersecting)
      },
      { root: root instanceof Element ? root : null, threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduceMotion || !active) {
      setRestMs(REST_DURATION_MS)
      return
    }

    let start = performance.now()
    let raf = 0
    let lastShown = -1
    const tick = (now: number) => {
      const elapsed = (now - start) % LOOP_MS
      const ms = restMsAt(elapsed)
      // Digits change once per second, like the live RestTimerBar — not every frame.
      const shown = Math.ceil(ms / 1000) * 1000
      if (shown !== lastShown) {
        lastShown = shown
        setRestMs(shown)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, reduceMotion])

  const restDone = active && !reduceMotion && restMs <= 0
  const restLow = active && !reduceMotion && !restDone && restMs <= REST_LOW_MS

  return (
    <div ref={rootRef} className="landing-how" aria-hidden="true">
      <div className="landing-hero-phone landing-how__phone">
        <div className="landing-hero-phone__bezel">
          <div className="landing-hero-phone__island" />
          <div className="landing-hero-phone__screen landing-how__screen">
            <div className="landing-how__scene landing-how__scene--home">
              <div className="landing-how-home">
                <div className="landing-how-home__date">THU, AUG 13</div>
                <h3 className="landing-how-home__hi">Let&apos;s get after it.</h3>

                <div className="landing-how-home__card landing-how-home__level">
                  <div className="landing-how-home__level-row">
                    <div>
                      <div className="landing-how-home__kicker">Level</div>
                      <div className="landing-how-home__level-n">8</div>
                    </div>
                    <div className="landing-how-home__level-next">
                      <div>→ LVL 9</div>
                      <div>1,860 XP away</div>
                    </div>
                  </div>
                  <div className="landing-how-home__xp">
                    <div className="landing-how-home__xp-fill" />
                  </div>
                  <div className="landing-how-home__xp-meta">2,140 / 4,000 XP</div>
                </div>

                <div className="landing-how-home__card landing-how-home__streak">
                  <div className="landing-how-home__streak-live">
                    <FlameIcon size={18} color="var(--accent-text)" />
                    <span className="landing-how-home__streak-n">12</span>
                    <span className="landing-how-home__kicker">Day streak</span>
                  </div>
                  <div className="landing-how-home__rule" />
                  <div className="landing-how-home__streak-best">
                    <div className="landing-how-home__kicker">Best</div>
                    <div className="landing-how-home__streak-best-n">18</div>
                    <div className="landing-how-home__kicker">Days</div>
                  </div>
                </div>

                <div className="landing-how-home__cta">
                  <DayIcon dayKey="push" size={32} color="var(--on-accent)" />
                  <span className="landing-how-home__cta-copy">
                    <span className="landing-how-home__cta-title">START PUSH DAY</span>
                    <span className="landing-how-home__cta-meta">Bench, Incline +1 more</span>
                  </span>
                  <ChevronRight />
                </div>

                <div className="landing-how-home__last">
                  <div className="landing-how-home__kicker">Last workout</div>
                  <div className="landing-how-home__last-card">
                    <div className="landing-how-home__last-head">
                      <span>PULL DAY</span>
                      <span>WED, AUG 12</span>
                    </div>
                    <div className="landing-how-home__last-row">
                      <span>Lat Pulldown</span>
                      <span>140 lbs</span>
                      <span>3 × 10</span>
                    </div>
                    <div className="landing-how-home__last-row">
                      <span>Barbell Row</span>
                      <span>135 lbs</span>
                      <span>3 × 8</span>
                    </div>
                  </div>
                </div>
              </div>
              <MiniNav active="home" />
            </div>

            <div className="landing-how__scene landing-how__scene--log">
              <div className="landing-how-wo">
                <div className="landing-how-wo__header">
                  <span className="landing-how-wo__back">
                    <BackIcon />
                  </span>
                  <span className="landing-how-wo__day">PUSH DAY</span>
                  <span className="landing-how-wo__meta">
                    <span className="landing-how-wo__g">
                      <CoachFabIcon size={22} />
                    </span>
                    <span className="landing-how-wo__clock">32:14</span>
                  </span>
                </div>
                <div className="landing-how-wo__progress">
                  <div className="landing-how-wo__progress-fill" />
                </div>

                <div className="landing-how-wo__body">
                  <div className="landing-how-wo__stack">
                    <div className="landing-how-wo__card landing-how-wo__card--prior">
                      <div className="landing-how-wo__ex">
                        <div className="landing-how-wo__ex-name">Incline Dumbbell Press</div>
                        <div className="landing-how-wo__ex-meta">
                          <span>3 sets × 10 reps</span>
                          <span>prev: 70 lbs</span>
                        </div>
                      </div>
                      <div className="landing-how-wo__rule" />
                      <div className="landing-how-set__cols">
                        <span />
                        <span>lbs</span>
                        <span>reps</span>
                        <span />
                      </div>
                      <div className="landing-how-set__list">
                        <SetRow n={1} weight="70" reps="10" state="done" />
                        <SetRow n={2} weight="70" reps="10" state="done" />
                        <SetRow n={3} weight="70" reps="10" state="done" />
                      </div>
                    </div>
                    <div className="landing-how-wo__card">
                      <div className="landing-how-wo__ex">
                        <div className="landing-how-wo__ex-name">Bench Press</div>
                        <div className="landing-how-wo__ex-meta">
                          <span>3 sets × 8 reps</span>
                          <span>prev: 185 lbs</span>
                        </div>
                      </div>
                      <div className="landing-how-wo__rule" />
                      <div className="landing-how-set__cols">
                        <span />
                        <span>lbs</span>
                        <span>reps</span>
                        <span />
                      </div>
                      <div className="landing-how-set__list">
                        <SetRow n={1} weight="185" reps="8" state="done" />
                        <SetRow n={2} weight="185" reps="8" state="done" />
                        <SetRow n={3} weight="190" reps="8" state="live" />
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className={`landing-how-wo__rest${restLow ? ' landing-how-wo__rest--low' : ''}${restDone ? ' landing-how-wo__rest--done' : ''}`}
                >
                  <div className="landing-how-wo__rest-bar">
                    <div className="landing-how-wo__rest-fill" />
                  </div>
                  <div className="landing-how-wo__rest-row">
                    <span className="landing-how-wo__rest-time">
                      {restDone ? '0:00' : fmtRest(restMs)}
                    </span>
                    <span className="landing-how-wo__rest-label">
                      {restDone ? 'REST DONE' : 'REST · Bench Press'}
                    </span>
                    {!restDone ? (
                      <>
                        <span className="landing-how-wo__rest-iconbtn">
                          <PauseIcon />
                        </span>
                        <span className="landing-how-wo__rest-iconbtn">±</span>
                      </>
                    ) : null}
                    <span className="landing-how-wo__rest-skip">{restDone ? 'OK' : 'SKIP'}</span>
                  </div>
                  {!restDone ? (
                    <div className="landing-how-wo__rest-chevron">
                      <RestChevron />
                    </div>
                  ) : null}
                </div>
                <div className="landing-how-wo__finish">
                  <span>FINISH WORKOUT</span>
                  <div className="landing-how-wo__finish-sum">6 / 6 sets</div>
                </div>
              </div>
            </div>

            <div className="landing-how__scene landing-how__scene--done">
              <div className="landing-how-done">
                <div className="landing-how-done__dim" />
                <div className="landing-how-done__sheet">
                  <div className="landing-how-done__title">WORKOUT COMPLETE</div>
                  <div className="landing-how-done__xp">
                    <span className="landing-how-done__xp-n">
                      <span>+</span>125
                    </span>
                    <span className="landing-how-done__xp-label">XP earned</span>
                  </div>
                  <div className="landing-how-done__stats">
                    {[
                      ['32m 14s', 'Duration'],
                      ['6', 'Sets'],
                      ['1', 'PRs'],
                      ['12', 'Streak'],
                    ].map(([value, label]) => (
                      <div key={label} className="landing-how-done__stat">
                        <div className="landing-how-done__stat-n">{value}</div>
                        <div className="landing-how-done__stat-l">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="landing-how-done__prs">PERSONAL RECORDS</div>
                  <div className="landing-how-done__pr">
                    <span>Bench Press</span>
                    <span className="landing-how-done__pr-lift">
                      190 lbs × 8
                      <PrTrophy />
                    </span>
                  </div>
                  <div className="landing-how-done__cta">BACK TO HOME</div>
                </div>
              </div>
            </div>
          </div>
          <div className="landing-hero-phone__home" />
        </div>
      </div>
      <ol className="landing-how__steps">
        <li className="landing-how__step landing-how__step--home">Open home</li>
        <li className="landing-how__step landing-how__step--log">Log the set</li>
        <li className="landing-how__step landing-how__step--pr">Hit a PR</li>
        <li className="landing-how__step landing-how__step--done">Saved</li>
      </ol>
    </div>
  )
}
