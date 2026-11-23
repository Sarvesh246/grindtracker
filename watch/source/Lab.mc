using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

// Rep lab: records every finished set for tuning the rep counter against real
// lifts. Each record holds the motion window the counter analyzed (12.5 Hz,
// milli-g), what it offered and when, and the reps that were logged. Undo
// drops that set's recording. Records upload after the workout syncs and are
// deleted once the server has them. See docs/watch-api.md.
//
// Storage: one value per record (a full 75 s window is ~15 KB of the 32 KB
// per-value limit) and at most MAX_RECORDS waiting, oldest dropped first.
module Lab {
    const MAX_RECORDS = 60;
    const VERSION = Body.BUILD_ID;
    const RICH_BAD_MAX = 2;    // sets with a broken stream before the extra sensors go off

    // On unless switched off in the Home menu.
    function enabled() {
        var v = Store.get("lab");
        return v == null || v == true;
    }

    // Switching it back on also gives the extra sensors another chance.
    function setEnabled(on) {
        Store.put("lab", on);
        if (on) { Store.del("rb"); }
    }

    function queue() {
        var q = Store.get("labq");
        return q instanceof Lang.Array ? q : [];
    }

    // Record key -> its session id, "" for a health record. Kept beside the
    // queue so next() and dropSession() can tell where a record belongs
    // without loading every body (labDue asks every 30 s). Records queued
    // before this index existed are filled in as they are met (sidOf).
    function index() {
        var m = Store.get("labs");
        return m instanceof Lang.Dictionary ? m : {};
    }

    function push(key, record) {
        var q = queue();
        var idx = index();
        while (q.size() >= MAX_RECORDS) {
            Store.del(q[0]);
            idx.remove(q[0]);
            q = q.slice(1, null);
        }
        Store.put(key, record);
        idx[key] = record["sid"] == null ? "" : record["sid"];
        q.add(key);
        Store.put("labq", q);
        Store.put("labs", idx);
    }

    function drop(key) {
        Store.del(key);
        var q = queue();
        var out = [];
        for (var i = 0; i < q.size(); i++) { if (!q[i].equals(key)) { out.add(q[i]); } }
        Store.put("labq", out);
        var idx = index();
        idx.remove(key);
        Store.put("labs", idx);
    }

    // The session a queued record belongs to ("" for none), or null if its
    // body is gone. Reads the body only for an entry the index doesn't know.
    function sidOf(idx, key) {
        if (idx.hasKey(key)) { return idx[key]; }
        var r = Store.get(key);
        if (!(r instanceof Lang.Dictionary)) { return null; }
        var s = r["sid"] == null ? "" : r["sid"];
        idx[key] = s;
        return s;
    }

    // A discarded workout never reaches the server: its recordings can't either.
    // A record the phone keeps failing to carry: send it again without the
    // compass and beat intervals, the parts most likely to be dispensable.
    function slim(key) {
        var r = Store.get(key);
        if (!(r instanceof Lang.Dictionary) || !(r["body"] instanceof Lang.Dictionary)) { return false; }
        var b = r["body"];
        if (b["mx"] == null && b["beats"] == null) { return false; }
        b.remove("mx"); b.remove("my"); b.remove("mz"); b.remove("beats");
        b["slim"] = true;
        Store.put(key, r);
        return true;
    }

    function dropSession(sid) {
        var q = queue();
        var idx = index();
        for (var i = 0; i < q.size(); i++) {
            if (sid.equals(sidOf(idx, q[i]))) { drop(q[i]); }
        }
    }

    // A set was just logged from a live window. Call before the window closes.
    function capture(sid, set, ex, autoShown, startedAt, unit) {
        if (!enabled() || Config.DEMO_DATA) { return; }
        try {
            var m = Reps.snapshot();
            var body = Tape.encode();
            body["id"] = set["id"]; body["session_id"] = sid;
            body["exercise_id"] = ex["id"]; body["exercise_name"] = ex["name"];
            body["set_number"] = set["n"]; body["weight"] = set["w"]; body["unit"] = unit;
            body["logged_reps"] = set["r"]; body["auto_reps"] = set["ra"]; body["auto_shown"] = autoShown;
            body["typed"] = Reps.manual; body["started_at"] = startedAt == null ? null : Logic.isoUtc(startedAt);
            body["finished_at"] = Logic.isoUtc(set["t"]);
            body["rate_hz"] = 12.5;
            body["events"] = m["events"]; body["diag"] = m["diag"]; body["app_version"] = VERSION;
            push("lb_" + set["id"], { "sid" => sid, "body" => body });
            Health.noteSet(m["diag"]);
        } catch (e) {
            System.println("lab capture failed " + e.getErrorMessage());
        }
    }

    function dropSet(setId) {
        drop("lb_" + setId);
        drop("lc_" + setId); // queued by older builds
    }

    // The oldest record whose workout has reached the server, or null.
    // Records of the open workout or one still queued wait for it.
    function next() {
        var q = queue();
        var idx = index();
        var active = Workout.active() ? Workout.cur["sid"] : null;
        var waiting = Store.queue();
        var before = idx.size();
        var found = null;
        for (var i = 0; i < q.size(); i++) {
            var sid = sidOf(idx, q[i]);
            if (sid == null) { drop(q[i]); break; }
            if (sid.equals("")) { found = q[i]; break; } // health records wait for nothing
            if (active != null && active.equals(sid)) { continue; }
            var queued = false;
            for (var j = 0; j < waiting.size(); j++) { if (waiting[j].equals(sid)) { queued = true; } }
            if (queued) { continue; }
            found = q[i];
            break;
        }
        if (idx.size() != before) { Store.put("labs", idx); }
        return found;
    }
}
