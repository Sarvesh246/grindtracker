'use client'

import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { hapticAttrs, setupHaptics, type HapticIntensity } from '@/lib/utils/haptics'

/**
 * Mount once in the authenticated app shell. Wires `[data-haptic]`:
 * iOS switch overlays (MutationObserver) + Android delegated click vibrate.
 */
export default function HapticsSetup() {
  useEffect(() => setupHaptics(), [])
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
