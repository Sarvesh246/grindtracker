/**
 * Live page ↔ compact sheet geometry while the finger is down.
 * Top tracks the drag; the opposite edge morphs in parallel so expand/minimize
 * never look like a rigid full-bleed card sliding until release.
 */

export type SheetRect = {
  top: number
  left: number
  width: number
  height: number
}

export type CollapsePreview = SheetRect & {
  /** Extra translateY after the box has fully reached compact rest size. */
  slideY: number
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function lerpRect(a: SheetRect, b: SheetRect, t: number): SheetRect {
  const tClamped = Math.min(1, Math.max(0, t))
  return {
    top: lerp(a.top, b.top, tClamped),
    left: lerp(a.left, b.left, tClamped),
    width: lerp(a.width, b.width, tClamped),
    height: lerp(a.height, b.height, tClamped),
  }
}

/**
 * Upward finger travel (px) that fully expands compact → page when the top
 * tracks 1:1. Prefers top travel so the grabber can reach the page edge;
 * falls back to height delta when the compact card is already top-aligned.
 */
export function expandTravelPx(compact: SheetRect, page: SheetRect): number {
  const topTravel = compact.top - page.top
  if (topTravel > 1) return topTravel
  return Math.max(1, page.height - compact.height)
}

/**
 * Downward finger travel (px) that fully morphs page → compact before the
 * mini sheet starts sliding toward dismiss.
 */
export function collapseMorphTravelPx(
  page: SheetRect,
  compact: SheetRect,
): number {
  const topTravel = compact.top - page.top
  if (topTravel > 1) return topTravel
  return Math.max(1, page.height - compact.height)
}

/**
 * Live compact→page drag preview.
 * Top follows the upward pull; height grows so the bottom advances toward
 * `page` in parallel (not only after the top pins to the screen edge).
 */
export function expandPreviewRect(
  compact: SheetRect,
  page: SheetRect,
  pullY: number,
): SheetRect {
  const up = Math.max(0, -pullY)
  const topTravel = compact.top - page.top
  const heightDelta = page.height - compact.height

  if (topTravel <= 1) {
    const span = Math.max(1, heightDelta)
    const p = Math.min(1, up / span)
    return {
      top: Math.min(compact.top, page.top),
      left: lerp(compact.left, page.left, p),
      width: lerp(compact.width, page.width, p),
      height: compact.height + heightDelta * p,
    }
  }

  const top = Math.max(page.top, compact.top - up)
  const p = Math.min(1, (compact.top - top) / topTravel)
  let left = lerp(compact.left, page.left, p)
  let width = lerp(compact.width, page.width, p)
  const height = compact.height + heightDelta * p

  if (width > page.width) {
    width = page.width
    left = page.left
  } else {
    left = Math.min(
      Math.max(left, page.left),
      page.left + page.width - width,
    )
  }

  return { top, left, width, height }
}

/**
 * Live page→compact drag preview.
 * Top follows the downward pull; height shrinks so the bottom retracts toward
 * compact in parallel. Once morph completes, `slideY` carries the mini sheet
 * toward the bottom of the screen for dismiss.
 */
export function collapsePreviewRect(
  page: SheetRect,
  compact: SheetRect,
  pullY: number,
): CollapsePreview {
  const down = Math.max(0, pullY)
  const topTravel = compact.top - page.top
  const heightDelta = page.height - compact.height

  if (topTravel <= 1) {
    const morphSpan = Math.max(1, heightDelta)
    const p = Math.min(1, down / morphSpan)
    const box = lerpRect(page, compact, p)
    return { ...box, slideY: Math.max(0, down - morphSpan) }
  }

  if (down <= topTravel) {
    const p = down / topTravel
    return {
      top: page.top + down,
      left: lerp(page.left, compact.left, p),
      width: lerp(page.width, compact.width, p),
      height: page.height - heightDelta * p,
      slideY: 0,
    }
  }

  return {
    top: compact.top,
    left: compact.left,
    width: compact.width,
    height: compact.height,
    slideY: down - topTravel,
  }
}

/** Visual top while a collapse preview is active (includes post-morph slide). */
export function collapsePreviewVisualTop(preview: CollapsePreview): number {
  return preview.top + preview.slideY
}
