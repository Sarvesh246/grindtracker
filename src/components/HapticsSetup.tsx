'use client'

import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { hapticAttrs, setupHaptics, setupTapDragGuard, type HapticIntensity } from '@/lib/utils/haptics'
import { setupIosViewportHeal } from '@/lib/utils/iosViewportHeal'

/**
 * Mount once in the authenticated app shell. Wires `[data-haptic]`:
 * iOS switch overlays (MutationObserver) + Android delegated click vibrate.
 * Overlays forward pans past ~10px to the nearest scroll parent so a swipe
 * that starts on a button still scrolls (WebKit switch would otherwise eat
 * it) — skipped for BottomNav/TopNav so tab taps stay instant. Also installs
 * the tap/drag guard so that swipe never activates the control it started on
 * (app chrome excluded from drag-cancel). Also heals iOS PWA visual-viewport
 * pan / vertical tap-offset (Save hitting Add Set) after keyboard, resume,
 * and leftover status-bar desync.
 */
export default function HapticsSetup() {
  useEffect(() => setupHaptics(), [])
  useEffect(() => setupTapDragGuard(), [])
  useEffect(() => setupIosViewportHeal(), [])
  return null
}

type HapticPressProps = {
  intensity?: HapticIntensity
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * Optional wrapper that stamps `data-haptic` on a positioned host. Prefer
 * putting `data-haptic` directly on the interactive element when possible.
 */
export function HapticPress({
  intensity = 'light',
  children,
  className,
  style,
}: HapticPressProps) {
  return (
    <span
      {...hapticAttrs(intensity)}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        ...style,
      }}
    >
      {children}
    </span>
  )
}
