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

### Accuracy pass (night of November 17)

The synthetic benchmark still scored the counter on a free-running buffer full of walking, drinking and pickups. Since the explicit START flow, the watch analyzes a window that opens with the wrist coming down from the screen and settles a second after the set. `tools/repsim.mjs` now models that timeline ("START window") and keeps the old one ("whole buffer") as a stress test. Changes were tuned on simulator seeds 151 to 300 and the RecoFit development split, then checked on seeds 1 to 150 and the RecoFit held-out split.

What changed in the counter (`tools/reps.mjs`, ported to `source/Reps.mc`):

- **START wrist movements are held still.** If a still second follows within 2.5 s of the window opening, everything before it is held at that position. Likewise, a still second within 1.5 s of the end holds the rest still. The wrist dropping from the screen had been merging into rep one, and the wrist rising to the screen into the last rep. A buffer cut by the 75 s rolling window is left alone, so a clipped set is still withdrawn.
- **One off-size rep no longer splits a set.** A single rep 1.5 to 1.8 times the usual size broke the rhythm chain in two, and only the longer half counted. A chain may now pass through one rep-like pair that misses the strict fingerprint, if it lands within 25% of the beat on both sides and the chain has at least four strict reps. Without that minimum, phantom three-rep chains appeared in no-set sessions.
- **A disputed last rep is settled instead of hidden.** When the normal and lenient edge rules differ by exactly one trailing rep, it counts if it returns within 12% of where it began, keeps within 1.3 beats, and is at least 0.65 of the usual size on the way back. Fatigued final reps pass. Failed reps, partials and reracks mostly don't.
- **Thresholds.** A rep must return within 50% of its size (was 40%), and core reps may be up to 1.6 times the median size (was 1.4). Both reduced wrong counts on the simulator and on RecoFit.
- **A glance can't take the count away.** Raising the wrist to read the screen turns the watch about 90 degrees, a gravity shift several times larger than a rep. In the simulator, recounting after such a glance dropped exact counts to about 50%. The re-check that follows a short movement (one or two moving seconds) after a settled count can now raise the count, never lower or clear it. This rule lives in the app, not the classifier. `testSettledCountSurvivesGlance` drives it with forced lower, absent and higher results.

Held-out simulator results, START window, wrist-visible lifts (150 sessions each):

| Lift | Exact | Shown wrong | Silent |
| --- | --- | --- | --- |
| curl | 84.7% → 90.7% | 3.3% → 2.7% | 12.0% → 6.7% |
| hammer curl | 84.7% → 92.0% | 2.7% → 3.3% | 12.7% → 4.7% |
| lateral raise | 88.0% → 91.3% | 5.3% → 3.3% | 6.7% → 5.3% |
| tricep pushdown | 71.3% → 80.7% | 2.7% → 3.3% | 26.0% → 16.0% |
| shoulder press | 53.3% → 74.7% | 15.3% → 8.0% | 31.3% → 17.3% |
| bench press | 36.0% → 59.3% | 13.3% → 9.3% | 50.7% → 31.3% |
| push-up | 62.0% → 72.0% | 4.7% → 2.7% | 33.3% → 25.3% |
| row | 58.7% → 66.0% | 9.3% → 6.7% | 32.0% → 27.3% |
| lat pulldown | 75.3% → 84.7% | 8.0% → 6.0% | 16.7% → 9.3% |
| pull-up | 60.7% → 74.0% | 3.3% → 2.7% | 36.0% → 23.3% |
| squat | 51.3% → 76.7% | 10.7% → 2.0% | 38.0% → 21.3% |
| deadlift | 57.3% → 68.0% | 9.3% → 5.3% | 33.3% → 26.7% |
| goblet lunge | 48.7% → 70.0% | 8.7% → 5.3% | 42.7% → 24.7% |
| crunch | 68.7% → 78.7% | 1.3% → 2.0% | 30.0% → 19.3% |
| sit-up | 84.7% → 88.7% | 6.0% → 6.0% | 9.3% → 5.3% |
| cable crunch | 76.0% → 84.7% | 4.7% → 4.0% | 19.3% → 11.3% |
| **All** | **66.3% → 78.3%** | **6.8% → 4.5%** | **26.9% → 17.2%** |

On the old whole-buffer timeline, exact counts went from 56.0% to 58.7%, wrong counts from 5.6% to 5.8%, and counts shown in no-set sessions from 1.8% to 2.0% (7 to 8 of 400). Leg press, leg extension and hanging leg raise remain correctly silent, since the wrist doesn't move.

RecoFit held-out (47 sets): exact 15 → 17, wrong 19 → 16. Most remaining RecoFit errors are one short, and the clips show it: each has 2R−1 complete half-swings, because the labeled boundary cuts half a rep off one end. The START window starts and ends with the arm at rest, so this cut can't happen in real use.

Port checks: the native `RepAnalysis` and `tools/reps.mjs` agree on count and confidence for all 36 RecoFit development traces and for 60 simulator sessions where the old and new counters disagree (so every new path is exercised). The longest single analysis step stayed 16 ms in the simulator, the same as before. The window trim runs once per analysis, about two thousand operations, and bridging adds a linear pass over the pairs. Streaming the 36 RecoFit traces through the live sensor path gave the same counts as before and a median wait of 1.93 s after the last rep.

