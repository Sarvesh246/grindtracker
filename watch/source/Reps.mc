using Toybox.ActivityMonitor;
using Toybox.Lang;
using Toybox.Math;
using Toybox.Sensor;
using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;

// Counts reps from wrist motion between START and finish, and offers
// the count on the set screen. A port of tools/reps.mjs, which explains the
// method and is where it gets tuned (against tools/repsim.mjs). Keep the two
// in step: same constants, same steps, same order.
//
// The rule above all others: a wrong number is worse than no number. When
// the counter isn't sure, `count` stays null and the set screen keeps the
// planned reps.
//
// Accelerometer at 25 Hz, averaged in pairs to 12.5 Hz, in g. The buffer
// holds the motion since the last set was logged, at most MAX_SAMPLES.
module Reps {
    const BLOCK = 12;
    const GAP_BLOCKS = 3;
    const MIN_MOTION = 0.03;
    var LAG_MIN = 8;           // tunable per exercise (configure)
    const LAG_MAX = 40;
    const PICK = 0.85;
    var MIN_AC = 0.60;         // tunable
    var MAX_CV = 0.32;         // tunable
    const MIN_REPS = 3;
    const SHORT_REPS = 4;
    const SHORT_AC = 0.7;
    const SHORT_CV = 0.15;
    const FRAG_AC = 0.35;
    const FRAG_T = 0.25;
    const FRAG_HARMONIC_T = 0.15;
    var SWING_MIN = 0.45;      // tunable
    const SWING_MAX = 2.4;
    const MIN_AMP = 0.06;
    const GAP_LO = 0.6;
    const GAP_HI = 1.6;
    const CORE_LO = 0.72;
    const CORE_HI = 1.6;
    const DUR_LO = 0.6;
    const DUR_HI = 1.7;
    const DIR_COS = 0.85;
    const EDGE_SIZE_HI = 1.45;
    const EDGE_DUR_LO = 0.6;
    const EDGE_DUR_HI = 1.6;
    const TRAIL_DUR_HI = 2.2;
    const EDGE_COS = 0.88;
    const CLOSE = 0.5;
    const TRIM_LEAD = 31;      // samples (2.5 s): START wrist movement to hold still
    const TRIM_TRAIL = 19;     // samples (1.5 s): finish wrist movement to hold still
    const TRIM_STEP = 3;
    const BRIDGE_GAP = 0.25;   // a bridged rep's gaps vs the period
    const BRIDGE_MIN = 4;      // strict reps a bridged chain needs
    const TRAIL_CLOSE = 0.12;  // a disputed last rep counts when it closes this cleanly,
    const TRAIL_GAP = 1.3;     // keeps this beat
    const TRAIL_SIZE = 0.65;   // and is this size on the way back
    const WALK_STEPS = 5;
    const WALK_WIN = 4;

    const RATE = 25;           // Hz asked of the sensor
    const MAX_SAMPLES = 938;   // 75 s at 12.5 Hz
    const BATCH_MS = 1000;
    const BATCH_GRACE_MS = 1750; // allow callback jitter, but catch a missed one-second batch
    const PREVIEW_EVERY = 3;  // sensor batches between in-set estimates
    const PAIR_BUDGET = 256;   // maximum correlation pairs per timer callback
    const SAMPLE_BUDGET = 128; // maximum filter samples per timer callback
    const SETTLED_MS = 30;     // work per 50 ms timer period once the wrist is still
    const SETTLED_STEPS = 40;
    const FINISH_MS = 3500;    // maximum wait for a count after pressing START

    // --- live state -------------------------------------------------------
    var bx = [];
    var by = [];
    var bz = [];
    var bs = [];               // step counter, per sample
    var carry = null;          // odd sample waiting for its pair
    var count = null;          // confident rep count, or null
    var manual = false;        // the user changed reps by hand: stop offering
    var listening = false;
    var dirty = false;         // moved since the last analysis
    var movingBatches = 0;
    var sawMotion = false;
    var interrupted = false;
    var lastBatch = null;
    var listenerAt = null;
    var lastSample = null;
    var repeatedTimestamps = 0;
    var fallbackBatches = 0;
    var finishBy = null;
    var captureEnd = null;
    var revision = 0;
    var jobRevision = 0;
    var jobSettled = false;    // the running analysis began with the wrist still
    var countSettled = false;  // `count` came from such an analysis
    var glanceNext = false;    // the next analysis follows a glance at a settled count
    var jobGlance = false;     // the running analysis is that re-check
    var offeredRevision = 0;
    var batches = 0;
    var lastResult = null;
    var sensorStatus = "idle";
    var rich = false;          // compass and beat intervals requested too
    var richCounted = false;   // this set already counted against them

    // --- per-exercise tuning (tools/reps.mjs TUNE_RANGES, src/lib/reps) ---
    // /today may send an exercise's `tune`: settings learned from your own
    // sets of it. Same keys, ranges and rounding as cleanParams() in JS, so
    // the watch and the replay can never count differently.
    var tuneTag = "";

    function inRange(v, lo, hi) {
        return (v instanceof Lang.Number || v instanceof Lang.Float || v instanceof Lang.Double) && v >= lo && v <= hi;
    }

    // The valid settings in `t`, rounded, or null if none.
    function validTune(t) {
        if (!(t instanceof Lang.Dictionary)) { return null; }
        var out = {};
        if (inRange(t["ac"], 0.45, 0.75)) { out["ac"] = Math.round(t["ac"] * 100.0) / 100.0; }
        if (inRange(t["cv"], 0.22, 0.45)) { out["cv"] = Math.round(t["cv"] * 100.0) / 100.0; }
        if (inRange(t["swing"], 0.30, 0.60)) { out["swing"] = Math.round(t["swing"] * 100.0) / 100.0; }
        if (inRange(t["lag"], 6, 10)) { out["lag"] = Math.round(t["lag"].toFloat()).toNumber(); }
        return out.size() == 0 ? null : out;
    }

    // The settings for the set about to start: defaults, then the exercise's.
    function configure(t) {
        MIN_AC = 0.60; MAX_CV = 0.32; SWING_MIN = 0.45; LAG_MIN = 8;
        tuneTag = "";
        var v = validTune(t);
        if (v == null) { return; }
        if (v["ac"] != null) { MIN_AC = v["ac"]; tuneTag += "ac" + v["ac"].format("%.2f") + " "; }
        if (v["cv"] != null) { MAX_CV = v["cv"]; tuneTag += "cv" + v["cv"].format("%.2f") + " "; }
        if (v["swing"] != null) { SWING_MIN = v["swing"]; tuneTag += "swing" + v["swing"].format("%.2f") + " "; }
        if (v["lag"] != null) { LAG_MIN = v["lag"]; tuneTag += "lag" + v["lag"] + " "; }
    }

    // Strikes belong to one build. 2026-11-18b rejected every batch with
    // tied timestamps, which spent both strikes on a validator bug and would
    // otherwise keep the extra sensors off for good.
    function richBad() {
        var v = Store.get("rb");
        if (!(v instanceof Lang.Array) || v.size() != 2 || !Lab.VERSION.equals(v[0])) { return 0; }
        return v[1] instanceof Lang.Number ? v[1] : 0;
    }

    function strikeRich() { Store.put("rb", [Lab.VERSION, richBad() + 1]); }
    var head = 0;              // oldest entry once the motion buffer is full
    var clipped = false;

