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
- A 2xx upload response that acknowledges none of the sent sets now backs off with a growing delay instead of retrying at a fixed one, and no longer advances the last-sync time.
- The plan cache rejects a malformed `/today` payload (wrong types, bad unit, a non-dictionary exercise) and keeps the previous plan, so a bad response can't wipe the day. An exercise with zero sets is left out rather than refusing the whole day.
- Undo persists the row and its slot before deleting it, so a crash mid-undo restores exactly one editable set. A correction keeps the set's ID, time and measured heart rate.
- Discard is stamped before cleanup starts, so an interrupted discard finishes on the next launch instead of uploading a partial workout.
- Recovery heart rate closes at the next set's START, and late samples can't become a 20-second peak or 60-second drop.
- A sensor stream that goes silent without another callback retires its count after six seconds, and a batch with a single dropped interval is rejected even when its average spacing looks normal.

## Rep accuracy

### Follow-up pass (late November 17)

The watch's own log showed `auto=null` for every set logged on the evening's builds. Two causes were found and fixed in the native app. The classifier's counting rules were left unchanged.

- **The count arrived too late.** The settled analysis took about 100 to 200 bounded steps, and the worker allowed only 6 ms of work per 50 ms timer period. Each step costs about 3 ms in the simulator and more on the watch, so a count often wasn't ready when START was pressed. Once the wrist is still, the worker now spends up to 30 ms of each period (40 steps at most). A step is bounded work of a few milliseconds, so a callback stays far below the watchdog. Mid-lift previews still take one step per period. Replaying 36 labeled sets through the native code in the simulator, the first AUTO number after the last rep moved from a median of 2.95 s (90th percentile 3.92 s, worst 4.56 s) to 1.93 s (2.42 s, 2.76 s). About one second of that is the sensor batch needed to confirm the wrist is still. Counts were identical before and after.
- **A glance blanked the number.** The previous pass withdrew any offer when motion settled, so raising the wrist to read the count replaced it with CHECKING. A count from a settled analysis now stays on screen through one or two moving batches while it is re-checked. A count from a mid-lift preview is still withdrawn at settle, because it can miss the last rep. `testSettledCountSurvivesGlance` covers both.

Where the remaining errors come from: on the RecoFit recordings, most wrong offers are one rep short, and in each case examined the missing rep is the **first** one. The labeled sets begin abruptly at rep one and the swing detector starts mid-swing, so the first half-rep is too small to pass. A rule crediting a truncated first half-rep raised held-out exact counts from 15 to 18 and cut wrong offers from 19 to 14. On the synthetic benchmark it raised wrong offers on wrist-visible lifts from 5.6% to 8.7%, because the wrist lowering after START became a rep. That breaks the counter's first rule (a wrong number is worse than none), so it was not shipped. Leading in with more still samples did not help either. In real use, the motion before rep one usually gives the detector a clean start, so the dataset likely overstates this error. A counted set on your own wrist is still the best evidence.

Native replay of the 36 development-split sets, value shown once the wrist settles:

| Outcome | Sets |
| --- | ---: |
| Exact | 11 |
| One short or over | 9 |
| Two or more off | 5 |
| No count offered | 11 |

`tools/replay-recofit.py` and `tools/replay-driver.mc` rebuild this replay from the pinned RecoFit export.

### First pass

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

## Bug and edge-case audit

Each scenario is an automated simulator test unless noted. All pass on this build.

| Scenario | Expected | Test |
| --- | --- | --- |
| START on weight, START on reps, START to finish | Focus moves to reps; the set window opens without logging; finish logs what was on screen and starts rest; the last set opens the summary | `testExplicitSetWindow` |
| App killed with a set open | Resumes on the same set, counted manually, finishable | `testExplicitSetWindow` |
| Rep press before the screen redraws | Each press counts; finish saves the newest manual edit | `testDisplayedRepCorrections` |
| Double-press finish on a zero-rest exercise | Logs one set, not two | `testDisplayedRepCorrections` |
| New estimate arrives just before finish | The number on screen is saved, not the unseen one | `testDisplayedRepCorrections` |
| Glance at the watch after the set | AUTO number stays visible during the re-check | `testSettledCountSurvivesGlance` |
| Counting switched off then on mid-set | That set stays manual; the next set counts | `testRepSettingsDuringSet` |
| Sensor drops a batch, delivers late, goes silent, or never starts | Late batches get a grace period; a gap withdraws the count; silence retires it; the label never sticks on WAITING | `testRepSensorGap`, `testSensorDeliveryFailures`, `testRepSensorCallbackFlow` |
| Glance, fidget, too little data, full 75 s buffer | A glance isn't a rep; fidgeting and short data give no count; long sets still count with bounded steps | `testRepsGlanceIsNotARep`, `testRepsFidgetSaysNothing`, `testRepsTooLittleData`, `testRepsFullBufferTime`, `testRepsRollingWindow` |
| Analysis outlives its set | A new set cancels it; work runs on a timer, never in a sensor callback | `testLiveRepAnalysis`, `testWorkoutScreensDoNotExhaustTimers` |
| Rest expires while the app is closed | Resume moves to the next set and records only the scheduled rest | `testRestRecoveryAndStrayInput` |
| Stray rest or set button after finishing | Ignored; no workout restarts | `testRestRecoveryAndStrayInput` |
| Undo, then crash before saving the correction | Exactly one editable row comes back with its ID, time and heart rate | `testUndoSet`, `testInterruptedUndoAndCorrection` |
| Crash during discard | Cleanup resumes; nothing partial uploads | `testInterruptedDiscard` |
| Malformed plan from the server | Previous plan kept; a zero-set exercise is dropped | `testMalformedPlanKeepsCache` |
| Upload returns 2xx but acknowledges nothing | Backs off and keeps the sets pending | `testMissingUploadAcknowledgment` |
| 12-hour workout heart-rate trace | Stored in chunks, restored, deleted with the workout | `testLongHeartTrace` |
| Next set starts during recovery | Recovery closes at its observed peak | `testRecoveryEndsAtNextSet` |
| Five sets, menus, skipped and adjusted rest, Save, Home | Completes with no errors | Simulator demo tour (`TOUR`) |

Not testable off the wrist: haptics, rep counting on your own wrist, Garmin Connect activity creation, a phone-mediated upload of this build, and a background wake.

## Verification

- Follow-up pass: all 40 native simulator tests passed, the demo tour completed with no failures, and all 620 repository tests passed. The watch's crash log has no entries after 7:54 PM; all seven watchdog crashes predate the commit that bounded the analysis.
- First pass: all 30 native simulator tests passed, including set start and finish, correction and undo, interrupted workout recovery, storage and upload payloads, rest, summary, heart-rate math, the 12-hour trace round trip, rolling motion windows, missing samples and timer limits.
- The offline simulator tour exercised five sets across three exercises, button input, a workout menu, adjusted and skipped rest, the summary, Save, and return to Home.
- All 620 repository tests passed, including 57 watch API and body tests in a targeted run. Production authenticated GET requests to ping and today's plan both returned HTTP 200. The watch's prior log showed an accepted workout upload and a successful background daily sync.
- The attached watch exposed seven historical watchdog crashes in `CIQ_LOG.BAK`. Its latest logged press and row sets had no automatic count. No labeled workout on the new release was available during this audit.
- The scratch watch API database now records cron job registrations in a fixture when PostgreSQL lacks the scheduling extension. This lets the real migrations and watch database tests run without dispatching hosted cron jobs.
- Physical haptics, on-wrist rep counting, Garmin Connect activity creation, a fresh phone-mediated upload, and a scheduled background wake on the new build require use after USB disconnect.
