using Toybox.ActivityMonitor;
using Toybox.Lang;
using Toybox.Math;
using Toybox.Sensor;
using Toybox.System;
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
    const MIN_AC = 0.45;
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
    const EVERY = 3;           // analyse every 3rd one-second batch, if moved

    // --- live state -------------------------------------------------------
    var bx = [];
    var by = [];
    var bz = [];
    var bs = [];               // step counter, per sample
    var carry = null;          // odd sample waiting for its pair
    var count = null;          // confident rep count, or null
    var manual = false;        // the user changed reps by hand: stop offering
    var listening = false;
    var batches = 0;
    var dirty = false;         // moved since the last analysis

    // On unless switched off in the Home menu.
    function enabled() {
        var v = Store.get("rc");
        return v == null || v == true;
    }

    function setEnabled(on) {
        Store.put("rc", on);
        if (!on) { stop(); reset(); }
    }

    // A new set: forget the motion so far.
    function reset() {
        bx = []; by = []; bz = []; bs = [];
        carry = null;
        count = null;
        manual = false;
        batches = 0;
        dirty = false;
    }

    // The reps the set screen should show: the confident count unless the
    // user has taken over, else null (keep whatever is there).
    function offer() {
        if (manual || count == null || !enabled()) { return null; }
        return count;
    }

    function start() {
        if (listening || !enabled()) { return; }
        try {
            if (!(Sensor has :registerSensorDataListener)) { return; }
            if (Sensor has :getMaxSampleRate && Sensor.getMaxSampleRate() < RATE) { return; }
            Sensor.registerSensorDataListener(new Lang.Method(Reps, :onData), {
                :period => 1,
                :accelerometer => { :enabled => true, :sampleRate => RATE }
            });
            listening = true;
        } catch (e) {
            System.println("reps: no accelerometer " + e.getErrorMessage());
            listening = false;
        }
    }

    function stop() {
        if (!listening) { return; }
        try { Sensor.unregisterSensorDataListener(); } catch (e) { }
        listening = false;
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
        var a = data.accelerometerData;
        if (a == null || a.x == null || a.y == null || a.z == null) { return; }
        var st = stepsNow();
        var n = a.x.size();
        for (var i = 0; i < n; i++) {
            var x = a.x[i] / 1000.0;
            var y = a.y[i] / 1000.0;
            var z = a.z[i] / 1000.0;
            if (carry == null) {
                carry = [x, y, z];
            } else {
                bx.add((carry[0] + x) / 2.0);
                by.add((carry[1] + y) / 2.0);
                bz.add((carry[2] + z) / 2.0);
                bs.add(st);
                carry = null;
            }
        }
        var over = bx.size() - MAX_SAMPLES;
        if (over > 0) {
            bx = bx.slice(over, null); by = by.slice(over, null);
            bz = bz.slice(over, null); bs = bs.slice(over, null);
        }
        batches += 1;
        if (moving()) { dirty = true; }
        if (batches % EVERY == 0) { update(); }
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
            var m = mean(a, n - BLOCK, n);
            for (var i = n - BLOCK; i < n; i++) { v += (a[i] - m) * (a[i] - m); }
        }
        return Math.sqrt(v / BLOCK) > MIN_MOTION;
    }

    function update() {
        if (manual || !enabled() || !dirty) { return; }
        dirty = false;
        var r = analyze(bx, by, bz, bs);
        // Keep the last confident count when a later look is unsure (say,
        // walking off after the set); replace it only with a newer one.
        if (r[1]) {
            if (count != r[0]) { WatchUi.requestUpdate(); }
            count = r[0];
        }
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

    // Centred moving average with shrinking edges, O(n).
    function movAvg(a, w) {
        var n = a.size();
        var out = new [n];
        if (w <= 1) {
            for (var i = 0; i < n; i++) { out[i] = a[i]; }
            return out;
        }
        var half = w / 2;
        var lo = 0;
        var hi = 0;
        var s = 0.0;
        for (var i = 0; i < n; i++) {
            var wantLo = imax(0, i - half);
            var wantHi = imin(n, i + half + 1);
            while (hi < wantHi) { s += a[hi]; hi++; }
            while (lo < wantLo) { s -= a[lo]; lo++; }
            out[i] = s / (hi - lo);
        }
        return out;
    }

    // Median of a copy (insertion sort: the arrays are small).
    function median(src) {
        var n = src.size();
        if (n == 0) { return 0.0; }
        var a = src.slice(0, null);
        for (var i = 1; i < n; i++) {
            var v = a[i];
            var j = i - 1;
            while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
            a[j + 1] = v;
        }
        return n % 2 == 1 ? a[(n - 1) / 2].toFloat() : (a[n / 2 - 1] + a[n / 2]) / 2.0;
    }

    // --- 1. motion bouts ------------------------------------------------------

    function bouts(x, y, z, steps) {
        var n = x.size();
        var nb = n / BLOCK;
        var out = [];
        if (nb < 3) { return out; }
        var mo = new [nb];
        for (var b = 0; b < nb; b++) {
            var lo = b * BLOCK;
            var hi = lo + BLOCK;
            var v = 0.0;
            var axes = [x, y, z];
            for (var k = 0; k < 3; k++) {
                var a = axes[k];
                var m = mean(a, lo, hi);
                var s = 0.0;
                for (var i = lo; i < hi; i++) { s += (a[i] - m) * (a[i] - m); }
                v += s / BLOCK;
            }
            mo[b] = Math.sqrt(v);
        }
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

    function principal(x, y, z, lo, hi) {
        var mx = mean(x, lo, hi);
        var my = mean(y, lo, hi);
        var mz = mean(z, lo, hi);
        var cxx = 0.0; var cyy = 0.0; var czz = 0.0;
        var cxy = 0.0; var cxz = 0.0; var cyz = 0.0;
        for (var i = lo; i < hi; i++) {
            var a = x[i] - mx;
            var b = y[i] - my;
            var c = z[i] - mz;
            cxx += a * a; cyy += b * b; czz += c * c; cxy += a * b; cxz += a * c; cyz += b * c;
        }
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
        return [vx, vy, vz, mx, my, mz];
    }

    // --- 3. period ------------------------------------------------------------

    // [period in 12.5 Hz samples, autocorrelation peak], or [0, 0].
    function period(s) {
        var n2 = s.size() / 2;
        var d = new [n2];
        for (var i = 0; i < n2; i++) { d[i] = (s[2 * i] + s[2 * i + 1]) / 2.0; }
        var lmax = imin(LAG_MAX, n2 / 2);
        if (lmax <= LAG_MIN + 1) { return [0.0, 0.0]; }
        var r = new [lmax + 2];
        for (var L = 0; L < lmax + 2; L++) { r[L] = 0.0; }
        for (var L = LAG_MIN - 1; L <= lmax + 1 && L < n2; L++) {
            var sxy = 0.0; var sxx = 0.0; var syy = 0.0;
            for (var i = 0; i + L < n2; i++) {
                sxy += d[i] * d[i + L]; sxx += d[i] * d[i]; syy += d[i + L] * d[i + L];
            }
            r[L] = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0.0;
        }
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

    // Best normalised autocorrelation of y[a0, a1) within 15 % of lag T.
    function spanAc(y, a0, a1, T) {
        var best = 0.0;
        var l0 = imax(1, (0.85 * T).toNumber());
        var lf = 1.15 * T;
        var l1 = lf.toNumber();
        if (l1 < lf) { l1 += 1; }
        for (var L = l0; L <= l1; L++) {
            var sxy = 0.0; var sxx = 0.0; var syy = 0.0;
            for (var i = a0; i + L < a1; i++) {
                sxy += y[i] * y[i + L]; sxx += y[i] * y[i]; syy += y[i + L] * y[i + L];
            }
            var r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0.0;
            if (r > best) { best = r; }
        }
        return best;
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
    function countCycles(y, T, ax, ay, az, raw) {
        var n = y.size();
        var none = [0, 1.0, 0.0, [], false];
        var W = imax(4, rnd(T));
        var wsd = [];
        for (var w0 = 0; w0 + W <= n; w0 += W) {
            var ss = 0.0;
            for (var i = w0; i < w0 + W; i++) { ss += y[i] * y[i]; }
            wsd.add(Math.sqrt(ss / W));
        }
        if (wsd.size() == 0) { return none; }
        var h = 0.45 * median(wsd);
        var refr = 0.45 * T;
        var ext = [];
        var ei = [];
        var kind = [];
        var at = [];
        var state = 0;
        var lastUp = -1000000;
        var lastDn = -1000000;
        var lo = y[0]; var hi = y[0]; var loI = 0; var hiI = 0;
        for (var i = 0; i < n; i++) {
            var v = y[i];
            if (v < lo) { lo = v; loI = i; }
            if (v > hi) { hi = v; hiI = i; }
            if (state != 1 && v > h && i - lastUp >= refr) {
                ext.add(lo); ei.add(loI); kind.add(-1); at.add(i);
                state = 1; lastUp = i; hi = v; hiI = i; lo = v; loI = i;
            } else if (state != -1 && v < -h && i - lastDn >= refr) {
                ext.add(hi); ei.add(hiI); kind.add(1); at.add(i);
                state = -1; lastDn = i; lo = v; loI = i; hi = v; hiI = i;
            }
        }
        if (state == 1) { ext.add(hi); ei.add(hiI); kind.add(1); }
        else { ext.add(lo); ei.add(loI); kind.add(-1); }
        at.add(n);
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

    // --- one bout, the whole buffer -----------------------------------------

    // [reps, ac, cv, T, ok]
    function analyzeBout(x, y, z, lo, hi) {
        var n = hi - lo;
        var res = [0, 0.0, 1.0, 0.0, false];
        if (n < 38) { return res; }
        var pr = principal(x, y, z, lo, hi);
        var s = new [n];
        for (var i = 0; i < n; i++) {
            s[i] = pr[0] * (x[lo + i] - pr[3]) + pr[1] * (y[lo + i] - pr[4]) + pr[2] * (z[lo + i] - pr[5]);
        }
        var slow = movAvg(s, 63);
        var s1 = new [n];
        for (var i = 0; i < n; i++) { s1[i] = s[i] - slow[i]; }
        slow = null;
        var pd = period(s1);
        s1 = null;
        var T = pd[0];
        res[1] = pd[1];
        res[3] = T;
        if (T <= 0 || n < 1.8 * T) { return res; }
        var base = movAvg(s, imax(3, rnd(T)));
        var y1 = new [n];
        for (var i = 0; i < n; i++) { y1[i] = s[i] - base[i]; }
        base = null;
        var w5 = imax(1, rnd(T / 5.0));
        var yy = movAvg(y1, w5);
        y1 = null;
        var ax = movAvg(x.slice(lo, hi), w5);
        var ay = movAvg(y.slice(lo, hi), w5);
        var az = movAvg(z.slice(lo, hi), w5);
        var raw = movAvg(s, w5);
        var c = countCycles(yy, T, ax, ay, az, raw);
        var reps = c[0];
        res[0] = reps;
        res[2] = c[1];
        if (reps >= 2) {
            var tm = c[3];
            var a0 = imax(0, tm[0] - rnd(0.6 * T));
            var a1 = imin(n, tm[tm.size() - 1] + rnd(1.2 * T));
            res[1] = spanAc(yy, a0, a1, T);
        }
        var few = reps <= SHORT_REPS;
        res[4] = res[1] >= (few ? SHORT_AC : MIN_AC) && c[1] <= (few ? SHORT_CV : MAX_CV)
            && reps >= MIN_REPS && c[2] >= MIN_AMP && c[4];
        return res;
    }

    // [reps, ok] for the whole buffer.
    function analyze(x, y, z, steps) {
        var bs2 = bouts(x, y, z, steps);
        var all = [];
        var best = -1;
        var bestScore = 0.0;
        for (var i = 0; i < bs2.size(); i++) {
            var r = analyzeBout(x, y, z, bs2[i][0], bs2[i][1]);
            all.add(r);
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
