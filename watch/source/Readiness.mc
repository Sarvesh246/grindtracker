using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Math;
using Toybox.Sensor;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

// Morning readiness check: one minute of beat-to-beat intervals while you
// sit still, turned into RMSSD (heart-rate variability). Home -> MENU ->
// Readiness check, only with no workout open (one sensor listener at a time).
//
//   settle   10 s   the heart rate calms after you sit down; nothing kept
//   measure  60 s   intervals from the heartBeatIntervals listener, plus the
//                   accelerometer to notice movement
//
// The maths mirrors src/lib/body/hrv.ts exactly (range 300-2000 ms, 20% off
// the median of the 11 around it, RMSSD over clean adjacent pairs, the same
// quality rules) so the number on the watch is the number GRIND stores. The
// server recomputes from the raw intervals anyway and that copy is the one
// that counts. Uploaded through the rep lab queue as "lr_<id>" (POST
// /readiness), whatever Rep lab is set to: it is your reading, not tuning data.
module Readiness {
    const SETTLE_S = 10;
    const MEASURE_S = 60;
    const MAX_BEATS = 200;
    const MOVE_MG = 60;        // a batch whose |a| varies more than this (milli-g RMS) is movement
    const SILENT_S = 15;       // no intervals by now: this watch isn't delivering them

    var state = :idle;         // :idle :settle :measure :done :fail
    var rr = [];
    var moving = 0;
    var startedAt = 0;         // ms timer
    var measureAt = 0;
    var lastBatch = 0;
    var recentMove = false;
    var hr = null;
    var result = null;         // analyze() output
    var reason = null;         // why it failed
    var listening = false;

    function begin() {
        if (Workout.active() || Reps.listening) { fail("Finish the workout first"); return; }
        rr = []; moving = 0; result = null; reason = null; recentMove = false; hr = null;
        try {
            // Recorder.stop turns the heart-rate sensor off after a workout,
            // and nothing else turns it on again: this check needs it on.
            Recorder.enableHr(true);
            Sensor.registerSensorDataListener(new Lang.Method(Readiness, :onData), {
                :period => 1,
                :accelerometer => { :enabled => true, :sampleRate => 25 },
                :heartBeatIntervals => { :enabled => true }
            });
            listening = true;
        } catch (e) {
            fail("Heartbeat data unavailable");
            return;
        }
        startedAt = System.getTimer();
        lastBatch = startedAt;
        state = :settle;
    }

    function stop() {
        if (!listening) { return; }
        listening = false;
        try { Sensor.unregisterSensorDataListener(); } catch (e) { }
        // Back to the state it was in before the check: off, since no
        // workout is open (the check never starts during one).
        if (!Workout.active()) { Recorder.enableHr(false); }
    }

    function cancel() {
        stop();
        state = :idle;
    }

    function fail(why) {
        stop();
        reason = why;
        state = :fail;
    }

    function elapsed() { return (System.getTimer() - startedAt) / 1000; }

    // Seconds left in the current phase, for the screen.
    function left() {
        if (state == :settle) { return Logic.clamp(SETTLE_S - elapsed(), 0, SETTLE_S); }
        if (state == :measure) { return Logic.clamp(MEASURE_S - (System.getTimer() - measureAt) / 1000, 0, MEASURE_S); }
        return 0;
    }

    // Spread of the acceleration magnitude in one batch, milli-g.
    function spread(a) {
        if (a == null || a.x == null || a.x.size() < 2) { return 0; }
        var n = a.x.size();
        var m = new [n];
        var mean = 0.0;
        for (var i = 0; i < n; i++) {
            var v = Math.sqrt((a.x[i] * a.x[i] + a.y[i] * a.y[i] + a.z[i] * a.z[i]).toFloat());
            m[i] = v;
            mean += v;
        }
        mean /= n;
        var s = 0.0;
        for (var i = 0; i < n; i++) { s += (m[i] - mean) * (m[i] - mean); }
        return Math.sqrt(s / n);
    }

    function onData(data) {
        if (!listening) { return; }
        try {
            lastBatch = System.getTimer();
            var info = Sensor.getInfo();
            if (info != null && info.heartRate != null) { hr = info.heartRate; }
            recentMove = spread(data.accelerometerData) > MOVE_MG;
            if (state == :settle) {
                if (elapsed() >= SETTLE_S) { state = :measure; measureAt = System.getTimer(); rr = []; moving = 0; }
                return;
            }
            if (state != :measure) { return; }
            if (recentMove) { moving++; }
            var h = data.heartRateData;
            if (h != null && h.heartBeatIntervals != null) {
                var b = h.heartBeatIntervals;
                for (var i = 0; i < b.size() && rr.size() < MAX_BEATS; i++) {
                    if (b[i] != null) { rr.add(b[i].toNumber()); }
                }
            }
            var t = (System.getTimer() - measureAt) / 1000;
            if (t >= SILENT_S && rr.size() == 0) { fail("No heartbeat data. Tighten the strap"); return; }
            if (t >= MEASURE_S) { finish(); }
        } catch (e) {
            fail("Check failed");
        }
    }

