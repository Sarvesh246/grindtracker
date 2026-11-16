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
//   set:  { id, e, n, r, w, t, rs, y }
//         set id, exercise id, set number, reps, weight, completed epoch,
//         rest taken before it, sync state (0 pending, 1 synced, 2 rejected)
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

    function localDate() {
        var i = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return i.year.format("%04d") + "-" + i.month.format("%02d") + "-" + i.day.format("%02d");
    }

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
    function buildPayload(meta, sets, max) {
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
            out.add(d);
        }
        var p = {
            "id" => meta["id"],
            "workout_id" => meta["wid"],
            "started_at" => isoUtc(meta["st"]),
            "utc_offset_seconds" => meta["off"],
            "sets" => out
        };
        if (meta["en"] != null) { p["ended_at"] = isoUtc(meta["en"]); }
        var hr = {};
        if (validHr(meta["ha"])) { hr["avg"] = meta["ha"]; }
        if (validHr(meta["hm"])) { hr["max"] = meta["hm"]; }
        if (hr.size() > 0) { p["heart_rate"] = hr; }
        if (meta["cal"] != null && meta["cal"] >= 0 && meta["cal"] <= 20000) { p["calories"] = meta["cal"]; }
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

    // 135.0 -> "135", 62.5 -> "62.5"
    function fmtWeight(w) {
        var f = w.toFloat();
        var n = f.toNumber();
        if (f == n) { return n.toString(); }
        return f.format("%.1f");
    }

    function clamp(v, lo, hi) {
        if (v < lo) { return lo; }
        if (v > hi) { return hi; }
        return v;
    }
}
