import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  collapseMorphTravelPx,
  collapsePreviewRect,
  collapsePreviewVisualTop,
  expandPreviewRect,
  expandTravelPx,
  lerpRect,
  type SheetRect,
} from '../sheetMorph'

/** Typical iPhone-ish page + bottom-docked compact card. */
const PAGE: SheetRect = { top: 0, left: 0, width: 390, height: 844 }
const COMPACT_BOTTOM: SheetRect = {
  top: 400,
  left: 12,
  width: 366,
  height: 420,
}

/** Desktop top-docked compact (small top travel, large downward grow). */
const COMPACT_TOP: SheetRect = {
  top: 88,
  left: 390 - 16 - 380,
  width: 380,
  height: 440,
}
const PAGE_DESKTOP: SheetRect = { top: 0, left: 0, width: 1280, height: 800 }

describe('sheetMorph expandPreviewRect', () => {
  it('grows the bottom toward the page as the top rises (not after pin)', () => {
    const midUp = (COMPACT_BOTTOM.top - PAGE.top) / 2
    const mid = expandPreviewRect(COMPACT_BOTTOM, PAGE, -midUp)
    const restBottom = COMPACT_BOTTOM.top + COMPACT_BOTTOM.height
    const midBottom = mid.top + mid.height
    const pageBottom = PAGE.top + PAGE.height

    assert.ok(mid.top < COMPACT_BOTTOM.top, 'top should rise')
    assert.ok(mid.top > PAGE.top, 'top should not pin early at mid-drag')
    assert.ok(
      midBottom > restBottom + 1,
      'bottom should advance before the top reaches the page edge',
    )
    assert.ok(midBottom < pageBottom, 'bottom should not overshoot mid-drag')
  })

  it('tracks the grabber 1:1 until the page top', () => {
    const up = 120
    const next = expandPreviewRect(COMPACT_BOTTOM, PAGE, -up)
    assert.equal(next.top, COMPACT_BOTTOM.top - up)
  })

  it('reaches full page when upward travel completes', () => {
    const travel = expandTravelPx(COMPACT_BOTTOM, PAGE)
    const done = expandPreviewRect(COMPACT_BOTTOM, PAGE, -travel)
    assert.equal(done.top, PAGE.top)
    assert.equal(done.height, PAGE.height)
    assert.equal(done.width, PAGE.width)
  })

  it('expands downward when compact is already near the top', () => {
    const travel = expandTravelPx(COMPACT_TOP, PAGE_DESKTOP)
    const mid = expandPreviewRect(COMPACT_TOP, PAGE_DESKTOP, -(travel / 2))
    assert.ok(mid.height > COMPACT_TOP.height)
    assert.ok(mid.top + mid.height > COMPACT_TOP.top + COMPACT_TOP.height)
    const done = expandPreviewRect(COMPACT_TOP, PAGE_DESKTOP, -travel)
    assert.equal(done.height, PAGE_DESKTOP.height)
  })
})

describe('sheetMorph collapsePreviewRect', () => {
  it('shrinks the bottom toward compact as the top descends', () => {
    const travel = collapseMorphTravelPx(PAGE, COMPACT_BOTTOM)
    const mid = collapsePreviewRect(PAGE, COMPACT_BOTTOM, travel / 2)
    const pageBottom = PAGE.top + PAGE.height
    const midBottom = mid.top + mid.height
    const compactBottom = COMPACT_BOTTOM.top + COMPACT_BOTTOM.height

    assert.equal(mid.slideY, 0)
    assert.ok(mid.top > PAGE.top, 'top should follow the finger down')
    assert.ok(
      midBottom < pageBottom - 1,
      'bottom should retract during the morph (not stay full-bleed)',
    )
    assert.ok(midBottom > compactBottom, 'bottom should not finish early')
  })

  it('matches compact geometry at morph completion, then slides', () => {
    const travel = collapseMorphTravelPx(PAGE, COMPACT_BOTTOM)
    const atCompact = collapsePreviewRect(PAGE, COMPACT_BOTTOM, travel)
    assert.equal(atCompact.top, COMPACT_BOTTOM.top)
    assert.equal(atCompact.height, COMPACT_BOTTOM.height)
    assert.equal(atCompact.width, COMPACT_BOTTOM.width)
    assert.equal(atCompact.slideY, 0)

    const slid = collapsePreviewRect(PAGE, COMPACT_BOTTOM, travel + 140)
    assert.equal(slid.top, COMPACT_BOTTOM.top)
    assert.equal(slid.height, COMPACT_BOTTOM.height)
    assert.equal(slid.slideY, 140)
    assert.equal(
      collapsePreviewVisualTop(slid),
      COMPACT_BOTTOM.top + 140,
    )
  })

  it('lerps width/left toward the compact card during morph', () => {
    const travel = collapseMorphTravelPx(PAGE, COMPACT_BOTTOM)
    const mid = collapsePreviewRect(PAGE, COMPACT_BOTTOM, travel / 2)
    assert.ok(mid.width < PAGE.width)
    assert.ok(mid.width > COMPACT_BOTTOM.width)
    assert.ok(mid.left > PAGE.left)
  })

  it('shrinks from a top-docked compact without a bottom pop', () => {
    const travel = collapseMorphTravelPx(PAGE_DESKTOP, COMPACT_TOP)
    const mid = collapsePreviewRect(PAGE_DESKTOP, COMPACT_TOP, travel / 2)
    assert.ok(mid.height < PAGE_DESKTOP.height)
    assert.ok(mid.slideY === 0)
    const done = collapsePreviewRect(PAGE_DESKTOP, COMPACT_TOP, travel + 80)
    assert.equal(done.height, COMPACT_TOP.height)
    assert.equal(done.slideY, 80)
  })
})

