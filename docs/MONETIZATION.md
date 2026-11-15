# GRIND monetization plan

Status: **proposal, nothing built yet.** Written 2026-11-11.
Next free migration number: `58` (schema is at `57-*.sql`; 57 is the badge expansion).

## The one-paragraph version

Keep the app that people already use free forever: logging, streaks, XP, badges,
the leaderboard, friends, rest days, body weight, offline, push reminders, data
export. Sell **GRIND Pro**, which unlocks the Coach (full), unlimited progress
photos, and future insight features. Offer a **14-day full Pro trial** to every
new account, then **$4.99/month, $39.99/year, or $99.99 lifetime**, sold on the
web through Stripe (no app-store cut). The annual plan is the default.

This is a *freemium chassis with hard-paywall-style pricing and a trial*. The
simulation (below) found the hard paywall had the highest median revenue, but
a hard paywall would empty the leaderboard that gives GRIND its network effect.
The trial gets most of that conversion pressure without removing the free tier.
**That hybrid was not simulated directly; treat its numbers as an estimate.**

## Why this model

What the simulation said (Monte Carlo, 4,000 uncertain worlds, 24-month horizon,
per 1,000 seed downloads, net of refunds, fees and Coach AI cost):

| Model | Median net | P10 - P90 |
| --- | --- | --- |
| Hard paywall + trial, $4.99 / $39.99 | $1,794 | $815 - $3,921 |
| One-time $39.99 unlock | $1,633 | $833 - $3,297 |
| Freemium premium, $7.99 / $59.99 | $1,596 | $720 - $3,149 |
| Freemium standard, $3.99 / $29.99 / $79.99 lifetime | $1,448 | $715 - $2,871 |
| Freemium cheap, $2.99 / $19.99 / $49.99 | $1,193 | $594 - $2,314 |
| Coach-only add-on, $4.99/mo | $645 | $276 - $1,285 |
| Free + tip jar | $16 | -$36 - $88 |

Read these honestly:

- The top four overlap almost entirely. The model **cannot prove** one beats
  another. What it does show is that cheap pricing did not help (the cheap tier
  beat the standard one in 23% of worlds) and that tips are worthless.
- The biggest driver by far is the real baseline conversion rate (rank
  correlation +0.85). Nobody knows that number for GRIND yet. Measure it.
- Coach-only did badly mostly because the model assumed a narrow gate halves
  conversion. That is an assumption, not a finding. Fitbod charges $95.99/yr
  for AI workouts, so AI can sell when it is the core product. GRIND's core is
  logging, so Coach alone is a thin gate. Hence Pro bundles several things.
- Scale is modest: netting about $500/month needs roughly 7,000-8,000
  downloads under the better models.
- Competitor anchors (annual / lifetime): Hevy $23.99 / $74.99, Strong
  $29.99 / $99.99, Liftosaur $39.99 / $99.99, Fitbod $95.99 / none.

## Tiers

### Free (forever)

Everything that makes GRIND a tracker and a community:

- Logging, custom days, exercises, rotation, templates, warm-ups, notes, RPE
- Rest timer, plate calculator, past-workout logging
- XP, levels, streaks, all 35 badges, rest days
- Leaderboard, friends, friend profiles, share card
- Body-weight log and chart, basic progress charts
- Offline logging and sync, light/dark themes
- Push reminders
- **Data export and delete-my-data** (never paywall these; portability is a trust
  and legal issue)
- Coach "taste": 3 messages per week, answers only, no action cards
- Progress photos: up to 10 photos, no compare view

### Pro

- Coach, full: 15 messages/day, action cards (log and correct weights, edit
  days, skip sets, start and finish workouts), weekly-plan install, saved
  conversations
- Progress photos: unlimited, timeline, side-by-side compare
- Future Pro-only work goes here (deeper analytics, training-block reports).
  Do not advertise features that do not exist yet.

### Prices

| Plan | Price | Notes |
| --- | --- | --- |
| Monthly | $4.99 | Exists mainly to make annual look good |
| **Annual (default)** | **$39.99** | About $3.33/mo; shown first and pre-selected |
| Lifetime | $99.99 | Matches Strong; breaks even against annual at about 2.5 years |

