'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * One-shot fade/rise when a landing section enters the viewport.
 * CSS `.landing-rise` stays inert until `.landing-rise--seen` is added,
 * so below-fold copy doesn't finish animating before the user scrolls to it.
 */
export default function LandingRise({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduced =
      document.documentElement.classList.contains('reduce-motion') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      el.classList.add('landing-rise--seen')
      return
    }

    el.classList.add('landing-rise--pending')

    const root = el.closest('.landing')
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        el.classList.remove('landing-rise--pending')
        el.classList.add('landing-rise--seen')
        io.disconnect()
      },
      {
        threshold: 0.16,
        root: root instanceof Element ? root : null,
        rootMargin: '0px 0px -8% 0px',
      },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={className ? `landing-rise ${className}` : 'landing-rise'}>
      {children}
    </div>
  )
}
