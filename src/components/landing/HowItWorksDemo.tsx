'use client'

import { useEffect, useRef } from 'react'
import DayIcon from '@/components/DayIcon'
import FlameIcon from '@/components/FlameIcon'

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * ~10s CSS loop: home → log a set → PR → saved.
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
              <div className="landing-home-mock">
                <div className="landing-home-mock__brand">GRIND</div>
                <div className="landing-home-mock__streak">
                  <FlameIcon size={14} color="var(--accent-text)" />
                  <span>12-day streak</span>
                </div>
                <div className="landing-home-mock__cta">
                  <DayIcon dayKey="push" size={22} color="var(--on-accent)" />
                  <span className="landing-home-mock__cta-copy">
                    <span className="landing-home-mock__cta-title">START PUSH</span>
                    <span className="landing-home-mock__cta-meta">Bench · Incline · OHP</span>
                  </span>
                </div>
                <div className="landing-home-mock__last">
                  <span className="landing-home-mock__last-label">Last workout</span>
                  <span className="landing-home-mock__last-row">Push · Bench 185 × 8</span>
                </div>
              </div>
            </div>

            <div className="landing-how__scene landing-how__scene--log">
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
                  <span className="landing-hero-set__check"><CheckIcon /></span>
                </div>
                <div className="landing-hero-set landing-hero-set--done">
                  <span className="landing-hero-set__label">SET 2</span>
                  <span className="landing-hero-set__box">185</span>
                  <span className="landing-hero-set__box">8</span>
                  <span className="landing-hero-set__check"><CheckIcon /></span>
                </div>
                <div className="landing-hero-set landing-hero-set--active">
                  <span className="landing-hero-set__label">SET 3</span>
                  <span className="landing-hero-set__box">190</span>
                  <span className="landing-hero-set__box">8</span>
                  <span className="landing-hero-set__check" />
                </div>
              </div>
            </div>

            <div className="landing-how__scene landing-how__scene--pr">
              <div className="landing-hero-phone__bar">
                <span className="landing-hero-phone__day">PUSH</span>
                <span className="landing-hero-phone__timer">0:00</span>
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
                  <span className="landing-hero-set__check"><CheckIcon /></span>
                </div>
                <div className="landing-hero-set landing-hero-set--done">
                  <span className="landing-hero-set__label">SET 2</span>
                  <span className="landing-hero-set__box">185</span>
                  <span className="landing-hero-set__box">8</span>
                  <span className="landing-hero-set__check"><CheckIcon /></span>
                </div>
                <div className="landing-hero-set landing-hero-set--done">
                  <span className="landing-hero-set__label">SET 3</span>
                  <span className="landing-hero-set__box">190</span>
                  <span className="landing-hero-set__reps-wrap">
                    <span className="landing-hero-set__box">8</span>
                    <span className="landing-how__pr">PR</span>
                  </span>
                  <span className="landing-hero-set__check"><CheckIcon /></span>
                </div>
              </div>
            </div>

            <div className="landing-how__scene landing-how__scene--done">
              <div className="landing-home-mock landing-home-mock--saved">
                <div className="landing-home-mock__saved">Workout saved</div>
                <div className="landing-home-mock__xp">+100 XP</div>
                <div className="landing-home-mock__streak">
                  <FlameIcon size={14} color="var(--accent-text)" />
                  <span>12-day streak</span>
                </div>
                <div className="landing-home-mock__cta landing-home-mock__cta--next">
                  <DayIcon dayKey="pull" size={22} color="var(--on-accent)" />
                  <span className="landing-home-mock__cta-copy">
                    <span className="landing-home-mock__cta-title">START PULL</span>
                    <span className="landing-home-mock__cta-meta">Up next</span>
                  </span>
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
