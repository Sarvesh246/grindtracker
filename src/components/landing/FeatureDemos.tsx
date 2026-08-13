'use client'

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import BadgeIcon from '@/components/BadgeIcon'
import { ALL_BADGES } from '@/lib/utils/badges'

function useInViewOnce(threshold = 0.35) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('landing-demo--active', 'landing-demo--seen')
          // One-shot demos: keep final state, stop observing.
          io.disconnect()
        }
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  return ref
}

function useInViewLoop(threshold = 0.3) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        const on = entry.isIntersecting
        el.classList.toggle('landing-demo--active', on)
        setActive(on)
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  return { ref, active }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('reduce-motion')
  )
}

function DemoFrame({
  children,
  className,
  demoRef,
}: {
  children: ReactNode
  className?: string
  demoRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div ref={demoRef} className={`landing-demo-frame ${className ?? ''}`} aria-hidden="true">
      {children}
    </div>
  )
}

const TIMER_SECONDS = 15
const TIMER_RADIUS = 42
const TIMER_CIRC = 2 * Math.PI * TIMER_RADIUS

function fmtRest(secs: number): string {
  const s = Math.max(0, Math.ceil(secs))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Rest-timer ring — real countdown; loops while in view. */
export function RestTimerDemo() {
  const { ref, active } = useInViewLoop()
  const [remaining, setRemaining] = useState(TIMER_SECONDS)
  const [reduceMotion, setReduceMotion] = useState(false)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    // Client-only motion preference (SSR shows animated-capable markup).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduceMotion(prefersReducedMotion())
  }, [])

  useEffect(() => {
    if (reduceMotion || !active) {
      startRef.current = null
      return
    }

    startRef.current = null
    let raf = 0
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now
      const elapsed = (now - startRef.current) / 1000
      // Loop: count 15→0, brief hold, restart.
      const cycle = TIMER_SECONDS + 1.2
      const t = elapsed % cycle
      if (t <= TIMER_SECONDS) {
        setRemaining(TIMER_SECONDS - t)
      } else {
        setRemaining(0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, reduceMotion])

  // Reduce-motion: static completed end-state (empty ring + 0:00).
  const shown = reduceMotion ? 0 : remaining
  const progress = shown / TIMER_SECONDS
  const dashOffset = TIMER_CIRC * (1 - progress)
  const low = !reduceMotion && shown <= 5 && shown > 0
  const phase = shown <= 0 ? 'DONE' : low ? 'UP SOON' : 'REST'

  return (
    <DemoFrame demoRef={ref} className="landing-timer-demo">
      <div className={`landing-timer-demo__ring${low ? ' landing-timer-demo__ring--low' : ''}`}>
        <svg viewBox="0 0 100 100" className="landing-timer-demo__svg">
          <circle cx="50" cy="50" r={TIMER_RADIUS} className="landing-timer-demo__track" />
          <circle
            cx="50"
            cy="50"
            r={TIMER_RADIUS}
            className="landing-timer-demo__progress"
            style={{
              strokeDasharray: TIMER_CIRC,
              strokeDashoffset: dashOffset,
            }}
          />
        </svg>
        <div className="landing-timer-demo__time">
          <span className="landing-timer-demo__digits">{fmtRest(shown)}</span>
          <span className="landing-timer-demo__label">{phase}</span>
        </div>
      </div>
      <p className="landing-timer-demo__legend">
        <span className="landing-timer-demo__swatch landing-timer-demo__swatch--rest" aria-hidden />
        Lime is rest.
        <span className="landing-timer-demo__swatch landing-timer-demo__swatch--low" aria-hidden />
        Red is the last seconds — then you&apos;re up.
      </p>
      <div className="landing-timer-demo__hints">
        <span>Prefill last weight</span>
        <span>Plate calc</span>
        <span>Offline queue</span>
      </div>
    </DemoFrame>
  )
}

/** Streak + XP bar — fills once on enter. */
export function StreakXpDemo() {
  const ref = useInViewOnce()
  return (
    <DemoFrame demoRef={ref} className="landing-streak-demo">
      <div className="landing-streak-demo__row">
        <div className="landing-streak-demo__stat">
          <span className="landing-streak-demo__value">12</span>
          <span className="landing-streak-demo__label">day streak</span>
        </div>
        <div className="landing-streak-demo__stat">
          <span className="landing-streak-demo__value">Lv 8</span>
          <span className="landing-streak-demo__label">level</span>
        </div>
      </div>
      <div className="landing-streak-demo__bar-wrap">
        <div className="landing-streak-demo__bar-label">
          <span>XP</span>
          <span>2,140 / 4,000</span>
        </div>
        <div className="landing-streak-demo__bar">
          <div className="landing-streak-demo__fill" />
        </div>
      </div>
      <div className="landing-streak-demo__rest">Rest days keep the streak alive</div>
    </DemoFrame>
  )
}

/** Static progress chart mock — no Recharts. */
export function ProgressMock() {
  return (
    <div className="landing-progress-mock" aria-hidden="true">
      <div className="landing-progress-mock__head">
        <span>e1RM · Bench</span>
        <span className="landing-progress-mock__delta">+12 lbs</span>
      </div>
      <svg className="landing-progress-mock__chart" viewBox="0 0 280 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="landingChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-mark)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-mark)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 78 C40 74, 60 70, 90 62 C120 54, 140 48, 170 40 C200 32, 230 28, 280 18 L280 100 L0 100 Z"
          fill="url(#landingChartFill)"
        />
        <path
          d="M0 78 C40 74, 60 70, 90 62 C120 54, 140 48, 170 40 C200 32, 230 28, 280 18"
          fill="none"
          stroke="var(--accent-text)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="landing-progress-mock__foot">
        <span>Body weight</span>
        <span>Photo compare</span>
      </div>
    </div>
  )
}