    var job = null;
    var worker = null;

    // Rep lab timeline for the current set: [ms since START, kind, values...].
    // 1 first batch (samples, timestamped) · 2 count shown (n, -1 = none) ·
    // 3 analysis done (reps, ok, wall ms, steps) · 4 input gap (code) ·
    // 5 wrist settled (moving batches) · 6 glance kept count (count, re-check
    // result) · 7 taken over by hand · 8 first batch using callback timing.
    const MAX_EVENTS = 110;
    var events = [];
    var t0 = 0;
    var jobStartMs = 0;
    var jobSteps = 0;
    var analyses = 0;
    var analysisMs = 0;
    var longestStep = 0;

    function ev(kind, a, b, c, d) {
        if (events.size() >= MAX_EVENTS) { return; }
        var e = [System.getTimer() - t0, kind];
        if (a != null) { e.add(a); }
        if (b != null) { e.add(b); }
        if (c != null) { e.add(c); }
        if (d != null) { e.add(d); }
        events.add(e);
    }

    function gapCode(reason) {
        var codes = ["sample gap", "invalid sample count", "unexpected sample count", "invalid sample interval",
            "unexpected sample spacing", "missing accelerometer", "sensor timeout"];
        for (var i = 0; i < codes.size(); i++) { if (codes[i].equals(reason)) { return i + 1; } }
        return 0;
    }

    function cancelAnalysis() {
        if (worker != null) { worker.stop(); worker = null; }
        job = null;
    }

    // On unless switched off in the Home menu.
    function enabled() {
        var v = Store.get("rc");
        return v == null || v == true;
    }

    function setEnabled(on) {
        Store.put("rc", on);
        if (!on) { stop(); clearMotion(); }
        if (Workout.setRunning()) { takeOver(); }
    }

    // A new set: forget the motion so far.
    function reset() {
        clearMotion();
        manual = false;
        interrupted = false;
        events = [];
        t0 = System.getTimer();
        repeatedTimestamps = 0;
        fallbackBatches = 0;
        rich = false;
        richCounted = false;
        finishBy = null;
        captureEnd = null;
        analyses = 0; analysisMs = 0; longestStep = 0;
        Tape.reset();
    }

    // The set's timeline and diagnostics for the rep lab. The signals
    // themselves come from Tape.
    function snapshot() {
        var d = Tape.diag();
        d["sensor"] = sensorStatus; d["batches"] = batches; d["motion"] = revision;
        d["result"] = lastResult == null ? null : lastResult[0] + (lastResult[1] ? "" : "?");
        d["interrupted"] = interrupted; d["listening"] = listening; d["manual"] = manual;
        d["analyses"] = analyses; d["analysis_ms"] = analysisMs; d["longest_callback_ms"] = longestStep;
        d["set_ms"] = (captureEnd == null ? System.getTimer() : captureEnd) - t0;
        d["rich"] = rich; d["rich_bad"] = richBad();
        d["repeated_timestamps"] = repeatedTimestamps;
        d["fallback_batches"] = fallbackBatches;
        d["tune"] = tuneTag.length() == 0 ? null : tuneTag;
        return { "events" => events, "diag" => d };
    }

    function clearMotion() {
        cancelAnalysis();
        bx = []; by = []; bz = []; bs = [];
        carry = null;
        count = null;
        countSettled = false;
        jobSettled = false;
        glanceNext = false;
        jobGlance = false;
        dirty = false;
        movingBatches = 0;
        sawMotion = false;
        lastBatch = null;
        lastSample = null;
        revision = 0;
        offeredRevision = 0;
        batches = 0;
        lastResult = null;
        head = 0;
        clipped = false;
    }

    // Your number wins for the rest of the set. The listener keeps running
    // so the rep lab still records the set; only the counting stops.
    function takeOver() {
        cancelAnalysis();
        if (!manual) { ev(7, null, null, null, null); }
        manual = true;
    }

    function inputGap(reason, detail) {
        ev(4, gapCode(reason), null, null, null);
        // The extra sensors are the newest thing on this path: if the stream
        // misbehaves while they're on, count it, and after two such sets
        // stop asking for them (Lab.RICH_BAD_MAX).
        if (rich && !richCounted && sawMotion) { richCounted = true; strikeRich(); }
        interrupted = sawMotion;
        if (interrupted || !sensorStatus.equals(reason)) {
            System.println("reps: " + reason + " (" + detail + ") after " + batches + " batches");
        }
        // Dropping the motion must not forget that the stream is alive.
        var seen = lastBatch;
        clearMotion();
        lastBatch = seen;
        // Counting stops, but the listener stays on so the rep lab still
        // records the rest of the set, the way a hand takeover does. A
        // stream that goes silent is stopped by checkDelivery.
        sensorStatus = reason;
    }

    // The reps the set screen should show: the confident count unless the
    // user has taken over, else null (keep whatever is there).
    function offer() {
        if (manual || count == null) { return null; }
        return count;
    }

    // Freeze the captured window on START when motion has not settled or
    // an analysis is pending. A mid-lift preview only covers part of the set.
    function checkFinalCount() {
        if (manual || interrupted || !listening || !sawMotion || bx.size() < 48 || clipped) { return false; }
        if (job == null && !dirty && lastResult != null && jobSettled) { return false; }
        // A fresh final window supersedes any earlier estimate.
        glanceNext = false;
        if (count != null) {
            count = null;
            ev(2, -1, null, null, null);
        }
        cancelAnalysis();
        finishBy = System.getTimer() + FINISH_MS;
        movingBatches = 0;
        dirty = true;
        update();
        return true;
    }

    function finalCountReady(now) {
        return finishBy != null && (job == null || now >= finishBy);
    }

    function start() {
        if (listening || manual || interrupted || (Config.DEMO_DATA && Config.TOUR) || !enabled()) { return; }
        try {
            if (!(Sensor has :registerSensorDataListener)) {
                sensorStatus = "unavailable";
                System.println("reps: accelerometer listener unavailable");
                return;
            }
            var maxRate = Sensor has :getMaxSampleRateForSensorType
                ? Sensor.getMaxSampleRateForSensorType(:accelerometer) : Sensor.getMaxSampleRate();
            if (maxRate < RATE) {
                sensorStatus = "unavailable";
                System.println("reps: accelerometer limit " + maxRate + " Hz");
                return;
            }
            if (Lab.enabled() && richBad() < Lab.RICH_BAD_MAX) {
                try {
                    var opts = {
                        :period => 1,
                        :accelerometer => { :enabled => true, :sampleRate => RATE, :includeTimestamps => true },
                        :heartBeatIntervals => { :enabled => true }
                    };
                    if (Sensor has :getMaxSampleRateForSensorType && Sensor.getMaxSampleRateForSensorType(:magnetometer) >= RATE) {
                        opts[:magnetometer] = { :enabled => true, :sampleRate => RATE };
                    }
                    Sensor.registerSensorDataListener(new Lang.Method(Reps, :onData), opts);
                    rich = true;
                } catch (e) {
                    System.println("reps: extra sensors refused " + e.getErrorMessage());
                    try { Sensor.unregisterSensorDataListener(); } catch (e2) { }
                }
            }
            if (!rich) {
                Sensor.registerSensorDataListener(new Lang.Method(Reps, :onData), {
                    :period => 1,
                    :accelerometer => { :enabled => true, :sampleRate => RATE, :includeTimestamps => true }
                });
            }
            listening = true;
            listenerAt = System.getTimer();
            sensorStatus = "waiting";
            System.println("reps: listening at " + RATE + " Hz (max " + maxRate + ") rich=" + rich);
        } catch (e) {
            System.println("reps: no accelerometer " + e.getErrorMessage());
            sensorStatus = "unavailable";
            listening = false;
        }
    }