Tried and rejected:

- Showing a count when the edge rules disagree in general: exact +2.4 points, wrong +4.3 points.
- Lowering the periodicity floor (0.60 → 0.50): those sets would be right only about 82% of the time, against about 93% for counts shown today.
- Crediting a truncated first half-rep: it fit RecoFit's clip boundaries but added phantom reps in the simulator.
- Trimming motion after a still second when the window ends still: no gain.

What still needs your wrist: the simulator's motions are idealized, and RecoFit is forearm data. Bench press stays the hardest, because the wrist barely rotates; it is silent on about a third of sets and wrong on about one in eleven.

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
| Glance at the watch after the set | AUTO number stays visible during the re-check; the re-check can add a rep but never lower or clear the count | `testSettledCountSurvivesGlance` |
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
| START wrist drop and finish wrist raise inside the window | Held still before analysis; the set itself untouched; a drop longer than 2.5 s left alone | `testTrimWindow` |
| Five sets, menus, skipped and adjusted rest, Save, Home | Completes with no errors | Simulator demo tour (`TOUR`) |

Not testable off the wrist: haptics, rep counting on your own wrist, Garmin Connect activity creation, a phone-mediated upload of this build, and a background wake.

## Verification

- Accuracy pass: all 41 native simulator tests passed, the demo tour completed with no failures, all 620 repository tests passed, and native and JS counters agreed on 96 of 96 parity traces.
- Follow-up pass: all 40 native simulator tests passed, the demo tour completed with no failures, and all 620 repository tests passed. The watch's crash log has no entries after 7:54 PM; all seven watchdog crashes predate the commit that bounded the analysis.
- First pass: all 30 native simulator tests passed, including set start and finish, correction and undo, interrupted workout recovery, storage and upload payloads, rest, summary, heart-rate math, the 12-hour trace round trip, rolling motion windows, missing samples and timer limits.
- The offline simulator tour exercised five sets across three exercises, button input, a workout menu, adjusted and skipped rest, the summary, Save, and return to Home.
- All 620 repository tests passed, including 57 watch API and body tests in a targeted run. Production authenticated GET requests to ping and today's plan both returned HTTP 200. The watch's prior log showed an accepted workout upload and a successful background daily sync.
- The attached watch exposed seven historical watchdog crashes in `CIQ_LOG.BAK`. Its latest logged press and row sets had no automatic count. No labeled workout on the new release was available during this audit.
- The scratch watch API database now records cron job registrations in a fixture when PostgreSQL lacks the scheduling extension. This lets the real migrations and watch database tests run without dispatching hosted cron jobs.
- Physical haptics, on-wrist rep counting, Garmin Connect activity creation, a fresh phone-mediated upload, and a scheduled background wake on the new build require use after USB disconnect.

## Telemetry pass (2026-11-18)

- Rep lab records now come from `Tape`: fixed ByteArray rings (about 1.9 KB an axis) holding the accelerometer and compass at 12.5 Hz, plus heart rate per second, beat intervals and step marks, encoded as base64 int16 at capture. A full record is under 30 KB, inside the 32 KB storage value.
- Taking over with UP/DOWN stops the counting but no longer the listener, so the sets that needed fixing are recorded whole.
- The compass and beat intervals are requested with the accelerometer and fall back to accelerometer-only if refused. Two sets with a broken stream while they're on switch them off until Rep lab is toggled.
- `Health` marks each run alive and clears the mark on a clean stop; the next start reports a run that died, with what it was doing. Each saved workout sends battery, peak memory, the longest counter step and upload outcomes.
- Worst case in the simulator (two minutes of curls through the real callback with every sensor on): peak 216 KB of the watch's 768 KB, 16 ms per sensor batch, 47-62 ms to capture. 47 native tests pass, the demo tour completes with no failures, and 633 repository tests pass.

## Readiness, lifting load and self-tuning (2026-11-18)

- **Readiness check** (`Readiness.mc`): 10 s settle, then 60 s of beat-to-beat intervals and accelerometer motion. Its maths matches `src/lib/body/hrv.ts` exactly on a shared fixture with a missed beat, a doubled one, out-of-range beats and a spike (RMSSD 20.4, 65 clean beats, 7.1% artifacts in both). The server recomputes from the raw intervals and its copy counts. Failure paths: no intervals after 15 s, a listener that goes quiet for 5 s, more than 10 s of movement. Only with no workout open, because the app gets one sensor listener at a time.
- **Per-exercise tuning**: four thresholds (`ac`, `cv`, `swing`, `lag`) are now module vars set by `Reps.configure` at each set start, validated with the same ranges and rounding as `cleanParams` in JS. Native vs JS counts were identical on 60 recorded traces with default settings and with two tuned sets, one of which changes a count.
- The simulator tour now walks the readiness intro, settle, measuring, good and poor results, and back to Home: no failures. 50 native tests pass, and the worst-case set peaked at 230 KB of the watch's 768 KB.
