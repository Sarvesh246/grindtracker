# Fitness Age for ages 18–90: research audit and proposed algorithm

Status: **engine implemented, no UI yet** (2026-11-24). Code lives in
`src/lib/body/fitnessAge/` (norms, calibration, cardio, strengthAge,
recoveryAge, queries, validate), the API is `/api/fitness-age`, the schema is
migration `84-fitness-age.sql`, and tests are in
`src/lib/body/__tests__/fitnessAge.test.ts`. Those tests include a seeded re-run
of simulation scenario S1 through the real code. Every tuned constant is in
`CARDIO`, `STRENGTH` and `RECOVERY`, and every reference curve is in `norms.ts`.
Written 2026-11-24.
**Update (same day):** extended to four scores: Cardio, Strength, Recovery and an
overall GRIND age. They were stress-tested in a 54,000-person simulation. The final
algorithm and accuracy figures are in **§9**, which supersedes the §6 estimates.
Goal: get the most accurate fitness age we can from the data GRIND already syncs,
for every adult aged 18–90. Garmin's version starts at 20.

---

## 1. The short version

- **Fitness age is a VO₂max number turned into an age.** The definition comes from
  the HUNT study (Nes et al., 2014): it's the age at which a healthy average person
  of your sex has your VO₂max. Every credible version, Garmin's included, is
  only as accurate as its VO₂max estimate.
- **Nothing in the science stops it working at 18.** VO₂max norms exist for
  teenagers. Per-kg VO₂max peaks around 17 in boys and declines slowly through the
  late teens and 20s in both sexes. Extending the reference curve from 20 down to
  18 is a small, well-supported extrapolation, not a guess.
- **The real problem at young ages is precision, not eligibility.** The VO₂max-vs-age
  curve is fairly flat from 18 to 45, losing only about 0.3–0.45 mL/kg/min a year.
  A Garmin VO₂max error of ±3 mL/kg/min therefore moves fitness age by roughly
  ±7–12 years. Garmin's 20-year cutoff probably hides this problem; it doesn't fix it.
- **Recommendation:** keep the standard, mortality-validated VO₂max definition.
  Make the VO₂max estimate as good as possible by combining Garmin's running VO₂max
  with a non-exercise model, resting HR and HRV trends, training load and body
  weight in a time-series (Kalman) filter. Add calibration from a field test or lab
  test when one exists. Show **a range, not a single number**. Clamp the
  result to 18–90.
- **Expected accuracy (modelled, not yet validated):** VO₂max about 94–95%
  accurate (MAPE 5–6%) using Garmin data alone, and about 97% after one field-test
  calibration. Fitness age typical error is about ±6 years for men and ±9 years for
  women aged 18–30 with no calibration, and about ±4 and ±6 years with
  calibration. Month-to-month **changes** are much more precise than the absolute
  number (see §7).

---

## 2. What fitness age actually is

| Source | Definition / inputs | Range |
| --- | --- | --- |
| HUNT / NTNU CERG calculator (Nes et al. 2014, MSSE 46:1159) | Non-exercise VO₂peak model (age, sex, waist or BMI, resting HR, leisure-time activity), mapped to the age where the healthy HUNT population mean equals it | 20–90 (HUNT 3 sample) |
| Garmin, before ~2021 (Firstbeat) | Your VO₂max estimate compared with sex-specific age norms | Bottomed out around 20 |
| Garmin, current | Age, sex, BMI (or body fat from an Index scale), resting HR and vigorous-intensity minutes. Exact formula isn't published. Rarely reads more than ~10 years below actual age | 20+ |