    function finishCapture() {
        var status = sensorStatus;
        finishBy = null;
        stop();
        sensorStatus = status;
    }

    function stop() {
        cancelAnalysis();
        listenerAt = null;
        if (!listening) { return; }
        System.println("reps: stopped" + diagnostics());
        listening = false;
        sensorStatus = "idle";
        try { Sensor.unregisterSensorDataListener(); } catch (e) { }
    }

    // A listener can stop delivering without issuing another callback. Allow
    // delayed delivery, but retire an estimate when its stream goes silent.
    function checkDelivery(now) {
        if (!listening || finishBy != null) { return; }
        var last = lastBatch == null ? listenerAt : lastBatch;
        if (last == null || now - last <= 6 * BATCH_MS) { return; }
        if (!interrupted) { inputGap("sensor timeout", now - last); }
        interrupted = true;
        stop();
        sensorStatus = "sensor timeout";
    }

    function stepsNow() {
        try {
            var a = ActivityMonitor.getInfo();
            if (a != null && a.steps != null) { return a.steps; }
        } catch (e) {
        }
        return 0;
    }

    function onData(data) {
        if (!listening || finishBy != null) { return; }
        Tape.feedExtra(data);
        var a = data == null ? null : data.accelerometerData;
        if (a == null || a.x == null || a.y == null || a.z == null) {
            // Extra sensors can deliver independently. Only accelerometer
            // batches advance its delivery clock.
            if (interrupted || (data != null && (data.magnetometerData != null || data.heartRateData != null))) { return; }
            inputGap("missing accelerometer", null);
            return;
        }
        onSamples(a.x, a.y, a.z, a.timestamp, System.getTimer(), stepsNow());
    }

    function onSamples(xs, ys, zs, timestamps, now, steps) {
        var n = xs.size();
        if (n == 0 || n > 2 * RATE || ys.size() != n || zs.size() != n) {
            if (!interrupted) { inputGap("invalid sample count", n); }
            return;
        }
        Tape.feed(xs, ys, zs, steps);
        var delay = lastBatch == null ? 0 : now - lastBatch;
        lastBatch = now;
        // After a gap this set is only being recorded, not counted.
        if (interrupted) { return; }

        var time = timestamps != null && timestamps.size() == n && n > 1 ? timestamps : null;
        if (time != null && !regularTimestamps(time, n)) { time = null; }
        var gap = time != null && lastSample != null ? time[0] - lastSample : null;
        if (gap != null && gap > 200) {
            inputGap("sample gap", gap);
            if (interrupted) { return; }
        }
        // The Forerunner can attach ties and 200+ ms jumps to a complete
        // batch. Use those samples in delivery order when the callback
        // arrives on time. Never join batches across a missed delivery
        // unless clean sensor timestamps show the samples are contiguous.
        if (time == null && n != RATE) {
            inputGap("unexpected sample count", n);
            return;
        }
        if ((gap == null || gap <= 0) && (delay < 0 || delay > BATCH_GRACE_MS)) {
            inputGap("sample gap", delay);
            if (interrupted) { return; }
        }
        if (batches == 0) { ev(1, n, time != null ? 1 : 0, null, null); }
        if (time == null) {
            if (fallbackBatches == 0) { ev(8, n, delay, null, null); }
            fallbackBatches++;
        }
        if (!sensorStatus.equals("receiving")) {
            System.println("reps: received " + n + " samples, timestamps=" + (time != null));
            sensorStatus = "receiving";
        }
        lastSample = time == null ? null : time[n - 1];
        batches++;
        if (manual) { return; }
        for (var i = 0; i < n; i++) {
            var x = xs[i] / 1000.0;
            var y = ys[i] / 1000.0;
            var z = zs[i] / 1000.0;
            if (carry == null) {
                carry = [x, y, z];
            } else {
                append((carry[0] + x) / 2.0, (carry[1] + y) / 2.0, (carry[2] + z) / 2.0, steps);
                carry = null;
            }
        }
        // Estimate periodically during the lift. A brief wrist raise can be
        // how the user checks a finished set, so keep the offer through one
        // moving batch. Sustained new motion needs a fresh estimate.
        if (moving()) {
            dirty = true;
            sawMotion = true;
            movingBatches++;
            revision++;
            if (movingBatches >= 2 && revision - offeredRevision >= PREVIEW_EVERY && count != null) {
                count = null;
                ev(2, -1, null, null, null);
            }
            if (revision % PREVIEW_EVERY == 0) { update(); }
        } else {
            if (movingBatches > 0) {
                // Analyze the settled endpoint. A preview taken during the
                // lift can omit its last rep, even when its rhythm is clear.
                // A settled count survives a glance at the watch (one or two
                // moving batches) while the re-check runs, so raising the
                // wrist to read the number never blanks it.
                if (job != null) { cancelAnalysis(); }
                dirty = true;
                ev(5, movingBatches, null, null, null);
                glanceNext = countSettled && count != null && movingBatches <= 2;
                if (!glanceNext && count != null) { count = null; ev(2, -1, null, null, null); }
            }
            movingBatches = 0;
            update();
        }
    }

    function regularTimestamps(time, n) {
        var regular = true;
        for (var i = 1; i < n; i++) {
            var spacing = time[i] - time[i - 1];
            if (spacing == 0) { repeatedTimestamps++; }
            if (spacing <= 0 || spacing > 200) { regular = false; }
        }
        var averageMs = (time[n - 1] - time[0]).toFloat() / (n - 1);
        return regular && averageMs >= 32.0 && averageMs <= 50.0;
    }

    function append(x, y, z, steps) {
        if (bx.size() < MAX_SAMPLES) {
            bx.add(x); by.add(y); bz.add(z); bs.add(steps);
        } else {
            bx[head] = x; by[head] = y; bz[head] = z; bs[head] = steps;
            head = (head + 1) % MAX_SAMPLES;
            clipped = true;
        }
    }

    function ordered(a) {
        var out = a.slice(head, null);
        if (head != 0) { out.addAll(a.slice(0, head)); }
        return out;
    }

    // Any real motion in the newest second? While the wrist is still nothing
    // new can be counted, so the analysis (the costly part) is skipped.
    function moving() {
        var n = bx.size();
        if (n < BLOCK) { return false; }
        var v = 0.0;
        var axes = [bx, by, bz];
        for (var k = 0; k < 3; k++) {
            var a = axes[k];
            var m = 0.0;
            for (var i = n - BLOCK; i < n; i++) { m += a[(head + i) % n]; }
            m /= BLOCK;
            for (var i = n - BLOCK; i < n; i++) {
                var delta = a[(head + i) % n] - m;
                v += delta * delta;
            }
        }
        return Math.sqrt(v / BLOCK) > MIN_MOTION;
    }