Lifetime means lifetime of the product, with the same Coach fair-use limit
(15/day). Coach cost is about $0.03 per heavy user-month at assumed Gemini
Flash-Lite pricing (verify against the real bill), so lifetime is low risk.

## How a user moves through it

1. **Sign-up:** account created, `pro_trial_ends_at = now() + 14 days`. They see
   everything unlocked. A small "Pro trial: N days left" pill appears in Profile
   (not a nag banner).
2. **Day 10:** one in-app card summarizing what they used (Coach messages,
   photos added) with a "Keep Pro" button. One push notification at most, only
   if push is enabled.
3. **Day 14:** trial ends. Core app is untouched. Coach drops to the free taste,
   photos beyond 10 become read-only (never deleted or hidden).
4. **Paywall moments** (no popups on launch): opening Coach after the taste is
   used up, trying to add an 11th photo, opening Compare. Each shows what Pro
   unlocks and the three plans.
5. **Checkout:** Stripe Checkout (hosted page), then back to `/profile` with a
   success toast.
6. **Managing:** Stripe Customer Portal for cancel, change plan, update card,
   invoices. Link from Profile -> Settings -> "Manage Pro".

## What happens on cancel or failed payment

- Cancel: Pro stays until period end, then reverts to Free. Nothing is deleted.
- Failed renewal: Stripe retries (smart retries, about 3 weeks). Pro stays
  active during the grace period (`past_due` counts as Pro). One email from
  Stripe, one in-app banner in Profile.
- Refund: Stripe refund removes Pro immediately via webhook. Policy: no-questions
  refund within 14 days (hard-paywall-style apps see about 5.8% refunds anyway).
- Over-limit data after downgrade: photos above 10 stay viewable and
  exportable but cannot be added to. Coach history stays readable.

## Existing users (important)

Everyone who signed up before launch is a **Founding member**:

- Pro free for 90 days from launch (separate from the 14-day trial)
- Then a permanent 40% off annual (`FOUNDING40` coupon, $23.99/yr)
- Nothing they have today is removed from the free core
- Founding status is stored (`founding_member = true`) so it can be honored later

Announce this before the paywall ships, not after.

## Technical design

### Payments

- **Stripe Checkout + Customer Portal + webhooks.** Sold on the web, so no
  App Store / Play cut (the 15% difference is about 10% of net revenue in the
  simulation). GRIND is a PWA, so this is allowed.
- Taxes: decide between **Stripe Tax** (you register in each place you owe VAT
  or sales tax) or a **merchant of record** (Paddle or Lemon Squeezy: higher fee
  of roughly 5% + $0.50, but they handle global tax). For a solo developer
  selling internationally, a merchant of record is the lower-risk default.
- Fees if Stripe: 2.9% + $0.30 per charge.

### Database (migration `58-subscriptions.sql`, idempotent like the others)

End it with the `grind_migrations` insert that every migration carries (see `docs/sql/00-migration-tracking.sql`).

```sql
-- One row per user. Written ONLY by the webhook (service role), never the client.
create table if not exists user_entitlements (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null default 'free',           -- 'free' | 'monthly' | 'annual' | 'lifetime'
  status text not null default 'none',          -- 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trial_ends_at timestamptz,
  founding_until timestamptz,
  founding_member boolean not null default false,
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);
alter table user_entitlements enable row level security;
-- select own row only; NO insert/update/delete policies for clients.

create table if not exists stripe_events (      -- webhook idempotency
  id text primary key,
  received_at timestamptz not null default now()
);
```

```sql
-- The single source of truth. Server-side everywhere; the UI only mirrors it.
create or replace function is_pro(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select plan = 'lifetime'
        or status in ('active', 'past_due')
        or (trial_ends_at > now())
        or (founding_until > now())
    from user_entitlements where user_id = p_user
  ), false)
$$;
```

Seed a row for every user from the existing `grind_seed_user_stats` signup
trigger path (same pattern as migration `11`): sets `trial_ends_at` for new
users and `founding_member` / `founding_until` for existing ones.

### Enforcement (RLS and RPCs are the boundary, never the UI)

- **Coach:** extend `enforce_coach_rate_limit()`. Start from `55-*.sql` (it
  keeps the `coach_dev_unlimited` admin bypass). Pro: current 15/day, 8 burst.
  Free: 3 per rolling 7 days, and the action-tool path in
  `src/lib/coach/actions` refuses when `not is_pro()`. The chat route also
  drops tools for free users (`planCoachTurn` already decides whether tools are
  offered, so add the gate there).
