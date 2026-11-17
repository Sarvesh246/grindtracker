# GRIND Health: research and implementation plan

Research date: November 16, 2026. Status: proposed implementation; no application, watch, database, or production changes made for this research.

## Recommendation

Build a dedicated **Health** experience at `/progress/health`, reached from one spacious entry on Progress. Keep the existing navigation unchanged. Keep Charge on Home, training load on Progress, and workout heart-rate insights with the workout. Each summary should link to the relevant detail within Health.

Use two complementary data paths: the existing Connect IQ watch app for workout detail and periodic available watch history; Garmin Connect APIs for richer all-day and overnight records. For the owner's personal pilot, investigate the official Personal API first. For a public integration serving GRIND users, use the business developer program. Ship daily sleep as part of the first complete Health release when the connected source supplies it.

The product promise is: **understand your day, see what changed, and know what you could do next**. The interface should remain useful without opening the full page every day.

## What the reference products do

### WHOOP

WHOOP's core loop is continuous wear, interpretation, daily guidance, and behavior change. Sleep, Recovery, and Strain give users a few concepts to follow over time. Baseline building is an explicit part of onboarding, rather than every insight being available immediately. [Official explanation](https://www.whoop.com/us/en/how-it-works/).

Its Health Monitor puts vitals together, compares them with the person's typical range, and lets the user drill into individual readings. The official illustration inspected for this research uses large numbers, restrained dark surfaces, and small range/status labels. It is an older published example, not evidence of the exact current paid app layout. Importantly, the monitor's baseline status and recovery readiness represent different things. [Health Monitor](https://www.whoop.com/us/en/thelocker/health-monitor-feature/).

Borrow the hierarchy and personal comparisons. Do not treat WHOOP's proprietary scores as formulas available to reproduce, or its feature list as evidence that Garmin exposes the same inputs.

### Fitbit Air / Google Health

Fitbit Air moves interaction to the phone: activity and sleep are tracked on the band, with Bluetooth sync and review in Google Health. The documented data includes sleep stages and daily movement, with personal coaching available through Premium. [Air setup and capabilities](https://support.google.com/googlehealth/answer/17033101?hl=en).

Google's current coaching experience separates Today, Fitness, Sleep, and Health. Today surfaces timely observations and quick replies; deeper tabs explain history and plans. The official screenshots inspected show a compact summary at the top, a conversational feed below, embedded activity cards, and an Ask Coach entry. [Google Health Coach announcement and screenshots](https://blog.google/products-and-platforms/products/google-health/google-health-coach/).

Borrow contextual explanations and easy follow-up questions. GRIND already has Coach G, so Health should pass richer evidence to that coach rather than introducing a second assistant.

### Garmin CIRQA / Garmin Connect

CIRQA is a screen-free collection device whose health and activity experience lives in Garmin Connect. Garmin documents sleep stages, sleep score, HRV, respiration, Body Battery, stress, and recovery/training features; availability on CIRQA does not establish availability on the Forerunner 165. [CIRQA announcement](https://www.garmin.com/en-US/newsroom/press-release/wearables-health/meet-cirqa-smart-band-the-screen-free-health-and-fitness-tracker-from-garmin/).

Connect distinguishes larger In Focus information from smaller At a Glance cards, with configurable priorities. That supports keeping useful summaries around GRIND while putting detailed analysis elsewhere. [Connect home organization](https://support.garmin.com/en-US/?faq=35qboQSvKC2WpKkTaDaRP7).

Active Intelligence adds explanations to the underlying health/activity data and updates insights throughout the day in the app. This is a useful model for GRIND's interpretation layer; importing Garmin's AI text is not assumed available through its APIs. [Active Intelligence](https://support.garmin.com/en-US/?faq=kWi5DoaMPZ4VCJBA0lFWP7).

### Shared design conclusion

Lead with a small number of decisions, then let users explore the evidence. Use distinct visualizations for different questions: an energy timeline, a sleep-stage timeline, a baseline range, and a weekly load comparison. Avoid turning every metric into another circular score.

Research scope: official product pages, support documents, developer documentation, and two official published app illustrations. No hands-on access to authenticated competitor apps or the user's watch was performed.

## What already exists in GRIND

These findings were verified in the local checkout, not on production:

| Area | Existing implementation | Implication |
| --- | --- | --- |
| Watch | `watch/manifest.xml`, `watch/README.md`; Forerunner 165 Music only | Plan against `fr165m`, not generic Garmin capability |
| Workout physiology | `Hr.mc`, `Recorder.mc`, watch session API | Preserve traces, zones, per-set peaks, and recovery readings |
| Daily physiology | `Body.mc`, `POST /api/watch/v1/daily` | Body Battery/stress series and scalar daily snapshots already exist |
| Persistence | `docs/sql/59-body-data.sql`, `daily_body`, `body_prefs` | Extend compatibly; do not replace working workout storage |
| Interpretation | `src/lib/body/charge.ts`, `load.ts`, `day.ts` | Reuse the domain boundary; improve evidence and freshness |
| Presentation | `ChargeRing`, `TodaySheet`, `LoadGauge`, `HeartbeatRibbon`, `FitterLine` | Keep useful contextual surfaces and deepen their links |
| Coach | `src/lib/coach/bodyContext.ts` | Health evidence already has a route into Coach G |
| Privacy | Health-data deletion and Coach-use preference in settings | Expand these controls to new sources and derived records |

Current collection is foreground-only: daily upload on launch and approximately every 15 minutes while open, outside workouts. The manifest has no Background permission or service delegate. Opening GRIND on the phone cannot itself make the closed watch app collect/upload data.

The local documentation records a previous watch probe finding empty respiration/SpO2 history. That is historical repository evidence; it was not re-tested here. The snapshot may contain a current SpO2 scalar, which must not be presented as an overnight average.

Current Charge combines Body Battery, recovery time, resting HR deviation, and a load comparison using fixed weights. It is a heuristic, not a validated recovery model. The current shared summary hook loads on mount; it needs account-safe refresh on focus, reconnection, date change, and completed ingestion.

## Where it belongs

### Progress entry

Use `/progress/health`, with page title **Health** and a clear Back to Progress action. This keeps Progress selected in the existing navbar automatically, and the nested page stays out of the top-level swipe sequence.

Add one Health entry to the Progress overview area, next to the existing progress-photo entry in the desktop rail and as a separate full-width row on mobile. Give it approximately 80–100 px of natural height, comfortable padding, a subtle timeline motif, one sentence, and a trailing arrow. Final dimensions depend on visual checks.

Example content: **Health & recovery** / “Last night's sleep and your daily recovery” / “View health”. When data exists, use one useful summary such as sleep duration and a freshness label. Do not insert a second dashboard into Progress or squeeze health controls into the exercise selector/chart.

Keep the entry reachable in Progress's no-exercises branch. A person can have sleep and daily-health records before logging any GRIND workouts. A failed health read must show a retry state, not a connect-watch prompt.

### Dedicated page composition

1. Header: Health, selected date, source/connection status, last measured/synced status.
2. Daily brief: a short evidence-based explanation, up to three supporting facts, one optional action, and Ask Coach.
3. Recovery: existing Charge, its contributing measurements, coverage, and an expandable explanation. Distinguish morning readiness from current Body Battery.
4. Sleep: last night's duration, provided score, bedtime/wake time, and stage timeline when supplied. Link to `/progress/health/sleep`.
5. Your day: Body Battery and stress over time, with workouts and sleep intervals marked where timestamps support it.
6. Metrics: resting HR, overnight HRV, movement, recovery time, and optional respiratory/SpO2/VO2 max values. Show only available metrics, with source and period.
7. Trends: 7/28/90-day views, explicit coverage, and relevant comparisons.

Allow metric detail at `/progress/health/metrics/[metric]`; validate the metric against an allowlist. Deep links may include a validated date. Chart interaction must not trigger tab swipes. Preserve browser Back behavior and the user's Progress selection/scroll position.

Use GRIND's existing typography and dark/lime palette, generous section spacing, large primary values, and restrained semantic color. Animate state changes lightly; do not continuously pulse charts. Provide chart text/table alternatives and labels that do not depend on color. Honor reduced motion and iOS safe areas.

### Distributed insights

| Surface | Keep or add | Full detail destination |
| --- | --- | --- |
| Home | Charge ring and concise daily guidance | Health recovery section; preserve quick sheet with View all health |
| Progress | Existing training-load summary and Health entry | Health training trends |
| Pre-workout | One relevant recovery/sleep observation when fresh and useful | Evidence detail; any workout adjustment uses existing preview/confirm flow |
| Active workout | Existing HR and smart rest | Workout physiology detail |
| Past workout | Trace, zones, set peaks, session interpretation | Session-specific detail |
| Coach G | Answer sleep/recovery/activity questions with current evidence | Selected date/metric links |
| Settings | Connections, sync status, consent, export/delete | Account controls |

Do not repeat the same brief across every screen. Home answers “how am I today?”, Progress answers “how am I changing?”, and workout views explain the current or completed session.

## Detailed UI and UX specification

This section is the proposed design specification, not a claim that these screens have been built or tested. Its purpose is to make the implementation visually intentional and reviewable. Use the reference apps' clarity and depth as the benchmark, while giving GRIND its own cohesive experience.

### Experience goals and information hierarchy

Design for three levels of attention:

| Time available | Question the interface should answer | UI response |
| --- | --- | --- |
| About 5 seconds | How am I doing today? | One daily headline, a short explanation, and the most relevant measurements |
| About 30 seconds | What changed, and what should I pay attention to? | Sleep summary, recovery contributors, and a readable day timeline |
| A few minutes | What does this number mean, and how has it changed? | Metric details, personal comparison, history, provenance, and Coach follow-up |

These are usability targets to test, not measured results. Every major visualization must have a sentence that communicates its main observation without requiring chart literacy. A person should never need to know what HRV stands for to understand the daily brief.

Use this disclosure order consistently: **observation → personal comparison → possible meaning → optional next step → underlying evidence**. Keep uncertainty next to the interpretation it qualifies. Do not make users open a methodology document to discover that a reading is old or estimated.

### Visual direction and design tokens

The direction is calm, precise, and athletic: charcoal surfaces, expressive but controlled type, large legible measurements, and lime used where attention is useful. Make the data itself the visual centerpiece. Avoid decorative ECG waves, stock wellness photography, glowing orbs, glass panels on every section, and decorative charts unrelated to actual observations.

Preserve the existing theme system in `src/app/globals.css`; introduce only documented health-specific extensions. The page must feel like a considered part of GRIND in both themes.

| Element | Proposed treatment |
| --- | --- |
| Background and surfaces | Existing `--bg`, `--surface`, and `--surface-elevated`; one surface step per hierarchy level; existing light-theme equivalents |
| Brand emphasis | `--accent` for selected controls/marks, `--accent-text` for readable accent text; never lime body paragraphs |
| Status | Existing warning/danger tokens only where their meaning warrants them; an unusual baseline reading is not automatically a red emergency |
| Display typography | Bebas Neue for the Health title and limited primary numerals, following existing GRIND identity |
| Explanation typography | DM Sans, sentence case, 15–16 px body with roughly 1.5 line height; medium-weight short headlines |
| Measurements | Tabular figures; primary duration/readiness approximately 40–52 px, secondary values 24–28 px; JetBrains Mono selectively for exact chart readings |
| Labels | 12–13 px supporting text; units subordinate but legible; no essential information below 12 px |
| Spacing | 4/8/12/16/24/32 px rhythm; 16 px mobile gutters, 20 px panel padding where space permits, 28–32 px between major sections |
| Shapes | Existing 16 px outer panel radius, 12 px nested controls, 8 px compact elements; pills reserved for filters and brief contextual facts |
| Depth | Border or tonal separation, using existing theme shadow behavior; no stack of competing heavy shadows |
| Icons | Match the app's current stroke style and optical size; pair unfamiliar symbols with text |

Use semantic data colors sparingly: lime for energy, muted neutral marks for movement, and a dedicated coordinated sleep palette if required for stage differentiation. Define accessible light/dark tokens for sleep stages, validate them visually, and pair color with named lanes/labels. Do not reuse the existing zone-5 coral token for unrelated sleep or stress meanings. Line styles and labels must distinguish series in monochrome too.

### Progress entry: a quiet invitation

Treat the Health entry as a destination row, with the same visual weight as the progress-photo entry, rather than a collection of miniature widgets. On mobile, place it after the photo entry and before the exercise selector, separated by 12–16 px. On desktop, place it beneath the photo entry in the existing overview rail; do not add a new sidebar.

Composition: small health glyph, **Health & recovery**, a single useful line, and a trailing chevron. The whole row is one accessible link; do not nest buttons inside it. An optional small sparkline must represent real data and remain secondary to the text. Omit it at narrow widths rather than squeezing the title.

State-specific example lines:

- Connected with sleep: “7h 18m sleep · Recovery looks steady”.
- Connected without a new night: “Your daily recovery and activity”.
- Delayed data: “Last reading yesterday at 8:42 PM”.
- Not connected: “Connect your Garmin to see your daily picture”.
- Failed read: “Health is temporarily unavailable” with a retry inside the destination page.

All figures and interpretations here and below are illustrative copy, not user measurements. Choose one short supporting line at runtime; the row should not grow into a paragraph or displace the exercise controls with a large hero.

### Health overview: mobile composition

Use a single vertical reading flow. At approximately 390 × 844 px, aim to show the header, complete daily brief, and the beginning of the sleep section before scrolling. Never achieve this by truncating essential copy or fixing panel heights; text scaling and smaller devices take precedence.

```text
‹ Progress                     Health
Today, Mon 16                  [calendar]
Garmin · Latest reading 8:42 AM

YOUR DAILY PICTURE
Steady for today
Your resting heart rate is close to usual.
You slept 38 minutes longer than your recent average.

[Charge 72]  [Sleep 7h 18m]  [Resting HR near usual]
Why this summary                       Ask Coach

LAST NIGHT                         View sleep ›
7h 18m                         Sleep score 81
11:24 PM — 7:12 AM
[stage timeline with labeled time axis]
38 minutes longer than your recent average

RECOVERY
Morning Charge and contributing measurements

YOUR DAY
[Body Battery timeline]
[aligned stress intervals and workout marker]

YOUR METRICS
Readable rows with personal comparisons

PATTERNS OVER TIME
One selected metric, one useful comparison
```

This order refines the earlier composition list: integrate the initial Charge summary into the daily brief, give sleep an early position, and put the expanded recovery explanation below sleep. Show the large Charge visualization once in the recovery section; the brief uses a compact value rather than a duplicate ring.

The header contains a clear return link, selected date, and calendar access. A source/freshness line opens connection details; it is not an intrusive warning strip. Once scrolled, a compact sticky header may retain Back and date only, approximately 52–56 px plus the safe area. No sticky section tabs, second navigation bar, or fixed Health action bar. Leave room above the existing bottom navigation and Coach orb.

The calendar opens a small date sheet with days carrying subtle available-data indicators. Provide explicit previous/next-day buttons with accessible names; future days are unavailable. Changing the date updates all date-dependent sections atomically, labels historical briefs with their date, and preserves the selection in the URL. A 7/28/90-day control belongs to the trends section, not beside the daily date where its scope would be ambiguous.

### The daily brief: interpretation with evidence

Use an open editorial block or one softly elevated panel with a small eyebrow, a 22–28 px sentence-case headline, at most two short explanatory sentences, and up to three compact supporting facts. The brief should feel authored and personal, without becoming a chat transcript or an endless AI feed.

Rank facts by relevance and coverage. For example, a fresh sleep deviation can matter more than a routine step count. Do not fill all three slots merely because space exists. When signals disagree, say so: “Your sleep was shorter, while resting heart rate stayed near usual.” When there is insufficient data, lead with the useful observation that exists instead of inventing an overall verdict.

“Why this summary” expands an inline evidence list: reading, date/period, comparison, and source. Show a concise “Generated explanation” attribution within that disclosure when AI wrote the narrative; do not decorate every value with an AI badge. If health AI use is off, the same layout works with deterministic explanations.

“Ask Coach” opens the existing Coach with the selected date and evidence context. Show an editable suggested question such as “What changed in my recovery today?”; do not automatically send a chat message or consume a message allowance. If no contextual question is relevant, use the normal Coach entry.

### Sleep overview and detail

The overview panel's focal point is total sleep, with supplied score secondary. Show actual sleep duration separately from the bedtime-to-wake interval, which can include awake periods. Use “Last night” only when referring to the relevant recent main sleep; historical records use an explicit date. A nap-only day should say “Nap recorded” rather than presenting the nap as a full night.

Sleep detail at `/progress/health/sleep` follows this sequence:

1. Selected night and duration, then a plain-language comparison with the user's recent nights.
2. Stage chart when interval data exists, with time in bed and awake time separately labeled.
3. Stage totals as calm rows: Awake, REM, Light, Deep, each with duration; percentages optional in an expanded view with the denominator stated.
4. Bedtime/wake-time consistency over a week, with a readable sentence; handle overnight times correctly.
5. Overnight resting HR/HRV/respiration/SpO2 only when that night's source actually provides them.
6. One relevant explanation or Coach prompt, then source and measurement details.

Render the stage chart as four labeled horizontal lanes sharing a time axis. Use step changes at recorded transitions, a readable legend, sparse axis labels, and visible missing intervals. Tap selects an interval; press-and-drag scrubs horizontally after the gesture is established, while vertical gestures retain native page scrolling. A fixed-height reading area above the plot reports stage, time, and interval length so the tooltip never covers the chart or jumps the layout. Keyboard users can step through intervals; a text table provides equivalent information.

When only stage totals exist, use labeled proportional bars, not a fabricated overnight timeline. If no score is provided, the duration still occupies the panel naturally without an empty score ring. Describe stages as the wearable's estimates in the detail explanation; avoid declaring a night good or bad solely from a stage percentage.

### Recovery and day timeline

Recovery should clearly separate **morning Charge** from **Body Battery at the latest reading**. Label their measurement periods beside their values, and explain the difference in one sentence on first expansion. Do not use two visually identical large rings that suggest they measure the same thing.

Use the existing Charge ring as the single principal circular visual, approximately 112–136 px on mobile when space allows, with a short interpretation beside it. Under it, show contributors as rows with their actual measurements, personal comparisons, and an expandable explanation of contribution/coverage. Keep formula weights in the methodology disclosure. If the score cannot be supported, replace the ring with “Still building your picture” and show the available measurements.

For Your day, align Body Battery and stress as separate plots on one shared time axis. The top plot shows energy on its own clearly labeled 0–100 scale; the lower plot shows stress intervals with its own legend. A single vertical cursor synchronizes the readings, and workout/sleep annotations sit in a dedicated event lane. Avoid layering two filled areas over one another or making stress look like the mathematical inverse of energy.

Use straight or shape-preserving lines through observed points, with no spline overshoot or implied precision beyond the source resolution. Gaps remain gaps. Future time is blank. When the user selects a workout marker, show its name/time and a link to that workout. A sentence below may describe a measured energy change across an interval, but must not claim that the workout caused all of it.

### Metric rows and detail pages

The overview's metric section is a clean list with dividers and generous row spacing. Each row contains the plain-language name, current value and unit, period, a brief personal comparison, and an optional small sparkline. Prioritize resting HR, overnight HRV, daily movement, and recovery time; put less frequently useful measurements behind “More measurements”. Retain visible rows for previously supported metrics temporarily missing today, with “No reading today” rather than silently shifting the whole layout.

Each metric detail page uses the same grammar: value/period → one-sentence meaning → 7/28/90-day chart → comparison/coverage → related observations → definition/source. Chart view selection must identify whether a mark represents an average, latest value, or daily total. A baseline band means the person's usual range and must be labeled as such; it is not a clinical normal range.

| Raw input | User-facing explanation | Evidence presentation |
| --- | --- | --- |
| Resting HR 58; comparable baseline 55 | “3 bpm above your usual” | Current point, personal range, baseline period |
| Overnight HRV below the user's established range | “Lower than your recent nights” | Nightly trend and range, with HRV definition on demand |
| Sleep 7h 18m; comparable average 6h 40m | “38 minutes longer than your recent average” | Last night beside a labeled average and number of nights |
| Steps 8,412 at 4 PM | “8,412 steps so far” | Daily total with observation time; compare equivalent times only if supported |
| Body Battery changed from 82 to 46 | “Energy estimate fell 36 points over this interval” | Measured interval endpoints; source identified as Garmin |
| Training load increased versus the comparison period | “More training than your recent average” | Comparable periods and measured/estimated load labels |

No raw metric should automatically become a prescription. The explanation layer describes what is known; any suggestion respects coverage, context, and the separate algorithm rules below.

### Trends and discovery

Give Trends one chart at a time with a clearly labeled metric selector and 7/28/90-day control. Follow it with at most two supported observations, ranked by usefulness and recency. Each observation must show its comparison window and enough context to inspect the underlying dates.

Avoid unexplained percentage improvements, competing leaderboards, and an overall health age. Cross-metric observations such as sleep and next-day recovery must meet predefined sample/coverage requirements, disclose the number of comparable days, and use association language. Suppress weak patterns instead of filling an insight carousel. With insufficient history, show a useful progress message such as “6 recorded nights; more history will make comparisons useful,” without inventing a fixed promise of accuracy.

### Component states and interaction rules

| State | Visual and behavioral response |
| --- | --- |
| First connection | Composed introduction with one Connect Garmin action, three short benefits, and clear scope/consent; sample preview only if explicitly labeled |
| Loading first data | Stable skeletons matching real panel geometry; no fake numbers or full-screen blocking spinner |
| Refresh with existing data | Retain values and scroll position; small updating indicator; replace related values together when the new snapshot is ready |
| Delayed/offline | Keep the last available readings with their measurement date; explain refresh limitations near source status |
| Partial coverage | Plot known intervals; show a brief coverage label; avoid an overall verdict unsupported by the available inputs |
| Baseline warming up | Show readings immediately and explain that personal comparisons need more history; do not render zero scores |
| Metric unsupported | Omit it from default overview; explain capability in connection details rather than repeated empty cards |
| Previously supported but missing | Keep a quiet “No reading today” state with access to history |
| Sleep pending | “No sleep record received for this night yet” when pending status is known; do not promise Garmin is still processing without evidence |
| Import/read error | Local retry action with preserved older data; other sections remain usable |
| AI unavailable or disabled | Deterministic observations in the same layout, with no broken chat bubble or blocked metrics |
| Source conflict | Use the reconciled value consistently; allow source inspection; do not make users resolve technical conflicts just to read the page |

Use native page scrolling. No carousel is required to discover a core metric. All essential actions work by tap and keyboard; hover only enhances desktop use. Targets are at least 44 × 44 px. Use `data-haptic="light"` on ordinary supported controls, reserve heavier feedback for confirmed saves, and avoid haptics on every chart sample. Keep Coach's existing circle, drag, keyboard, and status-bar behaviors intact.

Motion should help orientation: approximately 120–180 ms press feedback, 180–240 ms disclosure transitions, and 240–320 ms restrained page/panel transitions when warranted. These are proposed timing ranges, subject to device review. Do not count numbers up on every visit, animate charts as if data were arriving live, hijack scroll, or delay reading behind entrance animations. Reduced motion uses immediate changes or brief fades. Prefer existing CSS/motion primitives; adding a motion library is not required.

### Responsive layout and accessibility

At narrow widths, stack everything and let contributor facts wrap; never squeeze charts and prose into side-by-side columns. Around 768 px and above, use a two-column composition where it remains readable: daily brief full width, sleep and recovery adjacent, day timeline full width, then metrics and trends. Keep DOM reading order aligned with the mobile narrative. Respect the existing app shell's maximum width; the content should not stretch across a large monitor.

At 200% text size, controls wrap, panels grow, and the page remains fully readable. Test VoiceOver reading order, keyboard focus restoration after date sheets/Coach, text contrast, meaningful focus indicators, and accessible chart summaries. Do not announce every scrubbing sample to screen readers; provide deliberate keyboard reading controls and a table alternative. Anomaly status always includes words, not just colored dots.

### UI implementation deliverables and acceptance

Before UI code is considered complete, produce reviewable screen designs for: populated Health overview, sleep detail, one metric detail, Progress entry in context, and the disconnected/partial/delayed states. Use a clearly synthetic fixture dataset so screenshots and previews never expose real health records. Apply the existing research references without copying their branding or inventing their proprietary scoring.

Plan reusable components around `HealthEntry`, `HealthDateHeader`, `DailyHealthBrief`, `SleepSummary`, `SleepStageChart`, `RecoveryBreakdown`, `DailyHealthTimeline`, `MetricRow`, `MetricDetail`, `HealthTrend`, and `HealthSourceStatus`. Share data selectors and fact formatting across Home, Progress, Health, and Coach so a value or explanation cannot disagree between surfaces. Keep domain calculations out of presentational components.

Validate at 320, 390, 430, 768, and 1280 px; include both themes, large text, a long exercise/workout name, missing metrics, and actual iOS PWA use. Check chart label collisions, Coach overlap, bottom safe-area clearance, date navigation, and preserved Progress state. Capture screenshots only after fonts and chart layout settle.

Usability acceptance requires someone unfamiliar with the metric vocabulary to identify the latest sleep duration, explain the main daily observation, distinguish current versus old readings, and reach the supporting evidence without assistance. They must also be able to find Health from Progress and return to their previous exercise without losing context. Iterate the layouts and wording if these tasks are confusing, even when the screens look polished.

## Always-on tracking: feasible architecture

Separate **watch measurement**, **upload**, and **interpretation**. Garmin already measures in the background through its firmware; GRIND does not need to keep a strength activity running all day. A network outage can delay upload while measurements remain on the device or in Connect.

### Path A: official Garmin Connect data

The live official program overview now documents a Personal API, separate from its business offering. Personal is pull-only; the business Starter tier is push-only with limited users and no historical data; Enterprise offers broader delivery/backfill options. [Program overview](https://developer.garmin.com/gc-developer-program/overview/).

The Personal API is explicitly for an individual's own data, not commercial applications serving multiple end users. A self-generated key obtains a 24-hour access token; no refresh token is issued, and keys have configurable expirations. [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/).

Its published API lists sleep detail/summaries, HRV, daily heart rate, stress/steps summaries, Body Battery, and daily-summary endpoints. Endpoint presence does not guarantee non-null data for this account/device. Garmin also publishes an official Python example client. [API reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/), [official client](https://github.com/garmin/connect-personal-api-python).

For the owner's pilot, build a server-only connector, validate actual responses, and poll within confirmed limits. Prefer a rate-limited refresh when Health opens plus scheduled catch-up through the existing hourly server dispatcher. This is eventual sync, not a real-time feed. Verify current hosting limits and upstream quotas before choosing the final schedule; no sub-daily cron expression should be added under the current repository's Hobby assumptions.

For general GRIND users, implement the approved business connection/consent flow and ingestion adapter. Data becomes available after the watch syncs to Garmin Connect; cloud ingestion cannot force that upstream sync. Program access, commercial conditions, quotas, exact payloads, and permitted historical windows are implementation gates. [Business Health API](https://developer.garmin.com/gc-developer-program/enterprise/health-api/).

### Path B: Connect IQ background uploads

Garmin supports temporal background events no more frequently than every five minutes. Services can be killed for resources and terminate if they do not exit within 30 seconds. Sleep/wake events correspond to configured times, not detected sleep records. The FR165 Music has a 65,536-byte background memory budget. [Background services](https://developer.garmin.com/connect-iq/core-topics/backgrounding/), [event API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html), [device reference](https://developer.garmin.com/connect-iq/device-reference/fr165m/).

Proposed starting cadence: 15-minute background attempts, with bounded retries and adaptive behavior after battery testing. Implement `Background` permission, a small annotated service delegate, bounded history reads, durable upload storage, and acknowledgments. Prove each required history API works in background on the actual firmware before committing to this path. SensorHistory's retention and sample spacing are device-dependent. [SensorHistory reference](https://developer.garmin.com/connect-iq/api-docs/Toybox/SensorHistory.html).

Use firmware history rather than a permanently running live sensor listener. Add all-day HR history only after probing its availability and retention. Upload through the supported communications path when connectivity permits; test the actual iPhone/Garmin Connect background behavior. Start with independent health batches rather than loading the whole workout queue into the background process.

Persist observations before network calls; delete only acknowledged records. Process a bounded amount of work per invocation, exit before the platform deadline, and retry later. Coordinate foreground/background writes using separate immutable records or another device-tested protocol. A whole-queue overwrite can lose data when both contexts run.

### Recommended combination

Cloud records supply sleep and fuller history. Connect IQ supplies GRIND workout detail and opportunistic recent daily data. Reconcile overlapping measurements by source, timestamps, and revision rules; never add duplicate step totals or count the same workout twice. The PWA displays server data and needs no always-running browser tab. A native phone companion is not a first-release requirement for these paths.

## Sleep implementation

The Forerunner 165 manual documents automatic sleep detection, duration, stages, score, and detailed Connect records. It also documents overnight HRV and a three-week calibration period for Garmin's HRV status. These capabilities justify investigating daily sleep imports, not promising identical fields through every channel. [Sleep manual](https://www8.garmin.com/manuals/webhelp/GUID-607F08F6-33FC-40BF-9727-84E54043D82D/EN-US/GUID-70D41BFB-2BB2-4933-BF95-47FF63140112.html), [HRV manual](https://www8.garmin.com/manuals/webhelp/GUID-607F08F6-33FC-40BF-9727-84E54043D82D/EN-US/GUID-9282196F-D969-404D-B678-F48A13D8D0CB.html).

Store a sleep session with provider identity, start/end UTC timestamps, source timezone/offsets, provider reporting date, main-sleep/nap classification, optional stage intervals and score, revision metadata, and final/provisional status when the provider supplies it. Associate main sleep with its wake date for display, retaining provider dates for reconciliation. Handle overnight shifts, travel, DST, overlapping records, and nights spanning midnight. Do not force every sleep session into a midnight-to-midnight record.

Display total sleep first; then score, stages, awake periods, and overnight measurements only when actually supplied. Show a real timeline if interval data exists; show totals if only stage totals exist. Missing stage data is not zero deep sleep. Keep naps distinct from the main night's duration, while allowing an explicitly labeled 24-hour sleep total.

Re-fetch recent nights on subsequent syncs because users/providers can revise them. Recompute affected trends and briefs after edits. Establish actual backfill limits during the connector spike; do not assume unlimited historical access.

Differentiate waiting for sync, no sleep recorded, unsupported source, disconnected account, partial night, and failed import. Do not infer sleep from a scheduled sleep-mode event or rising Body Battery. Daily sleep must appear without opening the watch's GRIND app when the cloud connection is working.

## Data and interpretation design

### Storage and API boundaries

Extend `src/lib/body` and introduce `src/lib/health` for source adapters, reconciliation, sleep, and connection management. Keep physiological calculations pure and shared by all surfaces.

Proposed records, with final migration numbers selected at implementation time:

- `health_connections`: owner, source, device, connection generation, scopes/capabilities, sync cursor/status, last success/error, revocation state. Keep credentials in server-only encrypted storage, outside exposed public tables and logs.
- `health_ingest_batches`: source/batch identity, captured/received times, payload version, processing outcome. Deduplicate retries transactionally and bound retained diagnostic payloads.
- `health_samples`: owner/source/device/metric, UTC interval, value/unit, sample kind, quality and source revision. Unique source identities and appropriate owner/metric/time indexes prevent duplicate samples.
- `sleep_sessions` and optional `sleep_stages`: interval records and source revisions as above.
- `health_daily_summaries`: canonical projections, coverage, freshness, baselines, and source provenance; preserve `daily_body` compatibility for existing readers during rollout.
- `health_insights`: evidence references, period, interpretation version, optional generated explanation, consent generation, and expiry/invalidation state.

Extend the watch contract with a versioned health-batch endpoint and per-batch acknowledgments, retaining the current `/daily` route for old watch builds. Server identity comes from the verified device token; never trust an uploaded user ID. Validate metric allowlists, bounds, timestamps, units, batch size, and date range. Reconcile delayed uploads by observation time rather than receipt time. Preserve nulls and legitimate zeros.

Replace fixed 96-slot storage for new data with UTC intervals; derive local-day chart buckets at read time. A DST day may have 23 or 25 hours. Legacy snapshots should retain their known resolution and uncertainty rather than inventing precise timestamps.

Keep external activities separate from GRIND set logs initially. Match duplicates using reliable provider IDs where available; uncertain matches need review. Do not award XP or create duplicate completed workouts from a health import.

Use owner-scoped reads and explicit grants/RLS on exposed tables; privileged ingestion must verify connection ownership. Existing health data remains private from friends, ranks, and share endpoints. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Freshness and coverage

Track `observed_at`, provider update time, and `received_at` separately. The UI's “latest reading” refers to measurement time. A successful empty sync must not refresh the apparent age of old physiology.

Quality states should include current, partial, delayed, unavailable, and building baseline. Define freshness by metric: a completed overnight record has different expectations from an intraday energy reading. Derive thresholds from the chosen ingestion cadence and measured latency during the pilot. Show gaps in charts; do not interpolate long missing periods or interpret missing samples as rest.

### Algorithms before generated language

Create deterministic facts first: sleep duration/consistency, resting-HR deviation, HRV trend, covered stress intervals, Body Battery change, and logged training changes. Compare like measurements from the same source and period. Prefer source-provided personal HRV status where available; a GRIND baseline must be separately named and versioned.

For GRIND-owned comparisons, a proposed starting rule is a rolling 28-day robust baseline with at least 14 sufficiently covered days. These are engineering defaults requiring pilot evaluation, not established clinical cutoffs. Avoid changing baselines merely because a new device or HRV method appears.

Preserve Charge's identity, but review its weights, missing-input behavior, freshness, and overlapping signals before extending it. Body Battery already combines HR/HRV, movement, stress, rest, and sleep influences; adding all those again can double-count information. [Garmin Body Battery explanation](https://www.garmin.com/en-US/garmin-technology/health-science/body-battery/).

The present load code labels a ratio range a sweet spot and makes injury/strength claims. Revise this wording before expanding its role: display training changes descriptively, distinguish measured HR load from duration estimates and strength volume, and do not imply a load ratio predicts injury. Published methodological analysis challenges that causal interpretation. [ACWR conceptual analysis](https://pubmed.ncbi.nlm.nih.gov/32502973/).

Do not market a new composite as validated readiness, infer overnight HRV from occasional HR readings, equate physiological stress with anxiety, or infer muscular recovery from cardiovascular load alone.

### Coach and proactive explanations

Build a structured evidence object containing date/timezone, measurements, source, coverage, comparison window, and permitted interpretations. Generate a short optional explanation from that object. Validate referenced numbers and dates against the evidence; fall back to deterministic copy if generation fails.

Suggested brief format: what changed, why it may matter, and one reasonable next step. Distinguish association from cause. User-provided context such as soreness, perceived sleep quality, or late caffeine may enrich interpretation but must remain labeled as self-report.

Extend `bodyContext.ts` with sleep, HRV, freshness, and coverage. Reuse Coach G and existing action previews. Generate briefs after meaningful data changes or on demand, cache by evidence/model/prompt version, and use a separate bounded summary budget so background summaries do not silently consume the user's 15-message chat allowance.

Respect `coach_uses_body` across briefs, chat, cached explanations, and in-flight requests. On account changes, disconnect, or deletion, invalidate data and pending work with account/connection generations. Deletion should pause ingestion so late jobs cannot immediately restore the deleted records; resuming collection must be explicit. Define separate controls for stopping future collection and deleting stored history.

Proposed retention: short-lived raw ingest payloads, 180 days of detailed intraday samples initially, and longer daily/sleep summaries with user export/delete controls. Confirm storage costs and actual user needs before fixing these limits. Expand deletion/export to summaries, insights, caches, credentials, and imported sleep while preserving workouts unless the user requests account-wide deletion.

## Delivery sequence and completion gates

| Phase | Concrete work | Completion evidence |
| --- | --- | --- |
| 0. Feasibility | Validate official Personal API access for owner, business path for public users, FR165 background APIs/retention, actual sleep payloads, quotas, and battery baseline | Capability matrix backed by redacted real responses and device logs; explicit missing fields |
| 1. Health destination | Build nested page, Progress entry, deep links, initial existing-data views and clear unavailable/error states | Browser checks at 320/390/430 px and desktop; navigation unchanged; accessible without exercise history |
| 2. Ingestion foundation | Add provenance/time-aware records, idempotent batches, compatibility projections, connection/consent controls | Migration/RLS tests, retry/reorder tests, zero duplication or cross-account reads |
| 3. Daily sleep and cloud | Import sleep, HRV and supported daily metrics; recent-night reconciliation; bounded scheduled/foreground catch-up | Real account sleep matches Connect dates/durations; updates arrive with GRIND watch app closed |
| 4. Watch background | Small service, durable local batches, bounded communications, source reconciliation | Multi-day physical FR165/iPhone run: connected/disconnected, reboot, battery saver, other activities, no lost workout sets |
| 5. Insights and Coach | Shared fact engine, baseline/coverage display, concise daily brief, contextual summaries | Numeric grounding checks, Coach eval, stale/missing/contradictory-data cases, action consent checks |
| 6. Release | Full regression gates, migration verification, flags, staged enablement and monitoring | Explicit local/CI/deployed/device evidence and rollback procedure |

Phases 1 and 2 can proceed while source access is being validated. A visual shell can ship independently, but the complete health feature should not be called finished until sleep and closed-app syncing work for supported connections. Watch background collection is a device-tested enhancement, not a dependency for all cloud sleep records.

### Required verification

- Domain tests: out-of-order/replayed batches, missing versus zero, source conflicts, stale readings, baseline warm-up, device changes, partial coverage, sleep revisions, nap overlaps, midnight, travel, and both DST transitions.
- Database tests: isolation, explicit grants, unauthorized writes, deletion/revocation, expired credentials, race-safe processing, compatibility with migrations 58/59, and retention cleanup.
- Watch tests: service memory/runtime, bounded queue growth, network loss/recovery, HTTP 401/429/5xx behavior, foreground/background concurrency, and preservation of workout saving.
- UI tests: no extra navbar item, Back/scroll restoration, chart scrubbing, empty workout history, long values, loading/error/offline states, dark/light themes if supported, reduced motion, and iOS PWA tap/haptic/safe-area behavior.
- AI evaluation: no fabricated sleep stages or measurements, no causal certainty from correlation, no unsupported PR/injury claims, no health context after opt-out, and deterministic rendering during provider failure.
- Repository gates: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, targeted Playwright, SQL parity, and migration checks appropriate to the actual changes. Read relevant bundled Next.js docs before implementing route/data changes. Run Coach eval before changing Coach behavior.
- Physical pilot: at least 72 hours including nights, a normal workout, disconnected periods, and an overnight sync. Compare battery drain with the prior build under similar use; choose cadence based on the measured difference rather than promising zero overhead.

### Rollout and observability

Separate flags for the page, cloud import, background uploads, and generated briefs. Apply new migrations before dependent code; preserve old readers/watch uploads while rolling forward. Roll back by disabling a source or interpretation layer without deleting historical data.

Measure ingestion success, newest observation age, coverage, queue backlog, revision processing, duplicate rejection, provider throttling, failed briefs, and query/payload cost. Alert on meaningful pipeline failures, not individual low recovery measurements. Do not log credentials or raw personal health payloads.

## Decisions still requiring live evidence

1. Personal API access and actual response shapes for the owner's Garmin account. No credentials were requested or used during research.
2. Business access and terms for serving other GRIND users; personal keys are not the public product architecture.
3. Background-readable FR165 metrics, retention, connectivity, and battery impact on the installed firmware.
4. Which sleep stages, scores, HRV, respiration, and SpO2 records are actually supplied for this device/account.
5. Final polling frequency, freshness thresholds, storage retention/cost, and source precedence after real-data comparison.

These are narrow implementation spikes, not reasons to block the page design. Keep capability-dependent content honest while validating the full collection path.
