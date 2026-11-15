# Friend profiles, feedback and body weight

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Friend profiles ((app)/leaderboard/[username]/, migration `19-friend-profile.sql`)
Tapping a leaderboard row opens a read-only profile at `/leaderboard/[username]`
— banner (avatar, display name, level, XP bar), streak cards, lifetime stat
cards, and a collapsible badge grid. Own row goes to the real editable
`/profile` instead — no second read-only view of yourself. `page.tsx` resolves
the username to a user id via `user_profiles` (public-readable to any
authenticated user, `12-friendship-authz.sql`) then calls
`get_friend_profile(id)`; `FriendProfileView.tsx` is presentational only,
styled to match `ProfileDashboard.tsx`'s banner/streak/stat-card JSX exactly
(same inline styles, same `.stat-grid-4`/`.badge-grid` classes) so the two
feel like one page. If the RPC rejects (not a friend, or a hand-typed
username) the page renders a plain "profile unavailable" state rather than a
hard 404 — RLS/the RPC is the actual gate either way.

Both `FriendProfileView.tsx` and `ProfileDashboard.tsx` end with the same
footer: a centered "GRINDing since \<month year\>" line, "GRINDing" in
`--accent-text` (matching the "never `--accent` for text" rule under
Theming) — echoing the app name rather than a plain "Grinding". The join date
is `user_profiles.created_at`; `ProfileDashboard`'s own copy comes from
`profile/page.tsx`'s `joinedAt` prop (added alongside `username` in the same
query), the friend view's from `get_friend_profile`'s `joined_at` field. Keep
the two footers' copy/casing in sync if you change one.

## Feedback (src/components/FeedbackModal.tsx, (app)/admin/feedback/)
Users reach the developer through a "Send Feedback" row in Profile → Settings,
which opens a modal (type chips, message, up to 3 images ≤5 MB, optional
"send anonymously"). Images upload to the private `feedback-images` bucket keyed
`{user_id}/{uuid}.{ext}` before the row is written; the row stores object paths,
never URLs, and the inbox mints short-lived signed URLs server-side.

Rate limit: **3 submissions per 10 minutes and 20 per day, per user**, enforced by
the `feedback_rate_limit` BEFORE INSERT trigger — not by RLS (a policy on
`feedback` that subqueries `feedback` would recurse) and not by the client. The
modal pre-checks the same counts before uploading so a blocked submission fails
fast and doesn't strand images in the bucket, and maps the trigger's tagged
exception to plain English. **If you change the limits, change them in both
places** (`09-feedback.sql` and the constants in `FeedbackModal.tsx`).

The inbox lives at `/admin/feedback` — an email-style two-pane client (list +
detail, stacked below 900px via `.inbox-layout`) with search, read/starred
filters, type filter, sorting, mark read/unread, star, delete, and mark-all-read.
Mutations are optimistic and revert with a toast on failure.

**Access is enforced in Postgres, not the UI.** `is_grind_admin()` (see
`09-feedback.sql`) checks `auth.users.email` against the admin address and backs
the RLS policies: everyone can insert their own feedback, only the admin can
select all rows, update, or delete. `src/lib/utils/admin.ts` mirrors the address
for routing only — it decides whether the Profile link renders and whether
`/admin/feedback` 404s, and grants nothing on its own. "Anonymous" is a display
choice: `user_id` is always recorded (abuse control) and the inbox has a
"reveal sender" affordance.

## Body weight editing (src/app/(app)/profile/BodyWeightCard.tsx)
The card shows the last 90 days. The text field at the top only ever logs
TODAY; every past entry is corrected by **tapping its dot on the chart**
(each dot carries a transparent r=14 hit circle so the target clears 44px,
and the selected one gets an accent halo), which opens a bottom-sheet
`Dialog` with the date, a prefilled input, SAVE, and a destructive "Delete
this entry" that swaps the sheet into a DELETE/KEEP confirm rather than
stacking a second modal.

The full list is a **collapsed** "History" disclosure below the chart — it
used to render every reading inline, which after months of daily logging
buried the rest of the profile. Expanded, it's a scrolling (`max-height:
240px`) list of full-width buttons opening the same sheet, and it doubles as
the keyboard/screen-reader equivalent of the `aria-hidden` chart, so keep it
in the DOM and keep every entry reachable from it.

Deletes are a plain `body_weights` DELETE — the table's single `for all`
policy (`03-body-weights.sql`) already covers it, no migration needed. The
sheet's slide-up is the CSS `sheet-up` keyframe in `globals.css`, not
state-driven, so `html.reduce-motion` neutralizes it for free (unlike the
Recharts line, which still needs the explicit `isAnimationActive` opt-out
described under Reduced motion in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)).