    function update() {
        if (manual || interrupted || job != null || !dirty || !listening || bx.size() < 48) { return; }
        dirty = false;
        jobRevision = revision;
        jobSettled = movingBatches == 0;
        jobGlance = glanceNext && jobSettled;
        glanceNext = false;
        jobStartMs = System.getTimer();
        jobSteps = 0;
        // The buffers are copied on the timer's first step, not here in the
        // sensor callback. Both run on the main thread, so the copy is the
        // buffer as it stands a few ms later: at most a batch newer, which the
        // revision check already accounts for.
        job = new RepAnalysis(null, null, null, null, clipped);
        worker = new Timer.Timer();
        worker.start(new Lang.Method(Reps, :advanceAnalysis), 50, true);
    }

    function advanceAnalysis() {
        if (manual || !listening || job == null) { cancelAnalysis(); return; }
        // Once the wrist is still, the settled count is what the user is
        // waiting to read: spend most of each timer period on it. A step is
        // a few milliseconds of bounded work, so a callback stays far below
        // the watchdog. Mid-lift previews get a smaller time budget.
        var startMs = System.getTimer();
        var result = job.step();
        jobSteps++;
        var budget = movingBatches == 0 ? SETTLED_MS : 12;
        var limit = movingBatches == 0 ? SETTLED_STEPS : 8;
        for (var i = 1; result == null && i < limit && System.getTimer() - startMs < budget; i++) {
            result = job.step();
            jobSteps++;
        }
        var spent = System.getTimer() - startMs;
        analysisMs += spent;
        if (spent > longestStep) { longestStep = spent; }
        if (result == null) { return; }
        analyses++;
        ev(3, result[0], result[1] ? 1 : 0, System.getTimer() - jobStartMs, jobSteps);
        lastResult = result;
        cancelAnalysis();
        var fresh = revision - jobRevision < PREVIEW_EVERY;
        var offered = result[1] && fresh ? result[0] : null;
        // Raising the wrist to read the count turns the watch about 90
        // degrees, a gravity shift far larger than the reps. A re-check after
        // such a glance can add a rep done since, never take the count away.
        if (jobGlance && count != null && (offered == null || offered < count)) {
            ev(6, count, offered == null ? -1 : offered, null, null);
            offered = count;
            jobSettled = true;
        }
        if (offered != null) { offeredRevision = jobRevision; countSettled = jobSettled; }
        if (count != offered) {
            count = offered;
            ev(2, offered == null ? -1 : offered, null, null, null);
            WatchUi.requestUpdate();
        }
        if (Workout.completeRepReview(System.getTimer())) { return; }
        if (movingBatches == 0) { update(); }
    }

    function awaitingOffer() {
        return finishBy != null || (!manual && listening && !interrupted
            && (lastResult == null || dirty || job != null || movingBatches > 0));
    }

    function repLabel() {
        if (offer() != null) { return countSettled ? "AUTO" : "AUTO LIVE"; }
        if (!Workout.setRunning()) { return "REPS"; }
        if (manual || (!listening && !enabled())) { return "MANUAL"; }
        if (interrupted || !listening) { return "NO COUNT"; }
        if (job != null) { return "CHECKING"; }
        if (jobSettled && lastResult != null && movingBatches == 0 && !dirty) { return "NO COUNT"; }
        return batches == 0 ? "WAITING" : "TRACKING";
    }

    function diagnostics() {
        return " sensor=" + sensorStatus + " batches=" + batches + " motion=" + revision
            + " result=" + lastResult + " gap=" + interrupted + " tied_ts=" + repeatedTimestamps + " fallback=" + fallbackBatches;
    }

    // --- maths helpers ------------------------------------------------------

    function fabs(v) { return v < 0 ? -v : v; }
    function rnd(v) { return (v + 0.5).toNumber(); }
    function imax(a, b) { return a > b ? a : b; }
    function imin(a, b) { return a < b ? a : b; }

    function mean(a, lo, hi) {
        var s = 0.0;
        for (var i = lo; i < hi; i++) { s += a[i]; }
        return s / (hi - lo);
    }

    // Median of a copy. Gap passes keep the largest motion buffers from
    // hitting insertion sort's quadratic worst case in one callback.
    function median(src) {
        var n = src.size();
        if (n == 0) { return 0.0; }
        var a = src.slice(0, null);
        for (var gap = n / 2; gap >= 1; gap /= 2) {
            for (var i = gap; i < n; i++) {
                var v = a[i];
                var j = i;
                while (j >= gap && a[j - gap] > v) { a[j] = a[j - gap]; j -= gap; }
                a[j] = v;
            }
        }
        return n % 2 == 1 ? a[(n - 1) / 2].toFloat() : (a[n / 2 - 1] + a[n / 2]) / 2.0;
    }

    // --- 1. motion bouts ------------------------------------------------------

    function motion(x, y, z, b) {
        var lo = b * BLOCK;
        var hi = lo + BLOCK;
        var v = 0.0;
        var axes = [x, y, z];
        for (var k = 0; k < 3; k++) {
            var a = axes[k];
            var m = mean(a, lo, hi);
            for (var i = lo; i < hi; i++) {
                var delta = a[i] - m;
                v += delta * delta;
            }
        }
        return Math.sqrt(v / BLOCK);
    }

    function bouts(mo, steps, n, walkStart) {
        var nb = mo.size();
        var out = [];
        if (nb < 3) { return out; }
        var thr = 0.15 * median(mo);
        if (thr < MIN_MOTION) { thr = MIN_MOTION; }
        var act = new [nb];
        for (var b = 0; b < nb; b++) {
            var b0 = imax(0, b - WALK_WIN / 2);
            var b1 = imin(nb - 1, b0 + WALK_WIN);
            var walk = steps != null && steps[imin(n - 1, b1 * BLOCK + BLOCK - 1)] - steps[b0 * BLOCK] >= WALK_STEPS;
            if (walk && walkStart.size() == 0) { walkStart.add(b * BLOCK); }
            act[b] = !walk && mo[b] > thr;
        }
        var b = 0;
        while (b < nb) {
            if (!act[b]) { b++; continue; }
            var e = b;
            var gap = 0;
            var k = b + 1;
            while (k < nb) {
                if (act[k]) { e = k; gap = 0; } else { gap++; if (gap > GAP_BLOCKS) { break; } }
                k++;
            }
            out.add([imax(0, b * BLOCK - BLOCK / 2), imin(n, (e + 1) * BLOCK + BLOCK / 2)]);
            b = e + 1;
        }
        return out;
    }

    // --- 2. principal axis ------------------------------------------------------

    function principal(cxx, cyy, czz, cxy, cxz, cyz) {
        var vx = 0.0; var vy = 0.0; var vz = 0.0;
        if (cxx >= cyy && cxx >= czz) { vx = 1.0; } else if (cyy >= czz) { vy = 1.0; } else { vz = 1.0; }
        for (var it = 0; it < 25; it++) {
            var nx = cxx * vx + cxy * vy + cxz * vz;
            var ny = cxy * vx + cyy * vy + cyz * vz;
            var nz = cxz * vx + cyz * vy + czz * vz;
            var nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (nn == 0) { break; }
            vx = nx / nn; vy = ny / nn; vz = nz / nn;
        }
        return [vx, vy, vz];
    }

    // --- 3. period ------------------------------------------------------------

