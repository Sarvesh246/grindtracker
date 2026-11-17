using Toybox.Lang;
using Toybox.Math;
using Toybox.System;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.Cryptography;

// Pure logic: no UI, no storage, no network. Everything here is unit-tested.
//
// Stored shapes (short keys, because every byte is written to flash):
//   meta: { id, wid, nm, st, en, off, u, ha, hm, cal }
//         session id, workout id, name, start/end epoch secs, utc offset,
//         unit, avg/max heart rate, calories
//         te: training effect at Save
//   set:  { id, e, n, r, w, t, rs, y, hp, he, hd }
//         set id, exercise id, set number, reps, weight, completed epoch,
//         rest taken before it, sync state (0 pending, 1 synced, 2 rejected),
//         peak HR, HR when logged, HR drop 60 s into the following rest
//   h_<sid>: { tr, zs, hz } heart-rate trace (one reading per HR_STEP s,
//         0 = none), seconds per zone, the zone floors used
module Logic {
    const R_OK = 0;
    const R_RETRY = 1;
    const R_AUTH = 2;
    const R_DEAD = 3;

    var seeded = false;
    var counter = 0;

    // RFC 4122 version 4 UUID, lowercase: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx.
    // Bytes come from the watch's crypto RNG. If that is ever unavailable the
    // fallback mixes Math.rand() (seeded once from clock ^ uptime timer) with
    // a per-run counter and the timer, so two ids in the same tick differ.
    function uuid4() {
        var b = null;
        try {
            if (Toybox has :Cryptography && Cryptography has :randomBytes) {
                b = Cryptography.randomBytes(16);
            }
        } catch (e) {
            b = null;
        }
        if (b == null) { b = fallbackBytes(); }
        return formatUuid(b);
    }

    function fallbackBytes() {
        if (!seeded) {
            Math.srand(Time.now().value() ^ System.getTimer());
            seeded = true;
        }
        counter += 1;
        var b = new [16];
        for (var i = 0; i < 16; i++) {
            b[i] = (Math.rand() >> 8) & 0xff;
        }
        b[14] = (b[14] ^ System.getTimer()) & 0xff;
        b[15] = (b[15] ^ counter) & 0xff;
        return b;
    }

    function formatUuid(b) {
        var hex = "";
        for (var i = 0; i < 16; i++) {
            var v = b[i] & 0xff;
            if (i == 6) { v = (v & 0x0f) | 0x40; }
            if (i == 8) { v = (v & 0x3f) | 0x80; }
            hex += v.format("%02x");
            if (i == 3 || i == 5 || i == 7 || i == 9) { hex += "-"; }
        }
        return hex;
    }

    function isoUtc(epochSecs) {
        var u = Gregorian.utcInfo(new Time.Moment(epochSecs), Time.FORMAT_SHORT);
        return u.year.format("%04d") + "-" + u.month.format("%02d") + "-" + u.day.format("%02d") + "T"
            + u.hour.format("%02d") + ":" + u.min.format("%02d") + ":" + u.sec.format("%02d") + "Z";
    }

    function localDate() { return Body.date(); }

    // Seconds to wait before the next upload after `fails` failures in a row.
    function backoffSecs(fails) {
        if (fails <= 0) { return 0; }
        if (fails == 1) { return 30; }
        if (fails == 2) { return 120; }
        return 600;
    }

    // What to do with an upload result. Negative codes are Connect IQ's own
    // ("never reached the server"), always retryable.
    function classify(code, errCode) {
        if (code == 200 || code == 201) { return R_OK; }
        if (code == 401) { return R_AUTH; }
        if (code < 0 || code == 429 || code >= 500) { return R_RETRY; }
        if (code == 409 && errCode != null && errCode.equals("open_session_conflict")) { return R_RETRY; }
        if (code >= 400) { return R_DEAD; }
        return R_RETRY;
    }

    function qAdd(q, id) {
        if (q.indexOf(id) < 0) { q.add(id); }
        return q;
    }

    function qRemove(q, id) {
        q.remove(id);
        return q;
    }

    function pendingCount(sets) {
        var n = 0;
        for (var i = 0; i < sets.size(); i++) {
            if (sets[i]["y"] == 0) { n += 1; }
        }
        return n;
    }