- **Photos:** a `BEFORE INSERT` trigger on the photos table raises a tagged
  exception when a free user already has 10; `useProgressPhotos` maps it to the
  paywall sheet. Compare view reads `isPro` for display, but the 10-photo cap is
  what is enforced.
- **Client:** a `ProContext` (mirror `ThemeContext` / `UnitContext`) resolves
  `isPro` server-side in `(app)/layout.tsx` so there is no flash, and exposes
  `trialDaysLeft`. Never trust it for security; it only picks which UI to show.

### Webhook route (`src/app/api/stripe/webhook/route.ts`)

- Verify the signature, then insert the event id into `stripe_events`
  (ignore duplicates), then update `user_entitlements` with the service-role
  client (`src/lib/supabase/admin.ts` already exists).
- Handle: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`,
  `charge.refunded`. Lifetime is a one-time payment (`mode: payment`).
- Needs new env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the
  price ids. Add the Stripe domains to the CSP in `next.config.ts`.
- Add a `/api/stripe/checkout` route (creates the session for the signed-in
  user, passes `client_reference_id = user.id`) and `/api/stripe/portal`.

### UI additions

- `PaywallSheet` (uses the existing `ui/Dialog`), pricing cards with annual
  pre-selected, "Pro" badge on gated rows, trial pill in Profile, "Manage Pro"
  row in Settings, Founding-member card.
- Follow the design system: lime is a fill, use `--accent-text` for lime text,
  reuse the motion primitives, nothing below 10px.

## What to measure from day one

Log these as events (the `Analytics` component and `/api/errors` pattern exist):

- paywall shown (by trigger), plan viewed, checkout started, checkout completed
- trial started, trial-to-paid rate, day-35 download-to-paid rate
- refund rate, monthly churn, annual renewal rate
- Coach messages per user per week, free users hitting the taste limit

## Price test (the model cannot settle this, real users can)

- Randomly assign each new account to an annual price: **$29.99 / $39.99 / $49.99**.
- Needed sample: about **1,100 users per arm** to detect 2% vs 4% conversion
  (about 435 per arm for 5% vs 10%). A 10-30 person beta cannot prove anything
  statistically; use it to learn whether people understand the paywall and
  which Pro feature they would pay for.
- Run at least 6 weeks (23% of freemium conversions happen after week 6).
- Pick the arm with the highest **revenue per signup**, not the highest
  conversion.

## Rollout

1. **Before any code:** privacy policy and terms (the app stores health-adjacent
   data and progress photos), refund policy, decide Stripe Tax vs merchant of
   record, set a hard monthly spend cap and alert on the Gemini key.
2. **Build:** migration `58`, webhook, checkout/portal routes, `is_pro`, Coach
   and photo gates, paywall UI, tests (same style as `src/lib/**/__tests__`).
   Test with Stripe test keys on a `.test` / local host only.
3. **Soft launch:** Founding-member announcement, then the paywall to new
   sign-ups only.
4. **Review at 6 weeks:** keep, change prices, or change the gate.

## Kill criteria (decide these now, not later)

- Trial-to-paid under 2% after 1,000 trials: the gate is too thin, rework what
  Pro contains before touching price.
- Refund rate above 8%: the paywall is misleading or the trial is too short.
- Weekly free-user growth drops by more than a quarter after launch: the gate is
  hurting the leaderboard loop; loosen it (more free Coach messages).

## Open decisions for the owner

- Stripe Tax vs merchant of record
- Whether to ship lifetime at launch or only monthly and annual first
- Exact free Coach allowance (3 per week is a starting guess)
- Founding-member discount depth (40% is a starting guess)

## Caveats

- All revenue numbers come from a model fed by cross-category RevenueCat
  benchmarks (mostly iOS, mostly paid-acquisition apps) plus competitor
  pricing. GRIND is a niche, friend-driven lifting app with strong free rivals
  (Hevy), so real conversion could land well above or below the median.
- Coach cost assumes Gemini Flash-Lite-class pricing; check the actual bill.
- Nothing here has been built or tested with real payments.
