'use client'

import { useEffect, useRef } from 'react'
import DayIcon from '@/components/DayIcon'
import FlameIcon from '@/components/FlameIcon'

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function CoachG() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontFamily="var(--font-display, 'Bebas Neue', sans-serif)"
        fontSize="11"
        fontWeight="700"
      >
        G
      </text>
    </svg>
  )
}

function NavIcon({ name, active }: { name: 'home' | 'log' | 'progress' | 'profile' | 'ranks'; active?: boolean }) {
  const color = active ? 'var(--accent-text)' : 'var(--text-muted)'
  if (name === 'home') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  }
  if (name === 'log') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 17 9 11 13 15 21 7" />
      </svg>
    )
  }
  if (name === 'profile') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <NavIcon name={tab.id} active={tab.id === active} />
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
 * ~10s CSS loop that mirrors the real app: home → log a set → PR → completion sheet.
 * Reduce-motion holds on the home screen (the "screenshot" of opening the app).
 */
export default function HowItWorksDemo() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const root = el.closest('.landing')
    const io = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle('landing-demo--active', entry.isIntersecting)
      },
      { root: root instanceof Element ? root : null, threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

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
                    <DayIcon dayKey="push" size={24} color="var(--on-accent)" />
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
                      <CoachG />
                    </span>
                    <span className="landing-how-wo__clock">8:12</span>
                  </span>
                </div>
                <div className="landing-how-wo__progress">
                  <div className="landing-how-wo__progress-fill" />
                </div>

                <div className="landing-how-wo__body">
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

                <div className="landing-how-wo__rest">
                  <div className="landing-how-wo__rest-bar">
                    <div className="landing-how-wo__rest-fill" />
                  </div>
                  <div className="landing-how-wo__rest-row">
                    <span className="landing-how-wo__rest-time">1:32</span>
                    <span className="landing-how-wo__rest-label">Rest · Bench Press</span>
                  </div>
                </div>
                <div className="landing-how-wo__finish">
                  <span>FINISH WORKOUT</span>
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
                      ['8m 12s', 'Duration'],
                      ['3', 'Sets'],
                      ['1', 'PRs'],
                      ['12', 'Streak'],
                    ].map(([value, label]) => (
                      <div key={label} className="landing-how-done__stat">
                        <div className="landing-how-done__stat-n">{value}</div>
                        <div className="landing-how-done__stat-l">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="landing-how-done__pr">
                    <span>Bench Press</span>
                    <span>190 lbs × 8</span>
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
