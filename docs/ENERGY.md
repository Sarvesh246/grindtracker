# GRIND Energy

The `/progress/health/energy` page predicts today's **morning peak, afternoon dip, evening peak and wind-down** from your sleep, and can push a heads-up a few minutes before each one. It's the same idea as the RISE app, built on published models, plus one thing RISE doesn't do: it learns from how you actually feel.

Code: `src/lib/energy/` (pure model, unit-tested in `__tests__/energy.test.ts`), `src/components/energy/`, `src/app/api/cron/energy/route.ts`. Migration: `docs/sql/65-energy-schedule.sql`.

## The model in one pass

All maths runs in **clock hours relative to the day's local midnight**: 7.5 means 07:30, -1 means 23:00 the night before. `time.ts` converts using wall-clock time, so a DST night still reads 23:00 → 07:00.

1. **Nights** (`nights.ts`, `buildNights`). Covers the last 28 days, newest first, with each record read in its own timezone. For each wake date:
   - Records that overlap in time are **one block**. That's the same sleep seen by Garmin and Apple, even when one source calls it a nap. The block counts the longest record's sleep, never the sum.
   - Blocks within **2h** of the main block are chained into one **broken night**: onset is the first start, wake the last end, and sleep the sum of the blocks.
   - Later daytime blocks of 10 min or more are **naps**.
   - A date with only naps on record produces no night.
