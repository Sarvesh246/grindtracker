using Toybox.Activity;
using Toybox.Lang;
using Toybox.StringUtil;
using Toybox.System;

// Rep lab tape: the raw signals of the current set, recorded alongside the
// rep counter and independent of it. It keeps recording after you take over
// by hand, which is exactly the set the counter needs to learn from.
//
//   accelerometer  12.5 Hz (pairs of 25 Hz samples averaged), milli-g
//   magnetometer   12.5 Hz, when the watch delivers it
//   heart rate     one reading per sensor batch (about 1 s)
//   beat intervals ms between heartbeats, when the watch delivers them
//   steps          the step counter per batch, from the set's start
//
// Motion sits in fixed ByteArrays (2 bytes a sample, about 1.9 KB an axis),
// so recording allocates nothing per batch and costs a few hundred bytes of
// work a second. At capture each axis becomes one base64 string of
// big-endian int16, which keeps a full set near 20 KB on the wire and in
// storage, well inside the 32 KB per-value limit.
//
// Nothing here may throw into the sensor callback: feed() is wrapped.
module Tape {
    const N = 938;          // 75 s at 12.5 Hz, the counter's window
    const MAX_HR = 100;
    const MAX_BEATS = 240;

    var acc = null;         // [x, y, z] ByteArrays
    var mag = null;
    var an = 0; var ah = 0; // accelerometer: stored samples, ring head
    var mn = 0; var mh = 0;
    var aCarry = null;
    var mCarry = null;
    var hr = [];
    var beats = [];
    var stepsAt = [];       // [sample index, steps since start] per batch
    var steps0 = null;
    var memPeak = 0;
    var bat0 = null;
    var batchesSeen = 0;
    var magSeen = false;
    var beatsSeen = false;

    function alloc() {
        if (acc != null) { return; }
        acc = [new [2 * N]b, new [2 * N]b, new [2 * N]b];
        mag = [new [2 * N]b, new [2 * N]b, new [2 * N]b];
    }

    function reset() {
        alloc();
        an = 0; ah = 0; mn = 0; mh = 0; aTotal = 0;
        aCarry = null; mCarry = null;
        hr = []; beats = []; stepsAt = [];
        steps0 = null;
        memPeak = 0;
        batchesSeen = 0;
        magSeen = false; beatsSeen = false;
        bat0 = battery();
    }

    function battery() {
        try { return System.getSystemStats().battery; } catch (e) { return null; }
    }

    function put16(ba, i, v) {
        if (v > 32767) { v = 32767; } else if (v < -32768) { v = -32768; }
        if (v < 0) { v += 65536; }
        ba[2 * i] = (v >> 8) & 0xFF;
        ba[2 * i + 1] = v & 0xFF;
    }

    function get16(ba, i) {
        var v = (ba[2 * i] << 8) | ba[2 * i + 1];
        return v >= 32768 ? v - 65536 : v;
    }

    // One 12.5 Hz sample into a ring. Returns the new [count, head].
    function push(axes, n, h, x, y, z) {
        var i = n < N ? n : h;
        put16(axes[0], i, x);
        put16(axes[1], i, y);
        put16(axes[2], i, z);
        if (n < N) { return [n + 1, h]; }
        return [n, (h + 1) % N];
    }

    // 25 Hz integer arrays, averaged in pairs. `carry` holds an odd sample
    // until the next batch. Returns the new carry.
    function addPairs(axes, xs, ys, zs, carry, isMag) {
        if (xs == null || ys == null || zs == null) { return carry; }
        var n = xs.size();
        if (ys.size() < n) { n = ys.size(); }
        if (zs.size() < n) { n = zs.size(); }
        for (var i = 0; i < n; i++) {
            var x = xs[i].toNumber(); var y = ys[i].toNumber(); var z = zs[i].toNumber();
            if (carry == null) { carry = [x, y, z]; continue; }
            var r = push(axes, isMag ? mn : an, isMag ? mh : ah,
                (carry[0] + x) / 2, (carry[1] + y) / 2, (carry[2] + z) / 2);
            if (isMag) { mn = r[0]; mh = r[1]; } else { an = r[0]; ah = r[1]; aTotal++; }
            carry = null;
        }
        return carry;
    }

