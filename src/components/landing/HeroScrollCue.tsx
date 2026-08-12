'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Bottom-of-hero scroll affordance. Observes the hero inside `.landing`
 * (the actual scrollport — not `window`) and hides once the hero leaves view.
 */
export default function HeroScrollCue({ targetId }: { targetId: string }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const btn = btnRef.current
    const hero = btn?.closest('.landing-hero')
    const root = btn?.closest('.landing')
    if (!btn || !hero || !root) return

    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.4)
      },
      { root, threshold: [0, 0.25, 0.4, 0.6, 1] },
    )
    io.observe(hero)
    return () => io.disconnect()
  }, [])

  const onClick = () => {
    const target = document.getElementById(targetId)
    if (!target) return
    const reduce =
      document.documentElement.classList.contains('reduce-motion') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <button
      ref={btnRef}
      type="button"
      className={`landing-hero__scroll press${visible ? '' : ' landing-hero__scroll--hidden'}`}
      onClick={onClick}
      aria-label="Scroll to next section"
      data-haptic="light"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <svg
        className="landing-hero__scroll-icon"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}