    // Called every second by the screen: catches a listener that went quiet.
    function tick() {
        if ((state == :settle || state == :measure) && System.getTimer() - lastBatch > 5000) {
            fail("Sensor stopped. Try again");
        }
    }

    function finish() {
        stop();
        result = analyze(rr, moving);
        state = :done;
        upload();
    }

    function upload() {
        if (Config.DEMO_DATA || rr.size() == 0) { return; }
        try {
            var id = Logic.uuid4();
            var now = Time.now().value();
            Lab.push("lr_" + id, { "sid" => null, "body" => {
                "id" => id, "local_date" => Logic.localDate(), "measured_at" => Logic.isoUtc(now - MEASURE_S),
                "duration_s" => MEASURE_S, "rr_ms" => rr, "moving_s" => moving,
                "watch_rmssd" => result["rmssd"], "app_version" => Lab.VERSION
            } });
            if (gNet != null) { gNet.flush(); }
        } catch (e) {
            System.println("readiness upload " + e.getErrorMessage());
        }
    }

    // --- the maths, as in src/lib/body/hrv.ts ---------------------------------

    function cleanMask(r) {
        var n = r.size();
        var inRange = new [n];
        for (var i = 0; i < n; i++) { inRange[i] = r[i] >= 300 && r[i] <= 2000; }
        var mask = new [n];
        for (var i = 0; i < n; i++) {
            if (!inRange[i]) { mask[i] = false; continue; }
            var around = [];
            var lo = i - 5 < 0 ? 0 : i - 5;
            var hi = i + 5 > n - 1 ? n - 1 : i + 5;
            for (var j = lo; j <= hi; j++) { if (j != i && inRange[j]) { around.add(r[j]); } }
            if (around.size() < 4) { mask[i] = true; continue; }
            var m = Reps.median(around);
            mask[i] = (r[i] - m).abs() <= 0.2 * m;
        }
        return mask;
    }

    function round1(v) { return Math.round(v * 10.0) / 10.0; }

    // { rmssd, meanHr, pairs, cleanBeats, artifactPct, quality, reason }
    function analyze(r, movingS) {
        var n = r.size();
        var mask = cleanMask(r);
        var sum2 = 0.0;
        var pairs = 0;
        var clean = 0;
        var total = 0.0;
        for (var i = 0; i < n; i++) {
            if (mask[i]) { clean++; total += r[i]; }
            if (i > 0 && mask[i] && mask[i - 1]) {
                var d = (r[i] - r[i - 1]).toFloat();
                sum2 += d * d;
                pairs++;
            }
        }
        var artifactPct = n == 0 ? 100.0 : round1(100.0 * (n - clean) / n);
        var rmssd = pairs > 0 ? round1(Math.sqrt(sum2 / pairs)) : null;
        var meanHr = clean > 0 ? round1(60000.0 / (total / clean)) : null;
        var q = "poor";
        var why = null;
        if (pairs >= 40 && artifactPct <= 10 && movingS < 5) { q = "good"; }
        else if (pairs >= 30 && artifactPct <= 20 && movingS < 10) { q = "fair"; }
        else { why = movingS >= 10 ? "moving" : pairs < 30 ? "too few beats" : "too many artifacts"; }
        if (rmssd != null && rmssd < 1) { q = "poor"; why = "flat signal"; }
        return { "rmssd" => rmssd, "meanHr" => meanHr, "pairs" => pairs, "cleanBeats" => clean,
            "artifactPct" => artifactPct, "quality" => q, "reason" => why };
    }

    // Today's reading against your usual range from /today, as one line.
    function verdict() {
        var hv = Store.hrvRange();
        if (result == null || result["rmssd"] == null) { return null; }
        if (hv == null) { return "Building your usual range"; }
        var v = result["rmssd"];
        if (v < hv["lo"]) { return "Below your usual " + hv["lo"] + "-" + hv["hi"]; }
        if (v > hv["hi"]) { return "Above your usual " + hv["lo"] + "-" + hv["hi"]; }
        return "Within your usual " + hv["lo"] + "-" + hv["hi"];
    }
}