    // Keeps the newest `max` entries.
    function keep(a, v, max) {
        a.add(v);
        return a.size() > max ? a.slice(a.size() - max, null) : a;
    }

    // One accelerometer batch (25 Hz, milli-g) with the step counter. Runs
    // for every batch, the ones the counter rejects or ignores included.
    // Never throws.
    function feed(xs, ys, zs, steps) {
        try {
            if (acc == null) { reset(); }
            batchesSeen++;
            aCarry = addPairs(acc, xs, ys, zs, aCarry, false);
            var info = Activity.getActivityInfo();
            hr = keep(hr, info == null || info.currentHeartRate == null ? 0 : info.currentHeartRate, MAX_HR);
            if (steps0 == null) { steps0 = steps; }
            stepsAt = keep(stepsAt, [aTotal, steps - steps0], MAX_HR);
            var used = System.getSystemStats().usedMemory;
            if (used > memPeak) { memPeak = used; }
        } catch (e) {
            System.println("tape " + e.getErrorMessage());
        }
    }

    // The rest of a sensor batch: compass and beat intervals, when the
    // watch delivers them. Never throws.
    function feedExtra(data) {
        try {
            if (data == null) { return; }
            if (acc == null) { reset(); }
            var m = data.magnetometerData;
            if (m != null && m.x != null) { magSeen = true; mCarry = addPairs(mag, m.x, m.y, m.z, mCarry, true); }
            var h = data.heartRateData;
            if (h != null && h.heartBeatIntervals != null) {
                beatsSeen = true;
                var b = h.heartBeatIntervals;
                for (var i = 0; i < b.size(); i++) {
                    if (b[i] != null) { beats = keep(beats, b[i].toNumber(), MAX_BEATS); }
                }
            }
        } catch (e) {
            System.println("tape extra " + e.getErrorMessage());
        }
    }

    // Accelerometer samples recorded since the set began, the window's
    // dropped start included.
    var aTotal = 0;
    function total() { return aTotal; }

    function ordered(ba, n, h) {
        if (n < N) { return ba.slice(0, 2 * n); }
        if (h == 0) { return ba.slice(0, null); }
        var out = ba.slice(2 * h, null);
        out.addAll(ba.slice(0, 2 * h));
        return out;
    }

    function b64(ba) {
        return StringUtil.convertEncodedString(ba, {
            :fromRepresentation => StringUtil.REPRESENTATION_BYTE_ARRAY,
            :toRepresentation => StringUtil.REPRESENTATION_STRING_BASE64
        });
    }

    // The recording in the wire format of POST /rep-lab (enc "i16b64").
    function encode() {
        if (acc == null) { reset(); }
        var out = {
            "enc" => "i16b64",
            "ax" => b64(ordered(acc[0], an, ah)), "ay" => b64(ordered(acc[1], an, ah)), "az" => b64(ordered(acc[2], an, ah)),
            "hr" => hr, "step_marks" => stepsAt, "clipped" => aTotal > N
        };
        if (mn > 0) {
            out["mx"] = b64(ordered(mag[0], mn, mh));
            out["my"] = b64(ordered(mag[1], mn, mh));
            out["mz"] = b64(ordered(mag[2], mn, mh));
        }
        if (beats.size() > 0) { out["beats"] = beats; }
        return out;
    }

    function diag() {
        var mem = null;
        try { mem = System.getSystemStats().totalMemory; } catch (e) { }
        return {
            "tape_samples" => an, "tape_total" => aTotal, "mag_samples" => mn, "beats" => beats.size(),
            "mem_peak" => memPeak, "mem_total" => mem,
            "battery_start" => bat0, "battery_end" => battery()
        };
    }
}
