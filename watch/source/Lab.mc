using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

// Rep lab: records every finished set for tuning the rep counter against real
// lifts. Each record holds the motion window the counter analyzed (12.5 Hz,
// milli-g), what it offered and when, and the reps that were logged. An Undo
// correction later sends the corrected number for the same set id. Records
// upload through Net after their workout has synced (POST /rep-lab) and are
// deleted once the server has them. See docs/watch-api.md.
//
// Storage: one value per record (a full 75 s window is ~15 KB of the 32 KB
// per-value limit) and at most MAX_RECORDS waiting, oldest dropped first.
module Lab {
    const MAX_RECORDS = 60;
    const VERSION = "2026-11-18";

    // On unless switched off in the Home menu.
    function enabled() {
        var v = Store.get("lab");
        return v == null || v == true;
    }

    function setEnabled(on) { Store.put("lab", on); }

    function queue() {
        var q = Store.get("labq");
        return q instanceof Lang.Array ? q : [];
    }

    function push(key, record) {
        var q = queue();
        while (q.size() >= MAX_RECORDS) {
            Store.del(q[0]);
            q = q.slice(1, null);
        }
        Store.put(key, record);
        q.add(key);
        Store.put("labq", q);
    }

    function drop(key) {
        Store.del(key);
        var q = queue();
        var out = [];
        for (var i = 0; i < q.size(); i++) { if (!q[i].equals(key)) { out.add(q[i]); } }
        Store.put("labq", out);
    }

    // A discarded workout never reaches the server: its recordings can't either.
    function dropSession(sid) {
        var q = queue();
        for (var i = 0; i < q.size(); i++) {
            var r = Store.get(q[i]);
            if (r instanceof Lang.Dictionary && sid.equals(r["sid"])) { drop(q[i]); }
        }
    }

    function iso(epoch) {
        if (epoch == null) { return null; }
        return Logic.isoUtc(epoch);
    }

    // A set was just logged from a live window. Call before the window closes.
    function capture(sid, set, ex, autoShown, startedAt, unit) {
        if (!enabled() || Config.DEMO_DATA) { return; }
        try {
            var m = Reps.snapshot();
            push("lb_" + set["id"], {
                "sid" => sid,
                "body" => {
                    "id" => set["id"], "session_id" => sid,
                    "exercise_id" => ex["id"], "exercise_name" => ex["name"],
                    "set_number" => set["n"], "weight" => set["w"], "unit" => unit,
                    "logged_reps" => set["r"], "auto_reps" => Reps.count, "auto_shown" => autoShown,
                    "typed" => Reps.manual, "started_at" => iso(startedAt), "finished_at" => iso(set["t"]),
                    "rate_hz" => 12.5, "clipped" => m["clipped"],
                    "x" => m["x"], "y" => m["y"], "z" => m["z"], "steps" => m["steps"],
                    "events" => m["events"], "diag" => m["diag"], "app_version" => VERSION
                }
            });
        } catch (e) {
            System.println("lab capture failed " + e.getErrorMessage());
        }
    }

    // The set was reopened with Undo and saved again: its true count.
    function correct(sid, setId, reps) {
        if (!enabled() || Config.DEMO_DATA) { return; }
        var key = "lb_" + setId;
        var waiting = Store.get(key);
        if (waiting instanceof Lang.Dictionary && waiting["body"]["x"] != null) {
            // Not uploaded yet: fix the recording itself.
            waiting["body"]["logged_reps"] = reps;
            Store.put(key, waiting);
            return;
        }
        push("lc_" + setId, { "sid" => sid, "body" => { "id" => setId, "logged_reps" => reps, "corrected" => true } });
    }

    // The oldest record whose workout has reached the server, or null.
    // Records of the open workout or one still queued wait for it.
    function next() {
        var q = queue();
        var active = Workout.active() ? Workout.cur["sid"] : null;
        var waiting = Store.queue();
        for (var i = 0; i < q.size(); i++) {
            var r = Store.get(q[i]);
            if (!(r instanceof Lang.Dictionary)) { drop(q[i]); return null; }
            var sid = r["sid"];
            if (active != null && active.equals(sid)) { continue; }
            var queued = false;
            for (var j = 0; j < waiting.size(); j++) { if (waiting[j].equals(sid)) { queued = true; } }
            if (queued) { continue; }
            return q[i];
        }
        return null;
    }
}