    // [period in 12.5 Hz samples, autocorrelation peak], or [0, 0].
    function selectPeriod(r, lmax) {
        var best = 0.0;
        for (var L = LAG_MIN; L <= lmax; L++) {
            if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] > best) { best = r[L]; }
        }
        if (best <= 0) { return [0.0, 0.0]; }
        for (var L = LAG_MIN; L <= lmax; L++) {
            if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] >= PICK * best) {
                var a = r[L - 1];
                var b = r[L];
                var c = r[L + 1];
                var den = a - 2 * b + c;
                var off = den < 0 ? 0.5 * (a - c) / den : 0.0;
                if (off > 0.5) { off = 0.5; }
                if (off < -0.5) { off = -0.5; }
                return [2.0 * (L + off), r[L]];
            }
        }
        return [0.0, 0.0];
    }

    // --- 5-8. swings, pairs, the set ---------------------------------------
    // Scratch for one countCycles call (Monkey C has no closures).
    var cMag = null;
    var cDur = null;
    var cKind = null;
    var cCos = null;
    var cMm = null;
    var cMd = null;

    function dI(k) { return cKind[k] == -1 ? 0 : 1; }

    // Size check; with `comp`, a slow swing of a lift that moves the hand
    // (acceleration goes with 1/duration^2) is measured duration-compensated.
    function sizeOk(k, f, comp) {
        var m = cMm[dI(k)];
        if (cMag[k] >= f * m) { return true; }
        if (!comp) { return false; }
        var q = cDur[k].toFloat() / cMd[dI(k)];
        if (q > 2.0) { q = 2.0; }
        return cMag[k] * q * q >= f * m;
    }

    function loose(k) { return sizeOk(k, SWING_MIN, true) && cMag[k] <= SWING_MAX * cMm[dI(k)]; }

    function half(k, trail, size, comp) {
        var md = cMd[dI(k)];
        return sizeOk(k, size, comp) && cMag[k] <= EDGE_SIZE_HI * cMm[dI(k)]
            && cDur[k] >= EDGE_DUR_LO * md && cDur[k] <= (trail ? TRAIL_DUR_HI : EDGE_DUR_HI) * md
            && cCos[k] >= EDGE_COS;
    }

    // rule: [size, lo, leading hi, trailing hi, comp]
    function okEdge(k, gap, trail, cg, rule) {
        if (gap < rule[1] * cg || gap > (trail ? rule[3] : rule[2]) * cg) { return false; }
        if (trail) { return half(k, true, rule[0], rule[4]) && sizeOk(k + 1, rule[0], rule[4]); }
        return sizeOk(k, rule[0], rule[4]) && half(k + 1, false, rule[0], rule[4]);
    }

    // Longest run of times whose gaps fit the rhythm: [len, lo].
    function rhythmRun(t, T) {
        if (t.size() == 0) { return [0, 0]; }
        var bestLo = 0;
        var bestLen = 1;
        var lo = 0;
        for (var k = 1; k <= t.size(); k++) {
            var ok = k < t.size();
            if (ok) {
                var g = t[k] - t[k - 1];
                ok = g >= GAP_LO * T && g <= GAP_HI * T;
            }
            if (!ok) {
                if (k - lo > bestLen) { bestLen = k - lo; bestLo = lo; }
                lo = k;
            }
        }
        return [bestLen, bestLo];
    }

    // The longest chain of pairs that keeps the beat, allowing a single
    // non-strict but rep-like pair between strict ones: [t0, t1, strict] or
    // null. Uses the fingerprints countCycles has set.
    function bridgeRun(pairs, keep, at, T) {
        var ct = [];
        var cs = [];
        for (var j = 0; j < pairs.size(); j++) {
            var k = pairs[j];
            var st = keep[k] && keep[k + 1];
            if (st || (loose(k) && loose(k + 1))) { ct.add(at[k]); cs.add(st); }
        }
        var best = null;
        var i = 0;
        while (i < ct.size()) {
            if (!cs[i]) { i++; continue; }
            var j = i;
            var lastStrict = i;
            var n = 1;
            while (j + 1 < ct.size()) {
                var g = ct[j + 1] - ct[j];
                if (g < GAP_LO * T || g > GAP_HI * T) { break; }
                if (!cs[j + 1] && !cs[j]) { break; }
                if ((!cs[j + 1] || !cs[j]) && (g < (1 - BRIDGE_GAP) * T || g > (1 + BRIDGE_GAP) * T)) { break; }
                j++;
                if (cs[j]) { lastStrict = j; n++; }
            }
            if (n >= BRIDGE_MIN && (best == null || n > best[2])) { best = [ct[i], ct[lastStrict], n]; }
            i = lastStrict + 1;
        }
        return best;
    }

    function stillBlock(x, y, z, b) {
        var v = 0.0;
        var axes = [x, y, z];
        for (var k = 0; k < 3; k++) {
            var a = axes[k];
            var m = mean(a, b, b + BLOCK);
            for (var i = b; i < b + BLOCK; i++) { v += (a[i] - m) * (a[i] - m); }
        }
        return Math.sqrt(v / BLOCK) <= MIN_MOTION;
    }

    // Hold the START wrist movements still: everything before the first
    // still second within TRIM_LEAD of the start, and after the last still
    // second within TRIM_TRAIL of the end. In place; bounded work.
    function trimWindow(x, y, z) {
        var n = x.size();
        if (n < 2 * BLOCK) { return; }
        for (var b = 0; b <= imin(TRIM_LEAD, n - BLOCK); b += TRIM_STEP) {
            if (!stillBlock(x, y, z, b)) { continue; }
            for (var i = 0; i < b; i++) { x[i] = x[b]; y[i] = y[b]; z[i] = z[b]; }
            break;
        }
        for (var e = n; e - BLOCK >= imax(0, n - TRIM_TRAIL - BLOCK); e -= TRIM_STEP) {
            if (!stillBlock(x, y, z, e - BLOCK)) { continue; }
            for (var i = e; i < n; i++) { x[i] = x[e - 1]; y[i] = y[e - 1]; z[i] = z[e - 1]; }
            break;
        }
    }

    function spread(t) {
        if (t.size() < 3) { return 0.0; }
        var m = 0.0;
        for (var j = 1; j < t.size(); j++) { m += t[j] - t[j - 1]; }
        m /= (t.size() - 1);
        var v = 0.0;
        for (var j = 1; j < t.size(); j++) { v += (t[j] - t[j - 1] - m) * (t[j] - t[j - 1] - m); }
        return Math.sqrt(v / (t.size() - 1)) / m;
    }

    // [reps, cv, amp, times, agree]
    function countCycles(extrema, T, ax, ay, az, raw) {
        var none = [0, 1.0, 0.0, [], false];
        var ext = extrema.ext;
        var ei = extrema.ei;
        var kind = extrema.kind;
        var at = extrema.at;
        var ns = ext.size() - 1;
        if (ns < 2) { return none; }

        // Fingerprints.
        var mag = new [ns]; var dur = new [ns];
        var dx = new [ns]; var dy = new [ns]; var dz = new [ns];
        for (var k = 0; k < ns; k++) {
            mag[k] = fabs(ext[k + 1] - ext[k]);
            dur[k] = imax(1, at[k + 1] - at[k]);
            var a = ax[ei[k + 1]] - ax[ei[k]];
            var b = ay[ei[k + 1]] - ay[ei[k]];
            var c = az[ei[k + 1]] - az[ei[k]];
            var l = Math.sqrt(a * a + b * b + c * c);
            if (l == 0) { l = 1.0; }
            dx[k] = a / l; dy[k] = b / l; dz[k] = c / l;
        }
        var keep = new [ns];
        var cos = new [ns];
        for (var k = 0; k < ns; k++) { keep[k] = false; cos[k] = 0.0; }
        var mm2 = [0.0, 0.0];
        var md2 = [1.0, 1.0];
        for (var d = 0; d < 2; d++) {
            var want = d == 0 ? -1 : 1;
            var ms = [];
            var ds = [];
            for (var k = 0; k < ns; k++) {
                if (kind[k] == want) { ms.add(mag[k]); ds.add(dur[k]); }
            }
            if (ms.size() == 0) { continue; }
            var mm = median(ms);
            var md = median(ds);
            var sx = 0.0; var sy = 0.0; var sz = 0.0;
            for (var k = 0; k < ns; k++) {
                if (kind[k] != want || mag[k] < SWING_MIN * mm || mag[k] > SWING_MAX * mm) { continue; }
                sx += dx[k]; sy += dy[k]; sz += dz[k];
            }
            var sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
            if (sl == 0) { sl = 1.0; }
            sx /= sl; sy /= sl; sz /= sl;
            mm2[d] = mm; md2[d] = md;
            for (var k = 0; k < ns; k++) {
                if (kind[k] != want) { continue; }
                cos[k] = dx[k] * sx + dy[k] * sy + dz[k] * sz;
                keep[k] = mag[k] >= CORE_LO * mm && mag[k] <= CORE_HI * mm
                    && dur[k] >= DUR_LO * md && dur[k] <= DUR_HI * md && cos[k] >= DIR_COS;
            }
        }
        cMag = mag; cDur = dur; cKind = kind; cCos = cos; cMm = mm2; cMd = md2;
        var rules = [[0.75, 0.8, 1.25, 1.7, true], [0.6, 0.6, 1.6, 2.0, false]];

        var bestN = 0;
        var bestCv = 1.0;
        var bestT = [];
        var bestAgree = false;
        for (var p = 0; p < 2; p++) {
            var pol = p == 0 ? -1 : 1;
            // Complete pairs that close on the raw signal.
            var pairs = [];
            for (var k = 0; k + 1 < ns; k++) {
                if (kind[k] != pol) { continue; }
                var a = raw[ei[k]];
                var b = raw[ei[k + 1]];
                var c = raw[ei[k + 2]];
                if (fabs(c - a) <= CLOSE * fabs(b - a)) { pairs.add(k); }
            }
            var strict = [];
            for (var j = 0; j < pairs.size(); j++) {
                var k = pairs[j];
                if (keep[k] && keep[k + 1]) { strict.add(at[k]); }
            }
            var run = rhythmRun(strict, T);
            var t0 = run[0] > 0 ? strict[run[1]] : 0;
            var t1 = run[0] > 0 ? strict[run[1] + run[0] - 1] : 0;
            // One off-size or off-speed rep must not split a set in two.
            var bridged = bridgeRun(pairs, keep, at, T);
            if (bridged != null && bridged[2] > run[0]) { t0 = bridged[0]; t1 = bridged[1]; run[0] = bridged[2]; }
            if (run[0] < 2) {
                if (run[0] > bestN) { bestN = run[0]; bestCv = 1.0; bestT = strict.slice(run[1], run[1] + 1); bestAgree = false; }
                continue;
            }
            var times = [];
            var first = -1;
            var last = -1;
            for (var j = 0; j < pairs.size(); j++) {
                var k = pairs[j];
                if (at[k] == t0) { first = j; }
                if (at[k] == t1) { last = j; }
                if (at[k] >= t0 && at[k] <= t1 && loose(k) && loose(k + 1)) { times.add(at[k]); }
            }
            var gs = [];
            for (var j = 1; j < times.size(); j++) { gs.add(times[j] - times[j - 1]); }
            var cg = gs.size() > 0 ? median(gs) : T;
            var grown = [];
            for (var ri = 0; ri < rules.size(); ri++) {
                var rule = rules[ri];
                var tt = times.slice(0, null);
                // Leading reps are collected nearest-first and joined once;
                // prepending each one copied the whole list (quadratic).
                var lead = tt[0];
                var front = [];
                for (var j = first - 1; j >= 0; j--) {
                    var k = pairs[j];
                    if (!okEdge(k, lead - at[k], false, cg, rule)) { break; }
                    front.add(at[k]);
                    lead = at[k];
                }
                if (front.size() > 0) {
                    var nt = [];
                    for (var f = front.size() - 1; f >= 0; f--) { nt.add(front[f]); }
                    nt.addAll(tt);
                    tt = nt;
                }
                for (var j = last + 1; j < pairs.size(); j++) {
                    var k = pairs[j];
                    if (!okEdge(k, at[k] - tt[tt.size() - 1], true, cg, rule)) { break; }
                    tt.add(at[k]);
                }
                grown.add(tt);
            }
            var agree = grown[0].size() == grown[1].size();
            // The readings differ by one trailing rep: a slow last rep or
            // something done after the set. A last rep closes cleanly.
            if (!agree && grown[1].size() == grown[0].size() + 1 && grown[1][0] == grown[0][0]) {
                var tk = -1;
                var tEnd = grown[1][grown[1].size() - 1];
                for (var j = 0; j < pairs.size(); j++) { if (at[pairs[j]] == tEnd) { tk = pairs[j]; break; } }
                if (tk >= 0) {
                    var tgap = (tEnd - grown[0][grown[0].size() - 1]) / cg.toFloat();
                    var den = fabs(raw[ei[tk + 1]] - raw[ei[tk]]);
                    if (den == 0) { den = 1.0; }
                    var tcl = fabs(raw[ei[tk + 2]] - raw[ei[tk]]) / den;
                    if (tcl <= TRAIL_CLOSE && tgap <= TRAIL_GAP && mag[tk + 1] >= TRAIL_SIZE * mm2[dI(tk + 1)]) {
                        grown[0] = grown[1];
                        agree = true;
                    }
                }
            }
            var cnt = grown[0];
            var cv = spread(cnt);
            if (cnt.size() > bestN || (cnt.size() == bestN && cv < bestCv)) {
                bestN = cnt.size(); bestCv = cv; bestT = cnt; bestAgree = agree;
            }
        }
        var amp = mm2[0] < mm2[1] ? mm2[0] : mm2[1];
        cMag = null; cDur = null; cKind = null; cCos = null; cMm = null; cMd = null;
        return [bestN, bestCv, amp, bestT, bestAgree];
    }

    function bestBout(all) {
        var best = -1;
        var bestScore = 0.0;
        for (var i = 0; i < all.size(); i++) {
            var r = all[i];
            if (!r[4]) { continue; }
            var score = r[0] * r[1];
            if (score >= bestScore) { best = i; bestScore = score; }
        }
        return best;
    }

    function selectBout(all) {
        var best = bestBout(all);
        if (best < 0) { return [0, false]; }
        var b = all[best];
        // A set seen only in pieces: any one piece would be an undercount.
        for (var i = 0; i < all.size(); i++) {
            var r = all[i];
            if (i == best || r[0] < 2 || r[1] < FRAG_AC) { continue; }
            // A longer, strongly periodic bout may skip every other beat.
            // Treat its doubled period as evidence that the short count is partial.
            var sameRhythm = fabs(r[3] - b[3]) <= FRAG_T * b[3];
            var doubledPeriod = r[1] >= SHORT_AC && r[0] >= b[0] && fabs(r[3] / 2.0 - b[3]) <= FRAG_HARMONIC_T * b[3];
            if (sameRhythm || doubledPeriod) { return [0, false]; }
        }
        return [b[0], true];
    }
}

