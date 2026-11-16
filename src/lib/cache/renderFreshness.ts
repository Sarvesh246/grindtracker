/**
 * How old a server-rendered screen may be before the client stops trusting it.
 *
 * `/home` ships its data inside the HTML, and that HTML can reach the user long
 * after it was rendered: `public/sw.js` replays the last saved copy when a
 * launch is offline or slower than its 4s leash, and the browser can restore a
 * backgrounded PWA with the page it had hours ago. Pairing day-old stats with
 * today's date is what offered a "was yesterday a rest day?" prompt the morning
 * after a workout.
 *
 * Matches `staleTimes.dynamic` in next.config.ts: a payload the client router
 * would still happily reuse is not worth a second request.
 */
export const RENDER_STALE_AFTER_MS = 5 * 60 * 1000

/**
 * @param knownFreshAt when this screen's data was last known current (ms epoch)
 * @param now          the viewer's clock (ms epoch)
 */
export function isRenderStale(knownFreshAt: number, now: number): boolean {
  // A device clock behind the server gives a negative age, which stays fresh.
  return now - knownFreshAt > RENDER_STALE_AFTER_MS
}
