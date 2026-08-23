/**
 * True for fields the user types into. Excludes haptic-overlay switches,
 * buttons-as-inputs, and other non-text controls so scroll/focus guards
 * don't blur or steal those.
 */
export function isTextField(el: EventTarget | null): boolean {
  if (!el || typeof HTMLElement === 'undefined') return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  if (!(el instanceof HTMLInputElement)) return false
  if (el.hasAttribute('data-haptic-overlay')) return false
  switch (el.type) {
    case 'button':
    case 'submit':
    case 'reset':
    case 'checkbox':
    case 'radio':
    case 'file':
    case 'hidden':
    case 'image':
    case 'range':
    case 'color':
      return false
    default:
      return true
  }
}

export function closestTextField(from: EventTarget | null): HTMLElement | null {
  if (!from || typeof Element === 'undefined') return null
  if (!(from instanceof Element)) return null
  const el = from.closest('input, textarea, [contenteditable="true"]')
  if (!el || !isTextField(el)) return null
  return el
}