// Each step processes a bounded part of a filter or correlation. The timer
// worker checks how long it has run between steps.
class RepAnalysis {
    var x; var y; var z; var steps;
    var ranges; var index = 0; var all = [];
    var walkStart = [];
    var anchor = null;
    var recovering = false;
    var phase = :motion;
    var clipped;
    var motion;
    var cursor = 0;
    var lo; var hi; var signal; var pr; var d; var correlations;
    var lag; var maxLag; var period; var ac; var w;
    var filtered; var ax; var ay; var az; var raw; var cycles;
    var spanStart; var spanEnd;
    var mx; var my; var mz;
    var cxx; var cyy; var czz; var cxy; var cxz; var cyz;
    var pairIndex; var xy; var xx; var yy;
    var filter = null;
    var extrema = null;

    // Given no arrays, the analysis copies the live motion buffers on its
    // first step (see :snapshot), so the sensor callback never does.
    function initialize(xs, ys, zs, walking, wasClipped) {
        clipped = wasClipped;
        if (xs == null) { phase = :snapshot; return; }
        prepare(xs, ys, zs, walking);
    }

    function prepare(xs, ys, zs, walking) {
        x = xs; y = ys; z = zs; steps = walking;
        // A clipped buffer no longer starts at START; leave its edge alone so
        // a set cut by the rolling window is still withdrawn.
        if (!clipped) { Reps.trimWindow(x, y, z); }
        if (!clipped && x.size() > 0) {
            x = withStartPosition(x); y = withStartPosition(y);
            z = withStartPosition(z); steps = withStartPosition(steps);
        }
        motion = new [x.size() / Reps.BLOCK];
    }

