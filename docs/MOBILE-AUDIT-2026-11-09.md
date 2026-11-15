# GRIND mobile visual pass: fix plan (2026-11-09)

Companion to `docs/UI-AUDIT-2026-11-09.md`. That audit never saw the signed-in
app. This one did: every item below was observed in a real signed-in session at
390x844 on `localhost:3000`, dark theme, with light theme spot-checked on Home,
Log and Progress. Nothing here repeats the earlier file. If an item there and an
item here touch the same line, do the earlier file's change first.

## Rules for the agent doing this

- Read `CLAUDE.md` and `AGENTS.md` first. Design System, Theming, Motion system
  and Units are binding. Lime `--accent` is a fill, never a text colour.
- `main` is moving: fixes from the earlier audit are landing right now. Run
  `git pull` and `git status` first. **Line numbers below will have drifted.
  Find each site by the quoted code, not the number.**
- One commit per numbered item, straight to `main`, message explains the why.
- Mobile only. Any CSS you add must not change layout at `min-width: 768px`
  unless the item says so.
- Do not redesign anything. Each item states the exact change. If a quoted
  string cannot be found, stop and report it instead of improvising.
- Gate for every commit:

  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build
  ```

- Report each item as: fixed and seen (viewport + theme), fixed but not seen
  (why), or skipped (why).

## Owner action, not code: apply migrations 22 and 23

The console shows, on every tour step:
`Failed to persist onboarding state … Could not find the 'onboarding_skip_all' column of 'user_profiles' in the schema cache`.
The production database is missing the columns from
`docs/sql/22-onboarding-state.sql` and `docs/sql/23-tooltip-skip.sql`. Until the
owner runs both in the Supabase SQL editor, tours replay on every new browser
or device (only the localStorage mirror remembers them). The agent must not try
to fix this in code.

---

## P1: things that block or break a control

### 1. The Coach orb sits on top of sheets, dialogs and tours

Seen: with Manage Workouts open, the orb covers the "Day enabled" switch
completely, the colour picker's bottom-right swatch, and the "Edit workout
order" badge. In Add Progress Photos it floats over the form. During the Home
tour it overlaps the tooltip card.

Cause: `.coach-fab` is `position: fixed; z-index: 420` at the root, while
`.wm-backdrop` (500), `Dialog` and `CoachMark` (701) render inside the page's
stacking context, so their z-index never competes with the orb.

Fix: do not touch z-index. Hide the orb whenever a modal surface exists, using
the pattern already used for the share overlay.

1. `src/components/onboarding/CoachMark.tsx`: add a prop
   `targetKey?: string` to `CoachMarkProps`. On the card `<div ref={cardRef} role="dialog" aria-modal="true" …>`
   add `data-onboard-card=""` and `data-onboard-for={targetKey}`.
2. `src/components/onboarding/Tour.tsx`: pass the current step's `target`
   string as `targetKey` where it renders `<CoachMark …>`.
3. `src/app/globals.css`, directly under the existing
   `body.share-overlay-open .coach-fab { … }` rule, add:

   ```css
   /* Any modal surface hides the Coach orb. These surfaces render inside the
      page's stacking context, so z-index alone cannot put them above it. The
      Coach's own sheet and the tour step that points AT the orb are excluded. */
   body:has(.wm-backdrop) .coach-fab,
   body:has([aria-modal='true']:not(.coach-sheet):not([data-onboard-card])) .coach-fab,
   body:has([data-onboard-card]:not([data-onboard-for='coach-fab'])) .coach-fab {
     visibility: hidden !important;
     pointer-events: none !important;
   }
   ```

4. Confirm the Coach sheet root in `CoachSheet.tsx` (the element with
   `role="dialog" aria-modal="true" aria-labelledby={titleId}`) carries the
   class `coach-sheet`. If its base class is named differently, use that name
   in the `:not()`.

Done when: orb is gone while Manage Workouts, Add Progress Photos, the plate
calculator, a confirm dialog and Home tour steps 1 to 5 are open; orb is still
visible during the single "AI Coach" tour step; opening and closing the Coach
itself animates exactly as before.

### 2. Tour tooltip runs off the right edge

Seen: the "AI Coach" tooltip measured `left: 72px; right: 392px` in a 390px
viewport. Its right border and 8px margin are off-screen.

Cause: `CoachMark.tsx` measures the card with `getBoundingClientRect()` while
the `onboard-pop-in` keyframe is at `scale(0.97)`, so it records 310px for a
320px card and `placePopover` clamps with the wrong width.

Fix, in the `useLayoutEffect` that calls `setSize`: replace

```ts
const r = cardRef.current.getBoundingClientRect()
setSize(prev => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }))
```

with

```ts
// offsetWidth/Height ignore transforms; the pop-in keyframe starts at
// scale(0.97) and getBoundingClientRect() reported the shrunken box.
const w = cardRef.current.offsetWidth
const h = cardRef.current.offsetHeight
setSize(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
```

Also in that file change the bubble call `placePopover(anchor, size.w, size.h, { preferred: …, offset: 12 })`
to pass `margin: 12`. Check `src/components/onboarding/Tooltip.tsx` for the
same `getBoundingClientRect()` measurement and apply the same swap.

Done when: at 390 wide every tour card has at least 12px to both screen edges.

### 3. "WARM-UP" caption spills out of its column

Seen: under the W pill on set 1, in both the live workout and Edit Workout. The
caption is about 53px wide in a 36 to 44px column, so it overlaps the weight
input's left edge and hangs below the row like stray text.

Sites: `src/app/(app)/log/ActiveWorkout.tsx` and
`src/app/(app)/log/past/page.tsx`. In each, find the block
`{setNumber === 1 && !isBonus && ( <span …>warm-up</span> )}` (past page: the
`<span>` containing the text `warm-up` just after the button whose title is
`'Mark as warm-up'`).

Fix: delete that caption `<span>` in both files, and remove the now-unneeded
`flexDirection: 'column'` / `gap` from its wrapper so the W button is the
wrapper's only child and every set row has the same height. The meaning is
already carried by the button's `aria-label`/`title` and the onboarding hint
(`"Mark warm-up sets — they're excluded from PR detection."`). Then, in
ActiveWorkout's column-header row (the one rendering `LBS` and `REPS` above the
inputs), add a matching header cell above the W column with the text `WU`,
using the exact same style object as the `LBS` label, `aria-hidden="true"`,
width equal to the W column. Add the same `WU` header in the past page only if
it already has an `LBS`/`REPS` header row; otherwise skip it there.

Done when: set 1 is the same height as set 2 and nothing overlaps the weight
input at 390 wide.

### 4. Exercise header actions are too small to hit mid-workout

Seen in ActiveWorkout: Skip is 45x19, Rename 20x20, Swap 20x20, side by side.

Fix in `ActiveWorkout.tsx`, the three `className="wo-ghost-btn"` buttons whose
`aria-label`s start with `Skip `, `Rename ` and `Swap `:

- Rename and Swap: change `style={{ padding: '2px', flexShrink: 0 }}` to
  `style={{ width: '36px', height: '36px', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}`
  and add `hit-44` to the className. Keep the 16px icons.
- Skip: give it `minHeight: '36px'`, `padding: '0 8px'`, and add `hit-44`.
- Set the gap of the flex row that contains these buttons to `2px` so the row
  does not get wider than before; the exercise title must still get the
  remaining width with ellipsis.

Same treatment in `log/past/page.tsx` for the `SKIP` (39x19) and `UNDO` (41x19)
buttons, and the banner's `title="Delete this workout"` button (23x19): make it
36x36 with `hit-44`.

Done when: all of these measure at least 36px visually and 44px hit area, and
"Chest-Supported Dumbbell Row" still truncates cleanly.

---

## P2: wrong or broken-looking content

### 5. Friend avatars render as broken images

Seen: every friend on Ranks and the friend profile shows the browser's broken
image glyph (and alt text spilling inside the circle). The URLs are
`lh3.googleusercontent.com/a/…`, which Google refuses when a referrer is sent.

Fix: create `src/components/Avatar.tsx`:

```tsx
'use client'
import { useState } from 'react'

/** Round avatar that falls back to initials when there is no URL or the image
 *  fails. Google profile photos reject requests that carry a referrer. */
export default function Avatar({ src, name, size, fontSize }: {
  src?: string | null; name: string; size: number; fontSize: number
}) {
  const [failed, setFailed] = useState(false)
  const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span aria-hidden="true" style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize, color: 'var(--text-secondary)' }}>
          {initials}
        </span>
      )}
    </div>
  )
}
```

Replace the hand-rolled avatar blocks with it, keeping each site's current
size: `LeaderboardClient.tsx` (the `{/* Avatar */}` block, size 36, fontSize
13), `FriendProfileView.tsx`, `ProfileDashboard.tsx`, `FriendsAccordion.tsx`,
and `ShareCard.tsx`. Grep `avatar_url` to find any others. If a site uses a
different border or a level ring around the avatar, keep that wrapper and put
`<Avatar>` inside it. Delete local `initials()` helpers that become unused.

Done when: Ranks shows either a photo or initials for every row, never the
broken glyph.

### 6. Ranks row says "XP" twice and "95lbs" with no space

In `LeaderboardClient.tsx`:
- Find `statDisplay`. Make the overall branch return only the number
  (`entry.xp_total.toLocaleString()` or whatever field it uses, without
  ` XP`), since the caption below already reads `XP`.
- Make the lift branch return `` `${fmt(value)} ${unitLabel}` `` with a space.
  `ShareCard.tsx` builds its own stat string; apply the same two rules there.

### 7. "15-20 each reps", "45-60 sec reps"

`reps_target` is free text, and five places append the word "reps" to it.

Add to `src/lib/utils/formatting.ts`:

```ts
/** "3 sets × 10-12 reps", but never "… each reps" / "… sec reps": reps_target
 *  is free text and may already carry its own unit. */
