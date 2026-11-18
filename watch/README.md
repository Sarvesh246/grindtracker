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
| START | Confirm weight, begin the set, finish and log it, or skip rest |
| UP / DOWN | Change the highlighted number, or add/remove 15 s of rest |
| BACK, or hold UP | Workout menu: resume, undo last set, change weight, switch or skip exercise, end, discard |
| MENU on Home | Refresh, turn rep counting on or off, clear failed uploads |

A short white arc beside the START button means START does something on that
screen, the same cue Garmin's own apps use.

A new exercise starts with the weight highlighted. Press START to select
reps, START to begin lifting, and START to finish the set and begin rest.
Later sets of the same exercise open on reps. The final set opens the summary.
Touch works too: tap the left or right edge to step the number, tap the
numbers to switch between weight and reps, swipe up or down to adjust.

Reps prefill to the top of the target range (8-12 starts at 12), and the full
target is always shown next to the set count. The ring on the set screen has
one segment per planned set, so you can count what's left at a glance. A
weight of 0 shows as BW (bodyweight).

**Rep counting.** The watch reads wrist motion between starting and finishing
a set. TRACKING means samples are arriving. CHECKING means analysis is running.
An estimate can appear during the lift and update after movement settles.
**AUTO** under the reps means the watch found a count. Check the number before
pressing START. UP/DOWN adjusts
the displayed reps and takes over for that set. The estimate takes longer
for long sets. When motion is ambiguous, samples are interrupted, or a set
runs beyond the 75-second motion window, enter reps yourself. Turn the
feature off with Home MENU → Rep counting, or from the workout menu.

It counts a rep only when the wrist goes away and comes back, in the set's
own rhythm, size and direction. That is what keeps out picking the weight up,
re-racking, a sip of water, walking (step counter), fidgeting with your phone,
and raising your wrist to press START. Every logged set reports its estimate,
the saved reps, and whether the watch received and analyzed motion in the log
below. The method, and a simulator that scores it on
18 lifts plus no-set sessions, are in `tools/` (`node tools/repsim.mjs`).

**Logged the wrong thing?** BACK → Undo last set (it names the set) takes it
back and puts you on it with its numbers filled in. Sets only upload after
Save, so there's nothing to un-sync.

**Rest** shows the time left, the weight x reps you're about to do and which
exercise, so you can load the bar while you wait. It taps once at 10 s left
and buzzes long at zero.

**Doing exercises in another order:** BACK → Switch exercise lists every
exercise with sets left. Pick one and you're on it. A skipped exercise stays
in that list marked "Skipped", so choosing it undoes the skip; the summary's
BACK menu offers the same when something was skipped.

After Save, the summary shows the XP the workout earned (and your streak) as
soon as GRIND confirms the upload.

## Heart rate and Charge (GRIND Body)

While a workout is open the watch samples heart rate every 5 s and keeps the
trace, time in each of your zones, and per set the peak, the reading when you
logged it, and how far it fell 60 s into the rest. All of it uploads with the
workout. The set screen's status row shows your HR and zone (coral for zone 5).

On open (and every 15 min while open, never mid-workout) it sends the day's
snapshot to `POST /daily`: Body Battery and stress for the day, resting HR,
recovery time, steps, active minutes, floors, SpO2 and VO2 max. GRIND turns
that into **Charge**, which Home shows in the bezel ring with one line of
advice. On a low-Charge day, starting a workout asks once whether you want one
set fewer per lift. With Smart rest on (GRIND → Settings → Watch) the rest
screen buzzes twice and says RECOVERED once your HR has come back down.

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

It shows each set (logged vs AUTO vs what the current `tools/reps.mjs` makes
of the same motion), accuracy per exercise, the kinds of miss, how fast the
count appears, and the watch's health. Recordings are saved to
`watch/lab-data/` (gitignored). Once a change helps, port it to
`source/Reps.mc` and check native vs JS parity before sideloading.

If the phone keeps failing to carry a large record, the watch retries it
without the compass and beat intervals. If the sensor stream breaks in two
sets while the extra sensors are on, it stops asking for them; switching Rep
lab off and on gives them another chance.

**The saved number is the truth**, so if AUTO is wrong, fix it before you
finish the set, or Undo and save it again. A later Undo correction updates the
recording too. Gotcha: the tables come from `docs/sql/66-rep-lab.sql` and
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

With the app closed, the watch wakes GRIND every 2 hours and sends the day
snapshot (the same one as on open) so Charge stays fresh. It's skipped if a
snapshot went out in the last 30 minutes or the phone isn't connected. The
result lands in storage (`bg`: time and status code) and prints as
`bg daily -> <code>` the next time the app is open.

Logged workouts still upload only while the app is open: the upload path is
too big for the 64 KB a background process gets, and a finished workout is
saved on the watch until then anyway.

> **Gotcha:** `source/Secrets.mc` must carry the `(:background)` annotation
> (the example file has it), or the background service can't read the token.
