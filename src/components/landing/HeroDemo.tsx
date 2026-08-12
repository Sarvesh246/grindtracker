'use client'

import { useEffect, useRef } from 'react'

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
        <div className="landing-hero-phone__notch" />
        <div className="landing-hero-phone__screen">
          <div className="landing-hero-phone__bar">
            <span className="landing-hero-phone__day">PUSH</span>
            <span className="landing-hero-phone__timer">1:32</span>
          </div>

          <div className="landing-hero-phone__ex">
            <div className="landing-hero-phone__ex-name">Bench Press</div>
            <div className="landing-hero-phone__ex-meta">3 × 8 · last 185</div>
          </div>

          <div className="landing-hero-phone__sets">
            <div className="landing-hero-set landing-hero-set--done">
              <span className="landing-hero-set__n">1</span>
              <span className="landing-hero-set__w">185</span>
              <span className="landing-hero-set__r">× 8</span>
              <span className="landing-hero-set__check">✓</span>
            </div>
            <div className="landing-hero-set landing-hero-set--done">
              <span className="landing-hero-set__n">2</span>
              <span className="landing-hero-set__w">185</span>
              <span className="landing-hero-set__r">× 8</span>
              <span className="landing-hero-set__check">✓</span>
            </div>
            <div className="landing-hero-set landing-hero-set--active">
              <span className="landing-hero-set__n">3</span>
              <span className="landing-hero-set__w">190</span>
              <span className="landing-hero-set__r">× 8</span>
              <span className="landing-hero-set__check landing-hero-set__check--anim">✓</span>
            </div>
          </div>

          <div className="landing-hero-pr">
            <span className="landing-hero-pr__chip">PR</span>
            <span className="landing-hero-pr__copy">New volume PR · +25 XP</span>
          </div>
        </div>
      </div>
    </div>
  )
}
