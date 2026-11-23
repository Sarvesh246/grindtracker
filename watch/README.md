# GRIND for Garmin

Log your GRIND workout from your wrist. The watch pulls today's workout from
GRIND, you log each set with the buttons, and it syncs back through your phone
when it can. It also records a strength activity so the session and your heart
rate land in Garmin Connect.

Built for one watch: the **Forerunner 165 Music** (`fr165m`, 390x390 AMOLED).
The server side is documented in [docs/watch-api.md](../docs/watch-api.md).

## Quick start

You need the [Connect IQ SDK Manager](https://developer.garmin.com/connect-iq/sdk/)
with an SDK and the Forerunner 165 Music device downloaded, and Java.

1. **Token.** In GRIND go to Profile -> Settings -> Watch -> Generate token. Then:

   ```bash
   cp secrets/Secrets.example.mc source/Secrets.mc
   ```

   Paste the token into `source/Secrets.mc`. That file is gitignored.

2. **Signing key** (once, also gitignored):

   ```bash
   openssl genrsa -out key.pem 4096 && openssl pkcs8 -topk8 -inform PEM -outform DER -in key.pem -out developer_key.der -nocrypt && rm key.pem
   ```

3. **Build and run in the simulator.** `SDK` is your SDK's `bin` folder, e.g.
   `%APPDATA%\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.3.0-...\bin`.

   ```bash
   java -jar "$SDK/monkeybrains.jar" -o bin/grind.prg -f monkey.jungle -y developer_key.der -d fr165m -w
   "$SDK/simulator.exe" &
   "$SDK/monkeydo.bat" bin/grind.prg fr165m
   ```

> **Gotcha:** start the simulator before `monkeydo`, or it just prints its usage
> text. And in Git Bash, `monkeydo`'s `/t` flag gets rewritten into a path
> unless you prefix the command with `MSYS_NO_PATHCONV=1`.

## Put it on your watch

```bash
java -jar "$SDK/monkeybrains.jar" -o bin/grind-release.prg -f monkey.jungle -y developer_key.der -d fr165m -r -w
```

Plug the watch in over USB. It shows up in File Explorer as a media device (not
a drive letter). Copy `bin/grind-release.prg` into `Internal Storage\GARMIN\APPS`,
unplug, and GRIND appears in the watch's app list. Copying a newer build over
the old one updates it. Keep the same `developer_key.der`, or the watch treats
it as a different app and your stored data is gone.

## Using it

| Button | Does |
| --- | --- |
| START | Confirm weight, begin lifting, review the finished set, log it, or skip rest |
| UP / DOWN | Change the highlighted number, or add/remove 15 s of rest |
| BACK | Return from reps to weight during setup. Switch between weight and reps during review. Open the workout menu during lifting or rest. |
| Hold UP | Workout menu during setup, lifting, or rest: resume, undo last set, switch or skip exercise, end, discard |
| MENU on Home | Refresh, turn rep counting on or off, clear failed uploads |

A short white arc beside the START button means START does something on that
screen, the same cue Garmin's own apps use.

A new exercise starts with the weight highlighted. Press START to select
reps, and START to begin lifting. Later sets open with reps selected. Press
BACK from reps to change the weight. After lifting, press START to review.
Use UP/DOWN to edit reps, or press BACK to edit weight. Press START again to
log the set. Rest is timed from when you finished lifting. Logging the final
set opens the summary. You can also tap a number to select it and adjust
with the on-screen minus and plus or an up/down swipe.

Reps prefill to the top of the target range (8-12 starts at 12), and the full
target is always shown next to the set count. The ring on the set screen has
one segment per planned set, so you can count what's left at a glance. A
weight of 0 shows as BW (bodyweight).

**Rep counting.** The watch reads wrist motion between starting and finishing
a set. TRACKING means samples are arriving. CHECKING means analysis is running.
Dashes show that the watch has no live estimate yet. The set target stays visible below.
**AUTO LIVE** is a running estimate. **AUTO** is a count from a settled motion
window. UP/DOWN adjusts the displayed reps and takes over for that set.
When you press START to finish during a live estimate or a pending check,
the watch briefly analyzes the captured motion before showing the set for review. The review
shows AUTO REPS when there is a confident count, or MANUAL REPS with the
editable fallback when there is no count. Rest and the
workout summary show the last set's logged reps and mark an automatic count
with AUTO. When motion is ambiguous, samples are interrupted, or a set runs
beyond the 75-second motion window, enter reps yourself. Turn the feature off
with Home MENU → Rep counting, or from the workout menu.

It counts a rep only when the wrist goes away and comes back, in the set's
own rhythm, size and direction. That is what keeps out picking the weight up,
re-racking, a sip of water, walking (step counter), fidgeting with your phone,
and raising your wrist to press START. If the watch registers steps partway
through a lift, it can still count a strongly periodic lifting motion that
began before the step reading and continued through it. Every logged set reports its estimate,
the saved reps, and whether the watch received and analyzed motion in the log
below. The method, and a simulator that scores it on
18 lifts plus no-set sessions, are in `tools/` (`node tools/repsim.mjs`).

**Logged the wrong thing?** BACK → Undo last set (it names the set) takes it
back and returns you to the set with its previous weight and reps filled in.
Press START to begin a fresh set timer and rep count. Finishing again starts
a new rest countdown. Sets upload after Save on the workout summary.

**Rest** shows the time left, the weight x reps you're about to do and which
exercise, so you can load the bar while you wait. It taps once at 10 s left
and buzzes long at zero.

**Doing exercises in another order:** BACK → Switch exercise lists every
exercise with sets left. During a break the countdown stays visible in the
picker and carries over to the next exercise. A skipped exercise stays
in that list marked "Skipped", so choosing it undoes the skip; the summary's
BACK menu offers the same when something was skipped.

Save starts the upload automatically when the phone is connected. The summary
shows the upload status and switches to XP and streak once GRIND replies.
If the phone is offline, the watch keeps the workout and retries after
reconnecting while GRIND is open.

## Heart rate and Charge (GRIND Body)

While a workout is open the watch samples heart rate every second and keeps the
trace, time in each of your zones, and per set the peak, the reading when you
finished lifting, and how far it fell 60 s into the rest. All of it uploads with the
workout. The set screen's status row shows your HR and zone (coral for zone 5).

On open (every 15 min while open, never mid-workout, and every 15 min in the
background) it sends the day's snapshot to `POST /daily`: Body Battery, stress
and heart rate for the day, resting HR,
recovery time, steps, active minutes, floors, SpO2 and VO2 max. GRIND turns
that into **Charge**, which Home shows in the bezel ring with one line of
advice. On a low-Charge day, starting a workout asks once whether you want one
set fewer per lift. With Smart rest on (GRIND → Settings → Watch) the rest
screen buzzes twice and says RECOVERED once your HR has come back down.

**Readiness check** (Home → MENU): sit still for 70 s and the watch measures
your heart-rate variability (RMSSD) from beat-to-beat intervals, the same
way HRV4Training does. Do it on waking, before coffee, in the same position
each day; the first 10 s settle and are thrown away. After five mornings it
tells you whether today is below, within or above your usual range, and the
reading becomes part of Charge. A reading where you moved or the sensor missed
too many beats says so and asks you to try again; it never counts.

**Lifting load** compares this week's sets with your monthly average, each set
measured against your usual set of that exercise. When it's up a lot while
your recovery is slipping, Home says *Go lighter*; after three steady weeks
with no strength gains and good recovery, *Room to push*.

Every set is written to storage the moment you log it. If the app dies
mid-workout, the next launch offers to resume or discard. Only Save on the
summary writes a Garmin activity (and so a Strava post); closing mid-workout
drops the recording, so a resumed workout's Garmin activity starts at the resume.

## Tests

```bash
java -jar "$SDK/monkeybrains.jar" -o bin/grind-test.prg -f monkey.jungle -y developer_key.der -d fr165m -w --unit-test
MSYS_NO_PATHCONV=1 "$SDK/monkeydo.bat" bin/grind-test.prg fr165m /t
```

They cover id generation, the sync queue, retry and backoff decisions, the
upload payload, the summary math, and a whole workout with a crash in the middle.

## Checking the layout

Two switches in `source/Config.mc`:

- `DEBUG_OVERLAY` draws the screen circle, the layout zones and the tap columns.
- `DEMO_DATA` seeds a fake workout so you can click through every screen in the
  simulator. A demo build never talks to the server. `TOUR` also walks the
  screens on a timer. Turn both off before building for the watch.

`UNIT`, the weight step and the default rest are in the same file.

## Rep lab: tuning the counter on real sets

Think of it as a flight recorder for the counter. With Rep lab on (Home →
MENU, on by default), every set you finish records the raw wrist motion, the
compass, heart rate and beat intervals, what AUTO showed and when, and the
reps you saved. Recording carries on after you take over with UP/DOWN, since
those are the sets the counter most needs to learn from. The app also reports
its own health: any run that never stopped cleanly (a crash) with what it was
doing, and per workout its battery use, peak memory and longest counter step.
Everything uploads after the workout syncs.

The loop:

```bash
npm run replab                          # pull the last 30 days and score them
npm run replab -- --save-baseline       # remember today's results
# ...tune watch/tools/reps.mjs...
npm run replab -- --offline             # did it help? lists sets fixed and broken
npm run replab -- --offline --set 3f2a  # one set's timeline and diagnostics
```

### Watch report

`npm run watchreport` (`-- --days 30` for longer) reads what the watch says
about itself: how often the 15-minute background sync really fires and how
late, background runs that failed, battery drain per hour off the charger,
memory headroom in the 64 KB background process, the watch's own all-day
heart-rate sample rate and what the 15-minute averages hide, which sensor
values it fills in (and whether a firmware update changed that), and
dropouts in the one-second workout traces. Needs migration 70 and the same
`.env.local` keys as `replab`.


It shows each set (logged vs AUTO vs what the current `tools/reps.mjs` makes
of the same motion), accuracy per exercise, the kinds of miss, how fast the
count appears, and the watch's health. Recordings are saved to
`watch/lab-data/` (gitignored). Once a change helps, port it to
`source/Reps.mc` and check native vs JS parity before sideloading.

**It tunes itself.** Once an exercise has 20 recorded sets with usable manual or corrected rep counts, a nightly job
tries small changes to four of the counter's thresholds on those sets. A change
is kept only if it counts more of your sets exactly on sets it was *not*
tuned on (5-fold cross-validation), never adds a wrong count, and doesn't make
walking or fidgeting show a count on the simulated no-lift sessions. The watch
gets the result with the day's plan; `npm run replab -- --tune` shows the
evidence. The JS reference and the watch apply the settings identically
(checked on 60 traces with default and tuned settings).

If the phone keeps failing to carry a large record, the watch retries it
without the compass and beat intervals. If the sensor stream breaks in two
sets while the extra sensors are on, it stops asking for them; switching Rep
lab off and on, or installing a new build, gives them another chance. When the
counter gives up on a set because the stream broke, the watch keeps recording
the rest of that set for the lab.

Adjust an AUTO count with UP/DOWN during review before logging the set. Undo removes the
old recording, so a repeated set has its own motion trace. The tables come from `docs/sql/66-rep-lab.sql` and
`67-watch-telemetry.sql`; until they're applied the watch keeps its records
and retries.

## Reading logs off the watch

`System.println` only reaches the watch's disk if
`GARMIN/APPS/LOGS/GRIND.TXT` already exists, so copy an empty file there once.
Every request logs its status code there (`upload <id> -> 500 internal_error`).
Connect IQ crashes go to `CIQ_LOG.YML`. On USB, the Forerunner may expose
those entries in `CIQ_LOG.BAK` instead. Keep the debug XML from the same build
to interpret numeric stack addresses. Turn `PROBE` on in
`Config.mc` to also log every sensor value the watch gives the app on each
launch, every 15 minutes and every Save (`-` empty, `!` threw, `n/a` not on this
firmware): useful on a new watch or firmware.

## Background sync

With the app closed, the watch wakes GRIND every 15 minutes and sends the day
snapshot (the same one as on open, marked `background`) so the Health page
fills in through the day: Body Battery, stress, all-day heart rate, and the
step, active-minute and floor totals that build the day's curves. It's skipped
if the open app sent one in the last 10 minutes or the phone isn't connected.
The result lands in storage (`bg`: time and status code) and prints as
`bg daily -> <code>` the next time the app is open. The Health page's
"Received … (background) · N syncs" line shows whether these arrive.

A new sync period only takes over once the app has been opened after
installing the build.

Home's "synced … ago" is the last successful contact of any kind, a workout
upload or a day snapshot, so it matches the Health page.

Logged workouts still upload only while the app is open: the upload path is
too big for the 64 KB a background process gets, and a finished workout is
saved on the watch until then anyway.

> **Gotcha:** `source/Secrets.mc` must carry the `(:background)` annotation
> (the example file has it), or the background service can't read the token.

### Verify a release on Windows

Run `watch/tools/verify.ps1 -SdkBin <SDK bin directory> -Release` from PowerShell.
It compiles and runs the Forerunner 165 Music simulator tests, then prints the
SHA-256 fingerprint for the signed `watch/bin/grind-release.prg`. This file uses
your watch token, so keep it local. Copy it as `GARMIN/APPS/grind.prg` with the
same signing key as the installed app.

Open **MENU → Workout sync** to review recent workouts, retry pending uploads and
see rejected sets. Keep GRIND open with the phone connected while workout uploads
run. Health snapshots can sync with GRIND closed. A workout may show **Sets
synced · HR pending** while the watch retries its optional heart-rate data.

For the next physical workout, record the **Build** shown in MENU, count known
reps on both wrist-visible and wrist-still lifts, and record any AUTO offer and
its latency. Switch exercises during rest and verify that the countdown keeps
running. Reconnect first with GRIND closed, then open it and check Workout sync.
Report exact matches, wrong offers, and no offers by build and exercise. Manual
entry remains available throughout.
