# Mobile scrolling verification

The iOS haptic switch overlay forwards pans to the nearest scrollable ancestor.
Ordinary content keeps browser-native scrolling. The shared forwarder covers
workout pages, settings/profile lists, dialogs, Coach action lists and horizontal
strips; drag-owned controls, chart gestures, toasts and navigation stay separate.

The forwarder now preserves the initial drag distance, measures release velocity
from the most recent 100 ms, and applies exponential momentum on either axis.
It retains fractional positions at low speed and integrates decay by elapsed
time so 60/120 Hz displays get the same deceleration curve. New touches anywhere,
wheel input, hidden documents and teardown stop the glide. Cancelled gestures
and releases after a pause do not launch momentum.

Run `npm run test:scroll` after `npx playwright install chromium webkit` (the
host also needs Playwright's browser runtime libraries). Run timing checks without
a concurrent production build or other CPU-heavy jobs. Tests bundle the real
haptic implementation and load the app stylesheet into isolated mobile fixtures;
no production data or authenticated session is required.

Coverage:
- Vertical pages, horizontal strips, and nested dialog/chat lists follow the
  finger and glide after release; touching ordinary content catches the glide.
- Paused/cancelled drags do not fling; nested lists stop at their bounds without
  moving the page behind them.
- Haptic taps activate once; completed scroll gestures cannot activate a button.
- Frame samples verify monotonic, decelerating motion and compare frame gaps
  with idle cadence on the same worker. Tracing is off because its screenshots
  measurably slow WebKit during scrolling; timings are not device FPS claims.
- Chromium's trusted CDP touch input verifies ordinary native scrolling remains
  functional. WebKit uses dispatched touch sequences for the shared forwarder;
  the CDP-only native-input case is explicitly skipped there.

The three main gesture regressions were reproduced against the preceding
commit before testing the fix. TypeScript, lint, the complete unit suite and a
production webpack build are also checked. A real iPhone PWA and signed-in
screen-by-screen checks remain outside this automated fixture suite.
