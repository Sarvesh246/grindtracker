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
| BACK, or hold UP | Pause menu: resume, change weight, skip exercise, end, discard |
| MENU on Home | Refresh today's workout |

A new exercise starts with the weight highlighted: START moves to reps, START
again logs it. Later sets of the same exercise start on reps, so they're one
press. Touch works too: tap the left or right edge to step the number, tap the
numbers to switch between weight and reps, swipe up or down to adjust.

Every set is written to storage the moment you log it. If the app dies
mid-workout, the next launch offers to resume or discard.

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
- `DEMO_DATA` seeds a fake workout and walks every screen on a timer, so you can
  watch the whole flow in the simulator without a token. Turn it off before
  building for the watch.

`UNIT`, the weight step and the default rest are in the same file.

## Not built yet

Background sync. Right now the queue only flushes while the app is open (on
launch, right after Save, and every 30 s). A background service could flush it
every 5 minutes with the app closed, at the cost of a second code path that has
to fit in 64 KB.