    // Extend the initial position by one block to give the centred filters
    // a baseline when the first repetition starts immediately.
    function withStartPosition(values) {
        var result = new [Reps.BLOCK];
        for (var i = 0; i < result.size(); i++) { result[i] = values[0]; }
        result.addAll(values);
        return result;
    }

    function beginLag(at) {
        pairIndex = at;
        xy = 0.0; xx = 0.0; yy = 0.0;
    }

    // Share a single pair budget across lags. Even one lag over a full
    // resolution set can take too long for the watch's event watchdog.
    function scanLags(values, start, end, savePeaks) {
        var budget = Reps.PAIR_BUDGET;
        while (lag <= maxLag && budget > 0) {
            var finish = Reps.imin(end - lag, pairIndex + budget);
            while (pairIndex < finish) {
                var a = values[pairIndex]; var b = values[pairIndex + lag];
                xy += a * b; xx += a * a; yy += b * b;
                pairIndex++;
                budget--;
            }
            if (pairIndex + lag < end) { break; }
            var value = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0.0;
            if (savePeaks) { correlations[lag] = value; }
            else if (value > ac) { ac = value; }
            lag++;
            beginLag(start);
        }
        return lag > maxLag;
    }

    function average(values, start, end, width) {
        if (filter == null) { filter = new RepAverage(values, start, end, width); }
        if (!filter.step()) { return null; }
        var result = filter.out;
        filter = null;
        return result;
    }

    // A genuine lifting rhythm that spans the step veto can recover reps
    // falsely trimmed by the wrist's walking counter.
    function beginStepRecovery() {
        if (anchor == null) { return false; }
        var full = Reps.bouts(motion, null, x.size(), []);
        motion = null;
        for (var i = 0; i < full.size(); i++) {
            if (full[i][0] == anchor[0] && full[i][1] > walkStart[0]) {
                ranges = [full[i]];
                index = 0;
                recovering = true;
                return true;
            }
        }
        return false;
    }

