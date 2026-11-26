# GRIND design system, theming and motion

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Design System
Background: #0f0f0f | Surface: #1a1a1a | Surface elevated: #242424
Border: #2e2e2e | Accent: #c8f135 | Accent dim: #8faa24
Text primary: #f0f0f0 | Text secondary: #a3a3a3 | Text muted: #8c8c8c
Danger: #ef4444

Nothing below 10px; use 10px only for uppercase labels with letter-spacing.

Fonts: Bebas Neue (display), DM Sans (body), JetBrains Mono (numbers)
Border radius: 12px standard, 8px small, 9999px pill
Transitions: 150ms ease
Primary button: bg #c8f135, text #0f0f0f, font bold
Secondary button: bg #242424, text #f0f0f0, border #2e2e2e

## Theming (dark default + light mode)
All colors are CSS vars in `src/app/globals.css`. The dark palette lives in
`:root`; the light palette overrides the same mirror vars under `html.light`.
Theme is dark by default and persisted via the `grind_theme_pref` cookie
(+ localStorage) by `ThemeContext` — mirroring `UnitContext`. The root layout
(`src/app/layout.tsx`) reads the cookie server-side and sets `<html class="light">`
so there's no flash. Toggle UI: circular sun/moon `ThemeToggle` beside the kg/lb
toggle in TopNav and Profile settings.
**Convention:** the lime `--accent` is a FILL, unchanged in both themes. For lime
TEXT/icons that must read on white, use `--accent-text` (lime in dark, olive
`#435710` in light) — never `--accent` for text color. Faint accent panel
backgrounds use `--accent-wash`; cards read `--card-shadow` (none in dark).
Light-mode text tokens are tuned so `--accent-text` (and the Recovery
`--rcv-*-text` band colors) still clear 4.5:1 sitting on their own wash over
the page background, which is the hardest case (selected chips, band pills).
Day-color pills pick their label with `onDayFill()`, which takes whichever of
near-black / near-white has more contrast; every built-in fill is tested to
reach 4.5:1. The
leaderboard ShareCard and the favicon stay dark-branded (`.share-card-dark` pins
the dark tokens regardless of theme).

## Icons and copy
No emoji and no text glyphs for UI chrome (‹ › ⌄ × ✕ ✓ • ↔): iOS can render
them as color emoji. Use the SVG icons in `src/components/ui/Icons.tsx`
(chevrons, close, check) or a component's own SVG. Keep on-screen copy short:
labels and values, not explanations of how a chart or control works.

## Reduced motion
Mirrors the theming pattern exactly: `MotionContext` persists an explicit
in-app "Reduce Motion" preference via the `grind_motion_pref` cookie (+
localStorage), the root layout resolves it server-side and sets
`<html class="reduce-motion">` (alongside `.light`) so there's no flash, and a
switch in Profile → Settings toggles it. This is layered ON TOP of the
OS-level `prefers-reduced-motion` media query in `globals.css`, not a
replacement for it — `html.reduce-motion` gets the identical zero-duration
treatment as the media query, for anyone who wants animations off in-app
without changing their whole system.

`html.reduce-motion` only reaches CSS-driven animation (transitions/keyframes),
which covers every animation in the app except one: the Recharts `<Line>`
draw-in on the progress and body-weight charts is a JS (react-smooth)
animation the CSS class can't touch. Those two call sites (`ProgressChart.tsx`,
`BodyWeightCard.tsx`) read `useMotionPref().reduceMotion` directly and pass
`isAnimationActive={!reduceMotion}` to opt out explicitly — any future chart
needs the same treatment, since neither the media query nor the `.reduce-motion`
class does it automatically.

## Motion system (globals.css)
Five shared primitives cover nearly every transition in the app. **Reach for
these before writing a bespoke animation** — being CSS-driven is what lets
Reduced motion above zero them out in one place, with no component tracking
animation state:

| Class | What it does | Used by |
| --- | --- | --- |
| `.press` / `.press-card` | tap dip (scale .96 / .985) + the usual colour transitions | pills, tabs, nav items, `ui/Button`, `ui/IconButton`, day & leaderboard cards |
| `.drawer` + `data-open` | height collapse via `grid-template-rows: 0fr→1fr` | badges, body-weight history, friends accordion, per-set notes |
| `.swap-in` | fade + 6px rise for a panel whose contents changed | progress chart, calendar month grid |
| `.stagger` (children set `--i`) | indexed list entrance | progress stats/recent sessions, leaderboard rows, day grid |
| `.stagger-auto` | same, nth-child delays, fade only | home dashboard columns |

Three rules that are easy to get wrong:
- **Check new utility names against Tailwind's.** This landed broken once: the
  drawer was originally `.collapse`, which is a Tailwind utility
  (`visibility: collapse`) — the panel animated to full height with its
  contents invisible.
- **Fill mode is `backwards`, never `both`.** An element holding a finished
  transform becomes a containing block for fixed/absolute descendants, which
  silently breaks the fixed workout bars and nav.
