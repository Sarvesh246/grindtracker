# Forerunner 165 Music audit

November 17, 2026. The watch ran firmware 29.05. Simulator and release builds targeted `fr165m` with Connect IQ SDK 9.3.0.

## Workout behavior

- START on weight selects reps. START on reps begins the set and its elapsed timer. The next START logs the displayed count and starts rest, or opens the summary after the last set. Subsequent sets of the same exercise open on reps.
- The accelerometer runs during the set. The label shows WAITING before samples arrive, TRACKING while collecting samples, CHECKING during analysis, AUTO for a usable estimate, and MANUAL when the user takes over or automatic counting is unavailable.
- Weight and rep edits persist. An interrupted active set can be finished manually on resume. Undo reopens a logged set for correction. Switching, skipping, finishing and discarding clear the motion window.
- A newer result arriving between the last screen draw and the finish press cannot silently change the confirmed number.

## Reliability fixes

- Long heart-rate traces use 1,024-sample storage chunks and a final tail. Older single-value records remain readable. The upload reconstructs the trace on the final batch. Session deletion cleans up the chunks.
- Heart-rate display refreshes no longer feed extra readings into the fallback average. Recovery waits for Resume before adding new heart-rate samples.
- Foreground daily sync records the success time after acknowledgment. A failed request can retry after two minutes. Transport exceptions release the foreground request or finish the background service, and HTTP 408 leaves the workout queued for retry.
- Removing an already-finished queue item yields before the next cleanup. A sample just before midnight can no longer enter today's first health bucket.

## Rep accuracy

The classifier extends the initial wrist position by one motion block, requires stronger periodicity, and rejects estimates that account for too little of a motion bout. The watch withdraws stale or rejected estimates. A short clear set still has to meet the existing rhythm and direction checks.

We compared the previous and updated reference algorithms on a three-exercise RecoFit export covering chest press, shoulder press and lateral raise. Each recorded set was evaluated separately. We averaged four 50 Hz accelerometer readings per axis into each 12.5 Hz sample, and supplied zero step increments because this export has no pedometer stream. We excluded incomplete records, missing or nonpositive repetition labels, and recordings longer than the watch buffer. Even subject IDs were used for development. Odd IDs were held back until the candidate was selected. Of 99 records, 36 qualified for development and 47 for held-out evaluation. These were right-forearm recordings with labeled set boundaries. [Microsoft RecoFit](https://github.com/microsoft/Exercise-Recognition-from-Wearable-Sensors) · [Pinned CSV export](https://github.com/erenalpckroglu/imu-repcognition/tree/e302cc2dd1907fde18c1999d966865b0a56c69dd/data)

| Held-out result across 47 sets | Previous | Updated |
| --- | ---: | ---: |
| Exact count | 12 | 15 |
| Incorrect estimate | 24 | 19 |
| No estimate | 11 | 13 |
| Within one rep, including exact | 31 | 30 |

Of the 34 estimates the updated algorithm offered, 15 were exact and 30 were within one rep. This falls short of high exact-count accuracy. The explicit start and finish boundaries address an additional source of error during actual use. Their effect on a lifter's own wrist needs an on-watch test.

The repository's synthetic benchmark had a different tradeoff. Across wrist-visible lifts, exact counts went from 59.0% to 56.0%, incorrect offers from 6.8% to 5.6%, and abstentions from 34.3% to 38.4%. The false-offer rate on simulated sessions without a set stayed at 1.8%. These are reference-algorithm scores. The native simulator tests separately exercise scheduled analysis and sensor-batch handling.

## Verification

- All 30 native simulator tests passed, including set start and finish, correction and undo, interrupted workout recovery, storage and upload payloads, rest, summary, heart-rate math, the 12-hour trace round trip, rolling motion windows, missing samples and timer limits.
- The offline simulator tour exercised five sets across three exercises, button input, a workout menu, adjusted and skipped rest, the summary, Save, and return to Home.
- All 620 repository tests passed, including 57 watch API and body tests in a targeted run. Production authenticated GET requests to ping and today's plan both returned HTTP 200. The watch's prior log showed an accepted workout upload and a successful background daily sync.
- The attached watch exposed seven historical watchdog crashes in `CIQ_LOG.BAK`. Its latest logged press and row sets had no automatic count. No labeled workout on the new release was available during this audit.
- The scratch watch API database now records cron job registrations in a fixture when PostgreSQL lacks the scheduling extension. This lets the real migrations and watch database tests run without dispatching hosted cron jobs.
- Physical haptics, on-wrist rep counting, Garmin Connect activity creation, a fresh phone-mediated upload, and a scheduled background wake on the new build require use after USB disconnect.