describe('sheetMorph lerpRect', () => {
  it('interpolates all edges', () => {
    const mid = lerpRect(PAGE, COMPACT_BOTTOM, 0.5)
    assert.equal(mid.top, (PAGE.top + COMPACT_BOTTOM.top) / 2)
    assert.equal(mid.height, (PAGE.height + COMPACT_BOTTOM.height) / 2)
  })
})

describe('sheetMorph stress interactions', () => {
  it('expand→release-short stays between compact and page', () => {
    const travel = expandTravelPx(COMPACT_BOTTOM, PAGE)
    const short = expandPreviewRect(COMPACT_BOTTOM, PAGE, -(travel * 0.2))
    assert.ok(short.top < COMPACT_BOTTOM.top)
    assert.ok(short.height > COMPACT_BOTTOM.height)
    assert.ok(short.height < PAGE.height)
  })

  it('minimize band keeps slideY at 0 until morph completes', () => {
    const travel = collapseMorphTravelPx(PAGE, COMPACT_BOTTOM)
    for (const y of [0, 1, travel * 0.25, travel * 0.5, travel * 0.99]) {
      const preview = collapsePreviewRect(PAGE, COMPACT_BOTTOM, y)
      assert.equal(preview.slideY, 0, `slideY should be 0 at pullY=${y}`)
      assert.ok(preview.height <= PAGE.height)
      assert.ok(preview.height >= COMPACT_BOTTOM.height)
    }
  })

  it('dismiss travel past morph only increases slideY', () => {
    const travel = collapseMorphTravelPx(PAGE, COMPACT_BOTTOM)
    const a = collapsePreviewRect(PAGE, COMPACT_BOTTOM, travel + 40)
    const b = collapsePreviewRect(PAGE, COMPACT_BOTTOM, travel + 220)
    assert.equal(a.height, COMPACT_BOTTOM.height)
    assert.equal(b.height, COMPACT_BOTTOM.height)
    assert.equal(a.slideY, 40)
    assert.equal(b.slideY, 220)
    assert.ok(collapsePreviewVisualTop(b) > collapsePreviewVisualTop(a))
  })

  it('monotonic bottom motion on expand and collapse', () => {
    const expandTravel = expandTravelPx(COMPACT_BOTTOM, PAGE)
    let prevBottom = COMPACT_BOTTOM.top + COMPACT_BOTTOM.height
    for (let i = 1; i <= 10; i++) {
      const p = expandPreviewRect(COMPACT_BOTTOM, PAGE, -(expandTravel * i) / 10)
      const bottom = p.top + p.height
      assert.ok(bottom >= prevBottom - 0.001, `expand step ${i}`)
      prevBottom = bottom
    }

    const collapseTravel = collapseMorphTravelPx(PAGE, COMPACT_BOTTOM)
    prevBottom = PAGE.top + PAGE.height
    for (let i = 1; i <= 10; i++) {
      const p = collapsePreviewRect(PAGE, COMPACT_BOTTOM, (collapseTravel * i) / 10)
      const bottom = p.top + p.height
      assert.ok(bottom <= prevBottom + 0.001, `collapse step ${i}`)
      prevBottom = bottom
    }
  })

  it('ignores opposite-direction residue on each preview helper', () => {
    const up = expandPreviewRect(COMPACT_BOTTOM, PAGE, 80)
    assert.equal(up.top, COMPACT_BOTTOM.top)
    assert.equal(up.height, COMPACT_BOTTOM.height)

    const down = collapsePreviewRect(PAGE, COMPACT_BOTTOM, -40)
    assert.equal(down.top, PAGE.top)
    assert.equal(down.height, PAGE.height)
    assert.equal(down.slideY, 0)
  })
})
