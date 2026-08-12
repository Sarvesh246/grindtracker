'use client'

import { useEffect, useRef } from 'react'

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * CSS phone mockup: set check → PR chip loop.
 * Pauses via IntersectionObserver when off-screen; reduce-motion zeroes
 * keyframes via globals (html.reduce-motion / prefers-reduced-motion).
 */
export default function HeroDemo() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle('landing-demo--active', entry.isIntersecting)
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="landing-hero-phone" aria-hidden="true">
      <div className="landing-hero-phone__bezel">
        <div className="landing-hero-phone__island" />
        <div className="landing-hero-phone__screen">
          <div className="landing-hero-phone__bar">
            <span className="landing-hero-phone__day">PUSH</span>
            <span className="landing-hero-phone__timer">1:32</span>
          </div>

          <div className="landing-hero-phone__ex">
            <div className="landing-hero-phone__ex-name">Bench Press</div>
            <div className="landing-hero-phone__ex-meta">3 × 8 · last 185</div>
          </div>

          <div className="landing-hero-phone__col-labels">
            <span />
            <span>lbs</span>
            <span>reps</span>
            <span />
          </div>

          <div className="landing-hero-phone__sets">
            <div className="landing-hero-set landing-hero-set--done">
              <span className="landing-hero-set__label">SET 1</span>
              <span className="landing-hero-set__box">185</span>
              <span className="landing-hero-set__box">8</span>
              <span className="landing-hero-set__check">
                <CheckIcon />
              </span>
            </div>
            <div className="landing-hero-set landing-hero-set--done">
              <span className="landing-hero-set__label">SET 2</span>
              <span className="landing-hero-set__box">185</span>
              <span className="landing-hero-set__box">8</span>
              <span className="landing-hero-set__check">
                <CheckIcon />
              </span>
            </div>
            {/*
              Same-size LBS/REPS boxes as other rows; PR stacks below the reps
              box (all breakpoints) so it never crowds the “8”.
            */}
            <div className="landing-hero-set landing-hero-set--active">
              <span className="landing-hero-set__label">SET 3</span>
              <span className="landing-hero-set__box">190</span>
              <span className="landing-hero-set__reps-wrap">
                <span className="landing-hero-set__box">8</span>
                <span className="landing-hero-set__pr">PR</span>
              </span>
              <span className="landing-hero-set__check landing-hero-set__check--anim">
                <CheckIcon />
              </span>
            </div>
          </div>
        </div>
        <div className="landing-hero-phone__home" />
      </div>
    </div>
  )
}
