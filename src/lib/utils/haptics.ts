// Web haptics — iOS 18+ Safari supports native haptic feedback via the
// <input type="checkbox" switch> element when its <label> is .click()-ed
// programmatically. This is the only way to trigger a real system haptic
// in iOS Safari today. Android/Chrome falls back to navigator.vibrate.
//
// Usage:
//   import { haptic } from '@/lib/utils/haptics'
//   haptic('light')   // set check, timer tick
//   haptic('medium')  // finish workout
//   haptic('success') // PR

type Intensity = 'light' | 'medium' | 'success'

let switchEl: HTMLInputElement | null = null
let labelEl: HTMLLabelElement | null = null

function ensureSwitch() {
  if (typeof document === 'undefined') return null
  if (switchEl && labelEl && labelEl.isConnected) return labelEl

  const id = '__grind_haptic_switch__'
  const existing = document.getElementById(id) as HTMLLabelElement | null
  if (existing) {
    labelEl = existing
    switchEl = existing.querySelector('input') as HTMLInputElement
    return labelEl
  }

  const label = document.createElement('label')
  label.id = id
  label.setAttribute('aria-hidden', 'true')
  label.style.cssText =
    'position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;pointer-events:none;'

  const input = document.createElement('input')
  input.type = 'checkbox'
  // iOS 18 Safari recognizes the "switch" attribute and triggers haptics on toggle.
  input.setAttribute('switch', '')
  input.tabIndex = -1

  label.appendChild(input)
  document.body.appendChild(label)

  switchEl = input
  labelEl = label
  return label
}

function tryIosHaptic(): boolean {
  const l = ensureSwitch()
  if (!l) return false
  try {
    // Programmatic click toggles the switch — iOS fires the system tap.
    l.click()
    return true
  } catch {
    return false
  }
}

function tryVibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined') return false
  // navigator.vibrate is widely supported on Android Chrome; iOS Safari ignores it.
  const nav = navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean
  }
  if (!nav.vibrate) return false
  try {
    return !!nav.vibrate(pattern)
  } catch {
    return false
  }
}

export function haptic(intensity: Intensity = 'light'): void {
  if (typeof window === 'undefined') return

  // Try iOS first — when supported it produces a real native tap.
  const iosOk = tryIosHaptic()
  if (iosOk) return

  // Fall back to Android vibrate API.
  switch (intensity) {
    case 'light':
      tryVibrate(10)
      break
    case 'medium':
      tryVibrate(20)
      break
    case 'success':
      tryVibrate([10, 60, 30])
      break
  }
}
