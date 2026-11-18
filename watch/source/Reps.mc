using Toybox.ActivityMonitor;
using Toybox.Lang;
using Toybox.Math;
using Toybox.Sensor;
using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;

// Counts reps from wrist motion while a set or rest screen is up, and offers
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
    const LAG_MIN = 8;
    const LAG_MAX = 40;
    const PICK = 0.85;
    const MIN_AC = 0.60;
    const MAX_CV = 0.32;
    const MIN_REPS = 3;
    const SHORT_REPS = 4;
    const SHORT_AC = 0.7;
    const SHORT_CV = 0.15;
    const FRAG_AC = 0.35;
    const FRAG_T = 0.25;
    const SWING_MIN = 0.45;
    const SWING_MAX = 2.4;
    const MIN_AMP = 0.06;
    const GAP_LO = 0.6;
    const GAP_HI = 1.6;
    const CORE_LO = 0.72;
    const CORE_HI = 1.4;
    const DUR_LO = 0.6;
    const DUR_HI = 1.7;
    const DIR_COS = 0.85;
    const EDGE_SIZE_HI = 1.45;
    const EDGE_DUR_LO = 0.6;
    const EDGE_DUR_HI = 1.6;
    const TRAIL_DUR_HI = 2.2;
    const EDGE_COS = 0.88;
    const CLOSE = 0.4;
    const WALK_STEPS = 5;
    const WALK_WIN = 4;

    const RATE = 25;           // Hz asked of the sensor
    const MAX_SAMPLES = 938;   // 75 s at 12.5 Hz
    const BATCH_MS = 1000;
    const PREVIEW_EVERY = 3;  // sensor batches between in-set estimates
    const PAIR_BUDGET = 256;   // maximum correlation pairs per timer callback
    const SAMPLE_BUDGET = 128; // maximum filter samples per timer callback

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
    var lastSample = null;
    var revision = 0;
    var jobRevision = 0;
    var offeredRevision = 0;
    var batches = 0;
    var lastResult = null;
    var sensorStatus = "idle";
    var head = 0;              // oldest entry once the motion buffer is full
    var clipped = false;

    var job = null;
    var worker = null;

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
    }

    // A new set: forget the motion so far.
    function reset() {
        clearMotion();
        manual = false;
        interrupted = false;
    }

    function clearMotion() {
        cancelAnalysis();
        bx = []; by = []; bz = []; bs = [];
        carry = null;
        count = null;
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

    function takeOver() {
        cancelAnalysis();
        manual = true;
    }

    function inputGap(reason, detail) {
        interrupted = sawMotion;
        if (interrupted || !sensorStatus.equals(reason)) {
            System.println("reps: " + reason + " (" + detail + ") after " + batches + " batches");
        }
        clearMotion();
        sensorStatus = reason;
    }

    // The reps the set screen should show: the confident count unless the
    // user has taken over, else null (keep whatever is there).
    function offer() {
        if (manual || count == null) { return null; }
        return count;
    }

    function start() {
        if (listening || (Config.DEMO_DATA && Config.TOUR) || !enabled()) { return; }
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
            Sensor.registerSensorDataListener(new Lang.Method(Reps, :onData), {
                :period => 1,
                :accelerometer => { :enabled => true, :sampleRate => RATE, :includeTimestamps => true }
            });
            listening = true;
            sensorStatus = "waiting";
            System.println("reps: listening at " + RATE + " Hz (max " + maxRate + ")");
        } catch (e) {
            System.println("reps: no accelerometer " + e.getErrorMessage());
            sensorStatus = "unavailable";
            listening = false;
        }
    }

    function stop() {
        cancelAnalysis();
        if (!listening) { return; }
        System.println("reps: stopped" + diagnostics());
        listening = false;
        sensorStatus = "idle";
        try { Sensor.unregisterSensorDataListener(); } catch (e) { }
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
        if (!listening || manual || interrupted) { return; }
        var a = data == null ? null : data.accelerometerData;
        if (a == null || a.x == null || a.y == null || a.z == null) {
            inputGap("missing accelerometer", null);
            return;
        }
        onSamples(a.x, a.y, a.z, a.timestamp, System.getTimer(), stepsNow());
    }

    function onSamples(xs, ys, zs, timestamps, now, steps) {
        var n = xs.size();
        if (n == 0 || n > 2 * RATE || ys.size() != n || zs.size() != n) {
            inputGap("invalid sample count", n);
            return;
        }
        var time = timestamps != null && timestamps.size() == n && n > 1 && timestamps[n - 1] > timestamps[0]
            ? timestamps : null;
        // Use sample time where the firmware supplies it. A late callback
        // can still carry contiguous samples.
        var gap = time != null && lastSample != null ? time[0] - lastSample : null;
        var delay = lastBatch == null ? 0 : now - lastBatch;
        // Some firmware can report timestamps relative to each batch. Use
        // delivery time if the timestamp starts over.
        if ((gap != null && gap > 200)
            || ((gap == null || gap <= 0) && (delay < 0 || delay > 3 * BATCH_MS))) {
            inputGap("sample gap", gap != null && gap > 0 ? gap : delay);
            if (interrupted) { return; }
        }
        if (time == null && (n < RATE - 4 || n > RATE + 4)) {
            inputGap("unexpected sample count", n);
            return;
        }
        // The classifier expects 25 Hz before pair averaging. Suppress
        // counts when the reported cadence is substantially different.
        if (time != null) {
            var averageMs = (time[n - 1] - time[0]).toFloat() / (n - 1);
            if (averageMs < 32.0 || averageMs > 50.0) {
                inputGap("unexpected sample spacing", averageMs);
                return;
            }
        }
        if (!sensorStatus.equals("receiving")) {
            System.println("reps: received " + n + " samples, timestamps=" + (time != null));
            sensorStatus = "receiving";
        }
        lastBatch = now;
        lastSample = time == null ? null : time[n - 1];
        batches++;
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
            if (movingBatches >= 2 && revision - offeredRevision >= PREVIEW_EVERY) { count = null; }
            if (revision % PREVIEW_EVERY == 0) { update(); }
        } else {
            if (movingBatches > 0 && job != null && revision - jobRevision >= PREVIEW_EVERY) {
                cancelAnalysis();
            }
            movingBatches = 0;
            update();
        }
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
        // The sensor keeps appending while this snapshot is being analyzed.
        job = new RepAnalysis(ordered(bx), ordered(by), ordered(bz), ordered(bs), clipped);
        worker = new Timer.Timer();
        worker.start(new Lang.Method(Reps, :advanceAnalysis), 50, true);
    }

    function advanceAnalysis() {
        if (manual || !listening || job == null) { cancelAnalysis(); return; }
        var result = job.step();
        if (result == null) { return; }
        lastResult = result;
        cancelAnalysis();
        var fresh = revision - jobRevision < PREVIEW_EVERY;
        var offered = result[1] && fresh ? result[0] : null;
        if (offered != null) { offeredRevision = jobRevision; }
        if (count != offered) {
            count = offered;
            WatchUi.requestUpdate();
        }
        if (movingBatches == 0) { update(); }
    }

    function repLabel() {
        if (offer() != null) { return "AUTO"; }
        if (!Workout.setRunning()) { return "REPS"; }
        if (manual || interrupted || !listening) { return "MANUAL"; }
        if (job != null) { return "CHECKING"; }
        return batches == 0 ? "WAITING" : "TRACKING";
    }

    function diagnostics() {
        return " sensor=" + sensorStatus + " batches=" + batches + " motion=" + revision
            + " result=" + lastResult + " gap=" + interrupted;
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

    function bouts(mo, steps, n) {
        var nb = mo.size();
        var out = [];
        if (nb < 3) { return out; }
        var thr = 0.15 * median(mo);
        if (thr < MIN_MOTION) { thr = MIN_MOTION; }
        var act = new [nb];
        for (var b = 0; b < nb; b++) {
            var b0 = imax(0, b - WALK_WIN / 2);
            var b1 = imin(nb - 1, b0 + WALK_WIN);
            var walk = steps[imin(n - 1, b1 * BLOCK + BLOCK - 1)] - steps[b0 * BLOCK] >= WALK_STEPS;
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
            if (run[0] < 2) {
                if (run[0] > bestN) { bestN = run[0]; bestCv = 1.0; bestT = strict.slice(run[1], run[1] + 1); bestAgree = false; }
                continue;
            }
            var t0 = strict[run[1]];
            var t1 = strict[run[1] + run[0] - 1];
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
                for (var j = first - 1; j >= 0; j--) {
                    var k = pairs[j];
                    if (!okEdge(k, tt[0] - at[k], false, cg, rule)) { break; }
                    var nt = [at[k]];
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

    function selectBout(all) {
        var best = -1;
        var bestScore = 0.0;
        for (var i = 0; i < all.size(); i++) {
            var r = all[i];
            if (!r[4]) { continue; }
            var score = r[0] * r[1];
            if (score >= bestScore) { best = i; bestScore = score; }
        }
        if (best < 0) { return [0, false]; }
        var b = all[best];
        // A set seen only in pieces: any one piece would be an undercount.
        for (var i = 0; i < all.size(); i++) {
            var r = all[i];
            if (i == best || r[0] < 2 || r[1] < FRAG_AC) { continue; }
            if (fabs(r[3] - b[3]) <= FRAG_T * b[3]) { return [0, false]; }
        }
        return [b[0], true];
    }
}

// Each step returns to the event loop before the next filter or correlation
// batch. Even a full motion buffer cannot monopolize a sensor callback.
class RepAnalysis {
    var x; var y; var z; var steps;
    var ranges; var index = 0; var all = [];
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

    function initialize(xs, ys, zs, walking, wasClipped) {
        x = xs; y = ys; z = zs; steps = walking;
        clipped = wasClipped;
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

    function step() {
        var end;
        switch (phase) {
        case :motion:
            end = Reps.imin(motion.size(), cursor + 6);
            for (; cursor < end; cursor++) { motion[cursor] = Reps.motion(x, y, z, cursor); }
            if (cursor == motion.size()) { phase = :ranges; }
            break;
        case :ranges:
            ranges = Reps.bouts(motion, steps, x.size());
            motion = null; steps = null;
            // The set extends outside the rolling window. Withdraw even an
            // earlier offer so a partial count never becomes the set's value.
            if (clipped && ranges.size() > 0 && ranges[0][0] == 0) { return [-1, false]; }
            phase = :bout;
            break;
        case :bout:
            if (index >= ranges.size()) { return Reps.selectBout(all); }
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
            all.add([cycles[0], ac, cycles[1], period, ok]);
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