    function step() {
        var end;
        switch (phase) {
        case :snapshot:
            prepare(Reps.ordered(Reps.bx), Reps.ordered(Reps.by), Reps.ordered(Reps.bz), Reps.ordered(Reps.bs));
            phase = :motion;
            break;
        case :motion:
            end = Reps.imin(motion.size(), cursor + 6);
            for (; cursor < end; cursor++) { motion[cursor] = Reps.motion(x, y, z, cursor); }
            if (cursor == motion.size()) { phase = :ranges; }
            break;
        case :ranges:
            ranges = Reps.bouts(motion, steps, x.size(), walkStart);
            steps = null;
            // The set extends outside the rolling window. Withdraw even an
            // earlier offer so a partial count never becomes the set's value.
            if (clipped && ranges.size() > 0 && ranges[0][0] == 0) { return [-1, false]; }
            phase = :bout;
            break;
        case :bout:
            if (index >= ranges.size()) {
                if (!recovering && beginStepRecovery()) { break; }
                return Reps.selectBout(all);
            }
            lo = ranges[index][0]; hi = ranges[index][1]; index++;
            if (hi - lo < 38) { break; }
            mx = 0.0; my = 0.0; mz = 0.0;
            cursor = lo;
            phase = :means;
            break;
        case :means:
            end = Reps.imin(hi, cursor + Reps.SAMPLE_BUDGET);
            for (; cursor < end; cursor++) {
                mx += x[cursor]; my += y[cursor]; mz += z[cursor];
            }
            if (cursor == hi) {
                mx /= hi - lo; my /= hi - lo; mz /= hi - lo;
                cxx = 0.0; cyy = 0.0; czz = 0.0; cxy = 0.0; cxz = 0.0; cyz = 0.0;
                cursor = lo;
                phase = :covariance;
            }
            break;
        case :covariance:
            end = Reps.imin(hi, cursor + Reps.SAMPLE_BUDGET);
            for (; cursor < end; cursor++) {
                var a = x[cursor] - mx; var b = y[cursor] - my; var c = z[cursor] - mz;
                cxx += a*a; cyy += b*b; czz += c*c;
                cxy += a*b; cxz += a*c; cyz += b*c;
            }
            if (cursor == hi) {
                pr = Reps.principal(cxx, cyy, czz, cxy, cxz, cyz);
                signal = new [hi - lo];
                cursor = lo;
                phase = :project;
            }
            break;
        case :project:
            end = Reps.imin(hi, cursor + Reps.SAMPLE_BUDGET);
            for (; cursor < end; cursor++) {
                signal[cursor-lo] = pr[0]*(x[cursor]-mx) + pr[1]*(y[cursor]-my) + pr[2]*(z[cursor]-mz);
            }
            if (cursor == hi) { phase = :slow; }
            break;
        case :slow:
            filtered = average(signal, 0, signal.size(), 63);
            if (filtered != null) {
                d = new [signal.size() / 2];
                cursor = 0;
                phase = :detrend;
            }
            break;
        case :detrend:
            end = Reps.imin(d.size(), cursor + Reps.SAMPLE_BUDGET);
            for (; cursor < end; cursor++) {
                var j = 2 * cursor;
                d[cursor] = ((signal[j]-filtered[j]) + (signal[j+1]-filtered[j+1])) / 2.0;
            }
            if (cursor < d.size()) { break; }
            filtered = null;
            maxLag = Reps.imin(Reps.LAG_MAX, d.size()/2) + 1;
            if (maxLag <= Reps.LAG_MIN + 2) { signal = null; d = null; phase = :bout; break; }
            correlations = new [maxLag + 1];
            lag = Reps.LAG_MIN - 1;
            beginLag(0);
            phase = :lags;
            break;
        case :lags:
            if (scanLags(d, 0, d.size(), true)) {
                var pd = Reps.selectPeriod(correlations, maxLag - 1);
                period = pd[0]; ac = pd[1]; d = null; correlations = null;
                phase = period > 0 && hi-lo >= 1.8*period ? :baseline : :bout;
                if (phase == :bout) { signal = null; }
            }
            break;
        case :baseline:
            filtered = average(signal, 0, signal.size(), Reps.imax(3, Reps.rnd(period)));
            if (filtered != null) { cursor = 0; phase = :subtract; }
            break;
        case :subtract:
            end = Reps.imin(filtered.size(), cursor + Reps.SAMPLE_BUDGET);
            for (; cursor < end; cursor++) { filtered[cursor] = signal[cursor] - filtered[cursor]; }
            if (cursor == filtered.size()) {
                w = Reps.imax(1, Reps.rnd(period/5.0));
                phase = :smooth;
            }
            break;
        case :smooth:
            var smoothed = average(filtered, 0, filtered.size(), w);
            if (smoothed != null) { filtered = smoothed; phase = :axisX; }
            break;
        case :axisX: ax = average(x, lo, hi, w); if (ax != null) { phase = :axisY; } break;
        case :axisY: ay = average(y, lo, hi, w); if (ay != null) { phase = :axisZ; } break;
        case :axisZ: az = average(z, lo, hi, w); if (az != null) { phase = :raw; } break;
        case :raw:
            raw = average(signal, 0, signal.size(), w);
            if (raw != null) {
                signal = null;
                extrema = new RepExtrema(filtered, period);
                phase = :extrema;
            }
            break;
        case :extrema:
            if (extrema.step()) { phase = :cycles; }
            break;
        case :cycles:
            cycles = Reps.countCycles(extrema, period, ax, ay, az, raw);
            extrema = null;
            ax = null; ay = null; az = null; raw = null;
            if (cycles[0] < 2) { phase = :finish; break; }
            var times = cycles[3];
            spanStart = Reps.imax(0, times[0]-Reps.rnd(0.6*period));
            spanEnd = Reps.imin(hi-lo, times[times.size()-1]+Reps.rnd(1.2*period));
            lag = Reps.imax(1, (0.85*period).toNumber());
            maxLag = Math.ceil(1.15*period).toNumber();
            ac = 0.0;
            beginLag(spanStart);
            phase = :span;
            break;
        case :span:
            if (scanLags(filtered, spanStart, spanEnd, false)) { phase = :finish; }
            break;
        case :finish:
            var few = cycles[0] <= Reps.SHORT_REPS;
            var ok = ac >= (few ? Reps.SHORT_AC : Reps.MIN_AC)
                && hi - lo <= (cycles[0] + 3) * period * 1.3
                && cycles[1] <= (few ? Reps.SHORT_CV : Reps.MAX_CV)
                && cycles[0] >= Reps.MIN_REPS && cycles[2] >= Reps.MIN_AMP && cycles[4];
            if (recovering) {
                if (ok && ac >= 0.8 && cycles[1] <= 0.24 && Reps.fabs(period - anchor[3]) <= 0.2 * anchor[3]) {
                    var best = Reps.bestBout(all);
                    var largest = best < 0 ? 0 : all[best][0];
                    var before = 0;
                    var crossings = cycles[3];
                    for (var i = 0; i < crossings.size(); i++) {
                        if (lo + crossings[i] < walkStart[0]) { before++; }
                    }
                    if (cycles[0] >= largest + 3 && before >= 3 && crossings.size() - before >= 3) {
                        return [cycles[0], true];
                    }
                }
            } else {
                var result = [cycles[0], ac, cycles[1], period, ok];
                all.add(result);
                if (anchor == null && ok && walkStart.size() > 0 && Reps.fabs(hi - walkStart[0]) <= Reps.BLOCK) {
                    anchor = [lo, hi, ac, period];
                }
            }
            cycles = null; filtered = null;
            phase = :bout;
            break;
        }
        return null;
    }
}

// Finds hysteresis crossings after measuring the signal's typical size.
class RepExtrema {
    var values; var width; var refr;
    var ext = []; var ei = []; var kind = []; var at = [];
    var scales = []; var sum = 0.0;
    var cursor = 0;
    var threshold = null;
    var state = 0;
    var lastUp = -1000000; var lastDown = -1000000;
    var low; var high; var lowIndex = 0; var highIndex = 0;

    function initialize(series, period) {
        values = series;
        width = Reps.imax(4, Reps.rnd(period));
        refr = 0.45 * period;
        low = values[0]; high = low;
    }

    function step() {
        if (threshold == null) {
            var fullWindows = values.size() - values.size() % width;
            var end = Reps.imin(fullWindows, cursor + Reps.SAMPLE_BUDGET);
            for (; cursor < end; cursor++) {
                var value = values[cursor];
                sum += value * value;
                if ((cursor + 1) % width == 0) {
                    scales.add(Math.sqrt(sum / width));
                    sum = 0.0;
                }
            }
            if (cursor == fullWindows) {
                if (scales.size() == 0) { return true; }
                threshold = 0.45 * Reps.median(scales);
                scales = null;
                cursor = 0;
            }
            return false;
        }

        var end = Reps.imin(values.size(), cursor + Reps.SAMPLE_BUDGET);
        for (; cursor < end; cursor++) {
            var value = values[cursor];
            if (value < low) { low = value; lowIndex = cursor; }
            if (value > high) { high = value; highIndex = cursor; }
            if (state != 1 && value > threshold && cursor - lastUp >= refr) {
                ext.add(low); ei.add(lowIndex); kind.add(-1); at.add(cursor);
                state = 1; lastUp = cursor;
            } else if (state != -1 && value < -threshold && cursor - lastDown >= refr) {
                ext.add(high); ei.add(highIndex); kind.add(1); at.add(cursor);
                state = -1; lastDown = cursor;
            } else {
                continue;
            }
            low = value; high = value; lowIndex = cursor; highIndex = cursor;
        }
        if (cursor < values.size()) { return false; }
        if (state == 1) { ext.add(high); ei.add(highIndex); kind.add(1); }
        else { ext.add(low); ei.add(lowIndex); kind.add(-1); }
        at.add(values.size());
        return true;
    }
}

// Centred moving average with shrinking edges. Read the source in place and
// carry the running sum across callbacks so the window retains its shape.
class RepAverage {
    var source; var start; var half;
    var out;
    var cursor = 0;
    var lo = 0; var hi = 0; var sum = 0.0;

    function initialize(values, from, to, width) {
        source = values; start = from; half = width / 2;
        out = new [to - from];
    }

    function step() {
        var end = Reps.imin(out.size(), cursor + Reps.SAMPLE_BUDGET);
        for (; cursor < end; cursor++) {
            var wantLo = Reps.imax(0, cursor - half);
            var wantHi = Reps.imin(out.size(), cursor + half + 1);
            while (hi < wantHi) { sum += source[start + hi]; hi++; }
            while (lo < wantLo) { sum -= source[start + lo]; lo++; }
            out[cursor] = half == 0 ? source[start + cursor] : sum / (hi - lo);
        }
        return cursor == out.size();
    }
}
