Add a first-time-user onboarding system to GRIND: tooltips, coach marks, and page-level walkthroughs. Read `CLAUDE.md` first for the design system tokens, stack, and file structure — everything below has to match it exactly.

## Definitions (so we use consistent terms in code/comments)
- **Tooltip** — small popup with a hint, shown on hover/tap of a single element. No sequencing, no "skip tour" chrome.
- **Coach mark** — one onboarding popup anchored to a specific UI element, with a spotlight/highlight on that element, explaining what it does to a first-time user.
- **Walkthrough / tour** — several coach marks chained together with Back/Next, a step counter, and a "Skip tour" affordance, guiding a new user through a page.

## Non-negotiables
1. Every walkthrough has a visible **"Skip tour"** control, present on every step, not just the first.
2. Every individual coach mark also has its own small **"×" / "Skip"** dismiss that closes just that mark and advances the tour (marks it seen), without killing the rest of the tour.
3. Nothing shows twice. Once a tour or a contextual tooltip has been seen or skipped, it never appears again for that user.
4. **The active workout page (`(app)/log/ActiveWorkout.tsx`) gets NO scripted walkthrough.** Its onboarding is entirely use-case-based: a single one-off tooltip that appears the first time the user encounters a specific control in real use (see the ActiveWorkout section below), never a multi-step tour.
5. Mobile-first: this is a PWA used mostly on phones during a workout. Coach marks must never cover the bottom nav / rest timer / finish bar, must respect `env(safe-area-inset-*)`, must reposition/flip to stay on-screen, and tap targets follow the app's existing 44×44px minimum.
6. Nothing here should feel naggy — no modal-dimmed full-screen takeovers except optionally for the very first coach mark ever shown. Keep motion subtle (150–200ms ease, matching the app's existing transition timing).

## Architecture to build

### Persistence
Add a client-side onboarding store, same pattern as the app's existing prefs (`grind_theme_pref`, `grind.barWeight.*`, `grind_overdue_dismissed`): a `localStorage` key scoped per user, e.g. `grind_onboarding_{userId}`, shaped like:
```ts
{ toursSeen: string[]; tooltipsSeen: string[] }
```
Read via `useSyncExternalStore` (mirror the pattern already used for `grind_overdue_dismissed` in `HomeDashboard.tsx`) so hydration stays clean and a write in one tab is reflected via a custom event. Expose a small `src/lib/contexts/OnboardingContext.tsx` (mirror `UnitContext`/`ThemeContext`) with:
- `hasSeenTour(id)`, `markTourSeen(id)`, `hasSeenTooltip(id)`, `markTooltipSeen(id)`
- `skipAllTours()` — sets a single flag that suppresses every future scripted tour (offered once, see below) but does NOT suppress the ActiveWorkout contextual tooltips (those are considered functional hints, not onboarding fluff, and stay opt-in per-tooltip).

### Components (new, in `src/components/onboarding/`)
1. **`Tooltip.tsx`** — generic small popup. Trigger: hover (desktop) or tap-and-hold/tap-to-toggle (mobile, matching the existing badge-tooltip pattern already in `ProfileDashboard.tsx` lines ~843-941 — reuse that exact visual style: `surface-elevated` background, `border-strong` border, `8px` radius, drop shadow, positioned via `position: absolute` off the trigger). Use this primitive for the ActiveWorkout contextual hints.
2. **`CoachMark.tsx`** — a popup card anchored to a target element via its DOM rect (compute via `getBoundingClientRect` + reposition on resize/scroll), with:
   - A spotlight: a subtle ring/border drawn around the target (box-shadow "cutout" technique — `0 0 0 9999px rgba(0,0,0,0.55)` on a fixed overlay positioned exactly over the target rect, so everything else dims except the target) — NOT a full modal backdrop over the whole page on every step, just the cutout.
   - Card content: eyebrow step counter ("2 / 5", `text-muted`, `JetBrains Mono`), a short title (`Bebas Neue`, matches page H1 style), 1-2 sentences of body copy (`DM Sans`, `text-secondary`), Back (if step > 1) / Next / Done buttons styled as the app's existing secondary/primary buttons (`--surface-elevated` / `--accent`), and a persistent text-link "Skip tour" (`text-muted`, underline, same treatment as the "Log a past workout" link in `DaySelect.tsx`).
   - Auto-flips above/below/left/right of the target to stay within the viewport, with an 8-12px offset and a small triangular pointer.
   - On mobile (`<768px`), prefer anchoring as a **bottom sheet** (fixed to viewport bottom above the `BottomNav`, `border-radius: var(--radius-lg) var(--radius-lg) 0 0`) rather than a floating bubble when the target is in the lower half of the screen or the bubble would clip — floating pointer bubbles are fine for top-half targets on mobile, but never let one get clipped by the viewport edge.
   - `z-index`: pick something above existing modals (existing modals/toasts top out around 300-600 in this app — check current usages before finalizing) so a tour never gets hidden behind a sheet, but tours must never render while an actual modal (CompletionModal, ExerciseSwapModal, PlateCalculator, FeedbackModal, WorkoutManager) is open — pause/defer instead.
3. **`Tour.tsx`** — orchestrates an ordered array of coach-mark step configs (target id, title, body, optional "wait for route" hook), tracks current index, persists completion/skip via `OnboardingContext`, exposes `useTour(tourId, steps)`.
4. **`useFeatureTooltip(id, { delayMs })`** hook — for the ActiveWorkout one-offs. Shows a single `Tooltip` near a ref'd element the first time a condition becomes true, marks it seen, never again. No steps, no skip-tour link — just a small "×" and it's a one-liner.

### Trigger rules
- A page's tour fires once per page, on first authenticated visit to that route, after content has finished loading (no spinner state) and after a short settle delay (~500ms) so nothing shifts under the user's finger.
- Do not fire a tour if any modal/sheet is open, or if the resume/undo toast system is active on that page.
- The very first coach mark a user ever sees (Home page, first ever session after `/setup`) should include one extra affordance: "Skip all tours" alongside "Skip this one" / "Next" — respect whichever they pick going forward.
- Optional nice-to-have (only if time allows, don't let it block the rest): a "Show me around" row in Profile → Settings that resets `toursSeen` for the current page's tour so a user can replay it.

## Page-by-page walkthroughs (chained coach marks)

### Home (`(app)/home/HomeDashboard.tsx`) — tour id `home`
1. Level/XP card — "This is your level. Every completed workout and PR earns XP toward the next one."
2. Streak card — "Keep your streak alive by training on consecutive days — miss a day and it resets."
3. Primary CTA ("START <DAY>") — "Tap here to jump into your suggested next workout. GRIND rotates through your days automatically."
4. Stats row (Workouts this week/month, Total PRs) — "Track your volume at a glance."
5. Workout history calendar — "See every day you've trained, and revisit or edit past sessions."
(If `totalWorkouts === 0`, anchor step 3 to the welcome hero's CTA instead, and skip steps 1/2/4 since they're not meaningful yet — check for the empty-state before building the step list.)

### Choose Your Day (`(app)/log/DaySelect.tsx`) — tour id `log-dayselect`
1. Day cards — "Tap a day to start logging. UP NEXT highlights what GRIND suggests based on your rotation."
2. MANAGE button (gear icon, top right) — "Add, edit, reorder, or remove your workout days and exercises here."
3. "Log a past workout" link — "Forgot to log a session live? Add it retroactively here."

### Progress (`(app)/progress/page.tsx` + `ProgressChart.tsx`) — tour id `progress`
1. Exercise/metric selector — "Choose which lift or metric to chart."
2. The chart itself — "Each point is a working set; the highlighted ones are PRs."
(Read `(app)/progress/page.tsx` fully first to confirm the exact selector elements — it wasn't in the excerpt reviewed and may include an exercise picker in addition to the metric one.)

### Profile (`(app)/profile/ProfileDashboard.tsx`) — tour id `profile`
1. Username edit pencil icon — "Tap the pencil to change your @handle."
2. Weight unit toggle (KG/LBS pill) — "Switch how weights display app-wide. Everything is still stored consistently under the hood."
3. Default Rest Time control — "Set your default rest between sets — override per-exercise from the rest timer during a workout."
4. Badges section — "Tap a badge to see how to earn it." (this already has its own hover/tap tooltip built — the tour step just needs to point at the section header, not duplicate the per-badge tooltip.)

### Leaderboard (`(app)/leaderboard/LeaderboardClient.tsx` + `FriendsAccordion.tsx`) — tour id `leaderboard`
1. Friends accordion — "Add friends to compare progress. Rankings without friends only show you."
2. Category tabs (PUSH/PULL/LEGS/OVERALL) — "Overall ranks by XP; the lift categories rank by heaviest working set."
3. Share icon (top right) — "Share your current rank as an image."

## Use-case-based tooltips inside the active workout (`(app)/log/ActiveWorkout.tsx`) — NOT a tour, one-off `Tooltip`s only

Each fires the first time its condition is true, once ever, near the relevant control:
- **First unchecked set row rendered** → tooltip near the check-mark button: "Tap the checkmark to log this set. Tap a logged set again to edit and re-save it." (covers `handleCheck`/`handleStartEdit`/`handleSaveEdit` — the check ⇄ edit ⇄ save affordance around line 2685-2738 of `ActiveWorkout.tsx`.)
- **First time the plate-calculator icon (barbell glyph between the LBS/REPS column headers) is visible** → "Tap here to see which plates to load per side for your target weight."
- **First time the "W" warm-up pill is visible** (first set of the first exercise) → "Mark warm-up sets — they're excluded from PR detection." (There's already a static caption under set 1 of every exercise; the tooltip should supplement it once, not repeat it every exercise.)
- **First set checked, when the undo toast appears** → tooltip (or fold into the toast itself) noting "You have 5 seconds to undo a logged set."
- **First time a set is marked a PR** (the "PR" pill appears) → "New personal record! GRIND compares against your best-ever weight for this exercise."
- **First "+ ADD SET" tap available** (render once per user, on first exercise card) → "Need an extra set beyond the plan? Add one here."
- **First bonus set / first planned set skip controls seen** → clarify the Delete-vs-Skip distinction: bonus sets get a trash icon (removes the slot), planned sets get a skip icon (marks not-done but keeps the slot). One tooltip covering whichever the user sees first is enough — don't fire both.
- **First swap-exercise icon (double-arrow) seen** → "Swap this exercise for another from your catalog, or create a new one."
- **First rest timer bar appears** (after the first non-warm-up set is checked) → tooltip near the "±" button: "Adjust your rest on the fly, or tap the timer to set a new default for this exercise."
- **First per-set note chevron used or a note is present** → "Tap the chevron to add a note to this specific set."
- **First workout, when the Exit (back arrow) button is tapped and the confirm sheet opens** — this one already explains itself via body copy in the confirm dialog; no extra tooltip needed, skip it.

Keep this list as the source of truth but re-verify each trigger point against the current line numbers in `ActiveWorkout.tsx` before wiring — the file is ~2770 lines and these controls live in `SetRow`, `ExerciseCard`, and `RestTimerBar`.

## Visual spec (must match `CLAUDE.md` design system, not invent new tokens)
- Surface: `var(--surface-elevated)`, border: `var(--border-strong)`, radius: `var(--radius-md)` (12px), shadow matching existing popovers (`0 4px 16px rgba(0,0,0,0.4-0.5)`).
- Titles: `'Bebas Neue', sans-serif`, letter-spacing 1px, `var(--text-primary)`.
- Body: `'DM Sans', sans-serif`, `var(--text-secondary)`, 13-14px, line-height ~1.4-1.5.
- Step counters / numeric bits: `'JetBrains Mono', monospace`, `var(--text-muted)`.
- Primary action (Next/Done): `var(--accent)` bg, `var(--on-accent)` text, matches existing primary buttons.
- Secondary (Back): `var(--surface-elevated)` bg, `var(--border)` border, matches existing secondary buttons.
- Skip link: `var(--text-muted)`, underline, `text-underline-offset: 3px` — same treatment as the existing "Log a past workout" link.
- Respect dark/light theming via the same CSS vars — never hardcode hex values for anything except the spotlight dimmer overlay (`rgba(0,0,0,0.55)` is fine in both themes since it's just a dim mask).
- Transitions: 150-200ms ease, matching the rest of the app.

## Acceptance checklist (verify before calling this done)
- Skipping the tour on step 2 of 5 never shows steps 3-5, and the tour never reappears on reload.
- Skipping/dismissing one coach mark advances to the next step rather than ending the tour.
- No tour ever renders on top of an open modal, or overlapping the bottom nav / rest timer bar / finish button.
- Every ActiveWorkout tooltip fires at most once per user, ever, and never during an active rest countdown or while a modal is open on that page.
- All coach marks and tooltips are keyboard/screen-reader reachable (proper `role="dialog"`/`aria-label` like the rest of the codebase already does for its modals).
- Test on a narrow mobile viewport (≤375px) and confirm nothing clips or overlaps the safe-area / keyboard-inset handling already in `ActiveWorkout.tsx`.
- Toggle dark/light mode and confirm coach marks and tooltips read correctly in both.