- **A `.drawer`'s direct child must have no padding.** `grid-template-rows: 0fr`
  zeroes only its *content* height, and `overflow: hidden` clips at the padding
  box — so padding on the grid item leaves a sliver of the collapsed panel
  showing (this shipped once as a row of pill-shaped bars under every set in
  ActiveWorkout). Pad an inner wrapper instead.
- **A `.drawer`'s inner wrapper clips.** Give the content 4px of top padding —
  not 2px — so keyboard focus rings aren't cut: the ring sits `outline-offset:
  2px` beyond the element plus its own 2px width, so it needs a full 4px of
  clearance from the clip edge, not just the offset (this shipped once as the
  top of a focused set-note input reading as cropped, permanently, not just
  mid-animation). Mark the content `inert` while closed so collapsed controls
  leave the tab order. Don't nest a `.stagger` inside a `.drawer` — the height
  slide is already the reveal, and layering a per-item fade on top just makes
  it feel slow.

## Responsive navigation
`TopNav` (desktop) and `BottomNav` (mobile) both render in `(app)/layout.tsx`;
CSS at the 768px breakpoint shows exactly one — there is no JS width detection.
Both share `UnitContext`, so the kg/lbs toggle stays in sync across them.

## Health (Recovery)

The Health destination is presented as **Recovery**. Its screens live in
`src/components/health/recovery/` (`Overview`, `SleepDetail`, `MetricDetail`,
`Chrome` for the header/day strip/Coach button, `model.ts` for pure display
logic, `motion.ts` for the count-up, width and scrub hooks) and are styled by
`recovery.css`, which extends the theme with band tokens: `--rcv-primed`
(the lime fill), `--rcv-steady` (amber), `--rcv-easy` (blue), each with a
`*-text` variant for light mode, plus `--rcv-held` for inputs that held Charge
back. Set `data-band` on an element to get `--band` / `--band-text`.
`src/components/health/health.css` still provides the sleep-stage tokens
(`--sleep-*`) and styles the secondary panels (Body signals, Readiness,
Garmin details, sources).

Layout: the overview leads with the answer, one large Charge ring with a
count-up and zone arcs, the headline for its band and "Today's call"
(Easy/Steady/Push with an RPE). Then "What moved it" (each Charge input as a
bar left/right of neutral, tap for the sentence), last night's sleep, the day
chart (Body Battery / HR / steps with the stress strip), vitals tiles (a dot on
a track against the personal usual band from `metricBaseline`, never a
good/bad verdict; volume metrics say "Daily total"), VO₂ max, then the
secondary panels and a "Data & sources" drawer. A 7-day strip under the title
shows each morning's Charge as a bar and opens the calendar. At ≥1024px the
overview becomes a three-column grid with the hero column sticky; sleep and
metric details become two columns. The Progress card (`HealthEntry`) and the
Home strip (`ChargeRing`) reuse the same band language.

Motion: entrances use `.rcv-rise` (indexed with `--i`), lines draw in with
`.rcv-draw` and redraw when their data key changes, segmented controls slide a
thumb, and the ring halo, sync dot and "now" dot pulse continuously. All of it
stops under Reduce Motion (in-app class and OS query); `useCountUp` returns the
target immediately when motion is reduced.

Charts are read by dragging, never with a slider: a tap reads that point, a
horizontal drag scrubs (pointer capture), a vertical drag is left to the page
(`touch-action: pan-y`), and every plot is a focusable group read with the
arrow keys, Home and End (`useScrub`). Plots carry `data-swipe-ignore`; chip
rows do not. Charts draw at their measured pixel width (`useWidth`) so marks
never stretch. Every chart keeps a table alternative (stage table, the metric's
"Data and source coverage" table). Gaps in a series stay gaps. Numbers use
JetBrains Mono; durations read `7h 18m` with quiet units.

The screens match the "GRIND Recovery Redesign" canvas: anything the canvas
doesn't show (Energy, Body signals, Readiness, Garmin details, data sources)
lives in one collapsed "More from your watch" row at the end of the overview,
and chart tables for screen readers are visually hidden (`.rcv-sr`) rather than
shown as extra rows. On phones Progress splits into Lifts / Recovery / Body tabs
(`.progress-tabs`, `data-tab` on `.progress-layout`); desktop shows all three.
The tab bar (`ProgressTabs.tsx`) can be tapped or dragged: the thumb follows
the finger via a transform written in rAF and springs to the nearest tab (a
flick carries on). It is marked `data-tab-slider`, which SwipeNavigator
ignores so a sideways drag there never changes page. Use that marker, not
`data-swipe-ignore`, for any future draggable segmented control. On iOS the
marker also makes the haptic switch overlay treat its buttons as drag-owned
(like the Coach orb): the overlay's own pan handling preventDefaults
horizontal touchmoves and killed the drag on iPhone. Because the overlay is
`touch-action: none`, the control forwards vertical drags to the page itself
(`nearestScrollParent` + `startMomentum` from `haptics.ts`). This only shows
on a real iPhone — the overlay never attaches in desktop Chromium.
