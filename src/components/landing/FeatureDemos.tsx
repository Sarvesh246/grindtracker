'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle('landing-demo--active', entry.isIntersecting)
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  return ref
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

/** Rest-timer ring — loops while in view. */
export function RestTimerDemo() {
  const ref = useInViewLoop()
  return (
    <DemoFrame demoRef={ref} className="landing-timer-demo">
      <div className="landing-timer-demo__ring">
        <svg viewBox="0 0 100 100" className="landing-timer-demo__svg">
          <circle cx="50" cy="50" r="42" className="landing-timer-demo__track" />
          <circle cx="50" cy="50" r="42" className="landing-timer-demo__progress" />
        </svg>
        <div className="landing-timer-demo__time">
          <span className="landing-timer-demo__digits">1:28</span>
          <span className="landing-timer-demo__label">REST</span>
        </div>
      </div>
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
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
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

/** Level-up / badge strip mock. */
export function LevelUpMock() {
  return (
    <div className="landing-level-mock" aria-hidden="true">
      <div className="landing-level-mock__badge">
        <span className="landing-level-mock__icon">◆</span>
        <span>Flawless</span>
      </div>
      <div className="landing-level-mock__badge landing-level-mock__badge--hot">
        <span className="landing-level-mock__icon">★</span>
        <span>Two Plates</span>
      </div>
      <div className="landing-level-mock__badge">
        <span className="landing-level-mock__icon">▲</span>
        <span>Weekend</span>
      </div>
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