class ReadinessView extends WatchUi.View {
    function initialize() { View.initialize(); }

    function onShow() { Clock.view = self; }
    function onHide() { if (Clock.view == self) { Clock.view = null; } }

    function onSecond() {
        Readiness.tick();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        Draw.clear(dc);
        var s = Readiness.state;
        if (s == :idle) {
            Draw.line(dc, 0.22, [Graphics.FONT_TINY], "READINESS", Config.DIM);
            Draw.line(dc, 0.40, [Graphics.FONT_SMALL, Graphics.FONT_TINY], "Sit still", Config.FG);
            Draw.line(dc, 0.52, [Graphics.FONT_TINY, Graphics.FONT_XTINY], "Breathe normally", Config.FG);
            Draw.line(dc, 0.64, [Graphics.FONT_XTINY], "Best right after waking", Config.DIM);
            Draw.line(dc, 0.78, [Graphics.FONT_XTINY], "START for 70 s", Config.ACCENT);
            Draw.startCue(dc, Config.FG);
            return;
        }
        if (s == :settle || s == :measure) {
            var total = s == :settle ? Readiness.SETTLE_S : Readiness.MEASURE_S;
            var left = Readiness.left();
            Draw.ring(dc, (total - left).toFloat() / total, s == :settle ? Config.DIM : Config.ACCENT);
            Draw.line(dc, 0.25, [Graphics.FONT_TINY], s == :settle ? "SETTLING" : "MEASURING", Config.DIM);
            Draw.line(dc, 0.47, [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM], left.toString(), Config.FG);
            var hr = Readiness.hr == null ? "--" : Readiness.hr.toString();
            Draw.line(dc, 0.66, [Graphics.FONT_TINY, Graphics.FONT_XTINY],
                s == :measure ? "HR " + hr + "  ·  " + Readiness.rr.size() + " beats" : "HR " + hr, Config.FG);
            if (Readiness.recentMove) { Draw.line(dc, 0.77, [Graphics.FONT_XTINY], "Hold still", Config.ACCENT); }
            return;
        }
        if (s == :fail) {
            Draw.line(dc, 0.30, [Graphics.FONT_TINY], "NO READING", Config.DIM);
            Draw.line(dc, 0.48, [Graphics.FONT_TINY, Graphics.FONT_XTINY], Readiness.reason == null ? "Try again" : Readiness.reason, Config.FG);
            Draw.line(dc, 0.70, [Graphics.FONT_XTINY], "START to try again", Config.ACCENT);
            return;
        }
        var r = Readiness.result;
        if (r == null || r["rmssd"] == null || r["quality"].equals("poor")) {
            Draw.line(dc, 0.28, [Graphics.FONT_TINY], "POOR SIGNAL", Config.DIM);
            var why = r == null || r["reason"] == null ? "Try again" : r["reason"].equals("moving") ? "You moved too much" : "Too many missed beats";
            Draw.line(dc, 0.46, [Graphics.FONT_TINY, Graphics.FONT_XTINY], why, Config.FG);
            Draw.line(dc, 0.60, [Graphics.FONT_XTINY], "Sit still, strap snug", Config.DIM);
            Draw.line(dc, 0.74, [Graphics.FONT_XTINY], "START to try again", Config.ACCENT);
            return;
        }
        Draw.line(dc, 0.22, [Graphics.FONT_TINY], "HRV", Config.DIM);
        Draw.line(dc, 0.42, [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM], r["rmssd"].toNumber().toString(), Config.FG);
        Draw.line(dc, 0.57, [Graphics.FONT_XTINY], "ms RMSSD  ·  HR " + (r["meanHr"] == null ? "--" : r["meanHr"].toNumber().toString()), Config.DIM);
        var v = Readiness.verdict();
        if (v != null) { Draw.line(dc, 0.69, [Graphics.FONT_TINY, Graphics.FONT_XTINY], v, Config.FG); }
        Draw.line(dc, 0.80, [Graphics.FONT_XTINY], r["quality"].equals("good") ? "Good signal" : "Fair signal", Config.DIM);
    }
}

class ReadinessDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }

    // START: begin, retry, or close a finished reading.
    function onSelect() {
        var s = Readiness.state;
        if (s == :idle || s == :fail || (s == :done && (Readiness.result == null || Readiness.result["quality"].equals("poor")))) {
            Readiness.begin();
            Nav.buzz(55);
        } else if (s == :done) {
            Readiness.state = :idle;
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            return true;
        }
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() {
        Readiness.cancel();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onTap(evt) { return true; }
}