    // POST /sessions body: session fields plus up to `max` unsynced sets.
    // Optional fields are left out rather than sent as null (the server
    // rejects unknown shapes).
    // `body` is the stored heart-rate record { tr, zs, hz } or null.
    function buildPayload(meta, sets, max, body) {
        var out = [];
        for (var i = 0; i < sets.size() && out.size() < max; i++) {
            var s = sets[i];
            if (s["y"] != 0) { continue; }
            var d = {
                "id" => s["id"],
                "exercise_id" => s["e"],
                "set_number" => s["n"],
                "reps" => s["r"],
                "weight" => s["w"],
                "unit" => meta["u"],
                "completed_at" => isoUtc(s["t"])
            };
            if (s["rs"] != null) { d["rest_seconds"] = s["rs"]; }
            if (validHr(s["hp"])) { d["hr_peak"] = s["hp"]; }
            if (validHr(s["he"])) { d["hr_end"] = s["he"]; }
            if (s["hd"] != null && s["hd"] >= -100 && s["hd"] <= 200) { d["hr_rest_drop_60"] = s["hd"]; }
            out.add(d);
        }
        var p = {
            "id" => meta["id"],
            "workout_id" => meta["wid"],
            "started_at" => isoUtc(meta["st"]),
            "utc_offset_seconds" => meta["off"],
            "sets" => out
        };
        var finalBatch = meta["en"] != null && out.size() == pendingCount(sets);
        if (finalBatch) { p["ended_at"] = isoUtc(meta["en"]); }
        var hr = {};
        if (validHr(meta["ha"])) { hr["avg"] = meta["ha"]; }
        if (validHr(meta["hm"])) { hr["max"] = meta["hm"]; }
        if (hr.size() > 0) { p["heart_rate"] = hr; }
        if (meta["cal"] != null && meta["cal"] >= 0 && meta["cal"] <= 20000) { p["calories"] = meta["cal"]; }
        // Complete the workout and send its trace after all batches are accounted for.
        if (finalBatch && body != null) {
            var b = {};
            var tr = body["tr"];
            if (tr instanceof Lang.Array && tr.size() > 1) { b["trace"] = tr; b["step"] = Config.HR_STEP; }
            var hz = body["hz"];
            if (hz instanceof Lang.Array && hz.size() >= 5 && hz.size() <= 6 && validHr(hz[0])) { b["zones"] = hz; }
            var zs = body["zs"];
            if (zs instanceof Lang.Array && zs.size() == 5) { b["zone_seconds"] = zs; }
            if (meta["te"] != null && meta["te"] >= 0 && meta["te"] <= 5) { b["training_effect"] = meta["te"].toFloat(); }
            if (b.size() > 0) { p["hr"] = b; }
        }
        return p;
    }

    function validHr(v) {
        return v != null && v >= 20 && v <= 250;
    }

    // Marks sets from a 200/201 response. accepted/duplicate/updated are on
    // the server; rejected ones must not be resent unchanged. Returns the
    // indexes that changed so the caller can persist only those.
    function applyResult(sets, data) {
        var changed = [];
        if (!(data instanceof Lang.Dictionary)) { return changed; }
        var r = data["sets"];
        if (!(r instanceof Lang.Dictionary)) { return changed; }
        var ok = [];
        var lists = ["accepted", "duplicate", "updated"];
        for (var i = 0; i < lists.size(); i++) {
            var l = r[lists[i]];
            if (l instanceof Lang.Array) { ok.addAll(l); }
        }
        var bad = [];
        var rej = r["rejected"];
        if (rej instanceof Lang.Array) {
            for (var j = 0; j < rej.size(); j++) {
                if (rej[j] instanceof Lang.Dictionary) { bad.add(rej[j]["id"]); }
            }
        }
        for (var k = 0; k < sets.size(); k++) {
            var s = sets[k];
            if (s["y"] != 0) { continue; }
            if (ok.indexOf(s["id"]) >= 0) { s["y"] = 1; changed.add(k); }
            else if (bad.indexOf(s["id"]) >= 0) { s["y"] = 2; changed.add(k); }
        }
        return changed;
    }

    function volume(sets) {
        var v = 0.0;
        for (var i = 0; i < sets.size(); i++) {
            v += sets[i]["w"].toFloat() * sets[i]["r"];
        }
        return v;
    }

    function fmtDuration(secs) {
        if (secs < 0) { secs = 0; }
        var h = secs / 3600;
        var m = (secs % 3600) / 60;
        var s = secs % 60;
        if (h > 0) { return h + ":" + m.format("%02d") + ":" + s.format("%02d"); }
        return m + ":" + s.format("%02d");
    }

    function agoText(secs) {
        if (secs < 60) { return "synced just now"; }
        if (secs < 3600) { return "synced " + (secs / 60) + "m ago"; }
        if (secs < 86400) { return "synced " + (secs / 3600) + "h ago"; }
        return "synced " + (secs / 86400) + "d ago";
    }

    // 12450 -> "12,450". Every group but the first is padded to 3 digits.
    function fmtThousands(n) {
        var neg = n < 0;
        if (neg) { n = -n; }
        var out = "";
        while (n >= 1000) {
            out = "," + (n % 1000).format("%03d") + out;
            n = n / 1000;
        }
        return (neg ? "-" : "") + n.toString() + out;
    }

    // 135.0 -> "135", 62.5 -> "62.5"
    function fmtWeight(w) {
        var f = w.toFloat();
        var n = f.toNumber();
        if (f == n) { return n.toString(); }
        return f.format("%.1f");
    }

