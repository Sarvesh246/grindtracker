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
| START | Start the workout, confirm weight, log the set, skip rest |
| UP / DOWN | Change the highlighted number, or add/remove 15 s of rest |
| BACK, or hold UP | Workout menu: resume, undo last set, change weight, switch or skip exercise, end, discard |
| MENU on Home | Refresh, turn rep counting on or off, clear failed uploads |

A short white arc beside the START button means START does something on that
screen, the same cue Garmin's own apps use.

A new exercise starts with the weight highlighted: START moves to reps, START
again logs it. Later sets of the same exercise start on reps, so they're one
press. Touch works too: tap the left or right edge to step the number, tap the
numbers to switch between weight and reps, swipe up or down to adjust.

Reps prefill to the top of the target range (8-12 starts at 12), and the full
target is always shown next to the set count. The ring on the set screen has
one segment per planned set, so you can count what's left at a glance. A
weight of 0 shows as BW (bodyweight).

**Rep counting.** While a set or rest screen is up, the watch reads wrist
motion and, once it is sure, puts the count in the reps slot with **AUTO**
under it. Press START as usual. If it is wrong, UP/DOWN takes over and it
stays out of that set. It only shows a number it trusts: if it can't tell
(a lift your wrist barely moves in, like leg press, or a set it only saw in
pieces) the reps stay at the target. Turn it off with Home MENU → Rep
counting, or from the workout menu.

It counts a rep only when the wrist goes away and comes back, in the set's
own rhythm, size and direction. That is what keeps out picking the weight up,
re-racking, a sip of water, walking (step counter), fidgeting with your phone,
and raising your wrist to press START. Every logged set writes
`reps auto=<count> logged=<what you saved>` to the log (below), which is how
to check it on your own lifts. The method, and a simulator that scores it on
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

## Reading logs off the watch

`System.println` only reaches the watch's disk if
`GARMIN/APPS/LOGS/GRIND.TXT` already exists, so copy an empty file there once.
Every request logs its status code there (`upload <id> -> 500 internal_error`),
which is the fastest way to see why something isn't syncing. Turn `PROBE` on in
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
