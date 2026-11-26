using Toybox.Lang;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

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
    var awaitingResume = false;
    var last = null;     // summary numbers, kept after cur is cleared

    function now() { return Time.now().value(); }
    function active() { return cur != null; }

    // On launch: pick up an unfinished workout, or clean up half a one.
    function load() {
        cur = Store.get("cur");
        awaitingResume = cur != null;
        if (cur == null) { return; }
        plan = Store.get("pl");
        meta = Store.meta(cur["sid"]);
        if (plan == null || meta == null) {
            clear();
            return;
        }
        if (meta["discard"] == true) {
            Lab.dropSession(cur["sid"]);
            Store.dropSession(cur["sid"]);
            clear();
            return;
        }
        if (meta["en"] != null) {
            // Save was interrupted after stamping the workout as finished.
            if (Store.queue().indexOf(cur["sid"]) < 0) {
                Store.stageBackground(meta, Store.sets(cur["sid"]));
                Store.enqueue(cur["sid"]);
            }
            clear();
            return;
        }
        finishUndo();
        sets = Store.sets(cur["sid"]);
        // Old builds left an undone set running in manual-correction mode.
        // A row already re-saved before an interruption still gets reconciled.
        var oldEdit = cur["editRow"];
        if (oldEdit != null) {
            if (sets.size() == 0 || !sets[sets.size() - 1]["id"].equals(oldEdit["id"])) {
                cur["setAt"] = null;
                Lab.dropSet(oldEdit["id"]);
            }
            cur.remove("editRow");
            saveCur();
        }
        if (cur["dn"] == null) { upgrade(); } else { reconcileSets(); }
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

    // A set write or undo can reach flash before the cursor update. The
    // persisted rows determine which set numbers are still available.
    function reconcileSets() {
        var counts = Logic.doneCounts(plan["ex"], sets);
        for (var i = 0; i < counts.size(); i++) {
            if (counts[i] == cur["dn"][i]) { continue; }
            if (counts[i] == cur["dn"][i] + 1 && i == cur["ei"]) {
                var row = sets[sets.size() - 1];
                cur["w"] = row["w"];
                if (row["ar"] != true) { cur["r"] = row["r"]; }
                advanceAfterSet(ex(), row["t"]);
                return;
            }
            cur["dn"] = counts;
            closeSetWindow();
            cur["sum"] = false;
            cur["re"] = null;
            cur["rs"] = null;
            jumpTo(i);
            if (isDone(i) && !nextExercise()) { toSummary(); }
            else { saveCur(); }
            return;
        }
    }

    function clear() {
        awaitingResume = false;
        cur = null; plan = null; meta = null; sets = null;
        Store.del("cur");
        Store.del("pl");
    }

    function saveCur() { Store.put("cur", cur); }

    function start(wk) {
        awaitingResume = false;
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
        Reps.reset();
        Health.workoutStart(sid);
    }

    function resume() {
        awaitingResume = false;
        saved = false;
        if (!atSummary()) { Recorder.start(); }
        expireRest();
        Reps.reset();
        // The motion recorded before the interruption cannot be recovered.
        if (setRunning() && !setEnded()) { Reps.takeOver(); }
    }

    function setRunning() { return cur != null && cur["setAt"] != null; }

    function setEnded() { return setRunning() && cur["setEnd"] != null; }

    function endSetMotion() {
        cur["setEnd"] = now();
        Reps.captureEnd = System.getTimer();
        cur["f"] = 1;
        saveCur();
    }

    function reviewSet(offered) {
        cur["reviewAuto"] = offered;
        saveCur();
        Reps.finishCapture();
    }

    function completeRepReview(now) {
        if (!setEnded() || !Reps.finalCountReady(now)) { return false; }
        reviewSet(Reps.job == null ? Reps.offer() : null);
        WatchUi.requestUpdate();
        return true;
    }

    function beginSet() {
        if (cur == null || inRest() || atSummary() || setRunning()) { return; }
        cur["setAt"] = now();
        cur["f"] = 1;
        saveCur();
        Hr.closeRecovery();
        if (Recorder.session == null) { Recorder.ensureRecording(); }
        Reps.reset();
        Reps.configure(ex()["tune"]);
        Reps.start();
        Health.mark("set");
    }

    function closeSetWindow() {
        cur["setAt"] = null;
        cur.remove("setEnd");
        cur.remove("reviewAuto");
        cur.remove("correctedAuto");
        Reps.stop();
        Reps.reset();
    }

    function ex() { return plan["ex"][cur["ei"]]; }
    function exCount() { return plan["ex"].size(); }
    function setsOf(i) { return plan["ex"][i]["sets"]; }
    function isDone(i) { return cur["dn"][i] >= setsOf(i); }
    function isSkipped(i) { return cur["sk"][i] == 1; }

    // Use the latest load and the latest manual rep value for this exercise.
    // An AUTO count describes the completed set and isn't the manual fallback
    // for the next one. A fresh exercise starts with the weight focused.
    //
    // Reps prefill to the top of a target range ("10-12" -> 12): that's the
    // goal, and starting low cost real reps when the range was hard to read.
    function prefill() {
        var e = ex();
        var prev = Logic.lastSetFor(sets, e["id"], false);
        cur["r"] = Logic.targetReps(e);
        if (prev != null) {
            var manual = prev["ar"] == true ? Logic.lastSetFor(sets, e["id"], true) : prev;
            cur["w"] = prev["w"];
            if (manual != null) { cur["r"] = manual["r"]; }
            cur["f"] = 1;
            return;
        }
        cur["w"] = e["weight"] == null ? 0.0 : e["weight"].toFloat();
        cur["f"] = 0;
    }

    function totalSets() {
        return Logic.plannedSets(plan["ex"], cur["dn"], cur["sk"]);
    }

    function adjust(dir, displayedOffer) {
        if (cur["f"] == 0) {
            cur["w"] = Logic.clamp(cur["w"] + dir * Config.WEIGHT_STEP, 0.0, 2000.0);
        } else {
            var reps = Reps.manual || displayedOffer == null ? cur["r"] : displayedOffer;
            if (setRunning() && !Reps.manual && displayedOffer != null) { cur["correctedAuto"] = displayedOffer; }
            cur["r"] = Logic.clamp(reps + dir, 0, 1000);
            cur.remove("reviewAuto");
            Reps.takeOver(); // your number wins for the rest of this set
        }
        saveCur();
    }

    function setFocus(f) {
        cur["f"] = f;
        saveCur();
    }

    // Returns true when that was the last set of the workout.
    function logDisplayedSet(offered) {
        if (!setRunning() || inRest() || atSummary()) { return false; }
        var e = ex();
        if (Reps.manual) { offered = null; }
        var reps = offered == null ? cur["r"] : offered;
        var loggedAt = now();
        var endedAt = setEnded() ? cur["setEnd"] : loggedAt;
        // `ra`: what the rep counter made of this set (null: no confident
        // count). Rep Lab records it separately from the saved reps.
        var displayed = offered != null ? offered : cur["correctedAuto"];
        var estimated = displayed != null ? displayed : Reps.count;
        var s = {
            "id" => Logic.uuid4(), "e" => e["id"], "n" => cur["sn"], "r" => reps, "w" => cur["w"],
            "t" => endedAt, "rs" => cur["rs"], "y" => 0, "ra" => estimated, "ar" => offered != null
        };
        System.println("reps auto=" + estimated + " logged=" + reps + " typed=" + Reps.manual
            + " shown=" + (displayed != null) + " set=" + s["id"]
            + " " + e["name"] + Reps.diagnostics());
        Store.putSet(cur["sid"], sets.size(), s);
        sets.add(s);
        // Rep lab: the live window is still open here; it closes below.
        Lab.capture(cur["sid"], s, e, displayed, cur["setAt"], meta["u"]);
        Hr.onSetLogged(sets.size() - 1, endedAt, loggedAt);
        Health.mark("logged");
        var done = advanceAfterSet(e, s["t"]);
        // No lap after the last set: it would leave an empty one in Connect.
        if (!done) { Recorder.setLogged(sets.size()); }
        return done;
    }

    function advanceAfterSet(e, loggedAt) {
        closeSetWindow();
        cur["rs"] = null;
        cur["dn"][cur["ei"]] += 1;

        var rest = e["rest"] == null ? Config.DEFAULT_REST : e["rest"];
        rest = Logic.clamp(rest, 0, 3600);
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
            cur["r0"] = loggedAt;
            cur["rd"] = rest;
            cur["re"] = rest > 0 ? loggedAt + rest : null;
            saveCur();
        }
        return done;
    }

    // The most recent set as "135 x 12  Bench Press", for the undo item.
    // Numbers first: the menu cuts the end off, and they're what you check.
    function lastSetLabel() {
        if (sets == null || sets.size() == 0) { return null; }
        var s = sets[sets.size() - 1];
        var i = indexOfEx(s["e"]);
        return Logic.fmtLoad(s["w"]) + " x " + s["r"] + (i < 0 ? "" : "  " + plan["ex"][i]["name"]);
    }

    function lastRepLabel() {
        if (sets == null || sets.size() == 0) { return null; }
        var s = sets[sets.size() - 1];
        return s["r"] + (s["r"] == 1 ? " rep" : " reps") + (s["ar"] == true ? " AUTO" : " logged");
    }

    function indexOfEx(id) {
        for (var i = 0; i < exCount(); i++) {
            if (plan["ex"][i]["id"].equals(id)) { return i; }
        }
        return -1;
    }

    // Take back the last logged set and return to its setup screen. START
    // opens a fresh timer and motion window. Persist the intent before
    // removing the local set and its recording.
    function undoSet() {
        if (sets == null || sets.size() == 0) { return false; }
        var k = sets.size() - 1;
        var s = sets[k];
        var i = indexOfEx(s["e"]);
        if (i < 0) { return false; }
        sets = sets.slice(0, k);
        Hr.onSetUndone(k);
        closeSetWindow();
        cur["removeAt"] = k;
        cur["undoId"] = s["id"];
        cur["dn"][i] -= 1;
        if (cur["dn"][i] < 0) { cur["dn"][i] = 0; }
        cur["sk"][i] = 0;
        cur["ei"] = i;
        cur["sn"] = s["n"];
        cur["w"] = s["w"];
        cur["r"] = s["r"];
        cur["f"] = 1;
        cur["re"] = null;
        cur["r0"] = null;
        cur["rd"] = null;
        cur["rs"] = s["rs"];
        cur["sum"] = false;
        cur["sumAt"] = null;
        saveCur();
        finishUndo();
        return true;
    }

    function finishUndo() {
        if (cur["removeAt"] == null) { return; }
        Store.del("t_" + cur["sid"] + "_" + cur["removeAt"]);
        if (cur["undoId"] != null) { Lab.dropSet(cur["undoId"]); }
        cur.remove("undoId");
        cur["removeAt"] = null;
        saveCur();
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

    // The rest belongs to the previous set. Picking the next exercise
    // changes the preview while the same rest continues.
    function choose(i) {
        if (i == cur["ei"] && !atSummary() && !isSkipped(i)) { return; }
        closeSetWindow();
        if (cur["sum"] == true) { cur["sum"] = false; }
        jumpTo(i);
        saveCur();
    }

    function skipExercise() {
        closeSetWindow();
        cur["sk"][cur["ei"]] = 1;
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

    function inRest() { return cur != null && cur["re"] != null; }
    function restLeft() { return cur["re"] - now(); }
    function restElapsed() {
        if (!inRest() || cur["r0"] == null) { return 0; }
        var end = now();
        if (end > cur["re"]) { end = cur["re"]; }
        return Logic.clamp(end - cur["r0"], 0, 3600);
    }

    function restFrac() {
        if (cur["rd"] == null || cur["rd"] <= 0) { return 0.0; }
        return Logic.clamp(restLeft().toFloat() / cur["rd"], 0.0, 1.0);
    }

    function adjustRest(delta) {
        if (!inRest()) { return; }
        var left = Logic.clamp(restLeft() + delta, 0, 3600);
        cur["re"] = now() + left;
        cur["rd"] = Logic.clamp(cur["rd"] + delta, left, 3600);
        if (cur["rd"] < 1) { cur["rd"] = 1; }
        saveCur();
    }

    function endRest() {
        if (!inRest()) { return; }
        cur["rs"] = restElapsed();
        cur["re"] = null;
        saveCur();
    }

    function expireRest() {
        if (!inRest() || restLeft() > 0) { return false; }
        endRest();
        return true;
    }

    function toSummary() {
        closeSetWindow();
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
        if (isDone(cur["ei"]) && !nextExercise()) {
            for (var i = 0; i < exCount(); i++) {
                if (!isDone(i)) { jumpTo(i); break; }
            }
        }
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
        // sumAt is set when the summary is reached; before that, now.
        var end = cur["sumAt"] == null ? now() : cur["sumAt"];
        last = {
            "dur" => end - meta["st"],
            "sets" => sets.size(),
            "vol" => Logic.volume(sets),
            "hr" => st["ha"],
            "lastReps" => lastRepLabel(),
            "unit" => meta["u"],
            "sid" => cur["sid"]
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
            Hr.end(true);
            Store.putMeta(meta);
            Store.stageBackground(meta, sets);
            Store.enqueue(sid);
            Recorder.saveCompletedCounts(meta["en"]);
            Probe.log("save");
            Recorder.stop(true);
            Health.workoutEnd(sid, sets.size(), true, $.gNet);
            saved = true;
            Health.mark("saved");
        } else {
            meta["discard"] = true;
            Store.putMeta(meta);
            Lab.dropSession(sid);
            Health.workoutEnd(sid, sets.size(), false, null);
            Hr.end(false);
            Recorder.stop(false);
            Store.dropSession(sid);
        }
        Reps.stop();
        Reps.reset();
        clear();
        if (saved && $.gNet != null) { $.gNet.kick(); }
    }
}
