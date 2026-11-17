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
`#5f7a16` in light) — never `--accent` for text color. Faint accent panel
backgrounds use `--accent-wash`; cards read `--card-shadow` (none in dark). The
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

## Health

`src/components/health/health.css` extends the existing theme with sleep-stage
mark tokens (`--sleep-awake`, `--sleep-rem`, `--sleep-light`, `--sleep-deep`),
with separate light-theme values. Named lanes and interval tables communicate
the stages independently of color. Health uses rem-based readable text,
tabular values, 16px panels and static SVG charts. Plot gaps remain gaps;
energy and stress use separate scales. No continuously animated charts or
duplicate large score rings. The nested routes retain Progress navigation.

Mobile reading patterns (Health redesign): a 21-day date strip (dots = records)
sits under the prev/next/calendar controls; "Your metrics" are tappable tiles with
a 14-day sparkline and a plain "In your usual range / Above / Below usual" line
(from `metricBaseline`, never a good/bad verdict, and volume metrics like steps
say "Daily total"); sleep shows a proportional stage bar plus a legend before the
drag-to-read hypnogram; trend charts draw the personal usual range as a shaded
band and show Low/Average/High. The overview keeps exactly one large ring
(Recovery), so the brief uses numbers, not a second ring. Every chart still has
its table alternative, and numbers use JetBrains Mono.

Charts on Health are read by dragging, never with a slider: a tap reads that
point, a horizontal drag scrubs (pointer capture), and a vertical drag is left to
the page so scrolling over a chart still works. Plots carry `data-swipe-ignore`
so the tab swipe navigator never steals the gesture. The page's bottom padding is
small on purpose: `.app-main` already clears the nav and home indicator.

Refinement rules for Health (keep when adding to it): the date appears once in
the pill (a "Today" badge marks today) and once as the selected day in the strip;
sync state, source details and Refresh share one status bar; metric tiles sit on
the page under a section label instead of inside a second card; durations use
large numbers with quiet units (`7h 18m`), and anything under an hour reads
`42m`; the hypnogram draws connectors between stage changes; and all panel body
copy is 14px so only data is large.