const LANDING_BADGE_IDS = ['flawless', 'plates_225', 'weekend_warrior'] as const

/** Level-up / badge strip — real BadgeIcon + catalog labels. */
export function LevelUpMock() {
  const badges = LANDING_BADGE_IDS.map((id) => ALL_BADGES.find((b) => b.id === id)!).filter(
    Boolean,
  )

  return (
    <div className="landing-level-mock" aria-hidden="true">
      {badges.map((badge, i) => (
        <div
          key={badge.id}
          className={`landing-level-mock__badge${i === 1 ? ' landing-level-mock__badge--hot' : ''}`}
        >
          <span className="landing-level-mock__icon">
            <BadgeIcon badgeId={badge.id} size={22} earned />
          </span>
          <span>{badge.label}</span>
        </div>
      ))}
      <div className="landing-level-mock__xp">+100 XP · workout complete</div>
    </div>
  )
}

/** Friends / share card mock. */
export function FriendsMock() {
  return (
    <div className="landing-friends-mock" aria-hidden="true">
      <div className="landing-friends-mock__card share-card-dark">
        <div className="landing-friends-mock__brand">GRIND</div>
        <div className="landing-friends-mock__rank">#2 · PUSH</div>
        <div className="landing-friends-mock__name">you</div>
        <div className="landing-friends-mock__lift">225 lbs</div>
      </div>
      <p className="landing-friends-mock__note">Private leaderboard · share your best</p>
    </div>
  )
}

/** AI Coach sheet mock — lime G + a short chat beat. */
export function CoachMock() {
  const ref = useInViewOnce(0.35)
  return (
    <DemoFrame demoRef={ref} className="landing-coach-mock">
      <div className="landing-coach-mock__sheet">
        <div className="landing-coach-mock__header">
          <span className="landing-coach-mock__orb" aria-hidden>
            G
          </span>
          <span className="landing-coach-mock__title">Coach</span>
        </div>
        <div className="landing-coach-mock__bubble landing-coach-mock__bubble--user">
          How was today&apos;s push?
        </div>
        <div className="landing-coach-mock__bubble landing-coach-mock__bubble--coach">
          Bench moved — add 5 next time. Keep rest honest on incline.
        </div>
      </div>
    </DemoFrame>
  )
}
