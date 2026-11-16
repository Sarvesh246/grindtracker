using Toybox.System;
using Toybox.Time;

// The active workout: where you are, what you've logged. Every change that
// matters is written to storage before the UI moves on.
//
// cur: { sid, ei, sn, skip, f, w, r, re, rd, r0, rs, sum, sumAt }
//      session id, exercise index, next set number, sets skipped,
//      focus (0 weight, 1 reps), current weight/reps, rest end epoch,
//      rest length, rest start epoch, rest taken before the next set,
//      at-summary flag, epoch the summary was reached
module Workout {
    var cur = null;
    var plan = null;
    var meta = null;
    var sets = null;
    var saved = false;   // summary screen: already saved this session
    var last = null;     // summary numbers, kept after cur is cleared

    function now() { return Time.now().value(); }
    function active() { return cur != null; }

    // On launch: pick up an unfinished workout, or clean up half a one.
    function load() {
        cur = Store.get("cur");
        if (cur == null) { return; }
        plan = Store.get("pl");
        meta = Store.meta(cur["sid"]);
        if (plan == null || meta == null) {
            clear();
            return;
        }
        sets = Store.sets(cur["sid"]);
    }

    function clear() {
        cur = null; plan = null; meta = null; sets = null;
        Store.del("cur");
        Store.del("pl");
    }

    function saveCur() { Store.put("cur", cur); }

    function start(wk) {
        var sid = Logic.uuid4();
        meta = {
            "id" => sid, "wid" => wk["id"], "nm" => wk["name"], "st" => now(), "en" => null,
            "off" => System.getClockTime().timeZoneOffset, "u" => wk["unit"],
            "ha" => null, "hm" => null, "cal" => null
        };
        plan = wk;
        sets = [];
        saved = false;
        last = null;
        cur = { "sid" => sid, "ei" => 0, "sn" => 1, "skip" => 0, "re" => null, "rs" => null, "sum" => false };
        prefill();
        Store.put("pl", plan);
        Store.putMeta(meta);
        saveCur();
        Recorder.start();
    }

    function resume() {
        saved = false;
        Recorder.start();
    }

    function ex() { return plan["ex"][cur["ei"]]; }
    function exCount() { return plan["ex"].size(); }

    // New exercise: start from its target, with the weight focused because
    // that's the value most likely to need changing first.
    function prefill() {
        var e = ex();
        cur["w"] = e["weight"] == null ? 0.0 : e["weight"].toFloat();
        cur["r"] = e["reps"] == null ? 8 : e["reps"];
        cur["f"] = 0;
    }

    function totalSets() {
        var t = 0;
        for (var i = 0; i < plan["ex"].size(); i++) { t += plan["ex"][i]["sets"]; }
        return t - cur["skip"];
    }

    function progress() {
        var t = totalSets();
        if (t <= 0) { return 1.0; }
        return sets.size().toFloat() / t;
    }

    function adjust(dir) {
        if (cur["f"] == 0) {
            cur["w"] = Logic.clamp(cur["w"] + dir * Config.WEIGHT_STEP, 0.0, 2000.0);
        } else {
            cur["r"] = Logic.clamp(cur["r"] + dir, 0, 1000);
        }
    }

    function setFocus(f) {
        cur["f"] = f;
        saveCur();
    }

    // Returns true when that was the last set of the workout.
    function logSet() {
        var e = ex();
        var s = {
            "id" => Logic.uuid4(), "e" => e["id"], "n" => cur["sn"], "r" => cur["r"], "w" => cur["w"],
            "t" => now(), "rs" => cur["rs"], "y" => 0
        };
        Store.putSet(cur["sid"], sets.size(), s);
        sets.add(s);
        cur["rs"] = null;

        var rest = e["rest"] == null ? Config.DEFAULT_REST : e["rest"];
        var done = false;
        if (cur["sn"] < e["sets"]) {
            cur["sn"] += 1;
            cur["f"] = 1; // same exercise: weight carries over, reps is what changes
        } else {
            done = !nextExercise();
            if (done) { cur["sn"] += 1; } // nothing left to log
        }
        if (done) {
            toSummary();
        } else {
            cur["r0"] = now();
            cur["rd"] = rest;
            cur["re"] = now() + rest;
            saveCur();
        }
        return done;
    }

    function nextExercise() {
        if (cur["ei"] + 1 >= exCount()) { return false; }
        cur["ei"] += 1;
        cur["sn"] = 1;
        prefill();
        return true;
    }

    function skipExercise() {
        var e = ex();
        cur["skip"] += e["sets"] - (cur["sn"] - 1);
        cur["re"] = null;
        cur["rs"] = null;
        if (!nextExercise()) {
            cur["sn"] = e["sets"] + 1; // nothing left to log here
            toSummary();
        } else {
            saveCur();
        }
    }

    function inRest() { return cur["re"] != null; }
    function restLeft() { return cur["re"] - now(); }

    function restFrac() {
        if (cur["rd"] == null || cur["rd"] <= 0) { return 0.0; }
        return Logic.clamp(restLeft().toFloat() / cur["rd"], 0.0, 1.0);
    }

    function adjustRest(delta) {
        var left = restLeft() + delta;
        if (left < 0) { left = 0; }
        cur["re"] = now() + left;
        cur["rd"] = Logic.clamp(cur["rd"] + delta, left, 3600);
        if (cur["rd"] < 1) { cur["rd"] = 1; }
        saveCur();
    }

    function endRest() {
        cur["rs"] = Logic.clamp(now() - cur["r0"], 0, 3600);
        cur["re"] = null;
        saveCur();
    }

    function toSummary() {
        cur["re"] = null;
        cur["sum"] = true;
        cur["sumAt"] = now();
        saveCur();
    }

    // Back out of the summary if there is still something to log.
    function canLeaveSummary() {
        return !saved && cur != null && cur["sn"] <= ex()["sets"];
    }

    function leaveSummary() {
        cur["sum"] = false;
        saveCur();
    }

    function atSummary() { return cur != null && cur["sum"] == true; }

    function summary() {
        if (cur == null) { return last; }
        var st = Recorder.stats();
        last = {
            "dur" => cur["sumAt"] - meta["st"],
            "sets" => sets.size(),
            "vol" => Logic.volume(sets),
            "hr" => st["ha"],
            "unit" => meta["u"]
        };
        return last;
    }

    // Save: stamp the end, hand the session to the sync queue, save the
    // Garmin activity. Discard: drop both.
    function finish(save) {
        if (cur == null) { return; }
        var sid = cur["sid"];
        if (save && sets.size() > 0) {
            summary();
            var st = Recorder.stats();
            meta["en"] = cur["sumAt"] == null ? now() : cur["sumAt"];
            meta["ha"] = st["ha"];
            meta["hm"] = st["hm"];
            meta["cal"] = st["cal"];
            Store.putMeta(meta);
            Store.enqueue(sid);
            Probe.log("save"); // while the activity is still recording: training effect, avg HR
            Recorder.stop(true);
            saved = true;
        } else {
            Recorder.stop(false);
            Store.dropSession(sid);
        }
        clear();
    }
}
