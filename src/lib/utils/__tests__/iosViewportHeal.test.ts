import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldClampVisualViewportPan } from '../iosViewportHeal'

describe('shouldClampVisualViewportPan', () => {
  it('clamps a leftover status-bar / keyboard pan when idle', () => {
    assert.equal(
      shouldClampVisualViewportPan({
        editableFocused: false,
        zoomed: false,
        offsetTop: 59,
        offsetLeft: 0,
      }),
      true,
    )
  })

  it('does not steal the pan iOS uses to keep a focused field on-screen', () => {
    assert.equal(
      shouldClampVisualViewportPan({
        editableFocused: true,
        zoomed: false,
        offsetTop: 280,
        offsetLeft: 0,
      }),
      false,
    )
  })

  it('leaves pinch-zoom alone', () => {
    assert.equal(
      shouldClampVisualViewportPan({
        editableFocused: false,
        zoomed: true,
        offsetTop: 40,
        offsetLeft: 0,
      }),
      false,
    )
  })

  it('ignores sub-pixel jitter', () => {
    assert.equal(
      shouldClampVisualViewportPan({
        editableFocused: false,
        zoomed: false,
        offsetTop: 0.4,
        offsetLeft: 0,
      }),
      false,
    )
  })
})