2. **Sleep need** (`sleepNeed.ts`). Learned from your own nights; see **Sleep need** below. Starts from an 8h prior, shrunk by 5 pseudo-nights and clamped to 6–10h.
3. **Sleep debt** (`sleepDebt`). A running balance over the last 14 nights, oldest first: each night adds need − sleep − naps, extra sleep pays it back, and it never goes below 0 (you can't bank sleep). Capped at 20h. This is the cumulative deficit of Van Dongen 2003, repaid only by actually sleeping more (Kitamura 2016). An earlier version used RISE-style 15%/85% recency weights; scaled to 14 nights, those counted last night at 2.1× its real shortfall, so a 3h-short night showed as 6.3h of debt.
4. **Circadian phase** (`circadianPhase`). Estimates DLMO (dim-light melatonin onset, the clock's anchor) as the mean of:
   - *mid-sleep − 6h* (Kantermann 2015; Burgess & Fogg 2008), with Roenneberg's oversleep correction: a long lie-in pulls that night's mid back by half its excess sleep.
   - *habitual onset − 2h* (Burgess & Fogg 2008).

   Nights are weighted with a 3-night half-life, because the clock shifts at most about 1h a day.
5. **Alertness** (`alertness`). The Åkerstedt–Folkard three-process model, with parameters from Ingre et al. 2014:
   - S = 2.4 + (S₀ − 2.4)·e^(−0.0353t). **S₀ = acute(last night) − chronic(earlier debt)**:
     - *Acute* comes from the model's own equations: S falls over the (24 − slept) hours awake, then recovers by S′ = 14.3 − (14.3 − S)·e^(−0.381·slept). An 8h night gives 14.0, 5h gives 13.4 and 3h gives 12.2.
     - *Chronic* is 2.2·(1 − e^(−debt/6h)), using the 14-night balance **excluding last night** so a short night isn't charged twice. It levels off because, in Van Dongen 2003, felt sleepiness under 14 days of restriction rose about 1 point on the 7-point Stanford scale and then held. Converted: about 1.3 KSS points, or 2.2 alertness units. Performance kept falling, but the curve shows felt energy.
   - C = 2.5·cos(2π(h − (DLMO − 4.2))/24). The published C peak is 16.8h for a typical 21:00 DLMO, so the peak sits 4.2h *before* DLMO.
   - W = −5.72·e^(−1.51t): sleep inertia.
   - U = −A·cos(2π(h − (DLMO − 6))/12): the 12h harmonic that carves the post-lunch dip. Its trough is about 6h before DLMO. A = 1 + 0.4 × (chronic ÷ 2.2), so up to +40%. Sleep loss deepens the afternoon dip specifically (Carskadon & Dement 1987, afternoon sleep latency; Monk 2005 review). C is left alone, because Cohen 2010's chronic-loss amplification happens in the biological night, which a waking-day curve doesn't reach.
6. **Phases** (`phaseTimes`). Each phase comes from a *bounded* search, so a flat curve can't produce nonsense:
   - **Grogginess:** ends when W has recovered 90%, about 1.5h after waking.
   - **Morning peak:** the highest point between the end of grogginess and the dip region.
   - **Dip:** the lowest point within ±2.5h of DLMO − 6h.
   - **Evening peak:** the highest point between the dip and DLMO (the wake-maintenance zone).

   Each window is where the curve stays within 30% of the peak-to-dip swing. Peaks are capped at 3h and the dip at 2.5h.

   **Wind-down** runs from DLMO to DLMO + 1h. **Bedtime** is habitual wake − need − 15 min.
7. **Display curve** (`toPercents`). Raw three-process units mean nothing to a reader. The active day's range (grogginess end → DLMO) maps onto 15 → top, where top = 95 − 10 × (14 − S₀), clamped to 55–95. Lost sleep pressure lowers the ceiling while the shape stays readable.

For a 23:00–07:00 sleeper this gives:

| Event | Time |
| --- | --- |
| Grogginess ends | 08:30 |
| Morning peak | ~10:00 |
| Dip | 14:00–16:00 |
| Evening peak | 17:30–20:00 |
| DLMO / wind-down | 21:00 |
| Bedtime | 22:45 |

The tests pin these values.

### Beyond RISE: felt-energy calibration
The page has three buttons (Tired / OK / Sharp). Each tap writes an `energy_checkins` row with its local date and hour. "Tired" taps within 3h of the predicted dip vote on where the dip really is. The median vote is shrunk toward 0 with 3 pseudo-votes and capped at ±1.5h, then shifts DLMO, and with it the whole schedule (`calibrationOffset`). The hero shows "Tuned later/earlier Xm" once it moves.

### Confidence and provisional days
- **Confidence:** `high` / `medium` / `low` comes from nights observed (7 or more is full coverage) × mid-sleep regularity (spread under 45 min, 90 min, or worse).
- **Provisional days:** if last night hasn't been imported yet, the habitual wake time stands in and the hero says "Using your usual wake time".

## Sleep need (model v3)

Most nights don't measure need; they're capped by an alarm or a schedule. `sleepNeed` therefore treats nights as evidence with two corrections, then takes a recency-weighted **median** (robust to a sick night or a tracking glitch) and shrinks it toward 8h. It runs in two passes, because carried debt depends on the need being estimated.

1. **Which nights ran their course.** A night at least **30 min longer than your usual** counts as unconstrained. This is the MCTQ idea of free days as *oversleep* (Roenneberg). It uses duration, not wake time, because a shifted night (asleep 05:20, up 12:26) wakes late without sleeping longer. An earlier draft keyed on wake time and misread exactly that kind of night.
2. **Rebound correction.** An unconstrained night after short ones includes catch-up on top of need, so implied need = slept − 0.25 × the debt carried in. The 0.25 comes from Kitamura 2016: with 12h in bed, 1h of debt took about 4 nights to clear.
3. **Censoring.** Any other night only says "need ≥ this". It counts fully when it's above the current estimate (that's information) and at weight 0.25 below it (it might be an alarm, not the body). Broken nights count half. Recency half-life is 14 nights.

On real data (Nov 2026), the six unconstrained nights read 9.1 / 9.07 / 9.0 / 8.28 / 7.97 / 11.08h raw. After the rebound correction they read 7.9 / 7.8 / 8.0 / 7.2 / 7.0 / 8.8h: tightly clustered, giving a need of 7h 46m against a habitual 7.3h.

## Watch signals (model v2)

The watch makes the schedule more accurate in four ways. Each was chosen because it's backed by evidence **and** the data actually arrives, as measured on real accounts in Nov 2026:
- 30 of 32 nights had stage totals and 25 had overnight HRV.
- Naps appear.
- Split nights appear.
- `daily_body` exists only on days the watch app syncs.
- `health_samples` (all-day HR and steps) was empty.

| Signal | Source | What it changes | Bound |
| --- | --- | --- | --- |
| Broken night | overlapping/adjacent `sleep_sessions` | true onset, wake and total sleep (debt + phase) | blocks ≤ 2h apart only |
| Naps | `sleep_sessions` kind `nap` or a later block | debt paid back; today's curve: S recovers during the nap (S′ = 14.3 − (14.3 − S)·e^(−0.381·dur)) with a lighter inertia dip after; blank during the nap | never touches need or phase |
| Recovery | overnight HRV, `daily_body.bb_wake`, `resting_hr` | curve **height only**, as debt-equivalent hours | 7+ earlier readings; robust z vs your own median/MAD, ±2 cap; sensors **averaged**; ±1.5h max |
| Wake stage | stage timeline ending in deep sleep | grogginess decays at 1.0 instead of 1.51 (≈2.3h vs 1.5h; waking from deep sleep gives heavier inertia, Tassi & Muzet 2000) | only when the stage ran to the end of the night |

How the guardrails keep sensors from confusing the output:
- **Separate jobs.** Sensors never touch DLMO (melatonin onset): the clock stays anchored on sleep timing. Recovery changes how high the curve sits. Wake stage changes only grogginess. Naps change only the hours after the nap.
- **Neutral when missing.** A missing or new metric contributes exactly 0. Tests pin that sensor-free data reproduces the v1 schedule.
- **No stacking.** Three recovery sensors agreeing move the curve no further than one sensor at its cap.
- **Shown, not hidden.** The page's "What shaped today" list names each adjustment that applied, with the reading and your usual value. Recovery is listed only when |z| ≥ 0.5.
- **Freshness.** The cron rebuilds when either a sleep import or a watch sync (`daily_body.synced_at`) is newer than the stored schedule.

**Deliberately not used (yet):**
- **Sleep score:** mostly duration, so it would double-count debt.
- **SpO₂ and respiration:** no established link to alertness timing.
- **Workout timing:** exercise shifts the clock by too little to beat the noise.
- **Intraday Body Battery and stress:** they measure accumulated load, not alertness.
- **Sensor-driven clock estimation:** this one needs data GRIND doesn't collect yet. A sleeping heart-rate low point marks the body-temperature low (≈ DLMO + 7h), and steps can drive a Forger/St Hilaire oscillator (Huang 2021). Both need overnight or all-day samples in `health_samples`, which only arrive once watch background sync ships. When they do, blend them in at a capped weight next to the sleep-timing estimate, never replacing it.

## Recompute and alerts

- **The page** always computes live from the user's own rows (`getEnergySchedule`). The `energy_schedules` table isn't read there.
- **`/api/cron/energy`** runs every 5 minutes, driven by the `grind-energy` **pg_cron** job (migration 65). For each user with push `enabled` and `energy_alerts` on, it:
  1. Rebuilds today's schedule if any of these apply: the row is missing, the `model_version` is older, the newest sleep `received_at` is later than `sleep_seen_at`, or the alert prefs changed (`alertKey`).
  2. Upserts `energy_schedules`.
  3. Deletes today's **unsent** `energy:{user}:{date}:*` notifications and queues the wanted kinds at event start − `energy_lead_min`. Already-sent heads-ups stay sent: `ignoreDuplicates` on the unique `dedupe_key`.
  4. Claims and sends anything due through the shared `sendDueNotifications` (`src/lib/push/sendDue.ts`, also used by the hourly route; the claim is `skip locked`).
- **Timezone:** `notification_prefs.timezone` if it is set and not UTC, else the newest night's timezone.

### Decision: pg_cron, not a faster Vercel cron
GRIND is on Vercel Hobby: once-daily crons, used here as 24 jobs that each fire once a day, which works out to one run an hour. That can deliver a "20 min before" heads-up up to 59 minutes late. Options were:
- Vercel Pro: $20/mo for per-minute crons.
- An external pinger.
- Supabase pg_cron + pg_net: free, and already in the stack.

We chose pg_cron. The cost is two Vault secrets that must be created by hand (see the header of migration 65). The job fails quietly if they're missing.

## Known limitations
- Phase comes from sleep *timing* only. A light- or activity-driven oscillator would track jet lag and weekend drift faster: Forger/Jewett/Kronauer 1999 and St Hilaire 2007, fed by Garmin steps (Huang 2021 found activity predicts DLMO within about 1h). That's the natural v2.
- Calibration choices, not published constants: the dip gain's size (+40%), the 10-points-per-S-unit display ceiling, and the 0.25 rebound share.
- Need and debt are in **device-measured** hours. Garmin overstates total sleep by about 45 min versus polysomnography (Chinoy 2021). Because need is learned from the same device, the bias cancels out of debt. It's also why a learned need can sit below the lab figures (8.4h in Kitamura 2016; 8.9h for young adults in Klerman & Dijk 2008).
- Check-ins only calibrate *timing*, not amplitude.

## Sources
- Tassi & Muzet 2000 (sleep inertia is heavier when waking from slow-wave sleep)
- Åkerstedt & Folkard 1996; Ingre et al. 2014, *PLoS ONE* 9:e108679 (three-process parameters)
- Daan, Beersma & Borbély 1984; Skeldon et al. 2014 (two-process model)
- Burgess & Fogg 2008 (DLMO vs sleep timing); Kantermann et al. 2015 (MSFsc → DLMO)
- Roenneberg et al. (MCTQ, oversleep correction)
- Lavie 1986; Strogatz 1987 (wake-maintenance zone)
- Van Dongen et al. 2003, *Sleep* 26(2) (cumulative debt; felt sleepiness plateaus while performance keeps falling)
- Kitamura et al. 2016, *Sci Rep* (optimal sleep 8.41h vs habitual 7.37h; 1h of debt takes ~4 days to repay)
- Klerman & Dijk 2005, *Sleep*; 2008, *Curr Biol* (extended sleep opportunity; asymptote 8.9h young / 7.4h older adults)
- Carskadon & Dement 1987; Monk 2005 (sleep loss deepens the post-lunch dip)
- Cohen et al. 2010, *Sci Transl Med* (chronic loss amplifies deficits in the biological night)
- Chinoy et al. 2021, *Sleep* (wearable total-sleep bias vs polysomnography)
- RISE Science help center (14-night debt, 15%/85% weighting)
- Huang et al. 2021, *Sleep* 44 (wearable phase estimation)