export function formatSetsReps(sets: number, repsTarget: string | number): string {
  const reps = String(repsTarget).trim()
  const bare = /^\d+(\s*[-–]\s*\d+)?$/.test(reps)
  return `${sets} sets × ${reps}${bare ? ' reps' : ''}`
}
```

Use it at every `{x.sets_target} sets × {x.reps_target} reps` site:
`ActiveWorkout.tsx`, `ExercisePickerSheet.tsx` (two), `WorkoutManager.tsx`.
Add a unit test beside the existing formatting tests covering `10`, `10-12`,
`15-20 each`, `45-60 sec`.

### 8. Chat history header shows the text behind it

Seen: opening Coach → history, the "Done / Chats / New" bar has the empty-state
sentence showing through it.

Fix in `globals.css`: find `.coach-history`. Give the panel an opaque
background, `background-color: var(--surface);`, and make sure it covers its
parent (`position: absolute; inset: 0;` if it is not already). If the header
row inside it has its own class, give that `background-color: var(--surface)`
too. No transparency or blur on either.

### 9. Coach input shows a scrollbar when empty

Measured: textarea `scrollHeight 42`, `clientHeight 41`, `overflow-y: auto`.

Fix in `CoachSheet.tsx`, where the textarea's height is set from
`scrollHeight`: set `overflowY` to `'hidden'` while the content height is at or
below the max height, and `'auto'` only once it is clamped. If the height is
CSS-only, set `overflow-y: hidden` on the textarea class and add
`box-sizing: border-box`.

### 10. Coach replies: detail lines sit left of their bullet

Seen: "• Hanging Knee Raises" then "3 × 12–15 / Rest: 45 sec" outdented to the
bubble edge. `src/lib/coach/formatMessage.ts` already classifies these as
detail lines (see the comment "Detail lines that read like exercise
metadata"). In `CoachMessageContent.tsx`, find the class those lines render
with and, in `globals.css`, give it `padding-left` equal to the bullet's text
indent (measure the `.coach-md` list item: marker width plus gap; expected
about 18px) and `color: var(--text-secondary)`. Do not change the parser.

### 11. Progress Photos card is a click-only `<section>`

`src/app/(app)/progress/page.tsx`, the card containing `PROGRESS PHOTOS`. It has
no link, button, role or tabindex, so keyboard and screen-reader users cannot
open it. Change the outer element to `<Link href="/progress/photos" className="press-card" …>`
with the same inline style plus `textDecoration: 'none'`, remove the `onClick`
router push, and add `aria-label="Progress photos"`.

Same card: the subtitle reads "1 photo" for an entry holding five photos.
Find where that count is built; if it counts entries, label it
`${n} ${n === 1 ? 'entry' : 'entries'}`; if a real photo count is available,
show that with `photo`/`photos`.

### 12. Small copy fixes

| File | Find | Replace with |
| --- | --- | --- |
| `HomeDashboard.tsx` | `body: 'Track your volume at a glance.'` | `body: 'Workouts this week and month, plus every PR you have set.'` |
| `HomeDashboard.tsx` | `{ value: weeklyWorkouts, label: 'WORKOUTS', …` and the monthly twin | `label: weeklyWorkouts === 1 ? 'WORKOUT' : 'WORKOUTS'` (same for monthly) |
| `log/past/page.tsx` | `Editing {selectedDayType?.replace(/-/g, ' ')}` | `Editing {dayName(selectedDayType)}` using the same display-name helper the day pills on that page use, so it reads "Editing PULL" |
| `SettingsView.tsx` | `'In-page / local timer ping when rest hits zero (not lock-screen-accurate on Hobby cron)'` | `'Pings when your rest hits zero. Most reliable while GRIND is open.'` |
| `SettingsView.tsx` | `'Local heads-up before rest ends — use while the app is open; lock-screen timing isn’t gym-accurate'` | `'A heads-up 10 seconds before rest ends. Works while GRIND is open.'` |
| `SettingsView.tsx` | `Local hour (17–21)` | `Between 5 and 9 PM` |
| `CoachMark.tsx` | the `{step} / {total}` counter | render it only when `total > 1` |
| `WorkoutManager.tsx` | `aria-label` values built as `Open ${key} day` / `Delete ${key} day` | use the day's display name, not the raw key |
| `AddPhotoSheet.tsx` | workout chips | label with the same display-name helper used on Log (uppercase), and list only `enabledDayKeys()` days plus `None` |

---

## P3: polish

### 13. "WARM-UP %" wraps onto two lines

`ActiveWorkout.tsx`, the button rendering `{canUndoWarmup ? 'UNDO WARM-UP' : 'WARM-UP %'}`:
add `whiteSpace: 'nowrap'` and change `fontSize` from `'12px'` to `'11px'`.
If `UNDO WARM-UP` then overflows at 375 wide, change that label to `UNDO`.

### 14. Last row of a page hides under the orb

Seen on Progress: the final Recent Sessions value is covered at the end of the
scroll. In `globals.css` add, outside any media query, then cancel at desktop:

```css
/* Lets the last row scroll clear of the Coach orb (56px + 16px margin). */
.page--progress, .page--profile, .page--narrow { padding-bottom: 88px; }
@media (min-width: 768px) {
  .page--progress, .page--profile, .page--narrow { padding-bottom: 32px; }
}
```

First read each class's existing `padding-bottom` (and any inline
`paddingBottom` on the page root, e.g. Leaderboard's
`calc(80px + env(safe-area-inset-bottom))`). Only raise values that are below
88px; never lower one.

### 15. Chart axes

- `ProgressChart.tsx`: Y ticks read 41 / 61 / 81 / 104. Compute the domain as
  `[Math.floor(min / 10) * 10, Math.ceil(max / 10) * 10]` in display units and
  pass `tickCount={4}` with `allowDecimals={false}` so ticks land on round
  numbers.
- `BodyWeightChart.tsx`: the lowest Y tick ("158") collides with the first X
  label ("Aug 11"). Add `padding={{ left: 12, right: 12 }}` to the `XAxis` and
  `dy={6}` to its tick, or raise the chart's bottom margin by 6px, whichever
  the current props make simpler.

### 16. Light theme: lime day colour used as text

Seen in light mode: calendar date "4" and the "PUSH" legend label are lime on
cream, and the PUSH day title on Log is lime on a near-white card. That is
`--accent` used as text, which the design system forbids.

Find where a day's colour is applied as a text colour (`WorkoutCalendar.tsx`
legend and day number, `DaySelect.tsx` / `DayCardPreview.tsx` title and icon).
At those text sites only, when the resolved colour equals the accent lime
(`#c8f135`, compare case-insensitively), use `var(--accent-text)` instead.
Dots, fills and borders keep the real colour. Other day colours are unchanged.

### 17. Home calendar legend is hard-coded

The legend always reads PUSH / PULL / LEGS, but this account's days are PULL
ABS, ABS, HOME ABS and so on. In `WorkoutCalendar.tsx`, build the legend from
the distinct day types that actually appear in the displayed month (name via
the display-name helper, colour via the same resolver the day cells use), in
first-appearance order, capped at 4 with a trailing `+N` if more. Hide the
legend when the month has no workouts.

### 18. Reorder arrows in Manage are 23x23 and stacked

`WorkoutManager.tsx`, buttons with `aria-label` starting `Move `. Make each
32px wide by 28px tall (56px for the pair, matching the row height) with the
icon centred. Do not add `hit-44` here: the two targets are adjacent and their
extended areas would overlap.

---

## Not verified in this pass

- Finishing a workout: `CompletionModal`, `BadgeUnlockOverlay`, the undo
  banner. Not exercised, to avoid changing real XP and streak data.
- Setup wizard, share card, photo lightbox and compare view.
- Light theme inside the live workout, Settings, Profile and Coach.
- Reduce Motion, a real iPhone in standalone mode, and screen readers.
- One React error (`Cannot read properties of null (reading 'removeChild')`,
  page stuck on the old screen after leaving the Coach) appeared twice while
  audit scripts were injected into the page and did not reproduce in three
  clean runs of the same flow. Treat it as an artefact unless it shows up in
  normal use.
- A React dev warning, "Cannot update a component (OnboardingProvider) while
  rendering a different component (HomeDashboard)", fires on Home load. Not
  traced. Look in `useTour` (`Tour.tsx`) for a `markTourSeen` or other context
  setter called during render and move it into an effect.