    // A weight as the lifter reads it: 0 is bodyweight.
    function fmtLoad(w) {
        return w.toFloat() == 0.0 ? "BW" : fmtWeight(w);
    }

    function clamp(v, lo, hi) {
        if (v < lo) { return lo; }
        if (v > hi) { return hi; }
        return v;
    }

    // --- exercise order ---------------------------------------------------

    // Sets logged per exercise, in plan order.
    function doneCounts(ex, sets) {
        var dn = new [ex.size()];
        for (var i = 0; i < ex.size(); i++) {
            dn[i] = 0;
            for (var j = 0; j < sets.size(); j++) {
                if (sets[j]["e"].equals(ex[i]["id"])) { dn[i] += 1; }
            }
        }
        return dn;
    }

    // The most recent logged set of an exercise, or null.
    function lastSetFor(sets, exId) {
        if (sets == null) { return null; }
        for (var i = sets.size() - 1; i >= 0; i--) {
            if (sets[i]["e"].equals(exId)) { return sets[i]; }
        }
        return null;
    }

    // Reps to prefill: the top of a range, else the target, else 8.
    function targetReps(e) {
        if (e["reps_max"] != null) { return e["reps_max"]; }
        if (e["reps"] != null) { return e["reps"]; }
        return 8;
    }

    // "10-12 reps", "8 reps", "AMRAP": the whole target, never shortened.
    function repsText(e) {
        if (e["reps"] == null) { return "AMRAP"; }
        if (e["reps_max"] != null) { return e["reps"] + "-" + e["reps_max"] + " reps"; }
        return e["reps"] + " reps";
    }

    // The target with no words: "10-12", "8", "AMRAP".
    function bareTarget(e) {
        if (e["reps"] == null) { return "AMRAP"; }
        if (e["reps_max"] != null) { return e["reps"] + "-" + e["reps_max"]; }
        return e["reps"].toString();
    }

    // Sets the workout will have: everything planned, minus what is left on
    // skipped exercises.
    function plannedSets(ex, dn, sk) {
        var t = 0;
        for (var i = 0; i < ex.size(); i++) {
            t += sk[i] == 1 ? dn[i] : ex[i]["sets"];
        }
        return t;
    }

    // Next exercise after `from` (wrapping) that is neither finished nor
    // skipped, or -1.
    function nextPending(from, dn, sk, ex) {
        var n = ex.size();
        for (var k = 1; k <= n; k++) {
            var i = (from + k) % n;
            if (sk[i] != 1 && dn[i] < ex[i]["sets"]) { return i; }
        }
        return -1;
    }

    // Lighter day: one set fewer wherever there is more than one.
    function trimPlanSets(ex) {
        for (var i = 0; i < ex.size(); i++) {
            if (ex[i]["sets"] > 1) { ex[i]["sets"] -= 1; }
        }
        return ex;
    }

    // --- heart rate -------------------------------------------------------

    // Zone 1-5 for `hr` given floors [z1, z2, z3, z4, z5, max]; 0 below zone 1.
    function zoneOf(hr, zones) {
        if (hr == null || zones == null || zones.size() < 5) { return 0; }
        var z = 0;
        for (var i = 0; i < 5; i++) {
            if (hr >= zones[i]) { z = i + 1; }
        }
        return z;
    }

    // Writes `hr` at sample `idx`, padding any gap with 0. Indexes past
    // MAX_TRACE are dropped (a session left running for half a day).
    function traceSet(trace, idx, hr) {
        if (idx < 0 || idx >= Config.MAX_TRACE) { return trace; }
        while (trace.size() <= idx) { trace.add(0); }
        trace[idx] = hr;
        return trace;
    }

    // Highest reading in trace[from..to], or null.
    function peakIn(trace, from, to) {
        var p = null;
        if (from < 0) { from = 0; }
        for (var i = from; i <= to && i < trace.size(); i++) {
            var v = trace[i];
            if (v != null && v > 0 && (p == null || v > p)) { p = v; }
        }
        return p;
    }

    // Smart rest: recovered once HR has fallen SMART_REST_DROP below the
    // set's peak (or under the bottom of zone 2), after at least 30 s.
    function recovered(peak, hr, elapsed, zones) {
        if (peak == null || hr == null || elapsed < 30) { return false; }
        if (hr <= peak - Config.SMART_REST_DROP) { return true; }
        return zones != null && zones.size() >= 2 && hr < zones[1];
    }

    // --- daily snapshot ---------------------------------------------------

    // [[epochSecs, value], ...] -> 96 buckets of 15 minutes from `midnight`,
    // each the newest value that fell in it, null where none did.
    function buckets(samples, midnight) {
        var out = new [96];
        var at = new [96];
        for (var i = 0; i < samples.size(); i++) {
            Body.bucket(out, at, samples[i][0], samples[i][1], midnight);
        }
        return out;
    }
}
