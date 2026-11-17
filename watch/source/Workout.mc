using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

// The active workout: where you are, what you've logged. Every change that
// matters is written to storage before the UI moves on.
//
// cur: { sid, ei, sn, dn, sk, f, w, r, re, rd, r0, rs, sum, sumAt }
//      session id, current exercise index, its next set number, sets done
//      per exercise, skipped flag per exercise, focus (0 weight, 1 reps),
//      current weight/reps, rest end epoch, rest length, rest start epoch,
//      rest taken before the next set, at-summary flag, epoch the summary
//      was reached
//
// Exercises can be done in any order: `dn` and `sk` say what is left, and
// "next" means the next unfinished, unskipped exercise after the current one.
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
        if (cur["dn"] == null) { upgrade(); }
        Hr.begin(meta);
    }

    // A workout saved by the build before exercise order became free: rebuild
    // the per-exercise counts from the logged sets.
    function upgrade() {
        var n = exCount();
        cur["dn"] = Logic.doneCounts(plan["ex"], sets);
        cur["sk"] = new [n];
        for (var i = 0; i < n; i++) { cur["sk"][i] = 0; }
        for (var j = 0; j < cur["ei"] && j < n; j++) {
            if (cur["dn"][j] < plan["ex"][j]["sets"]) { cur["sk"][j] = 1; }
        }
        saveCur();
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
            "ha" => null, "hm" => null, "cal" => null, "te" => null
        };
        plan = wk;
        sets = [];
        saved = false;
        last = null;
        var n = exCount();
        var dn = new [n];
        var sk = new [n];
        for (var i = 0; i < n; i++) { dn[i] = 0; sk[i] = 0; }
        cur = { "sid" => sid, "ei" => 0, "sn" => 1, "dn" => dn, "sk" => sk, "re" => null, "rs" => null, "sum" => false };
        prefill();
        Store.put("pl", plan);
        Store.putMeta(meta);
        saveCur();
        Recorder.start();
        Hr.begin(meta);
    }

    function resume() {
        saved = false;
        Recorder.start();
    }

    function ex() { return plan["ex"][cur["ei"]]; }
    function exCount() { return plan["ex"].size(); }
    function setsOf(i) { return plan["ex"][i]["sets"]; }
    function isDone(i) { return cur["dn"][i] >= setsOf(i); }
    function isSkipped(i) { return cur["sk"][i] == 1; }

    // New exercise: the weight and reps you last logged for it this workout,
    // else its targets. A fresh exercise starts with the weight focused
    // because that's the value most likely to need changing first.
    //
    // Reps prefill to the top of a target range ("10-12" -> 12): that's the
    // goal, and starting low cost real reps when the range was hard to read.
    function prefill() {
        var e = ex();
        var prev = Logic.lastSetFor(sets, e["id"]);
        if (prev != null) {
            cur["w"] = prev["w"];
            cur["r"] = prev["r"];
            cur["f"] = 1;
            return;
        }
        cur["w"] = e["weight"] == null ? 0.0 : e["weight"].toFloat();
        cur["r"] = Logic.targetReps(e);
        cur["f"] = 0;
    }

    function totalSets() {
        return Logic.plannedSets(plan["ex"], cur["dn"], cur["sk"]);
    }

    function progress() {
        var t = totalSets();
        if (t <= 0) { return 1.0; }
        return Logic.clamp(sets.size().toFloat() / t, 0.0, 1.0);
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
        Hr.onSetLogged(sets.size() - 1, s["t"]);
        cur["rs"] = null;
        cur["dn"][cur["ei"]] += 1;

        var rest = e["rest"] == null ? Config.DEFAULT_REST : e["rest"];
        var done = false;
        if (!isDone(cur["ei"])) {
            cur["sn"] = cur["dn"][cur["ei"]] + 1;
            cur["f"] = 1; // same exercise: weight carries over, reps is what changes
        } else {
            done = !nextExercise();
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

    // Moves to the next exercise with sets left, wrapping around. False when
    // there is none.
    function nextExercise() {
        var i = Logic.nextPending(cur["ei"], cur["dn"], cur["sk"], plan["ex"]);
        if (i < 0) { return false; }
        jumpTo(i);
        return true;
    }

    function jumpTo(i) {
        cur["ei"] = i;
        cur["sk"][i] = 0;
        cur["sn"] = cur["dn"][i] + 1;
        prefill();
    }

    // From the exercise picker: do this one now (also brings back a skipped
    // one). Ends any rest in progress, since you've moved on.
    function choose(i) {
        if (cur["re"] != null) { endRest(); }
        if (cur["sum"] == true) { cur["sum"] = false; }
        jumpTo(i);
        saveCur();
    }

    function skipExercise() {
        cur["sk"][cur["ei"]] = 1;
        cur["re"] = null;
        cur["rs"] = null;
        if (!nextExercise()) {
            toSummary();
        } else {
            saveCur();
        }
    }

    // Exercises that still have sets to do (skipped ones included), for the
    // picker. Each entry: [index, label, sub-label].
    function pickable() {
        var out = [];
        for (var i = 0; i < exCount(); i++) {
            if (isDone(i)) { continue; }
            var sub = isSkipped(i) ? "Skipped, select to undo"
                : cur["dn"][i] + "/" + setsOf(i) + " sets" + (i == cur["ei"] ? ", current" : "");
            out.add([i, plan["ex"][i]["name"], sub]);
        }
        return out;
    }

    function inRest() { return cur["re"] != null; }
    function restLeft() { return cur["re"] - now(); }
    function restElapsed() { return cur["r0"] == null ? 0 : now() - cur["r0"]; }

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
        return !saved && cur != null && pickable().size() > 0;
    }

    function leaveSummary() {
        cur["sum"] = false;
        if (isDone(cur["ei"])) { nextExercise(); }
        if (isSkipped(cur["ei"])) { cur["sk"][cur["ei"]] = 0; }
        saveCur();
    }

    function atSummary() { return cur != null && cur["sum"] == true; }

    // Lighter-day prompt: one set fewer on every exercise that has more than
    // one, before the first set is logged.
    function trimSets() {
        plan["ex"] = Logic.trimPlanSets(plan["ex"]);
        Store.put("pl", plan);
    }

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
            meta["te"] = Recorder.trainingEffect();
            Store.putMeta(meta);
            Hr.end(true);
            Store.enqueue(sid);
            Probe.log("save");
            Recorder.stop(true);
            saved = true;
        } else {
            Hr.end(false);
            Recorder.stop(false);
            Store.dropSession(sid);
        }
        clear();
    }
}