Why it matters: in the HUNT data, each 1 MET (3.5 mL/kg/min) of estimated fitness
meant about 21% lower cardiovascular mortality. Large meta-analyses put the
all-cause mortality relative risk at **0.88–0.89 per MET** (Laukkanen 2022, 37
cohorts, 2.26M people; Han 2022). Measured or estimated VO₂max is the validated,
outcome-linked core. Nobody has validated Garmin's composite fitness age as its own
measure (the5krunner review; Garmin doesn't publish the method).

**Implication:** adding HRV, sleep or stress straight onto fitness age as "years" has
no outcome data behind any weighting. It would make the number less accurate, not
more. Those signals are valuable as inputs to the VO₂max estimate and its trend,
which is how this design uses them (§5).

---

## 3. Reference norms: the biggest hidden choice

Fitness age depends entirely on whose average you compare against. Reference sets
disagree by roughly 5 mL/kg/min at young ages, which is 10+ years of fitness age.

Directly measured VO₂max, mean ± SD (mL/kg/min):

| Age | HUNT 3 men (Loe 2013) | HUNT 3 women | FRIEND men, 50th pct (20–29) | FRIEND women |
| --- | --- | --- | --- | --- |
| 20–29 | 54.4 ± 8.4 | 43.0 ± 7.7 | ~48–49.5 | ~37.6–40.6 |
| 30–39 | 49.1 ± 7.5 | 40.0 ± 6.8 | | |
| 40–49 | 47.2 ± 7.7 | 38.4 ± 6.9 | | |
| 50–59 | 42.6 ± 7.4 | 34.4 ± 5.7 | | |
| 60–69 | 39.2 ± 6.7 | 31.1 ± 5.1 | | |
| 70+ | 35.3 ± 6.5 (n=76) | 28.3 ± 5.2 (n=53) | | |

FRIEND (Kaminsky 2015 / 2022 update; Peterman 2020 global): US-based, about 9%
decline per decade, covers 20–89 and has much larger samples above 70. HUNT is
Norwegian, fitter, and the population the fitness age concept was built on.

**Teens / 18–19** (the gap Garmin leaves):
- Shvartz & Reibold 1990 (pooled direct VO₂max, ages 6–75, US/Canada/7 European countries):
  mean relative VO₂max at age 18 is 48 (men) and 41 (women), versus 35 and 28 at age 30.
  These are older and lower norms, but they show the 18→30 decline direction and size.
- Welde 2020 (Norway, longitudinal, 14–19): boys' aerobic power peaks at **17**,
  and girls' curve is flatter.
- Kemper (Amsterdam Growth Study, 12–36): VO₂max per kg declines slowly and steadily
  from the teens into the 30s in both sexes, a little faster in girls and women.

**Decision:** use HUNT 3 as the primary curve. It is directly measured, healthy,
and the same lineage as the fitness age definition and the CERG mortality validation.

- **20 to ~75:** fit a smooth, monotone, sex-specific curve through the decade means.
  HUNT has a non-physiological flat spot in the men's 30s–40s, so the curve has to be
  monotone or the age inversion becomes unstable.
- **75–90:** shape the curve with the FRIEND / Fleg decline rates, because HUNT is thin there.
- **18–20:** extend down at a gentle youth slope. Provisional anchors: men ≈ 55.5–56,
  women ≈ 44.5–45 at 18. Confirm these against the full text before implementing.

Keep FRIEND as a switchable alternative. Note that a FRIEND-referenced age will read
**younger** for the same VO₂max.

---

## 4. Why young fitness age is inherently imprecise

Fitness age error ≈ VO₂max error ÷ slope of the reference curve at that age.

Approximate cross-sectional slopes (smoothed HUNT):

| Age band | Men (mL/kg/min/yr) | Women |
| --- | --- | --- |
| 18–30 | ~0.45 | ~0.30 |
| 30–45 | ~0.30 | ~0.25 |
| 45–60 | ~0.40 | ~0.35 |
| 60–75 | ~0.40 | ~0.30 |
| 75–90 | ~0.50 (accelerating) | ~0.40 |

Longitudinal data agree that decline is slow early and fast late: about 3–6% per
decade in the 20s–30s, rising to more than 20% per decade in the 70s (Fleg 2005,
BLSA; Letnes 2020, HUNT 10-year follow-up).

Two consequences:
1. **One mL/kg/min ≈ 2–4 years of fitness age** for an 18–45-year-old. Any VO₂max
   noise shows up strongly.
2. **The floor matters.** If you are fitter than the average 18-year-old, a
   VO₂max-based age has nowhere lower to go. Showing "14" would be meaningless. The
   honest output is **"18 (at peak)" plus how far above the 18-year-old norm you sit**
   (percentile, or +X mL/kg/min).

---

## 5. Proposed algorithm: "GRIND Fitness Age"

### 5.1 Inputs, from data GRIND already syncs or would need

| Signal | Where it lives now | Role |
| --- | --- | --- |
| Garmin `vo2MaxPrecise` (running/cycling) | `garmin_personal_days.measurements.vo2_max` (collect.ts) | Main exercise-based VO₂max measurement |
| Garmin fitness age | `measurements.fitness_age` | Comparison only (not provided under 20) |
| Weight, BMI, body fat % | `measurements.weight_kg / bmi / bodyFat`, `body_weights` | Per-kg conversion, non-exercise prior |
| Resting HR (daily + sleeping HR) | `daily_body.resting_hr`, `sleep_avg_hr`, health samples | Prior + fitness-change signal |
| Overnight HRV | `overnight_hrv`, `sleep_sessions.overnight_hrv` | Gating out sick/strained days, weak trend signal |
| Vigorous / moderate intensity minutes, steps | `intensity_vigorous / moderate`, `steps` | Activity prior + drift input |
| Activities: HR trace, speed, splits, training load | `garmin_personal_activities.details` | Run quality gating; later our own HR-speed VO₂ estimate |
| Sleep duration/score, stress, body battery | various | Gating only |
| **Birth date, sex, height** | **Not stored in GRIND** | **Required.** Available from Garmin's user profile or a one-time setting |

### 5.2 The estimator: one VO₂max state, updated over time

Track **absolute VO₂max (L/min)** as the hidden state, then divide by smoothed
current body mass to get mL/kg/min. That way a 3 kg weight change updates fitness
immediately, instead of waiting for Garmin to re-run its estimate.

A Bayesian / Kalman filter, run daily:

1. **Prior (day 0, or after a long data gap):** non-exercise model from age, sex,
   BMI or body fat, resting HR and activity (HUNT-style model; SEE about 5–6
   mL/kg/min). This prior is weak.
2. **Process model (day to day):**
   - Small random drift.
   - Training-load-driven change: weeks with no vigorous work drift down. Stopping
     training can cut VO₂max by up to ~20% in 12 weeks (Burtscher 2022). Sustained
     load drifts it up.
   - Resting HR trend as a change signal: a sustained +1 bpm in resting HR ≈ −0.23
     mL/kg/min (Fenland longitudinal, Gonzales 2023).
3. **Measurements (with their own error):**
   - Garmin running VO₂max: σ ≈ 3–3.5 mL/kg/min, with known bias (overestimates
     <45, underestimates >55; Düking 2022, Engel 2025).
   - Garmin cycling VO₂max: σ larger (Firstbeat says ~8% vs 5% running).
   - Non-exercise resting estimate: σ ≈ 5–6, and **down-weighted for
     correlation** with Garmin, which already uses resting info.
   - **Calibration anchors when available:** a recent maximal field test (5 km
     race, Cooper 12-minute run) σ ≈ 2.5; a lab CPET σ ≈ 2 (lab test-retest
     typical error ≈ 2 mL/kg/min, Düking 2022).
   - Learn a **personal bias term** for Garmin from any anchor. Most of Garmin's
     error is stable per person: more runs did not reduce MAPE (Düking 2022), so
     averaging alone can't remove it, but one calibration can.
4. **Quality gating** (drop or down-weight a Garmin VO₂ reading when):
   - Overnight HRV is ≥10% below baseline or resting HR ≥5% above baseline
     (sickness, alcohol). Altini & Plews 2021: sickness ≈ +6% HR, −10% HRV.
   - Heat or altitude flags, or a short or low-intensity run (<10 min above 70% HRmax).
   - Wrist-only HR with poor trace quality.

### 5.3 Turning VO₂max into fitness age

- Push the posterior VO₂max quantiles (10th / 50th / 90th) through the inverse of
  the sex-specific reference curve. This makes the flat-curve uncertainty show up
  automatically as a wide range.
- Clamp to **18–90**. At or above the 18-year-old median, show "18 · peak" plus a
  percentile or "+X above an average 18-year-old".
- Show **fitness age, an 80% range, and percentile for your actual age**, with a
  confidence label (Uncalibrated / Calibrated / Lab-verified).
- Show the trend from the filter (30/90-day), with its own, much narrower,
  uncertainty.

### 5.4 Deliberately not done
- **Adding body fat, HRV or sleep as extra "years".** No validated weights, and it
  double-counts what VO₂max already reflects. Garmin's composite approach is
  untested (no study has validated it).
- **"Risk-equivalent age" (mortality-matched).** At 0.89 RR per MET and ~8-year
  mortality doubling, 1 MET ≈ 1.4 years. Mortality before ~35 is dominated by
  external causes, so the model breaks down exactly where you need it (18–30).
- **Trying to clone Garmin's current formula.** It isn't published, it caps at
  ~10 years, and it's unvalidated.

---

## 6. Accuracy estimate (modelled from published error rates)

Assumes VO₂max error SD: **A** = Garmin running data + fusion ≈ 3.5;
**B** = plus one field-test calibration ≈ 2.5; **C** = lab CPET anchor ≈ 2.0.
Fitness age SD ≈ VO₂ SD ÷ slope. Typical absolute error ≈ 0.8 × SD.

| Age band | Sex | A: typical error / % within ±5 yrs | B (field-calibrated) | C (lab) |
| --- | --- | --- | --- | --- |
| 18–30 | Men | ±6.2 yrs / ~48% | ±4.4 / ~63% | ±3.6 / ~74% |
| 18–30 | Women | ±9.3 / ~33% | ±6.7 / ~45% | ±5.3 / ~55% |
| 45–60 | Men | ±7.0 / ~43% | ±5.0 / ~58% | ±4.0 / ~68% |
| 75–90 | Men | ±5.6 / ~53% | ±4.0 / ~68% | ±3.2 / ~79% |

As a percentage of VO₂max, the headline figures are:
- **~94–95%** (MAPE 5–6%) with Garmin running data and fusion.
- **~96–97%** after one field-test calibration.
- **~97–98%** with a lab anchor.

Compared with Garmin, the uncalibrated tier is about the same base error. It doesn't
pretend otherwise: the gain is the 18–19 coverage, honest ranges, gating of bad
readings, weight-aware conversion and calibration.

Caveats:
- These figures come from published validation errors, not from validating this
  algorithm. Clamping at 18 shrinks the visible error for very fit 18-year-olds.
- Garmin VO₂max is worse for highly trained users (>60 mL/kg/min; Engel 2025: ~6
  mL/kg/min underestimate, MAPE ~10%). It is also worse for wrist-HR-only or
  rest-based estimates (INTERLIVE meta-analysis: limits of agreement ±13–17
  mL/kg/min for resting methods, versus ±10 for exercise-based ones).
- The reference choice (HUNT vs FRIEND) is a definition, not an error, but it
  shifts young ages by 10+ years. Pick one and label it.

## 7. Trend precision: the part that is actually good

Most of the wearable error is a stable per-person bias. Changes in the filtered
estimate over 1–3 months should be precise to roughly ±1 mL/kg/min, about ±2–4
fitness-age years at 18–30. That is good enough to see training working or
detraining, even before any calibration.

## 8. Open items before implementing
1. Confirm Garmin still syncs `vo2MaxPrecise` for users under 20 (it withholds
   fitness age; VO₂max availability needs checking on the user's own rows).
2. Store birth date and sex (and height) in GRIND, or read them from Garmin's
   user profile.
3. Get the full text of Nes 2011 / 2014 for the exact non-exercise coefficients,
   and FRIEND 2022 for the 70–89 percentiles. The coefficients are not quoted here
   on purpose.
4. Personal validation: one lab CPET (or a 5 km time trial) to set the bias term
   and check this whole pipeline against a real number.

---

## 9. Final algorithm: four ages, stress-tested (v2)

### 9.1 Why these extra scores are allowed
- **Strength is an independent predictor.** In UK Biobank (70,913 adults), with
  cardio fitness and grip strength each adjusted for the other, the top-category
  hazard ratios were 0.65 for cardio fitness and 0.79 for grip, and the combination
  was best (HR 0.53) (Kim 2018). Strength also predicts outcomes independently of
  cardio fitness in 18-year-old Swedish conscripts (Timpka 2014) and in men in the
  Aerobics Center Longitudinal Study (Ruiz 2008, BMJ).
- **Resting HR predicts mortality on top of VO₂max** (Copenhagen Male Study, Jensen
  2013). Low HRV predicts mortality in population studies (Jarczok 2022
  meta-analysis; Tegegne 2023). Recovery therefore gets a small weight.
- **Strength norms:**
  - Grip: lifespan curves from 2.4M adults (Tomkinson 2025) and 12 British studies
    (Dodds 2014). Grip rises to a **peak at 30–39** and declines after midlife.
  - Lifts: barbell norms exist only for powerlifters (van den Hoek 2024, 810k
    entries), and an age/anthropometry-adjusted z-score framework exists for ages
    16–64 (Isenmann 2026). There are no general-population lift-to-health curves.
    That is why lift-only strength carries the biggest error below.

### 9.2 One shared scale
Between-person spread divided by the age decline in midlife works out to about
**20 years per standard deviation** for VO₂max, grip strength and ln-HRV alike.
So every score uses the same scale: **sub-age = age − 20 × z**, where z is your
standing against people of your own age and sex, clamped to 18–90.

This matters at 18. Strength peaks at 30–39 and HRV/RHR barely slope with age, so
"inverting the curve" (the cardio method) would call a normal 18-year-old's
strength "age 50". The z approach doesn't have that problem.

Cardio age keeps the validated curve inversion from §5.3.

### 9.3 The four scores

| Score | Inputs | How |
| --- | --- | --- |
| **Cardio age** | Garmin VO₂max, non-exercise prior, RHR/HRV gating, training history, weight, optional field or lab test | 2-state Kalman filter [VO₂max, personal Garmin bias], then HUNT curve inversion (§5) |
| **Strength age** | Best e1RM per lift over 6 weeks (Epley), relative to body weight, against age/sex lift norms. Optional grip-dynamometer reading | z averaged across lifts and shrunk toward the population mean by its uncertainty. A guard against early "novice" gains (fast first-3-month e1RM climbs are mostly technique, not health) |
| **Recovery age** | 28-day median overnight RHR and ln(HRV), excluding flagged sick/alcohol nights (fall back to all nights if fewer than 10 remain) | z = mean of RHR z (sign flipped) and age-adjusted HRV z |
| **GRIND age** | The three sub-ages | Weighted mean **0.55 cardio / 0.30 strength / 0.15 recovery**. Weights from mutually adjusted risk estimates (Kim 2018 cardio:grip log-HR ≈ 0.64:0.36, recovery given a small weight). **Drop a score with no data and renormalise the rest** |

Changes made because of the stress test (v1 → v2):
1. **Detraining** only counts against your *own* habit: at least 6 runs in the prior
   60 days, then 21+ days with none. The decay is capped at 12%. v1 penalised people
   who were always sedentary.
2. **Recovery falls back** to all nights when too many are flagged. v1 went blank
   for people who were sick a lot.
3. **Cycling gets its own error terms** (bias SD 3.5, noise 2.0). v1's 80% ranges
   only covered 70% of cyclists.
4. **Garmin's pull toward the average is corrected** (k = 0.12, deliberately
   different from the simulated true value of 0.15, to test misspecification).
   Garmin overestimates low VO₂max and underestimates high VO₂max.
5. **One Garmin reading per 7 days**, because Garmin smooths its own estimate and
   back-to-back readings aren't independent.
6. **A score with no data is hidden.** Strength with no lifting data had 68% range
   coverage and an 18-year error, so it must not be shown.

### 9.4 Simulation setup
[`scripts/fitness-age-sim.mjs`](../scripts/fitness-age-sim.mjs). Run with
`node scripts/fitness-age-sim.mjs 3000`.

- 18 scenarios × 3,000 simulated people × 180 days each.
- True VO₂max, strength and recovery are drawn from the reference distributions,
  with realistic correlations (strength vs cardio r ≈ 0.3; RHR and HRV tied to VO₂max).
- Observations carry the published error rates:
  - Garmin: person-specific bias SD 2.6 (3.5 cycling), the pull toward 50 described
    above, per-run noise, and Garmin's own smoothing.
  - Daily signals: nightly RHR ±2.5 bpm and ln-HRV ±0.15. Illness adds +6% RHR,
    −12% HRV and −3 on Garmin VO₂max. Alcohol, heat (−2), and 10% missed nights.
  - Lifts: a lift-to-health-strength mapping error of 0.5 SD (0.2 with a grip test).
  - HRV norms: a device mismatch of 0.25 SD.
- The estimator never sees the true values.

### 9.5 Results (FINAL algorithm, 3,000 people per scenario)

**Floor-aware view.** At 18, about half of people are fitter than the average
18-year-old, so their true score sits at the 18 floor and their error is near zero.
That flatters the averages. These are the honest numbers: people whose **true**
age is above the floor. Cells show mean absolute error and % within ±5 years.

| Scenario | % at floor | Cardio age | Strength age | Recovery age | **GRIND age** | GRIND 80% range holds |
| --- | --- | --- | --- | --- | --- | --- |
| **18M runner + lifter (you)** | 50% | 5.2 y / 56% | 6.7 y / 46% | 3.4 y / 76% | **2.8 y / 83%** | 80% |
| 18F runner + lifter | 50% | 6.9 / 44% | 6.6 / 45% | 3.3 / 77% | 3.3 / 77% | 78% |
| 18M + 5 km field test | 49% | 3.9 / 70% | 6.5 / 47% | 3.1 / 81% | 2.3 / 89% | 78% |
| 18M + lab test + grip test | 51% | 3.4 / 75% | 3.1 / 81% | 3.3 / 78% | **1.7 / 96%** | 82% |
| 18M gym only, no runs | 50% | 9.1 / 33% | 6.4 / 49% | 3.3 / 78% | 4.2 / 66% | 80% |
| 18M sedentary, no lifting | 22% | 5.8 / 51% | (hidden) | 3.4 / 77% | 5.4 / 57% | 68%* |
| 18M still injured (no running last 80 days) | 24% | 4.9 / 58% | 6.4 / 48% | 3.1 / 81% | 3.0 / 81% | 88% |
| 18M frequent illness + alcohol | 51% | 5.2 / 56% | 6.5 / 48% | 3.8 / 69% | 2.8 / 83% | 79% |
| 18M cyclist only | 50% | 6.1 / 48% | 6.3 / 48% | 3.3 / 78% | 3.0 / 79% | 80% |
| 18M summer heat | 50% | 5.2 / 55% | 6.4 / 47% | 3.4 / 75% | 2.8 / 83% | 81% |
| 18M novice lifter | 51% | 5.2 / 55% | 7.2 / 43% | 3.3 / 78% | 2.8 / 82% | 77% |
| 18F HRV-norm mismatch | 49% | 7.1 / 43% | 6.5 / 47% | 5.2 / 56% | 3.5 / 76% | 75% |
| 25M losing 10 kg | 72% | 5.3 / 54% | 6.7 / 46% | 3.1 / 80% | 2.5 / 87% | 78% |
| 45M average | 11% | 5.3 / 55% | 6.8 / 46% | 3.3 / 77% | 3.6 / 73% | 80% |
| 70F average | 0% | 5.5 / 55% | 5.9 / 52% | 2.9 / 79% | 3.6 / 73% | 82% |

\*Composite computed before the "hide empty scores" rule. With strength dropped, it
behaves like the cardio + recovery rows.

**Improvement over Garmin-style cardio age (all people, same reference curve):**

| Scenario | Latest Garmin reading → age | v1 naive filter | **v2 final** | VO₂max accuracy (v2) |
| --- | --- | --- | --- | --- |
| 18M runner + lifter | 3.7 y | 3.6 y | **3.0 y** | 96.2% |
| 18M still injured | 8.5 y | 8.5 y | **4.0 y** | 96.2% |
| 18M gym only, no runs | no reading | 10.0 y | **5.3 y** | 93.3% |
| 18M + 5 km field test | 3.7 y | 3.6 y | **2.1 y** | 97.3% |
| 18M + lab test | 3.5 y | 3.4 y | **1.9 y** | 97.7% |
| 18M cyclist | 4.6 y | 4.5 y | **3.5 y** | 95.4% |
| 70F average | 10.0 y | 9.9 y | **5.5 y** | 93.0% |

### 9.6 Final accuracy estimate

For you (18-year-old man who runs and lifts, Garmin data only):

| Score | Typical error (true age above floor) | All 18M users incl. floor | Notes |
| --- | --- | --- | --- |
| VO₂max | **96% accurate** (MAPE ~3.8%) | | ~97.3% with a 5 km test, ~97.7% with a lab test |
| Cardio age | ±5.2 y (56% within ±5) | ±3.0 y (74%) | ±3.9 y with a field test |
| Strength age | ±6.7 y (46%) | ±3.7 y (70%) | **±3.1 y with a $25 grip dynamometer** |
| Recovery age | ±3.4 y (76%) | ±1.7 y (88%) | Precise, but its link to health is the weakest |
| **GRIND age** | **±2.8 y (83% within ±5)** | **±2.4 y (86%)** | **±1.7 y (96%) with a lab test + grip test** |

**What this does and doesn't prove:**
- The simulation shows the algorithm is close to optimal *given* the published error
  rates. It handles illness, heat, injury, weight loss, cycling and novice gains
  without breaking, and its 80% ranges hold about 75–88% of the time.
- It cannot show that real Garmin errors match the assumptions, or that the
  0.55/0.30/0.15 weights are right. Those weights come from published risk ratios,
  not from GRIND outcome data.
- GRIND age has the smallest error because averaging three partly independent
  estimates cancels noise. It is the most **precise** score. Cardio age is still
  the most **validated** one.
- The single biggest upgrade is one calibration: a 5 km time trial or a lab test
  for cardio, and a grip-dynamometer reading for strength.

### 9.7 Still to confirm before building
Everything in §8, plus:
- General-population lift norms by age and sex (or a grip-strength bridge), to set
  the strength z-scores.
- Overnight HRV norms for **Garmin** specifically. The Fitbit norms in Natarajan
  2020 are a different device and algorithm. The 18F mismatch row shows the risk:
  recovery error goes from 3.3 to 5.2 years.

---

## 10. Calibration plan (adopted)

Both calibrations go into the algorithm as **anchors**: measurements with a known
error that pin down the person-specific biases the wearables can't see by
themselves. A calibration is optional. Without one, the app shows the
"Uncalibrated" label and the wider ranges from §9.6.

### 10.1 Cardio: a maximal 5 km effort (or the Cooper 12-minute test)

**Protocol**
- Flat route or a 400 m track. Run all-out with even pacing, after a 10-minute warm-up.
- Air temperature under about 25 °C. Not on a night that was flagged sick or
  after alcohol (the same RHR/HRV gate as §5.2).
- Average HR at least 90% of your observed HRmax. This confirms it was a real
  maximal effort; a jog doesn't count.

**Auto-detection:** GRIND already syncs activity HR traces, speed and splits. Any
5 km run (or race) that meets the rules above is used automatically, with no manual
entry. It is shown to you as "Used as calibration ✓" so you can reject it.

**Conversion to VO₂max**
- 5 km time: the Daniels & Gilbert VDOT equations (race velocity and duration →
  VO₂ at race pace ÷ the fraction of VO₂max that duration can sustain).
- Cooper 12-minute test: VO₂max = (distance m − 504.9) / 44.73 (Cooper 1968).
- Treat the result as an anchor with **SD 2.5 mL/kg/min** (the simulation's value),
  widened to 3.5 if pacing was uneven (split SD above ~4%).
- Caveat: race-derived values track VO₂max well in practised runners but can
  underestimate it in people with poor running economy. In that case the filter
  weights Garmin and the anchor by their stated errors rather than trusting the anchor blindly.

**Lab CPET (optional, best):** enter it manually as an anchor with SD 2.0.

### 10.2 Strength: a grip dynamometer reading

**Protocol** (the standard Southampton protocol: seated, elbow at 90°, wrist neutral)
- Three attempts per hand, alternating hands. Score = the best single attempt.
- A Jamar-type hydraulic dynamometer, or a digital equivalent. Keep the same device
  each time.

**How it's used**
- Grip z against age- and sex-specific norms: Tomkinson 2025 for ages 20+, and
  Dodds 2014 lifespan curves for the 18–19 band.
- **Grip is the health-validated anchor. Your logged lifts track change between
  grip readings.** At each grip reading, GRIND learns your personal
  lift-to-grip offset. Between readings, strength age moves with your e1RM trend.
  This cuts the lift-mapping error from 0.5 SD to about 0.2 SD, the "±6.7 → ±3.1
  years" row in §9.6.

### 10.3 How long a calibration lasts

The personal biases drift: new watch firmware, a new HR strap, changes in running
economy or technique. So each anchor's weight fades over time instead of counting
forever.

| Anchor | Fully trusted | Fades to half weight by | Prompt to redo |
| --- | --- | --- | --- |
| 5 km / Cooper | 3 months | 6 months | Every 3–6 months, after 4+ weeks off running, or after a watch/strap change |
| Lab CPET | 6 months | 12 months | Optional, yearly |
| Grip | 3 months | 6 months | Every 3 months (takes 2 minutes) |

In the filter, this is process noise on the bias states (Garmin bias and the
lift-to-grip offset): about 1 mL/kg/min and 0.15 SD of drift per 6 months. The
confidence label steps back from "Calibrated" to "Uncalibrated" as an anchor fades.

### 10.4 What you'd see
- A label on each score: **Uncalibrated / Calibrated (field) / Lab-verified**, plus
  the date of the anchor.
- A short "Calibrate" card when an anchor is missing or stale. It names the test
  and the accuracy gain (for example "5 km test: cardio age ±5.2 → ±3.9 years").
- A first calibration that differs a lot from the current estimate (more than 2
  times its error) is shown as "Your Garmin was reading X high/low", not silently absorbed.

### 10.5 Data needed (not built)
- A calibration log: date, type (`run_5k | cooper | lab_cpet | grip`), raw value,
  derived value, error SD, source (`auto | manual`), and whether you accepted it.
- Auto-detect rules for 5 km efforts run over `garmin_personal_activities`.

---

## Sources
- Daniels J, Gilbert J 1979. *Oxygen Power: Performance Tables for Distance Runners* (VDOT equations).
- Cooper KH 1968. A means of assessing maximal oxygen intake: correlation between field and treadmill testing. *JAMA* 203:201–204.
- Roberts HC et al. 2011. A review of the measurement of grip strength in clinical and epidemiological studies: towards a standardised approach. *Age Ageing* 40:423–429.
- Kim Y et al. 2018. Combination of CRF and muscle strength, and mortality (UK Biobank). *Eur J Epidemiol*. [PMC6153509](https://pmc.ncbi.nlm.nih.gov/articles/PMC6153509/)
- Ruiz JR et al. 2008. Muscular strength and mortality in men. *BMJ*. [PMC2453303](https://pmc.ncbi.nlm.nih.gov/articles/PMC2453303/)
- Timpka S et al. 2014. Muscle strength in adolescent men and later CVD. *BMC Med*. [PMC4006633](https://pmc.ncbi.nlm.nih.gov/articles/PMC4006633/)
- Tomkinson GR et al. 2025. International norms for adult handgrip strength (2.4M adults). *J Sport Health Sci*. [PMC11863340](https://pmc.ncbi.nlm.nih.gov/articles/PMC11863340/)
- Dodds RM et al. 2014. Grip strength across the life course. *PLoS One*. [PMC4256164](https://pmc.ncbi.nlm.nih.gov/articles/PMC4256164/)
- van den Hoek DJ et al. 2024. Squat, bench and deadlift norms from 809,986 entries. *J Sci Med Sport*. [PubMed 39060209](https://pubmed.ncbi.nlm.nih.gov/39060209/)
- Isenmann E et al. 2026. Normalising barbell strength by sex, age and anthropometry. *Sci Rep*. [PMC13338387](https://pmc.ncbi.nlm.nih.gov/articles/PMC13338387/)
- Jensen MT et al. 2013. Resting HR, fitness and mortality (Copenhagen Male Study). *Heart*. [PMC3664385](https://pmc.ncbi.nlm.nih.gov/articles/PMC3664385/)
- Jarczok MN et al. 2022. HRV and mortality meta-analysis. *Neurosci Biobehav Rev*. [PubMed 36243195](https://pubmed.ncbi.nlm.nih.gov/36243195/)
- Natarajan A et al. 2020. HRV with PPG in 8 million individuals. *Lancet Digit Health*. [PubMed 33328029](https://pubmed.ncbi.nlm.nih.gov/33328029/)
- Nes BM et al. 2014. A simple nonexercise model of cardiorespiratory fitness predicts long-term mortality. *MSSE* 46:1159. [PubMed 24576863](https://pubmed.ncbi.nlm.nih.gov/24576863/)
- Nes BM et al. 2011. Estimating VO₂peak from a nonexercise prediction model: the HUNT Study. *MSSE*. [PubMed 21502897](https://pubmed.ncbi.nlm.nih.gov/21502897/)
- Loe H et al. 2013. Aerobic capacity reference data in 3816 healthy men and women 20–90 years. *PLoS One*. [PMC3654926](https://pmc.ncbi.nlm.nih.gov/articles/PMC3654926/)
- Loe H, Nes BM, Wisløff U 2016. Predicting VO₂peak from submaximal and peak exercise models: HUNT 3. *PLoS One*. [PMC4721596](https://pmc.ncbi.nlm.nih.gov/articles/PMC4721596/)
- Letnes JM et al. 2020. Age-related change in VO₂peak: the HUNT Study. *Prog Cardiovasc Dis*. [PubMed 32971113](https://pubmed.ncbi.nlm.nih.gov/32971113/)
- Fleg JL et al. 2005. Accelerated longitudinal decline of aerobic capacity in healthy older adults. *Circulation*. [PubMed 16043637](https://pubmed.ncbi.nlm.nih.gov/16043637/)
- Kaminsky LA et al. 2015 / 2022. FRIEND reference standards. *Mayo Clin Proc*. [PMC4919021](https://pmc.ncbi.nlm.nih.gov/articles/PMC4919021/), [PubMed 34809986](https://pubmed.ncbi.nlm.nih.gov/34809986/)
- Peterman JE et al. 2020. Global reference standards (FRIEND). *Mayo Clin Proc*. [PubMed 31883698](https://pubmed.ncbi.nlm.nih.gov/31883698/)
- Myers J et al. 2017. FRIEND reference equation for VO₂max. [PubMed 28377168](https://pubmed.ncbi.nlm.nih.gov/28377168/)
- Shvartz E, Reibold RC 1990. Aerobic fitness norms for males and females aged 6 to 75. [PubMed 2405832](https://pubmed.ncbi.nlm.nih.gov/2405832/)
- Welde B et al. 2020. VO₂peak among 14–19-year-olds. *Front Sports Act Living*. [PMC7739671](https://pmc.ncbi.nlm.nih.gov/articles/PMC7739671/)
- Kemper HCG et al. 2013. Aerobic fitness over 25 years (Amsterdam Growth Study). [PubMed 24214436](https://pubmed.ncbi.nlm.nih.gov/24214436/)
- Molina-Garcia P et al. 2022. VO₂max by consumer wearables: meta-analysis (INTERLIVE). *Sports Med*. [PMC9213394](https://pmc.ncbi.nlm.nih.gov/articles/PMC9213394/)
- Düking P et al. 2022. Garmin Forerunner 245 VO₂peak validity. *Int J Sports Med*. [PMC9286863](https://pmc.ncbi.nlm.nih.gov/articles/PMC9286863/)
- Engel FA et al. 2025. Forerunner 245 in highly vs moderately trained athletes. *Eur J Appl Physiol*. [PMC12881131](https://pmc.ncbi.nlm.nih.gov/articles/PMC12881131/)
- Carrier B et al. 2025. Garmin fēnix 6 VO₂max validation. *Sensors*. [PMC11723475](https://pmc.ncbi.nlm.nih.gov/articles/PMC11723475/)
- Laukkanen JA et al. 2022. CRF and all-cause mortality, 37 cohorts. *Mayo Clin Proc*. [PubMed 35562197](https://pubmed.ncbi.nlm.nih.gov/35562197/)
- Han M et al. 2022. CRF and mortality dose–response meta-analysis. *BJSM*. [PubMed 35022163](https://pubmed.ncbi.nlm.nih.gov/35022163/)
- Gonzales TI et al. 2023. Resting HR as a biomarker of fitness (Fenland). *PLoS One*. [PMC10174582](https://pmc.ncbi.nlm.nih.gov/articles/PMC10174582/)
- Spathis D et al. 2022. Longitudinal CRF prediction through wearables. *npj Digit Med*. [PMC9718831](https://pmc.ncbi.nlm.nih.gov/articles/PMC9718831/)
- Altini M, Plews D 2021. Resting HR and HRV changes in free-living. *Sensors*. [PMC8659706](https://pmc.ncbi.nlm.nih.gov/articles/PMC8659706/)
- Burtscher J et al. 2022. Training and VO₂max loss in masters athletes. [PMC9517884](https://pmc.ncbi.nlm.nih.gov/articles/PMC9517884/)
- Miller AC et al. 2025. PpgAge, a wearable aging clock (Apple Heart & Movement Study). *Nat Commun*. [PMC12537950](https://pmc.ncbi.nlm.nih.gov/articles/PMC12537950/)
- Garmin, "Viewing your fitness age" (device manual). [garmin.com](https://www8.garmin.com/manuals/webhelp/GUID-2492EDA1-1182-400B-8F43-D8B3211E4F3C/EN-US/GUID-A52C695F-A924-4421-B2F9-49C8BDEF65AE.html)
- the5krunner, Garmin Fitness Age review (secondary). [the5krunner.com](https://the5krunner.com/garmin-features/physiology/fitness-age/)
- NTNU CERG fitness calculator. [ntnu.edu/cerg/vo2max](https://www.ntnu.edu/cerg/vo2max)
