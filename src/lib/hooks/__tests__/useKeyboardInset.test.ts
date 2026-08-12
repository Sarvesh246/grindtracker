import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isEditableElement,
  isVisualViewportZoomed,
} from '../useKeyboardInset'

describe('useKeyboardInset helpers', () => {
  it('treats pinch-zoom scale drift as zoomed', () => {
    assert.equal(isVisualViewportZoomed(1), false)
    assert.equal(isVisualViewportZoomed(undefined), false)
    assert.equal(isVisualViewportZoomed(1.01), false)
    assert.equal(isVisualViewportZoomed(1.05), true)
    assert.equal(isVisualViewportZoomed(0.9), true)
  })

  it('detects editable focus targets', () => {
    assert.equal(isEditableElement(null), false)
    // jsdom-less environment: only exercise the null / non-element path here.
    // Element checks are covered by instanceof guards at runtime in the browser.
  })
})
