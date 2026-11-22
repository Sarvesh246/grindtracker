using Toybox.Lang;
using Toybox.Test;
using Toybox.Math;
using Toybox.System;
using Toybox.StringUtil;
using Toybox.Application.Storage;
using Toybox.Time;

// Run: build with --unit-test, then `monkeydo bin/grind-test.prg fr165m -t`.
// (:test) code is stripped from normal builds.

// Helpers live in a module: a bare (:test) function is run as a test.
(:test)
module T {
    function completeSet() {
        if (!Workout.setRunning()) { Workout.beginSet(); }
        return Workout.logDisplayedSet(Reps.offer());
    }

    function startPress(rest) {
        Workout.start({ "id" => "push", "name" => "Push", "unit" => "lbs", "ex" => [
            { "id" => "e", "name" => "Press", "sets" => 2, "reps" => 10, "weight" => 95, "rest" => rest }
        ] });
    }
    function ck(logger, name, cond) {
        if (!cond) { logger.error("FAILED: " + name); }
        return cond;
    }

    function unb64(str) {
        return StringUtil.convertEncodedString(str, {
            :fromRepresentation => StringUtil.REPRESENTATION_STRING_BASE64,
            :toRepresentation => StringUtil.REPRESENTATION_BYTE_ARRAY
        });
    }

    // One 25 Hz batch of constant milli-g values: 12.5 Hz samples after
    // pair averaging.
    function batch(v, size) {
        var xs = []; var ys = []; var zs = [];
        for (var i = 0; i < size; i++) { xs.add(v); ys.add(-v); zs.add(v + 1); }
        return [xs, ys, zs];
    }

    function sampleMeta() {
        return {
            "id" => "6c1f2a9e-0d4b-4c7e-9f3a-5b8e2d1c0a7f", "wid" => "push", "nm" => "Push",
            "st" => 1794848400, "en" => null, "off" => -18000, "u" => "lbs",
            "ha" => null, "hm" => null, "cal" => null
        };
    }

    function sampleSet(id, n, reps, weight, synced) {
        return { "id" => id, "e" => "ex-1", "n" => n, "r" => reps, "w" => weight, "t" => 1794848700, "rs" => null, "y" => synced };
    }
}

(:test)
function testUuidFormat(logger) {
    var ok = true;
    var seen = {};
    for (var i = 0; i < 200; i++) {
        var u = Logic.uuid4();
        ok = T.ck(logger, "length 36", u.length() == 36) && ok;
        ok = T.ck(logger, "dashes", u.substring(8, 9).equals("-") && u.substring(13, 14).equals("-")
            && u.substring(18, 19).equals("-") && u.substring(23, 24).equals("-")) && ok;
        ok = T.ck(logger, "version 4", u.substring(14, 15).equals("4")) && ok;
        var v = u.substring(19, 20);
        ok = T.ck(logger, "variant", v.equals("8") || v.equals("9") || v.equals("a") || v.equals("b")) && ok;
        ok = T.ck(logger, "lowercase", u.equals(u.toLower())) && ok;
        ok = T.ck(logger, "unique", !seen.hasKey(u)) && ok;
        seen[u] = true;
    }
    logger.debug("sample " + Logic.uuid4());
    return ok;
}

(:test)
function testUuidFallback(logger) {
    // The no-crypto path must also produce distinct, well-formed ids.
    var a = Logic.formatUuid(Logic.fallbackBytes());
    var b = Logic.formatUuid(Logic.fallbackBytes());
    var fixed = Logic.formatUuid([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 255]);
    logger.debug("fallback " + a);
    return T.ck(logger, "distinct", !a.equals(b))
        && T.ck(logger, "length", a.length() == 36)
        && T.ck(logger, "known bytes", fixed.equals("00010203-0405-4607-8809-0a0b0c0d0eff"));
}

(:test)
function testQueue(logger) {
    var q = [];
    Logic.qAdd(q, "a");
    Logic.qAdd(q, "b");
    Logic.qAdd(q, "a"); // no duplicates
    var ok = T.ck(logger, "add dedupes", q.size() == 2 && q[0].equals("a") && q[1].equals("b"));
    Logic.qRemove(q, "a");
    ok = T.ck(logger, "remove", q.size() == 1 && q[0].equals("b")) && ok;
    Logic.qRemove(q, "zzz"); // removing a missing id is harmless
    ok = T.ck(logger, "remove missing", q.size() == 1) && ok;
    return ok;
}

(:test)
function testBackoff(logger) {
    return T.ck(logger, "0", Logic.backoffSecs(0) == 0)
        && T.ck(logger, "1", Logic.backoffSecs(1) == 30)
        && T.ck(logger, "2", Logic.backoffSecs(2) == 120)
        && T.ck(logger, "3", Logic.backoffSecs(3) == 600)
        && T.ck(logger, "capped", Logic.backoffSecs(50) == 600);
}

(:test)
function testClassify(logger) {
    return T.ck(logger, "200", Logic.classify(200, null) == Logic.R_OK)
        && T.ck(logger, "201", Logic.classify(201, null) == Logic.R_OK)
        && T.ck(logger, "401", Logic.classify(401, "token_revoked") == Logic.R_AUTH)
        && T.ck(logger, "-104 no phone", Logic.classify(-104, null) == Logic.R_RETRY)
        && T.ck(logger, "-300 timeout", Logic.classify(-300, null) == Logic.R_RETRY)
        && T.ck(logger, "-400 bad body", Logic.classify(-400, null) == Logic.R_RETRY)
        && T.ck(logger, "429", Logic.classify(429, "rate_limited") == Logic.R_RETRY)
        && T.ck(logger, "500", Logic.classify(500, "internal_error") == Logic.R_RETRY)
        && T.ck(logger, "503", Logic.classify(503, null) == Logic.R_RETRY)
        && T.ck(logger, "409 open", Logic.classify(409, "open_session_conflict") == Logic.R_RETRY)
        && T.ck(logger, "409 logged", Logic.classify(409, "day_already_logged") == Logic.R_DEAD)
        && T.ck(logger, "422", Logic.classify(422, "validation_failed") == Logic.R_DEAD)
        && T.ck(logger, "413", Logic.classify(413, "payload_too_large") == Logic.R_DEAD);
}

(:test)
function testPayload(logger) {
    var meta = T.sampleMeta();
    var sets = [
        T.sampleSet("s1", 1, 8, 135.0, 1),   // already synced: not resent
        T.sampleSet("s2", 2, 8, 135.0, 0),
        T.sampleSet("s3", 3, 7, 140.0, 0),
        T.sampleSet("s4", 4, 6, 140.0, 2)    // rejected: not resent
    ];
    sets[2]["rs"] = 120;
    var p = Logic.buildPayload(meta, sets, 25, null);
    var ok = T.ck(logger, "ids", p["id"].equals(meta["id"]) && p["workout_id"].equals("push"));
    ok = T.ck(logger, "started_at", p["started_at"].equals("2026-11-16T17:00:00Z")) && ok;
    ok = T.ck(logger, "open session has no ended_at", !p.hasKey("ended_at")) && ok;
    ok = T.ck(logger, "no hr when unknown", !p.hasKey("heart_rate") && !p.hasKey("calories")) && ok;
    ok = T.ck(logger, "offset", p["utc_offset_seconds"] == -18000) && ok;
    ok = T.ck(logger, "open session sends no trace", !Logic.buildPayload(meta, sets, 25, { "tr" => [90, 91] }).hasKey("hr")) && ok;
    ok = T.ck(logger, "only unsynced", p["sets"].size() == 2 && p["sets"][0]["id"].equals("s2")) && ok;
    var s = p["sets"][1];
    ok = T.ck(logger, "set fields", s["exercise_id"].equals("ex-1") && s["set_number"] == 3 && s["reps"] == 7
        && s["weight"] == 140.0 && s["unit"].equals("lbs") && s["completed_at"].equals("2026-11-16T17:05:00Z")) && ok;
    ok = T.ck(logger, "rest only when known", s["rest_seconds"] == 120 && !p["sets"][0].hasKey("rest_seconds")) && ok;

    meta["en"] = 1794851550;
    meta["ha"] = 128; meta["hm"] = 300; meta["cal"] = 410; // max out of range: dropped
    sets[1]["hp"] = 150; sets[1]["he"] = 140; sets[1]["hd"] = 30; sets[2]["hp"] = 400; // out of range: dropped
    p = Logic.buildPayload(meta, sets, 2, { "tr" => [90, 0, 120], "zs" => [5, 10, 0, 0, 0], "hz" => [106, 127, 148, 169, 190, 211] });
    ok = T.ck(logger, "set hr", p["sets"][0]["hr_peak"] == 150 && p["sets"][0]["hr_end"] == 140
        && p["sets"][0]["hr_rest_drop_60"] == 30 && !p["sets"][1].hasKey("hr_peak")) && ok;
    ok = T.ck(logger, "session hr", p["hr"]["trace_b64"].equals("WgB4") && p["hr"]["step"] == Config.HR_STEP
        && p["hr"]["zone_seconds"][1] == 10 && p["hr"]["zones"].size() == 6) && ok;
    ok = T.ck(logger, "final batch completes session", p["ended_at"].equals("2026-11-16T17:52:30Z")) && ok;
    p = Logic.buildPayload(meta, sets, 1, null);
    ok = T.ck(logger, "no hr block without a record", !p.hasKey("hr")) && ok;
    ok = T.ck(logger, "partial batch stays open", !p.hasKey("ended_at")) && ok;
    ok = T.ck(logger, "hr", p["heart_rate"]["avg"] == 128 && !p["heart_rate"].hasKey("max")) && ok;
    ok = T.ck(logger, "calories", p["calories"] == 410) && ok;
    ok = T.ck(logger, "batch cap", p["sets"].size() == 1) && ok;
    return ok;
}

(:test)
function testApplyResult(logger) {
    var sets = [T.sampleSet("s1", 1, 8, 135.0, 0), T.sampleSet("s2", 2, 8, 135.0, 0),
        T.sampleSet("s3", 3, 8, 135.0, 0), T.sampleSet("s4", 4, 8, 135.0, 0), T.sampleSet("s5", 5, 8, 135.0, 0)];
    var changed = Logic.applyResult(sets, { "sets" => {
        "accepted" => ["s1"], "duplicate" => ["s2"], "updated" => ["s3"],
        "rejected" => [{ "id" => "s4", "code" => "set_number_taken", "message" => "x" }]
    } });
    var ok = T.ck(logger, "four changed", changed.size() == 4);
    ok = T.ck(logger, "accepted/duplicate/updated synced", sets[0]["y"] == 1 && sets[1]["y"] == 1 && sets[2]["y"] == 1) && ok;
    ok = T.ck(logger, "rejected not resent", sets[3]["y"] == 2) && ok;
    ok = T.ck(logger, "unmentioned stays pending", sets[4]["y"] == 0 && Logic.pendingCount(sets) == 1) && ok;
    ok = T.ck(logger, "garbage body changes nothing", Logic.applyResult(sets, null).size() == 0
        && Logic.applyResult(sets, { "sets" => "nope" }).size() == 0) && ok;
    return ok;
}

(:test)
function testMath(logger) {
    var sets = [T.sampleSet("a", 1, 8, 135.0, 0), T.sampleSet("b", 2, 6, 62.5, 0), T.sampleSet("c", 3, 10, 0.0, 0)];
    return T.ck(logger, "volume", Logic.volume(sets) == 1455.0)
        && T.ck(logger, "volume empty", Logic.volume([]) == 0.0)
        && T.ck(logger, "dur short", Logic.fmtDuration(83).equals("1:23"))
        && T.ck(logger, "dur zero", Logic.fmtDuration(0).equals("0:00"))
        && T.ck(logger, "dur hour", Logic.fmtDuration(3750).equals("1:02:30"))
        && T.ck(logger, "dur negative", Logic.fmtDuration(-5).equals("0:00"))
        && T.ck(logger, "weight whole", Logic.fmtWeight(135.0).equals("135"))
        && T.ck(logger, "weight int", Logic.fmtWeight(45).equals("45"))
        && T.ck(logger, "weight half", Logic.fmtWeight(62.5).equals("62.5"))
        && T.ck(logger, "ago now", Logic.agoText(12).equals("synced just now"))
        && T.ck(logger, "ago min", Logic.agoText(300).equals("synced 5m ago"))
        && T.ck(logger, "ago hour", Logic.agoText(7300).equals("synced 2h ago"))
        && T.ck(logger, "ago day", Logic.agoText(200000).equals("synced 2d ago"))
        && T.ck(logger, "latest of workout and day sync", Logic.latest(100, 900) == 900 && Logic.latest(900, 100) == 900)
        && T.ck(logger, "latest with one missing", Logic.latest(null, 5) == 5 && Logic.latest(5, null) == 5 && Logic.latest(null, null) == null)
        && T.ck(logger, "clamp", Logic.clamp(-1, 0, 10) == 0 && Logic.clamp(11, 0, 10) == 10 && Logic.clamp(5, 0, 10) == 5);
}

(:test)
function testStoreRoundTrip(logger) {
    // Persist, reload and drop a session exactly as a crash-recovery would.
    var sid = "test-" + Logic.uuid4();
    var meta = T.sampleMeta();
    meta["id"] = sid;
    Store.putMeta(meta);
    Store.putSet(sid, 0, T.sampleSet("s1", 1, 8, 135.0, 0));
    Store.putSet(sid, 1, T.sampleSet("s2", 2, 8, 135.0, 0));
    var back = Store.sets(sid);
    var ok = T.ck(logger, "two sets back", back.size() == 2 && back[1]["id"].equals("s2") && back[1]["w"] == 135.0);
    ok = T.ck(logger, "meta back", Store.meta(sid)["wid"].equals("push")) && ok;
    var before = Store.queue().size();
    Store.enqueue(sid);
    Store.enqueue(sid);
    ok = T.ck(logger, "enqueued once", Store.queue().size() == before + 1) && ok;
    Store.dequeue(sid);
    Store.dropSession(sid);
    ok = T.ck(logger, "gone", Store.queue().size() == before && Store.sets(sid).size() == 0 && Store.meta(sid) == null) && ok;
    return ok;
}

(:test)
function testWorkoutFlow(logger) {
    // A whole workout through the state machine, including a simulated
    // crash halfway (memory wiped, state reloaded from storage).
    var plan = { "date" => "2026-11-16", "unit" => "lbs", "id" => "push", "name" => "Push", "ex" => [
        { "id" => "e1", "name" => "Bench Press", "sets" => 2, "reps" => 8, "reps_max" => 12, "weight" => 135, "rest" => 60 },
        { "id" => "e2", "name" => "Overhead Press", "sets" => 2, "reps" => null, "reps_max" => null, "weight" => null, "rest" => null }
    ] };
    Workout.start(plan);
    var sid = Workout.cur["sid"];
    var ok = T.ck(logger, "prefilled from target", Workout.cur["w"] == 135.0 && Workout.cur["r"] == 12 && Workout.cur["f"] == 0);
    ok = T.ck(logger, "total", Workout.totalSets() == 4) && ok;
    Workout.adjust(1, null);
    ok = T.ck(logger, "weight step", Workout.cur["w"] == 135.0 + Config.WEIGHT_STEP) && ok;
    Workout.adjust(-1, null);
    Workout.setFocus(1);
    Workout.adjust(1, null);
    ok = T.ck(logger, "reps step", Workout.cur["r"] == 13) && ok;

    ok = T.ck(logger, "first set not last", !T.completeSet()) && ok;
    // Simulate the set reaching storage before the cursor advance.
    Workout.cur["dn"][0] = 0; Workout.cur["sn"] = 1; Workout.saveCur();
    Workout.load();
    ok = T.ck(logger, "resting", Workout.inRest() && Workout.restLeft() > 55 && Workout.restLeft() <= 60) && ok;
    ok = T.ck(logger, "next set, reps focused, values carried", Workout.cur["sn"] == 2 && Workout.cur["f"] == 1
        && Workout.cur["w"] == 135.0 && Workout.cur["r"] == 13) && ok;
    Workout.adjustRest(15);
    ok = T.ck(logger, "+15s", Workout.restLeft() > 70 && Workout.restLeft() <= 75) && ok;
    Workout.adjustRest(-300);
    ok = T.ck(logger, "rest never negative", Workout.restLeft() <= 0 && Workout.restLeft() > -2) && ok;
    Workout.endRest();
    ok = T.ck(logger, "rest taken recorded", !Workout.inRest() && Workout.cur["rs"] != null && Workout.cur["rs"] >= 0) && ok;

    // Crash: lose everything in memory.
    Workout.cur = null; Workout.plan = null; Workout.meta = null; Workout.sets = null;
    Workout.load();
    ok = T.ck(logger, "recovered", Workout.active() && Workout.cur["sid"].equals(sid) && Workout.sets.size() == 1
        && Workout.cur["sn"] == 2 && Workout.sets[0]["r"] == 13 && Workout.sets[0]["n"] == 1) && ok;

    ok = T.ck(logger, "second set moves on", !T.completeSet()) && ok;
    ok = T.ck(logger, "next exercise defaults", Workout.cur["ei"] == 1 && Workout.cur["sn"] == 1
        && Workout.cur["w"] == 0.0 && Workout.cur["r"] == 8 && Workout.cur["f"] == 0) && ok;
    ok = T.ck(logger, "rest from finished exercise", Workout.cur["rd"] == 60) && ok;
    ok = T.ck(logger, "set numbers", Workout.sets[1]["n"] == 2 && Workout.sets[1]["rs"] != null) && ok;
    Workout.endRest();

    Workout.skipExercise();
    ok = T.ck(logger, "skip last -> summary", Workout.atSummary() && Workout.totalSets() == 2) && ok;
    ok = T.ck(logger, "a skip can still be undone from the summary", Workout.canLeaveSummary()) && ok;
    var s = Workout.summary();
    ok = T.ck(logger, "summary", s["sets"] == 2 && s["vol"] == 3510.0 && s["dur"] >= 0) && ok;

    Workout.finish(true);
    var m = Store.meta(sid);
    ok = T.ck(logger, "saved + queued", !Workout.active() && Workout.saved && Store.get("cur") == null
        && Store.queue().indexOf(sid) >= 0 && m["en"] != null && Store.sets(sid).size() == 2) && ok;
    var p = Logic.buildPayload(m, Store.sets(sid), Config.SYNC_BATCH, Store.heart(sid));
    ok = T.ck(logger, "payload", p.hasKey("ended_at") && p["sets"].size() == 2 && p["sets"][1]["set_number"] == 2) && ok;
    Store.dequeue(sid);
    Store.dropSession(sid);

    // Discard wipes the session and never queues it.
    Workout.start(plan);
    sid = Workout.cur["sid"];
    Workout.setFocus(1);
    T.completeSet();
    Workout.finish(false);
    ok = T.ck(logger, "discarded", !Workout.active() && Store.sets(sid).size() == 0 && Store.meta(sid) == null
        && Store.queue().indexOf(sid) < 0) && ok;
    Workout.saved = false;
    return ok;
}

(:test)
function testDayPicker(logger) {
    // Start clean: a real run in the same simulator may have cached days.
    Store.del("wk"); Store.del("wk_pull"); Store.del("wk_push"); Store.del("wk_legs");
    // /today as the updated backend sends it: up-next plan plus every day.
    var d = Logic.localDate();
    Store.cacheToday({ "date" => d, "unit" => "lbs",
        "workout" => { "id" => "pull", "name" => "Pull", "exercises" => [
            { "id" => "p1", "name" => "Row", "sets" => 3, "reps" => 8, "reps_max" => null, "weight" => 100, "rest" => null } ] },
        "days" => [{ "id" => "pull", "name" => "Pull" }, { "id" => "push", "name" => "Push" }, { "id" => "legs", "name" => "Legs" }] });
    Pick.id = null;
    var ok = T.ck(logger, "default is up-next", Pick.currentId().equals("pull") && Store.days().size() == 3);
    ok = T.ck(logger, "default plan cached under its day", Store.planFor("pull")["ex"].size() == 1) && ok;
    ok = T.ck(logger, "other day not downloaded yet", Store.planFor("push") == null) && ok;

    ok = T.ck(logger, "down -> next", Pick.step(1) && Pick.id.equals("push")) && ok;
    ok = T.ck(logger, "down -> next", Pick.step(1) && Pick.id.equals("legs")) && ok;
    ok = T.ck(logger, "wraps forward", Pick.step(1) && Pick.id.equals("pull")) && ok;
    ok = T.ck(logger, "up wraps back", Pick.step(-1) && Pick.id.equals("legs") && Pick.nameOf("legs").equals("Legs")) && ok;

    // A fetched day lands in its own key and leaves the default alone.
    Store.cacheDay({ "date" => d, "unit" => "lbs", "workout" => { "id" => "push", "name" => "Push", "exercises" => [
        { "id" => "x1", "name" => "Bench", "sets" => 3, "reps" => 5, "reps_max" => null, "weight" => 135, "rest" => 90 },
        { "id" => "x2", "name" => "Dips", "sets" => 3, "reps" => 8, "reps_max" => null, "weight" => 0, "rest" => null } ] } });
    ok = T.ck(logger, "picked day cached", Store.planFor("push")["ex"].size() == 2 && Store.planFor("push")["id"].equals("push")) && ok;
    ok = T.ck(logger, "default untouched", Store.today()["id"].equals("pull") && Store.days().size() == 3) && ok;

    // A plan from another date is never offered.
    Store.put("wk_push", { "date" => "1999-01-01", "unit" => "lbs", "id" => "push", "name" => "Push", "ex" => [] });
    ok = T.ck(logger, "stale day ignored", Store.planFor("push") == null) && ok;

    // Rest day: nothing is picked until the user scrolls, then either end works.
    Store.cacheToday({ "date" => d, "unit" => "lbs", "workout" => null, "reason" => "rest_day",
        "days" => [{ "id" => "pull", "name" => "Pull" }, { "id" => "push", "name" => "Push" }] });
    Pick.id = null;
    ok = T.ck(logger, "rest day: nothing picked", Pick.currentId() == null && Store.days().size() == 2) && ok;
    ok = T.ck(logger, "rest day: down -> first", Pick.step(1) && Pick.id.equals("pull")) && ok;
    Pick.id = null;
    ok = T.ck(logger, "rest day: up -> last", Pick.step(-1) && Pick.id.equals("push")) && ok;

    // One day only: nothing to scroll.
    Store.cacheToday({ "date" => d, "unit" => "lbs",
        "workout" => { "id" => "pull", "name" => "Pull", "exercises" => [] },
        "days" => [{ "id" => "pull", "name" => "Pull" }] });
    Pick.id = null;
    ok = T.ck(logger, "single day: no scroll", !Pick.step(1) && Pick.id == null) && ok;

    // An older server (no days) just means no picker.
    Store.cacheToday({ "date" => d, "unit" => "lbs", "workout" => { "id" => "pull", "name" => "Pull", "exercises" => [] } });
    ok = T.ck(logger, "no days: no picker", Store.days() == null && !Pick.step(1)) && ok;

    // Body signals ride on /today's body: kept when they flag strain,
    // dropped when the server sends none.
    var charge = { "score" => 48, "band" => "easy", "label" => "Easy", "advice" => "Trim a set per lift" };
    Store.cacheToday({ "date" => d, "unit" => "lbs", "workout" => { "id" => "pull", "name" => "Pull", "exercises" => [] },
        "body" => { "charge" => charge, "signals" => { "level" => "strong", "short" => "Rest: strain signs" } } });
    var sg = Store.bodySignal();
    ok = T.ck(logger, "strong body signal kept", sg != null && sg["lv"] == 2 && sg["t"].equals("Rest: strain signs")) && ok;
    Store.cacheToday({ "date" => d, "unit" => "lbs", "workout" => { "id" => "pull", "name" => "Pull", "exercises" => [] },
        "body" => { "charge" => charge, "signals" => null } });
    ok = T.ck(logger, "no signal, no line", Store.bodySignal() == null) && ok;

    Pick.id = null; Pick.want = false;
    Store.del("wk"); Store.del("wk_pull"); Store.del("wk_push"); Store.del("wk_legs"); Store.del("wkAt");
    return ok;
}

(:test)
function testExerciseOrder(logger) {
    // Out of order, skip, undo the skip, and finish everything.
    var plan = { "date" => "2026-11-16", "unit" => "lbs", "id" => "pull", "name" => "Pull", "ex" => [
        { "id" => "a", "name" => "Row", "sets" => 2, "reps" => 8, "reps_max" => null, "weight" => 100, "rest" => 30 },
        { "id" => "b", "name" => "Face Pull", "sets" => 1, "reps" => 15, "reps_max" => null, "weight" => 40, "rest" => 30 },
        { "id" => "c", "name" => "Preacher Curl", "sets" => 1, "reps" => 10, "reps_max" => 12, "weight" => 50, "rest" => 30 }
    ] };
    Workout.start(plan);
    var sid = Workout.cur["sid"];
    var ok = T.ck(logger, "three to pick", Workout.pickable().size() == 3);

    Workout.choose(2); // preacher curls before face pulls
    ok = T.ck(logger, "jumped", Workout.cur["ei"] == 2 && Workout.cur["sn"] == 1 && Workout.cur["r"] == 12 && Workout.cur["w"] == 50.0) && ok;
    Workout.setFocus(1);
    T.completeSet();
    ok = T.ck(logger, "wraps to first unfinished", Workout.cur["ei"] == 0 && Workout.cur["dn"][2] == 1) && ok;
    var restEnd = Workout.cur["re"];
    var restStart = Workout.cur["r0"];
    Workout.choose(1);
    ok = T.ck(logger, "switch updates the next set and preserves the original rest",
        Workout.cur["ei"] == 1 && Workout.cur["re"] == restEnd && Workout.cur["r0"] == restStart
        && Workout.cur["rd"] == 30 && Store.get("cur")["re"] == restEnd) && ok;
    Workout.choose(0);
    Workout.cur["r0"] = Workout.now() - 31;
    Workout.cur["re"] = Workout.cur["r0"] + 30;
    ok = T.ck(logger, "rest can expire inside the picker and records the full interval once",
        Workout.expireRest() && !Workout.expireRest() && Workout.cur["rs"] == 30 && Workout.cur["ei"] == 0) && ok;

    Workout.skipExercise(); // oops
    ok = T.ck(logger, "skip moves on", Workout.cur["ei"] == 1 && Workout.isSkipped(0)) && ok;
    var list = Workout.pickable();
    ok = T.ck(logger, "skipped still pickable", list.size() == 2 && list[0][0] == 0 && list[0][2].find("Skipped") != null) && ok;
    Workout.choose(0); // undo
    ok = T.ck(logger, "undo skip", Workout.cur["ei"] == 0 && !Workout.isSkipped(0) && Workout.totalSets() == 4) && ok;

    Workout.setFocus(1);
    T.completeSet(); Workout.endRest();
    ok = T.ck(logger, "same exercise next set", Workout.cur["ei"] == 0 && Workout.cur["sn"] == 2 && Workout.cur["f"] == 1) && ok;
    T.completeSet(); Workout.endRest();
    ok = T.ck(logger, "then face pulls", Workout.cur["ei"] == 1) && ok;
    Workout.setFocus(1);
    ok = T.ck(logger, "last set ends it", T.completeSet() && Workout.atSummary()) && ok;
    ok = T.ck(logger, "set numbers per exercise", Workout.sets[0]["n"] == 1 && Workout.sets[1]["n"] == 1
        && Workout.sets[2]["n"] == 2 && Workout.sets[3]["n"] == 1) && ok;

    // All remaining work is skipped and the current exercise is complete.
    Workout.finish(false);
    Workout.start(plan);
    Workout.skipExercise(); Workout.skipExercise(); T.completeSet();
    Workout.leaveSummary();
    ok = T.ck(logger, "resume selects unfinished exercise", !Workout.isDone(Workout.cur["ei"])
        && !Workout.isSkipped(Workout.cur["ei"])) && ok;

    // Skipping every exercise lands on the summary, and BACK can return.
    Workout.finish(false);
    Workout.start(plan);
    var sid2 = Workout.cur["sid"];
    Workout.skipExercise(); Workout.skipExercise(); Workout.skipExercise();
    ok = T.ck(logger, "all skipped -> summary", Workout.atSummary() && Workout.canLeaveSummary()) && ok;
    Workout.leaveSummary();
    ok = T.ck(logger, "back from summary un-skips", !Workout.atSummary() && !Workout.isSkipped(Workout.cur["ei"])) && ok;
    Workout.finish(false);
    Store.dropSession(sid);
    Store.dropSession(sid2);
    Workout.saved = false;
    return ok;
}

(:test)
function testHrMath(logger) {
    var z = [106, 127, 148, 169, 190, 211];
    var ok = T.ck(logger, "zones", Logic.zoneOf(100, z) == 0 && Logic.zoneOf(130, z) == 2
        && Logic.zoneOf(170, z) == 4 && Logic.zoneOf(195, z) == 5 && Logic.zoneOf(150, null) == 0 && Logic.zoneOf(null, z) == 0);
    var tr = [];
    var midnightGap = new [96];
    var midnightAt = new [96];
    Body.bucket(midnightGap, midnightAt, 999, 87, 1000);
    ok = T.ck(logger, "previous day's last second cannot enter today's first bucket", midnightGap[0] == null) && ok;
    Logic.traceSet(tr, 0, 90);
    Logic.traceSet(tr, 3, 120);
    ok = T.ck(logger, "trace pads gaps", tr.size() == 4 && tr[1] == 0 && tr[3] == 120) && ok;
    Logic.traceSet(tr, Config.MAX_TRACE, 99);
    ok = T.ck(logger, "trace capped", tr.size() == 4) && ok;
    ok = T.ck(logger, "peak", Logic.peakIn(tr, -5, 10) == 120 && Logic.peakIn(tr, 1, 2) == null) && ok;
    ok = T.ck(logger, "not recovered early", !Logic.recovered(160, 120, 20, z)) && ok;
    ok = T.ck(logger, "recovered by drop", Logic.recovered(160, 160 - Config.SMART_REST_DROP, 40, z)) && ok;
    ok = T.ck(logger, "recovered under z2", Logic.recovered(140, 125, 40, z) && !Logic.recovered(140, 130, 40, z)) && ok;
    ok = T.ck(logger, "no peak, no buzz", !Logic.recovered(null, 90, 90, z)) && ok;

    var b = new [96];
    var bAt = new [96];
    var samples = [[1000, 50], [1000 + 899, 52], [1000 + 900, 60], [1000 + 95 * 900 + 10, 7], [500, 99]];
    for (var si = 0; si < samples.size(); si++) { Body.bucket(b, bAt, samples[si][0], samples[si][1], 1000); }
    ok = T.ck(logger, "buckets", b.size() == 96 && b[0] == 52 && b[1] == 60 && b[2] == null && b[95] == 7) && ok;

    var e = { "reps" => 10, "reps_max" => 12 };
    ok = T.ck(logger, "reps text whole", Logic.repsText(e).equals("10-12 reps") && Logic.targetReps(e) == 12) && ok;
    ok = T.ck(logger, "reps text single", Logic.repsText({ "reps" => 8, "reps_max" => null }).equals("8 reps")
        && Logic.repsText({ "reps" => null, "reps_max" => null }).equals("AMRAP")
        && Logic.targetReps({ "reps" => null, "reps_max" => null }) == 8) && ok;
    var ex = Logic.trimPlanSets([{ "sets" => 4 }, { "sets" => 1 }]);
    ok = T.ck(logger, "lighter day", ex[0]["sets"] == 3 && ex[1]["sets"] == 1) && ok;
    var one = [{ "sets" => 1 }, { "sets" => 1 }, { "sets" => 1 }];
    ok = T.ck(logger, "next pending wraps", Logic.nextPending(2, [0, 1, 0], [0, 0, 0], one) == 0
        && Logic.nextPending(0, [1, 1, 0], [0, 0, 1], one) == -1) && ok;
    return ok;
}

(:test)
function testLongHeartTrace(logger) {
    var id = "test-long-trace";
    var trace = [];
    for (var i = 0; i < Config.MAX_TRACE; i++) { trace.add(i % 171); }
    var sealed = Store.putHeart(id, trace, null, null, 0);
    var restored = Store.heart(id)["tr"];
    var ok = T.ck(logger, "long trace restored across chunk boundary", sealed > 1
        && restored.size() == trace.size() && restored[1024] == trace[1024]
        && restored[trace.size()-1] == trace[trace.size()-1]);
    Store.dropSession(id);
    return T.ck(logger, "chunks removed with workout", Store.get("hc_" + id + "_0") == null) && ok;
}

(:test)
function testUndoSet(logger) {
    // Undo takes back exactly the last set and puts you on it to re-log.
    var plan = { "date" => "2026-11-16", "unit" => "lbs", "id" => "push", "name" => "Push", "ex" => [
        { "id" => "e1", "name" => "Bench Press", "sets" => 2, "reps" => 8, "reps_max" => null, "weight" => 135, "rest" => 60 },
        { "id" => "e2", "name" => "Dips", "sets" => 1, "reps" => null, "reps_max" => null, "weight" => null, "rest" => 60 }
    ] };
    Workout.start(plan);
    var sid = Workout.cur["sid"];
    var ok = T.ck(logger, "nothing to undo", !Workout.undoSet() && Workout.lastSetLabel() == null);
    Workout.setFocus(1);
    T.completeSet();
    Workout.endRest();
    Workout.cur["r"] = 6;
    T.completeSet(); // bench done -> resting before dips
    ok = T.ck(logger, "label", Workout.lastSetLabel().equals("135 x 6  Bench Press")) && ok;
    ok = T.ck(logger, "undo", Workout.undoSet()) && ok;
    ok = T.ck(logger, "back on bench set 2", Workout.cur["ei"] == 0 && Workout.cur["sn"] == 2 && Workout.cur["dn"][0] == 1
        && Workout.cur["r"] == 6 && Workout.cur["f"] == 1 && !Workout.inRest()
        && !Workout.setRunning() && !Reps.listening && Reps.offer() == null && !Reps.manual) && ok;
    ok = T.ck(logger, "stored set gone", Workout.sets.size() == 1 && Store.sets(sid).size() == 1) && ok;
    // Survives a crash.
    Workout.cur = null; Workout.plan = null; Workout.meta = null; Workout.sets = null;
    Workout.load();
    ok = T.ck(logger, "reloaded", Workout.sets.size() == 1 && Workout.cur["sn"] == 2 && Workout.cur["dn"][0] == 1) && ok;
    Workout.cur["r"] = 7;
    T.completeSet();
    ok = T.ck(logger, "re-logged with same number", Workout.sets.size() == 2 && Workout.sets[1]["n"] == 2 && Workout.sets[1]["r"] == 7) && ok;
    Workout.endRest();
    // Undo from the summary reopens the workout.
    Workout.cur["r"] = 10;
    ok = T.ck(logger, "dips ends it", T.completeSet() && Workout.atSummary()) && ok;
    ok = T.ck(logger, "bodyweight label", Workout.lastSetLabel().equals("BW x 10  Dips")) && ok;
    Workout.undoSet();
    ok = T.ck(logger, "summary undone", !Workout.atSummary() && Workout.cur["ei"] == 1 && Workout.totalSets() == 3) && ok;
    Workout.finish(false);
    Store.dropSession(sid);
    Workout.saved = false;
    return ok;
}

(:test)
function testFormatting(logger) {
    var ok = T.ck(logger, "thousands", Logic.fmtThousands(0).equals("0") && Logic.fmtThousands(999).equals("999")
        && Logic.fmtThousands(2310).equals("2,310") && Logic.fmtThousands(1002345).equals("1,002,345")
        && Logic.fmtThousands(1000).equals("1,000"));
    ok = T.ck(logger, "load", Logic.fmtLoad(0.0).equals("BW") && Logic.fmtLoad(62.5).equals("62.5") && Logic.fmtLoad(135).equals("135")) && ok;
    ok = T.ck(logger, "bare target", Logic.bareTarget({ "reps" => 8, "reps_max" => 12 }).equals("8-12")
        && Logic.bareTarget({ "reps" => 5, "reps_max" => null }).equals("5")
        && Logic.bareTarget({ "reps" => null, "reps_max" => null }).equals("AMRAP")) && ok;
    return ok;
}

(:test)
function testKeepResult(logger) {
    // The summary's "+XP" comes from a completed upload only.
    Store.del("lx");
    var n = new Net();
    n.keepResult("s1", { "session" => { "status" => "open", "xp_earned" => null }, "stats" => null });
    var ok = T.ck(logger, "open ignored", Store.get("lx") == null);
    n.keepResult("s1", { "session" => { "status" => "completed", "xp_earned" => 140 }, "stats" => { "current_streak" => 9 } });
    var r = Store.get("lx");
    ok = T.ck(logger, "kept", r != null && r["sid"].equals("s1") && r["xp"] == 140 && r["st"] == 9) && ok;
    n.keepResult("s2", "not json");
    ok = T.ck(logger, "garbage ignored", Store.get("lx")["sid"].equals("s1")) && ok;
    Store.del("lx");
    return ok;
}

// --- rep counter ------------------------------------------------------------
// Same generators as tools/reps-fixtures.mjs; the expected counts are what
// the reference implementation gives (`node watch/tools/reps-fixtures.mjs`).
(:test)
module RepFx {
    var seed = 1;

    function lcg() {
        seed = (seed * 75 + 74) % 65537;
        return seed / 65537.0 - 0.5;
    }

    function smooth(u) { return u * u * (3 - 2 * u); }

    function curl(reps, glance) {
        seed = 7;
        var th = [];
        var ph = [];
        for (var i = 0; i < 37; i++) { th.add(0.0); ph.add(0.0); }
        for (var r = 0; r < reps; r++) {
            for (var i = 0; i < 4; i++) { th.add(0.0); ph.add(0.0); }
            for (var i = 0; i < 12; i++) { th.add(2 * smooth((i + 1) / 12.0)); ph.add(0.0); }
            for (var i = 0; i < 4; i++) { th.add(2.0); ph.add(0.0); }
            for (var i = 0; i < 20; i++) { th.add(2 - 2 * smooth((i + 1) / 20.0)); ph.add(0.0); }
        }
        for (var i = 0; i < 37; i++) { th.add(0.0); ph.add(0.0); }
        if (glance) {
            for (var i = 0; i < 6; i++) { th.add(0.0); ph.add(1.3 * smooth((i + 1) / 6.0)); }
            for (var i = 0; i < 15; i++) { th.add(0.0); ph.add(1.3); }
        }
        var x = []; var y = []; var z = []; var s = [];
        for (var i = 0; i < th.size(); i++) {
            var vy = -Math.sin(th[i]);
            var vz = Math.cos(th[i]);
            x.add(vz * Math.sin(ph[i]) + 0.03 * lcg());
            y.add(vy + 0.03 * lcg());
            z.add(vz * Math.cos(ph[i]) + 0.03 * lcg());
            s.add(0);
        }
        return [x, y, z, s];
    }

    function press(reps) {
        seed = 11;
        var p = [];
        for (var i = 0; i < 37; i++) { p.add(0.0); }
        for (var r = 0; r < reps; r++) {
            for (var i = 0; i < 6; i++) { p.add(0.0); }
            for (var i = 0; i < 14; i++) { p.add(smooth((i + 1) / 14.0)); }
            for (var i = 0; i < 6; i++) { p.add(1.0); }
            for (var i = 0; i < 18; i++) { p.add(1 - smooth((i + 1) / 18.0)); }
        }
        for (var i = 0; i < 37; i++) { p.add(0.0); }
        var dt = 0.08;
        var n = p.size();
        var x = []; var y = []; var z = []; var s = [];
        for (var i = 0; i < n; i++) {
            var a = p[i > 0 ? i - 1 : 0];
            var b = p[i];
            var c = p[i < n - 1 ? i + 1 : n - 1];
            var acc = (a - 2 * b + c) / (dt * dt) * 0.4 / 9.81;
            var tilt = 0.12 * p[i];
            x.add(Math.sin(tilt) + 0.02 * lcg());
            y.add(0.02 * lcg());
            z.add(Math.cos(tilt) + acc + 0.02 * lcg());
            s.add(0);
        }
        return [x, y, z, s];
    }

    function fidget() {
        seed = 3;
        var x = []; var y = []; var z = []; var s = [];
        var a = 0.0;
        var b = 0.0;
        for (var i = 0; i < 600; i++) {
            a += 0.15 * lcg(); b += 0.15 * lcg();
            a *= 0.97; b *= 0.97;
            x.add(Math.sin(a) + 0.03 * lcg());
            y.add(Math.sin(b) + 0.03 * lcg());
            z.add(Math.cos(a) * Math.cos(b) + 0.03 * lcg());
            s.add(0);
        }
        return [x, y, z, s];
    }

    function run(d) {
        var job = new RepAnalysis(d[0], d[1], d[2], d[3], false);
        var result = null;
        while (result == null) { result = job.step(); }
        return result;
    }
}

(:test)
function testRepsCurl(logger) {
    var r8 = RepFx.run(RepFx.curl(8, false));
    var r12 = RepFx.run(RepFx.curl(12, false));
    logger.debug("curl 8 -> " + r8 + ", curl 12 -> " + r12);
    return T.ck(logger, "curl 8", r8[1] && r8[0] == 8) && T.ck(logger, "curl 12", r12[1] && r12[0] == 12);
}

(:test)
function testRepsGlanceIsNotARep(logger) {
    // Raising the wrist to press START after the set is half a motion.
    var r = RepFx.run(RepFx.curl(8, true));
    logger.debug("curl 8 + glance -> " + r);
    return T.ck(logger, "still 8", r[1] && r[0] == 8);
}

(:test)
function testRepsPress(logger) {
    var r = RepFx.run(RepFx.press(6));
    logger.debug("press 6 -> " + r);
    return T.ck(logger, "press 6", r[1] && r[0] == 6);
}

(:test)
function testRepsFidgetSaysNothing(logger) {
    var r = RepFx.run(RepFx.fidget());
    logger.debug("fidget -> " + r);
    return T.ck(logger, "no count", !r[1]);
}

(:test)
function testRepsTooLittleData(logger) {
    return T.ck(logger, "empty", !RepFx.run([[], [], [], []])[1])
        && T.ck(logger, "short", !RepFx.run([[1.0, 1.0], [0.0, 0.0], [0.0, 0.0], [0, 0]])[1]);
}

(:test)
function testRepsFullBufferTime(logger) {
    var d = RepFx.curl(20, false);
    var job = new RepAnalysis(d[0], d[1], d[2], d[3], false);
    var longest = 0;
    var result = null;
    var calls = 0;
    while (result == null && calls < 500) {
        var start = System.getTimer();
        result = job.step();
        longest = Reps.imax(longest, System.getTimer() - start);
        calls++;
    }
    logger.debug("Full buffer: " + calls + " callbacks, longest " + longest + " ms");
    return T.ck(logger, "bounded callbacks and accurate count", calls > 10 && longest < 250
        && result != null && result[1] && result[0] == 20);
}

(:test)
function testRepsRollingWindow(logger) {
    Reps.reset();
    var data = RepFx.curl(25, false);
    for (var i = 0; i < data[0].size(); i++) {
        Reps.append(data[0][i], data[1][i], data[2][i], i);
    }
    var steps = Reps.ordered(Reps.bs);
    var ok = T.ck(logger, "rolling buffer keeps the latest samples in order",
        Reps.clipped && steps.size() == Reps.MAX_SAMPLES && steps[0] == data[0].size() - Reps.MAX_SAMPLES
            && steps[steps.size() - 1] == data[0].size() - 1);
    // No walking in this fixture. Feed the same clipped motion to the worker.
    var job = new RepAnalysis(Reps.ordered(Reps.bx), Reps.ordered(Reps.by), Reps.ordered(Reps.bz),
        data[3].slice(data[3].size() - Reps.MAX_SAMPLES, null), true);
    var result = null;
    for (var i = 0; i < 500 && result == null; i++) { result = job.step(); }
    ok = T.ck(logger, "clipped set withdraws the rep offer", result != null && result[0] == -1 && !result[1]) && ok;
    Reps.reset();
    return ok;
}

(:test)
function testRepSensorGap(logger) {
    Reps.reset();
    Reps.listening = true;
    Reps.onData(null);
    var ok = T.ck(logger, "missing startup batch can recover", !Reps.interrupted);
    Reps.sawMotion = true;
    Reps.count = 8;
    Reps.onData(null);
    ok = T.ck(logger, "missing mid-set batch withdraws the offer", Reps.interrupted && Reps.offer() == null) && ok;
    Reps.reset();
    Reps.listening = false;
    return T.ck(logger, "next set can count again", !Reps.interrupted) && ok;
}

(:test)
function testRepSensorCallbackFlow(logger) {
    Reps.reset();
    Reps.listening = true;
    var data = RepFx.curl(8, false);
    var samples = data[0].size() * 2;
    var analysisDuringMotion = false;
    for (var start = 0; start < samples; start += Reps.RATE) {
        var xs = []; var ys = []; var zs = []; var ts = [];
        for (var i = start; i < Reps.imin(samples, start + Reps.RATE); i++) {
            xs.add((1000 * data[0][i / 2]).toNumber());
            ys.add((1000 * data[1][i / 2]).toNumber());
            zs.add((1000 * data[2][i / 2]).toNumber());
            ts.add(i * 40);
        }
        // Timestamped samples remain contiguous even when the callback runs
        // several seconds late.
        Reps.onSamples(xs, ys, zs, ts, start * 40 + (start == 75 ? 4000 : 0), 0);
        if (Reps.movingBatches > 0 && Reps.job != null) { analysisDuringMotion = true; }
        for (var j = 0; j < 20 && Reps.job != null; j++) { Reps.advanceAnalysis(); }
    }
    for (var i = 0; i < 500 && Reps.job != null; i++) { Reps.advanceAnalysis(); }
    var ok = T.ck(logger, "analysis begins during the lift", analysisDuringMotion)
        && T.ck(logger, "complete sensor flow offers eight curls", !Reps.interrupted && Reps.offer() == 8);
    Reps.reset();
    Reps.listening = false;
    return ok;
}

class FakeRepJob {
    var result;
    function initialize(r) { result = r; }
    function step() { return result; }
}

(:test)
function testTrimWindow(logger) {
    // 3 s of wrist coming down from the screen, 1.5 s still, a set, 1.2 s
    // still, then 1 s of the wrist rising to press START.
    var x = []; var y = []; var z = [];
    for (var i = 0; i < 38; i++) { var t = 1.3 * (1.0 - i / 37.0); x.add(Math.sin(t)); y.add(0.0); z.add(Math.cos(t)); }
    for (var i = 0; i < 19; i++) { x.add(0.0); y.add(0.0); z.add(1.0); }
    for (var i = 0; i < 100; i++) { x.add(0.0); y.add(0.4 * Math.sin(i / 4.0)); z.add(1.0); }
    for (var i = 0; i < 15; i++) { x.add(0.0); y.add(0.4 * Math.sin(100 / 4.0)); z.add(1.0); }
    for (var i = 0; i < 12; i++) { var t = 1.3 * (i + 1) / 12.0; x.add(Math.sin(t)); y.add(0.4 * Math.sin(100 / 4.0)); z.add(Math.cos(t)); }
    var n = x.size();
    var setStart = y[60];
    Reps.trimWindow(x, y, z);
    var ok = T.ck(logger, "a drop longer than 2.5 s is left alone", x[0] > 0.9);
    // Shorten the drop to 1.5 s: now it is held still.
    var x2 = x.slice(19, null); var y2 = y.slice(19, null); var z2 = z.slice(19, null);
    for (var i = 0; i < 19; i++) { var t = 1.3 * (1.0 - i / 18.0); x2[i] = Math.sin(t); z2[i] = Math.cos(t); }
    Reps.trimWindow(x2, y2, z2);
    ok = T.ck(logger, "START drop held still", Reps.fabs(x2[0]) < 0.01 && Reps.fabs(z2[0] - 1.0) < 0.01) && ok;
    ok = T.ck(logger, "the set is untouched", y[60] == setStart && y2[41] == y[60]) && ok;
    ok = T.ck(logger, "finish raise held still", Reps.fabs(x[n - 1]) < 0.01 && Reps.fabs(x2[x2.size() - 1]) < 0.01) && ok;
    return ok;
}

module GlanceFx {
    // One 25 Hz batch, continuing the timestamps after `at` samples. `rise`
    // turns the wrist toward the face across the batch; otherwise it holds.
    function batch(at, rise, hold) {
        var xs = []; var ys = []; var zs = []; var ts = [];
        for (var i = 0; i < Reps.RATE; i++) {
            var tilt = rise ? 1.3 * (i + 1) / Reps.RATE : hold;
            xs.add((1000 * Math.sin(tilt)).toNumber());
            ys.add(0);
            zs.add((1000 * Math.cos(tilt)).toNumber());
            ts.add((at + i) * 40);
        }
        Reps.onSamples(xs, ys, zs, ts, (at + Reps.RATE) * 40, 0);
    }
}

(:test)
function testSettledCountSurvivesGlance(logger) {
    Reps.reset();
    Reps.listening = true;
    var data = RepFx.curl(8, false);
    var samples = data[0].size() * 2;
    for (var start = 0; start < samples; start += Reps.RATE) {
        var xs = []; var ys = []; var zs = []; var ts = [];
        for (var i = start; i < Reps.imin(samples, start + Reps.RATE); i++) {
            xs.add((1000 * data[0][i / 2]).toNumber());
            ys.add((1000 * data[1][i / 2]).toNumber());
            zs.add((1000 * data[2][i / 2]).toNumber());
            ts.add(i * 40);
        }
        Reps.onSamples(xs, ys, zs, ts, start * 40, 0);
        for (var j = 0; j < 20 && Reps.job != null; j++) { Reps.advanceAnalysis(); }
    }
    for (var i = 0; i < 500 && Reps.job != null; i++) { Reps.advanceAnalysis(); }
    var ok = T.ck(logger, "settled count offered", Reps.offer() == 8 && Reps.countSettled);
    var at = samples;
    GlanceFx.batch(at, true, 0.0);
    ok = T.ck(logger, "count shown while raising the wrist", Reps.offer() == 8) && ok;
    GlanceFx.batch(at + Reps.RATE, false, 1.3);
    ok = T.ck(logger, "count still shown while the re-check runs", Reps.offer() == 8 && Reps.job != null) && ok;
    for (var i = 0; i < 500 && Reps.job != null; i++) { Reps.advanceAnalysis(); }
    ok = T.ck(logger, "re-check keeps eight", Reps.offer() == 8) && ok;
    // The re-check after a glance sees the wrist turned ~90 degrees. It may
    // add a rep done since, but never lower or clear the settled count.
    var outcomes = [[5, true], [0, false], [9, true]];
    var expect = [8, 8, 9];
    for (var i = 0; i < outcomes.size(); i++) {
        at += 2 * Reps.RATE;
        GlanceFx.batch(at, true, 0.0);
        GlanceFx.batch(at + Reps.RATE, false, 1.3);
        ok = T.ck(logger, "glance re-check scheduled " + i, Reps.job != null && Reps.jobGlance) && ok;
        Reps.job = new FakeRepJob(outcomes[i]);
        Reps.advanceAnalysis();
        ok = T.ck(logger, "glance re-check " + outcomes[i] + " shows " + expect[i], Reps.offer() == expect[i]) && ok;
    }
    // A count from a mid-lift preview can miss the last rep: settling drops it.
    Reps.cancelAnalysis();
    Reps.count = 5; Reps.countSettled = false; Reps.movingBatches = 1;
    GlanceFx.batch(at + 2 * Reps.RATE, false, 1.3);
    ok = T.ck(logger, "preview count withdrawn at settle", Reps.offer() == null) && ok;
    Reps.reset();
    Reps.listening = false;
    return ok;
}

(:test)
function testRepOfferDoesNotCarryForward(logger) {
    Workout.start({ "id" => "push", "name" => "Push", "unit" => "lbs", "ex" => [
        { "id" => "e", "name" => "Bench", "sets" => 3, "reps" => 12, "weight" => 135.0, "rest" => 0 }
    ] });
    Workout.setFocus(1);
    Workout.beginSet();
    Reps.count = 8;
    T.completeSet();
    var ok = T.ck(logger, "offer saved, next set keeps planned reps, no rest screen",
        Workout.sets[0]["r"] == 8 && Workout.cur["r"] == 12 && !Workout.inRest());
    Workout.cur["dn"][0] = 0; Workout.cur["sn"] = 1; Workout.saveCur();
    Workout.load();
    ok = T.ck(logger, "recovery retains fallback reps", Workout.cur["sn"] == 2 && Workout.cur["r"] == 12) && ok;
    Workout.beginSet();
    Reps.count = 9;
    Workout.adjust(1, 9);
    ok = T.ck(logger, "manual adjustment starts from the offer", Workout.cur["r"] == 10 && Reps.offer() == null) && ok;
    T.completeSet();
    Workout.undoSet();
    ok = T.ck(logger, "undo retains fallback reps and clears the previous count", Workout.cur["r"] == 10 && Reps.offer() == null) && ok;
    var input = new TestSetDelegate();
    input.onSelect();
    ok = T.ck(logger, "START after undo starts a fresh timer and enables automatic counting",
        Workout.setRunning() && Workout.cur["setAt"] == Workout.now() && !Reps.manual && Workout.sets.size() == 1) && ok;
    Workout.finish(false);
    return ok;
}

(:test)
function testRepLabRecordsSets(logger) {
    var savedQ = Store.get("labq");
    Store.put("labq", []);
    Lab.setEnabled(true);
    T.startPress(0);
    var sid = Workout.cur["sid"];
    Workout.setFocus(1);
    Workout.beginSet();
    // A real sensor flow: eight curls through the live listener path.
    Reps.listening = true;
    var data = RepFx.curl(8, false);
    var samples = data[0].size() * 2;
    for (var start = 0; start < samples; start += Reps.RATE) {
        var xs = []; var ys = []; var zs = []; var ts = [];
        for (var i = start; i < Reps.imin(samples, start + Reps.RATE); i++) {
            xs.add((1000 * data[0][i / 2]).toNumber());
            ys.add((1000 * data[1][i / 2]).toNumber());
            zs.add((1000 * data[2][i / 2]).toNumber());
            ts.add(i * 40);
        }
        Reps.onSamples(xs, ys, zs, ts, start * 40, 0);
        for (var j = 0; j < 20 && Reps.job != null; j++) { Reps.advanceAnalysis(); }
    }
    for (var i = 0; i < 500 && Reps.job != null; i++) { Reps.advanceAnalysis(); }
    var shown = Reps.offer();
    var n = data[0].size();
    Workout.logDisplayedSet(shown);
    var setId = Workout.sets[0]["id"];
    var rec = Store.get("lb_" + setId);
    var body = rec == null ? null : rec["body"];
    var ax = body == null ? null : T.unb64(body["ax"]);
    var ok = T.ck(logger, "set recorded with its motion window", body != null && body["enc"].equals("i16b64")
        && ax.size() == 2 * n && T.unb64(body["az"]).size() == ax.size()
        && Tape.get16(ax, 0) == (1000 * data[0][0]).toNumber() && Tape.get16(ax, n - 1) == (1000 * data[0][n - 1]).toNumber()
        && body["diag"]["tape_samples"] == n && body["hr"].size() > 0 && body["step_marks"].size() > 0
        && body["logged_reps"] == 8 && body["auto_reps"] == 8
        && body["auto_shown"] == true && body["session_id"].equals(sid) && body["started_at"] != null);
    var kinds = {};
    for (var i = 0; i < body["events"].size(); i++) { kinds[body["events"][i][1]] = true; }
    ok = T.ck(logger, "timeline has first batch, analysis and the shown count",
        kinds[1] == true && kinds[3] == true && kinds[2] == true && body["diag"]["analyses"] > 0) && ok;
    Workout.undoSet();
    ok = T.ck(logger, "undo removes the old motion record", Store.get("lb_" + setId) == null && Lab.queue().size() == 0) && ok;
    Workout.beginSet();
    Workout.logDisplayedSet(9);
    setId = Workout.sets[0]["id"];
    ok = T.ck(logger, "redo attaches a fresh recording to the automatically counted set",
        Store.get("lb_" + setId)["body"]["logged_reps"] == 9 && Lab.queue().size() == 1
        && Workout.sets[0]["ar"] == true && Store.get("lb_" + setId)["body"]["diag"]["tape_samples"] == 0) && ok;
    ok = T.ck(logger, "held while its workout is open", Lab.next() == null) && ok;
    Workout.cur["sumAt"] = Workout.now();
    Workout.finish(true);
    // The saved workout's health summary goes first, waiting for nothing.
    var h = Lab.next();
    var hb = h == null ? null : Store.get(h)["body"];
    ok = T.ck(logger, "workout health summary queued", h != null && h.substring(0, 3).equals("lh_")
        && hb["kind"].equals("session") && hb["data"]["sets"] == 1 && hb["data"]["lab_sets"] == 2
        && hb["data"]["mem_peak"] > 0) && ok;
    Lab.drop(h);
    ok = T.ck(logger, "held while its workout waits to upload", Store.queue().indexOf(sid) >= 0 && Lab.next() == null) && ok;
    Store.dequeue(sid);
    ok = T.ck(logger, "sent once the workout has synced", Lab.next() != null && Lab.next().equals("lb_" + setId)) && ok;
    var net = new Net();
    net.labKey = "lb_" + setId;
    net.onLab(201, { "id" => setId, "stored" => true });
    ok = T.ck(logger, "dropped after the server has it", Lab.queue().size() == 0 && Store.get("lb_" + setId) == null) && ok;
    Store.dropSession(sid);
    Store.put("labq", savedQ == null ? [] : savedQ);
    return ok;
}

(:test)
function testExplicitSetWindow(logger) {
    T.startPress(60);
    var input = new TestSetDelegate();
    input.onSelect();
    var ok = T.ck(logger, "weight confirmation only focuses reps", !Workout.setRunning() && Workout.cur["f"] == 1);
    input.onSelect();
    ok = T.ck(logger, "start opens a persisted window without logging", Workout.setRunning()
        && Store.get("cur")["setAt"] != null && Workout.sets.size() == 0 && !Workout.inRest()) && ok;
    Reps.count = 9;
    Workout.logDisplayedSet(8);
    ok = T.ck(logger, "finish saves the display and stops sampling at rest", Workout.sets[0]["r"] == 8
        && !Workout.setRunning() && !Reps.listening && Workout.inRest()) && ok;
    Workout.endRest();
    Workout.beginSet();
    Workout.load(); Workout.resume();
    ok = T.ck(logger, "recovered open set uses manual reps", Workout.setRunning() && Reps.manual) && ok;
    T.completeSet();
    ok = T.ck(logger, "last finish opens summary", Workout.atSummary() && Workout.sets.size() == 2) && ok;
    Workout.finish(false);
    return ok;
}

(:test)
class TestSetDelegate extends SetDelegate {
    var view;
    function initialize() { SetDelegate.initialize(); view = new SetView(); }
    function current() { return view; }
}

(:test)
function testDisplayedRepCorrections(logger) {
    T.startPress(0);
    Workout.beginSet();
    var input = new TestSetDelegate();
    input.view.displayedOffer = 8;
    Reps.count = 10;
    input.bump(1);
    // The listener stays on for the rep lab; counting stops.
    var ok = T.ck(logger, "corrects visible eight to nine", Workout.cur["r"] == 9 && Reps.manual && Reps.job == null && Reps.offer() == null);
    input.bump(1);
    ok = T.ck(logger, "second press before redraw increments again", Workout.cur["r"] == 10) && ok;
    Workout.logDisplayedSet(8);
    ok = T.ck(logger, "finish before redraw saves latest manual edit", Workout.sets[0]["r"] == 10) && ok;
    Workout.logDisplayedSet(8);
    ok = T.ck(logger, "duplicate finish cannot log the next zero-rest set", Workout.sets.size() == 1) && ok;
    Workout.beginSet();
    input.view.displayedOffer = null;
    Reps.count = 6;
    input.bump(-1);
    ok = T.ck(logger, "unseen estimate cannot replace the visible fallback", Workout.cur["r"] == 9) && ok;
    Workout.finish(false);
    return ok;
}

(:test)
function testRestRecoveryAndStrayInput(logger) {
    T.startPress(60);
    T.completeSet();
    var input = new SetDelegate();
    input.onSelect();
    Workout.cur["r0"] = Workout.now() - 3600;
    Workout.cur["re"] = Workout.cur["r0"] + 60;
    Workout.saveCur();
    Workout.load(); Workout.resume();
    var ok = T.ck(logger, "expired rest restores next setup and records only the scheduled minute",
        !Workout.inRest() && !Workout.setRunning() && Workout.cur["rs"] == 60 && Workout.sets.size() == 1);
    Workout.endRest(); Workout.adjustRest(15);
    ok = T.ck(logger, "stray rest actions leave the next setup intact", Workout.cur["rs"] == 60 && !Workout.inRest()) && ok;
    T.completeSet();
    input.onSelect();
    Workout.finish(false);
    input.onSelect();
    return T.ck(logger, "stale set inputs after finish do not restart a workout", !Workout.active()) && ok;
}

(:test)
function testRepSettingsDuringSet(logger) {
    var previous = Reps.enabled();
    T.startPress(0);
    Workout.beginSet();
    Reps.count = 6;
    Reps.setEnabled(false); Reps.setEnabled(true);
    Reps.start();
    var ok = T.ck(logger, "partial set stays manual after off then on", Reps.manual && !Reps.listening && Reps.offer() == null);
    T.completeSet(); Workout.beginSet();
    ok = T.ck(logger, "next full set is eligible for counting", !Reps.manual && !Reps.interrupted && Reps.enabled()) && ok;
    Workout.finish(false); Reps.setEnabled(previous);
    return ok;
}

(:test)
function testSensorDeliveryFailures(logger) {
    var a = [];
    for (var i = 0; i < Reps.RATE; i++) { a.add(100); }
    Reps.reset(); Reps.listening = true; Reps.sawMotion = true; Reps.count = 8;
    Reps.lastBatch = 1000;
    Reps.onSamples(a, a, a, null, 3000, 0);
    var ok = T.ck(logger, "missed delivery stops counting without reliable timestamps",
        Reps.interrupted && Reps.count == null && Reps.listening);
    // The set keeps recording for the rep lab after the counter gives up.
    var taped = Tape.total();
    Reps.onSamples(a, a, a, null, 4000, 0);
    ok = T.ck(logger, "later batches reach the tape, not the counter",
        Tape.total() > taped && Reps.batches == 0 && Reps.lastBatch == 4000 && Reps.offer() == null) && ok;
    Reps.reset(); Reps.sawMotion = true;
    var short = a.slice(0, 20);
    Reps.onSamples(short, short, short, null, 5000, 0);
    ok = T.ck(logger, "a short batch with no reliable timestamps interrupts counting", Reps.interrupted) && ok;
    Reps.listening = false;
    Reps.reset(); Reps.listening = true; Reps.lastBatch = 1000; Reps.sawMotion = true; Reps.count = 7;
    Reps.checkDelivery(6000);
    ok = T.ck(logger, "late callbacks have a grace period", Reps.offer() == 7) && ok;
    Reps.checkDelivery(9000);
    ok = T.ck(logger, "silent stream retires stale count without another callback", Reps.offer() == null && Reps.interrupted && !Reps.listening) && ok;
    Reps.reset(); Reps.listening = true;
    Reps.listenerAt = System.getTimer() - 7000;
    Reps.onData(new FakeSensorData(null, null, new FakeBeats([640])));
    Reps.checkDelivery(System.getTimer());
    ok = T.ck(logger, "extra-sensor callbacks cannot mask accelerometer silence", Reps.interrupted && !Reps.listening) && ok;
    Reps.reset();
    return ok;
}

(:test)
function testIrregularSensorTimestampsAndFinalCount(logger) {
    var data = RepFx.curl(8, false);
    Reps.reset();
    Reps.configure(null);
    Reps.listening = true;
    var n = Reps.RATE;
    var end = (2 * data[0].size() / n) * n;
    for (var start = 0; start < end; start += n) {
        var xs = []; var ys = []; var zs = []; var ts = [];
        for (var i = 0; i < n; i++) {
            var pos = (start + i) / 2;
            xs.add(Reps.rnd(1000 * data[0][pos]));
            ys.add(Reps.rnd(1000 * data[1][pos]));
            zs.add(Reps.rnd(1000 * data[2][pos]));
            // Garmin delivered complete batches with repeated timestamps
            // and jumps up to 304 ms. Preserve every sample in those batches.
            var offset = i * 40;
            if (start % 50 == 0) {
                if (i <= 6) { offset = 0; }
                else if (i < 12) { offset = 24 * (i - 6); }
                else { offset = 424 + 40 * (i - 12); }
            }
            ts.add(start * 40 + offset);
        }
        Reps.onSamples(xs, ys, zs, ts, start * 40, 0);
    }
    var ok = T.ck(logger, "irregular timestamps preserve all samples when delivery continues",
        Reps.batches == end / n && Reps.bx.size() == end / 2 && !Reps.interrupted
        && Reps.repeatedTimestamps > 0 && Reps.fallbackBatches > 0);
    Reps.count = 3; Reps.countSettled = false;
    ok = T.ck(logger, "START replaces a partial preview with a final pass",
        Reps.checkFinalCount() && Reps.offer() == null && !Reps.finalCountReady(System.getTimer())) && ok;
    for (var i = 0; i < 100 && Reps.job != null; i++) { Reps.advanceAnalysis(); }
    ok = T.ck(logger, "final pass offers all eight reps",
        Reps.finalCountReady(System.getTimer()) && Reps.offer() == 8) && ok;
    Reps.stop();
    Reps.reset();
    return ok;
}

(:test)
function testPartialRepCountWithCompetingMotion(logger) {
    var candidate = [4, 0.94, 0.04, 19.8, true];
    var longer = [7, 0.88, 0.09, 40.0, false];
    var result = Reps.selectBout([longer, candidate]);
    var ok = T.ck(logger, "a short count is withheld after strongly periodic motion at double its period", !result[1]);
    longer[1] = 0.60;
    result = Reps.selectBout([longer, candidate]);
    return T.ck(logger, "weak competing motion does not erase a count", result[1] && result[0] == 4) && ok;
}

(:test)
function testMalformedPlanKeepsCache(logger) {
    var data = { "date" => Logic.localDate(), "unit" => "lbs", "workout" => {
        "id" => "audit", "name" => "Push", "exercises" => [
            { "id" => "p", "name" => "Press", "sets" => 2, "weight" => 42.5 }
        ] }, "body" => { "charge" => {} }, "days" => [null, { "id" => "audit", "name" => "Push" }] };
    var ok = T.ck(logger, "valid workout survives malformed optional fields", Store.cacheToday(data)
        && Store.charge() == null && Store.days().size() == 1);
    data["workout"]["exercises"][0]["weight"] = "heavy";
    ok = T.ck(logger, "bad numeric field preserves cached plan", !Store.cacheDay(data)
        && Store.planFor("audit")["ex"][0]["weight"] == 42.5) && ok;
    data["workout"]["exercises"] = [null];
    ok = T.ck(logger, "invalid exercise cannot overwrite the default", !Store.cacheToday(data)
        && Store.today()["ex"][0]["id"].equals("p")) && ok;
    data["workout"]["exercises"] = [
        { "id" => "z", "name" => "Dropped", "sets" => 0 },
        { "id" => "q", "name" => "Row", "sets" => 3, "reps" => 10, "weight" => 95, "rest" => 90 }
    ];
    ok = T.ck(logger, "zero-set exercise is left out, not the whole day", Store.cacheDay(data)
        && Store.get("wk_audit")["ex"].size() == 1 && Store.get("wk_audit")["ex"][0]["id"].equals("q")) && ok;
    Store.del("wk"); Store.del("wk_audit"); Store.del("wkAt");
    return ok;
}

(:test)
function testMissingUploadAcknowledgment(logger) {
    var net = new Net();
    var rows = [T.sampleSet("pending", 1, 8, 95, 0)];
    var savedSync = Store.get("ls");
    var ok = true;
    for (var i = 1; i <= 3; i++) {
        net.upSid = "edge"; net.upSets = rows;
        net.onUpload(200, { "sets" => { "accepted" => ["unrelated"] } });
        ok = T.ck(logger, "backoff after empty acknowledgment " + i, net.fails == i
            && net.nextAt - net.now() >= Logic.backoffSecs(i) - 1 && rows[0]["y"] == 0) && ok;
    }
    return T.ck(logger, "empty acknowledgments did not advance last sync", Store.get("ls") == savedSync) && ok;
}

(:test)
class TestWorkoutNet extends Net {
    var online = false;
    var path = null;

    function initialize() { Net.initialize(); }
    function connected() { return online; }
    function request(nextPath, params, post, cb) {
        path = nextPath;
        busy = true;
    }
}

(:test)
function testSavedWorkoutSyncTakesPriority(logger) {
    var previous = $.gNet;
    var queue = Store.get("q");
    var sync = Store.get("ls");
    var receipts = Store.list("receipts");
    var sensors = Store.sensors();
    Store.put("q", []);
    Store.put("qh", []);
    var net = new TestWorkoutNet();
    $.gNet = net;
    T.startPress(0);
    T.completeSet();
    Workout.toSummary();
    var sid = Workout.cur["sid"];
    var id = Workout.sets[0]["id"];
    net.nextAt = net.now() + 600;
    Workout.finish(true);
    var ok = T.ck(logger, "save queues offline and clears earlier backoff",
        Store.queue().indexOf(sid) >= 0 && net.nextAt == 0 && net.path == null
        && net.workoutStatus(sid).equals("Open GRIND with phone"));
    net.online = true;
    net.busy = true;
    net.labKey = "lh-test";
    ok = T.ck(logger, "queued workout waits for the in-flight request", !net.tickUploads()) && ok;
    net.onLab(-1, null);
    ok = T.ck(logger, "upload starts as soon as diagnostics release the connection",
        net.path != null && net.path.equals("/sessions") && net.upSid.equals(sid)
        && net.workoutStatus(sid).equals("Syncing to GRIND…")) && ok;
    net.onUpload(201, { "sets" => { "accepted" => [id] }, "sensor" => { "status" => "pending" } });
    ok = T.ck(logger, "core acknowledged while sensor data is retained separately",
        net.workoutStatus(sid).equals("Sets synced · HR pending") && net.path.equals("/ping")
        && Store.meta(sid) == null && Store.sensorPending(sid)) && ok;
    net.busy = false;
    ok = T.ck(logger, "sensor retry does not send a pending core workout", net.tickUploads() && net.sensorKey.equals(id)) && ok;
    net.onSensor(200, { "sensor" => { "status" => "stored" } });
    ok = T.ck(logger, "sensor receipt settles without another core upload",
        net.workoutStatus(sid).equals("Synced to GRIND") && !Store.sensorPending(sid)) && ok;
    net.online = false;
    T.startPress(0);
    T.completeSet(); Workout.toSummary();
    var second = Workout.cur["sid"];
    Workout.finish(true);
    net.online = true;
    net.busy = false;
    ok = T.ck(logger, "reconnect poll picks up another offline save", net.tickUploads() && net.upSid.equals(second)) && ok;
    Store.dropSession(second);
    if (queue == null) { Store.del("q"); } else { Store.put("q", queue); }
    if (sync == null) { Store.del("ls"); } else { Store.put("ls", sync); }
    Store.put("receipts", receipts);
    Store.put("qh", sensors);
    $.gNet = previous;
    Workout.saved = false;
    return ok;
}

(:test)
function testRecoveryEndsAtNextSet(logger) {
    T.startPress(0);
    Workout.beginSet(); Hr.now = 150; Workout.logDisplayedSet(null);
    Workout.beginSet();
    var ok = T.ck(logger, "new effort ends previous recovery at its observed peak", Hr.pend == null
        && Workout.sets[0]["hp"] == 150 && Workout.sets[0]["hd"] == null);
    Workout.logDisplayedSet(null);
    Hr.now = 190; Hr.advance(Hr.pend["t"] + 90);
    ok = T.ck(logger, "late HR cannot become a 20-second peak or 60-second drop",
        Workout.sets[1]["hp"] == 150 && Workout.sets[1]["hd"] == null) && ok;
    Workout.finish(false);
    return ok;
}

(:test)
function testInterruptedUndoAndRedo(logger) {
    T.startPress(60);
    T.completeSet();
    var sid = Workout.cur["sid"];
    var row = Workout.sets[0];
    row["t"] -= 35;
    row["hp"] = 140;
    Store.putSet(sid, 0, row);
    Workout.undoSet();
    // Restore the durable midpoint between recording intent and removing the row.
    Store.putSet(sid, 0, row);
    Lab.push("lb_" + row["id"], { "sid" => sid, "body" => { "id" => row["id"] } });
    Workout.cur["removeAt"] = 0; Workout.cur["undoId"] = row["id"]; Workout.saveCur();
    Workout.load(); Workout.resume();
    var ok = T.ck(logger, "interrupted undo removes the old row and recording and re-arms START",
        Workout.sets.size() == 0 && Store.sets(sid).size() == 0 && !Workout.setRunning()
        && Store.get("lb_" + row["id"]) == null && Workout.cur["sn"] == row["n"]);
    // A legacy build may also have left an undone row in manual-edit mode.
    Workout.cur["setAt"] = row["t"]; Workout.cur["editRow"] = row; Workout.saveCur();
    Workout.load(); Workout.resume();
    ok = T.ck(logger, "legacy undo loads ready for a fresh START",
        !Workout.setRunning() && !Reps.manual && Workout.cur["editRow"] == null) && ok;
    Workout.beginSet();
    Hr.now = 120;
    Workout.logDisplayedSet(11);
    var updated = Store.sets(sid)[0];
    ok = T.ck(logger, "redo tracks a new set and starts a full rest",
        !updated["id"].equals(row["id"]) && updated["t"] > row["t"] && updated["hp"] == null
        && updated["he"] == 120 && updated["r"] == 11 && updated["ar"] == true && Workout.restLeft() >= 59) && ok;
    Workout.finish(false);
    return ok;
}

(:test)
function testInterruptedDiscard(logger) {
    T.startPress(0); T.completeSet(); T.completeSet();
    var sid = Workout.cur["sid"];
    Workout.meta["discard"] = true; Store.putMeta(Workout.meta);
    Store.del("t_" + sid + "_1");
    Workout.load();
    return T.ck(logger, "discard resumes cleanup and cannot enqueue a partial workout", !Workout.active()
        && Store.meta(sid) == null && Store.sets(sid).size() == 0 && Store.queue().indexOf(sid) < 0);
}

(:test)
function testLiveRepAnalysis(logger) {
    var data = RepFx.curl(8, false);
    Reps.reset();
    Reps.listening = true;
    Reps.bx = data[0]; Reps.by = data[1]; Reps.bz = data[2]; Reps.bs = data[3];
    Reps.dirty = true;
    Reps.update();
    var ok = T.ck(logger, "analysis scheduled outside sensor event", Reps.job != null && Reps.count == null);
    for (var i = 0; Reps.job != null && i < 500; i++) { Reps.advanceAnalysis(); }
    ok = T.ck(logger, "result delivered", Reps.count == 8 && Reps.worker == null) && ok;
    Reps.dirty = true;
    Reps.update();
    Reps.reset();
    Reps.advanceAnalysis();
    Reps.listening = false;
    return T.ck(logger, "new set cancels previous analysis", Reps.count == null && Reps.worker == null) && ok;
}

// Regression: the watch allows 3 running timers and the app clock holds one.
// A workout screen shown twice without onHide (menu pop + view switch) used
// to leak its 1 s timer, and the rep analyser's timer then crashed the app
// with Too Many Timers a few seconds into every set.
(:test)
function testWorkoutScreensDoNotExhaustTimers(logger) {
    var a = new SetView();
    a.onShow();
    a.onShow();
    var b = new RestView();
    b.onShow();
    var was = Reps.listening;
    Reps.listening = true;
    Reps.reset();
    for (var i = 0; i < 120; i++) { Reps.bx.add(0.0); Reps.by.add(0.0); Reps.bz.add(0.0); Reps.bs.add(0); }
    Reps.dirty = true;
    Reps.update();
    var ok = T.ck(logger, "analysis scheduled", Reps.job != null);
    Reps.reset();
    Reps.listening = was;
    b.onHide();
    a.onHide();
    return ok;
}

// The tape's ring keeps the newest 75 s in order, and its int16 encoding
// survives the full milli-g range and the clamps either side.
(:test)
function testTapeRingAndEncoding(logger) {
    Tape.reset();
    var b = T.batch(0, 2);
    // Values written straight through, then a wrap by 10 samples.
    for (var i = 0; i < Tape.N + 10; i++) {
        b = T.batch(i - 500, 2);
        Tape.feed(b[0], b[1], b[2], i);
    }
    var e = Tape.encode();
    var ax = T.unb64(e["ax"]);
    var ay = T.unb64(e["ay"]);
    var ok = T.ck(logger, "ring keeps the newest window in order", ax.size() == 2 * Tape.N
        && Tape.get16(ax, 0) == 10 - 500 && Tape.get16(ax, Tape.N - 1) == Tape.N + 9 - 500
        && Tape.get16(ay, 0) == 500 - 10 && e["clipped"] == true && Tape.total() == Tape.N + 10);
    ok = T.ck(logger, "no compass or beats means none sent", e["mx"] == null && e["beats"] == null) && ok;
    var ba = new [6]b;
    Tape.put16(ba, 0, 40000); Tape.put16(ba, 1, -40000); Tape.put16(ba, 2, -1);
    ok = T.ck(logger, "int16 clamps and sign", Tape.get16(ba, 0) == 32767 && Tape.get16(ba, 1) == -32768 && Tape.get16(ba, 2) == -1) && ok;
    // An odd batch carries its last sample into the next one.
    Tape.reset();
    b = T.batch(100, 3); Tape.feed(b[0], b[1], b[2], 0);
    b = T.batch(300, 1); Tape.feed(b[0], b[1], b[2], 0);
    ax = T.unb64(Tape.encode()["ax"]);
    ok = T.ck(logger, "pairs straddle batches", ax.size() == 4 && Tape.get16(ax, 1) == 200) && ok;
    Tape.reset();
    return ok;
}

// Taking over by hand stops the counting, not the recording: the sets you
// had to fix are the ones the counter needs to learn from.
(:test)
function testTapeRecordsAfterTakeOver(logger) {
    T.startPress(0);
    Workout.setFocus(1);
    Workout.beginSet();
    Reps.listening = true;
    var b = T.batch(50, Reps.RATE);
    var ts = [];
    for (var i = 0; i < Reps.RATE; i++) { ts.add(i * 40); }
    Reps.onSamples(b[0], b[1], b[2], ts, 0, 0);
    Workout.adjust(1, null);
    var tsb = [];
    for (var i = 0; i < Reps.RATE; i++) { tsb.add(1000 + i * 40); }
    Reps.onSamples(b[0], b[1], b[2], tsb, 1000, 3);
    var ok = T.ck(logger, "manual set keeps recording", Reps.manual && Reps.job == null && Reps.offer() == null
        && Tape.total() == Reps.RATE && Reps.batches == 2);
    Workout.finish(false);
    return ok;
}

// A run that never stopped cleanly is reported on the next start, with what
// it was doing; a clean stop leaves nothing to report.
(:test)
function testHealthReportsUncleanExit(logger) {
    var savedQ = Store.get("labq");
    var savedAlive = Store.get("alive");
    Store.put("labq", []);
    Lab.setEnabled(true);
    Store.put("alive", { "at" => 1794848400, "phase" => "set", "mem" => 123456, "battery" => 54.0 });
    Health.boot();
    var key = Lab.next();
    var body = key == null ? null : Store.get(key)["body"];
    var ok = T.ck(logger, "unclean exit queued for upload", body != null && body["kind"].equals("unclean_exit")
        && body["data"]["phase"].equals("set") && body["data"]["mem"] == 123456 && body["at"] != null);
    ok = T.ck(logger, "this run is marked alive", Store.get("alive") instanceof Lang.Dictionary) && ok;
    if (key != null) { Lab.drop(key); }
    Health.stop();
    Health.boot();
    ok = T.ck(logger, "clean stop reports nothing", Lab.queue().size() == 0) && ok;
    Health.stop();
    if (savedAlive != null) { Store.put("alive", savedAlive); }
    Store.put("labq", savedQ == null ? [] : savedQ);
    return ok;
}

// The extra sensors switch themselves off after two sets whose stream broke
// while they were on, and come back when Rep lab is switched on again.
(:test)
function testRichSensorsBackOff(logger) {
    Store.del("rb");
    Reps.reset();
    Reps.rich = true; Reps.richCounted = false; Reps.listening = true; Reps.sawMotion = true;
    Reps.inputGap("sample gap", 300);
    Reps.reset();
    Reps.rich = true; Reps.richCounted = false; Reps.listening = true; Reps.sawMotion = true;
    Reps.inputGap("sample gap", 300);
    Reps.inputGap("sample gap", 300);
    var ok = T.ck(logger, "two broken sets counted once each", Reps.richBad() == 2);
    Lab.setEnabled(true);
    ok = T.ck(logger, "switching Rep lab on resets it", Reps.richBad() == 0) && ok;
    Store.put("rb", 2);
    ok = T.ck(logger, "strikes stored by older builds do not count", Reps.richBad() == 0) && ok;
    Store.put("rb", ["2026-11-18b", 2]);
    ok = T.ck(logger, "strikes from another build do not count", Reps.richBad() == 0) && ok;
    Store.del("rb");
    Reps.rich = false; Reps.listening = false; Reps.reset();
    return ok;
}

(:test)
class FakeAxes {
    var x; var y; var z; var timestamp;
    function initialize(a, b, c, t) { x = a; y = b; z = c; timestamp = t; }
}

(:test)
class FakeBeats {
    var heartBeatIntervals;
    function initialize(b) { heartBeatIntervals = b; }
}

(:test)
class FakeSensorData {
    var accelerometerData; var magnetometerData; var heartRateData;
    function initialize(a, m, h) { accelerometerData = a; magnetometerData = m; heartRateData = h; }
}

// The worst set the watch can meet: two minutes of curls through the real
// listener callback with the compass and beat intervals on, so the window
// wraps, then a capture. Memory, the longest step and the capture's cost must
// stay far from the limits, and the record must fit one storage value.
(:test)
function testWorstCaseSetStaysInBudget(logger) {
    var savedQ = Store.get("labq");
    Store.put("labq", []);
    Lab.setEnabled(true);
    T.startPress(0);
    Workout.setFocus(1);
    Workout.beginSet();
    Reps.listening = true; Reps.rich = true;
    var data = RepFx.curl(12, false);
    var n = data[0].size();
    var total = 0;
    var memMax = 0;
    var batchMs = 0;
    for (var b = 0; b < 120; b++) {
        var xs = []; var ys = []; var zs = []; var ts = [];
        for (var i = 0; i < Reps.RATE; i++) {
            var k = ((b * Reps.RATE + i) / 2) % n;
            xs.add((1000 * data[0][k]).toNumber()); ys.add((1000 * data[1][k]).toNumber()); zs.add((1000 * data[2][k]).toNumber());
            ts.add((b * Reps.RATE + i) * 40);
        }
        var t0 = System.getTimer();
        Reps.onData(new FakeSensorData(new FakeAxes(xs, ys, zs, ts), new FakeAxes(ys, zs, xs, null), new FakeBeats([620, 640])));
        var spent = System.getTimer() - t0;
        if (spent > batchMs) { batchMs = spent; }
        for (var j = 0; j < 20 && Reps.job != null; j++) { Reps.advanceAnalysis(); }
        var used = System.getSystemStats().usedMemory;
        if (used > memMax) { memMax = used; }
        total += Reps.RATE;
    }
    for (var i = 0; i < 500 && Reps.job != null; i++) { Reps.advanceAnalysis(); }
    var c0 = System.getTimer();
    Workout.logDisplayedSet(Reps.offer());
    var captureMs = System.getTimer() - c0;
    var rec = Store.get("lb_" + Workout.sets[0]["id"]);
    var body = rec == null ? null : rec["body"];
    var totalMem = System.getSystemStats().totalMemory;
    System.println("worst case: peak " + memMax + "/" + totalMem + " B, batch " + batchMs + " ms, longest step "
        + Reps.longestStep + " ms, capture " + captureMs + " ms, tape " + (body == null ? "-" : body["diag"]["tape_samples"])
        + " compass " + (body == null ? "-" : body["diag"]["mag_samples"]));
    var ok = T.ck(logger, "record stored with every signal", body != null && body["mx"] != null && body["beats"].size() == Tape.MAX_BEATS
        && body["diag"]["tape_samples"] == Tape.N && body["clipped"] == true && T.unb64(body["mz"]).size() == 2 * Tape.N);
    // Test builds get far more memory than the app's 768 KB on the watch:
    // judge against the watch's limit.
    ok = T.ck(logger, "memory stays well under the watch's limit", memMax < 786432 * 6 / 10) && ok;
    ok = T.ck(logger, "sensor callback stays short", batchMs < 250) && ok;
    ok = T.ck(logger, "capture stays short", captureMs < 1000) && ok;
    Workout.finish(false);
    Store.put("labq", savedQ == null ? [] : savedQ);
    Reps.rich = false; Reps.listening = false;
    return ok;
}

// The watch's HRV maths must give exactly what src/lib/body/hrv.ts gives on
// the same intervals (expected values printed by analyzeRr on this fixture:
// a missed beat, a doubled one, an out-of-range pair and a spike).
(:test)
function testReadinessMathMatchesServer(logger) {
    var rr = [930,976,998,992,1015,994,994,989,973,965,480,924,891,881,881,898,895,897,950,946,956,987,1020,1015,999,1900,2600,966,939,936,919,915,886,879,901,909,904,947,974,988,1450,1020,1014,1020,992,984,958,949,927,902,914,888,878,889,917,250,936,959,980,986,1006,1011,1011,1004,1004,968,943,928,922,894];
    var a = Readiness.analyze(rr, 2);
    var ok = T.ck(logger, "full minute: rmssd 20.4, HR 63.1, 65 clean, 60 pairs, 7.1% artifacts, good",
        (a["rmssd"] - 20.4).abs() < 0.05 && (a["meanHr"] - 63.1).abs() < 0.05 && a["cleanBeats"] == 65
        && a["pairs"] == 60 && (a["artifactPct"] - 7.1).abs() < 0.05 && a["quality"].equals("good"));
    var b = Readiness.analyze(rr.slice(0, 25), 0);
    ok = T.ck(logger, "short: rmssd 22.1, poor for too few beats", (b["rmssd"] - 22.1).abs() < 0.05
        && b["quality"].equals("poor") && b["reason"].equals("too few beats")) && ok;
    var c = Readiness.analyze(rr, 12);
    ok = T.ck(logger, "moving 12 s is poor", c["quality"].equals("poor") && c["reason"].equals("moving")) && ok;
    var d = Readiness.analyze([], 0);
    ok = T.ck(logger, "nothing is poor, not a crash", d["rmssd"] == null && d["quality"].equals("poor")) && ok;
    return ok;
}

// A whole check through the listener callback: settle, a minute of beats,
// then a queued upload with the raw intervals; and the two ways it fails.
(:test)
function testReadinessCheckFlow(logger) {
    var savedQ = Store.get("labq");
    Store.put("labq", []);
    Readiness.begin();
    var ok = T.ck(logger, "starts settling", Readiness.state == :settle);
    var still = new FakeAxes([0, 1, 0, 1], [-1000, -1000, -1001, -1000], [0, 0, 1, 0], null);
    Readiness.startedAt -= 11000;
    Readiness.onData(new FakeSensorData(still, null, new FakeBeats([900])));
    ok = T.ck(logger, "then measures, the settle beats dropped", Readiness.state == :measure && Readiness.rr.size() == 0) && ok;
    for (var i = 0; i < 60; i++) {
        Readiness.onData(new FakeSensorData(still, null, new FakeBeats([900 + (i % 7) * 12, 910 - (i % 5) * 9])));
    }
    Readiness.measureAt -= 61000;
    Readiness.onData(new FakeSensorData(still, null, new FakeBeats([905])));
    var key = Lab.next();
    var body = key == null ? null : Store.get(key)["body"];
    ok = T.ck(logger, "done with a good reading", Readiness.state == :done && Readiness.result["quality"].equals("good")
        && !Readiness.listening) && ok;
    ok = T.ck(logger, "queued for /readiness with raw intervals", key != null && key.substring(0, 3).equals("lr_")
        && body["rr_ms"].size() == 121 && body["duration_s"] == 60 && body["moving_s"] == 0
        && body["watch_rmssd"] == Readiness.result["rmssd"] && body["local_date"] != null) && ok;
    if (key != null) { Lab.drop(key); }
    // A watch that never sends intervals fails after 15 s with a reason.
    Readiness.begin();
    Readiness.startedAt -= 11000;
    Readiness.onData(new FakeSensorData(still, null, null));
    Readiness.measureAt -= 16000;
    Readiness.onData(new FakeSensorData(still, null, null));
    ok = T.ck(logger, "no intervals is a clear failure", Readiness.state == :fail && Readiness.reason != null && !Readiness.listening) && ok;
    // Moving the whole time is a poor reading, still uploaded as evidence.
    Readiness.begin();
    Readiness.startedAt -= 11000;
    var shake = new FakeAxes([0, 400, -300, 500], [-1000, -600, -1400, -800], [0, 300, -200, 100], null);
    Readiness.onData(new FakeSensorData(shake, null, null));
    for (var i = 0; i < 60; i++) { Readiness.onData(new FakeSensorData(shake, null, new FakeBeats([900, 910]))); }
    Readiness.measureAt -= 61000;
    Readiness.onData(new FakeSensorData(shake, null, new FakeBeats([900])));
    ok = T.ck(logger, "moving is poor", Readiness.state == :done && Readiness.result["quality"].equals("poor")
        && Readiness.result["reason"].equals("moving")) && ok;
    Readiness.cancel();
    Store.put("labq", savedQ == null ? [] : savedQ);
    return ok;
}

// Tuned counter settings: only valid, in-range keys survive, the same as
// cleanParams() in tools/reps.mjs; a bad tune never costs the plan.
(:test)
function testRepTuningSettings(logger) {
    var v = Reps.validTune({ "ac" => 0.551, "cv" => 9, "swing" => "x", "lag" => 6.6, "evil" => 1 });
    var ok = T.ck(logger, "keeps valid keys, rounded", v != null && (v["ac"] - 0.55).abs() < 0.001 && v["lag"] == 7
        && v["cv"] == null && v["swing"] == null && v["evil"] == null);
    ok = T.ck(logger, "nothing valid is null", Reps.validTune({ "ac" => 2 }) == null && Reps.validTune("x") == null) && ok;
    Reps.configure({ "ac" => 0.55, "lag" => 7 });
    ok = T.ck(logger, "configure applies", (Reps.MIN_AC - 0.55).abs() < 0.001 && Reps.LAG_MIN == 7
        && (Reps.MAX_CV - 0.32).abs() < 0.001 && Reps.tuneTag.length() > 0) && ok;
    Reps.configure(null);
    ok = T.ck(logger, "and resets to defaults", (Reps.MIN_AC - 0.60).abs() < 0.001 && Reps.LAG_MIN == 8 && Reps.tuneTag.length() == 0) && ok;
    var plan = Store.trimPlan({ "date" => "2026-11-18", "unit" => "lbs", "workout" => { "id" => "push", "name" => "Push", "exercises" => [
        { "id" => "a", "name" => "Bench", "sets" => 3, "reps" => 8, "reps_max" => null, "weight" => 135, "rest" => 90, "tune" => { "lag" => 7 } },
        { "id" => "b", "name" => "Fly", "sets" => 3, "reps" => 12, "reps_max" => null, "weight" => 25, "rest" => 60, "tune" => "junk" }
    ] } });
    ok = T.ck(logger, "plan keeps a valid tune and drops a junk one", plan != null && plan["ex"].size() == 2
        && plan["ex"][0]["tune"]["lag"] == 7 && plan["ex"][1]["tune"] == null) && ok;
    return ok;
}

// The day snapshot carries the watch's own diagnostics in the shape POST
// /daily accepts: a UTC timestamp, a probe entry for every sensor value, and
// no nulls (the server is strict).
(:test)
function testDailyDiagnostics(logger) {
    var d = Body.snapshot("app");
    var g = d["diag"];
    var ok = T.ck(logger, "diag present", g instanceof Lang.Dictionary && g["taken_at"].length() == 20
        && g["taken_at"].substring(19, 20).equals("Z"));
    var p = g["probe"];
    ok = T.ck(logger, "probe covers history and live values", p != null && p.hasKey("hr_h") && p.hasKey("spo2_h")
        && p.hasKey("resp") && p.hasKey("vo2") && p.size() <= 24) && ok;
    var keys = p.keys();
    var shaped = true;
    for (var i = 0; i < keys.size(); i++) {
        var v = p[keys[i]];
        if (v instanceof Lang.Array) { shaped = shaped && v.size() == 2; }
        else { shaped = shaped && v instanceof Lang.Number && v >= -3 && v <= -1; }
    }
    ok = T.ck(logger, "each probe is [value, age] or a code", shaped) && ok;
    var nulls = false;
    var gk = g.keys();
    for (var i = 0; i < gk.size(); i++) { if (g[gk[i]] == null) { nulls = true; } }
    ok = T.ck(logger, "no nulls in diag", !nulls) && ok;
    ok = T.ck(logger, "daily diagnostics identify the installed build", Body.BUILD_ID.equals(g["app_version"])) && ok;
    var raw = d["hr_raw"];
    ok = T.ck(logger, "raw hr, when sent, is paired", raw == null || raw["t"].size() == raw["v"].size()) && ok;
    ok = T.ck(logger, "trace bytes", Logic.traceB64([90, 0, 120, 300, null]).equals("WgB4AAA=")) && ok;
    ok = T.ck(logger, "spo2 only when recent", Body.spo2Fresh(0) && Body.spo2Fresh(30)
        && !Body.spo2Fresh(31) && !Body.spo2Fresh(-1) && !Body.spo2Fresh(null)) && ok;
    ok = T.ck(logger, "spo2, when sent, is in range", d["spo2"] == null || (d["spo2"] >= 50 && d["spo2"] <= 100)) && ok;
    ok = T.ck(logger, "respiration, when sent, is in range", d["respiration"] == null || (d["respiration"] >= 4 && d["respiration"] <= 60)) && ok;
    var prevWk = Storage.getValue("wkhr");
    Storage.setValue("wkhr", [10, 2, 7, 1]);
    var wk = Body.diag(Time.now().value())["wk_hr"];
    ok = T.ck(logger, "diag carries the last workout's HR reads", wk instanceof Lang.Array && wk.size() == 4 && wk[1] == 2) && ok;
    if (prevWk == null) { Storage.deleteValue("wkhr"); } else { Storage.setValue("wkhr", prevWk); }
    return ok;
}

// --- audit regressions ------------------------------------------------------

class ReplySink {
    var code = null;
    var hits = 0;
    function hit(c, d) { code = c; hits += 1; }
}

(:test)
function testBatchesCountUnderManual(logger) {
    // Taking over by hand stops the counting, not the bookkeeping: the batch
    // is still delivered and counted, and a silent stream still retires.
    Reps.reset();
    Reps.listening = true;
    Reps.takeOver();
    var b = T.batch(100, Reps.RATE);
    Reps.onSamples(b[0], b[1], b[2], null, 5000, 0);
    var ok = T.ck(logger, "batch counted under manual", Reps.batches == 1 && Reps.lastBatch == 5000 && Reps.bx.size() == 0);
    Reps.checkDelivery(12500);
    ok = T.ck(logger, "silence still retires under manual", Reps.interrupted) && ok;
    Reps.reset();
    return ok;
}

(:test)
function testRejectedBatchKeepsStream(logger) {
    // A short accelerometer batch still tells us the listener is alive,
    // but an empty batch must not hide a lack of accelerometer samples.
    Reps.reset();
    Reps.listening = true;
    Reps.listenerAt = 0;
    Reps.onSamples([100], [100], [100], null, 5000, 0);
    Reps.checkDelivery(9000);
    var ok = T.ck(logger, "a short batch keeps the watchdog fed", !Reps.interrupted && Reps.listening);
    Reps.onSamples([], [], [], null, 9500, 0);
    Reps.checkDelivery(12000);
    ok = T.ck(logger, "empty batches cannot mask motion sensor silence", Reps.interrupted && !Reps.listening) && ok;
    Reps.reset();
    return ok;
}

(:test)
function testNetRepliesAreGenerational(logger) {
    var n = new Net();
    var sink = new ReplySink();
    n.busy = true; n.gen = 2;
    n.onReply(1, new Lang.Method(sink, :hit), 200, null);
    var ok = T.ck(logger, "late reply from an old request is ignored", n.busy && sink.hits == 0);
    n.onReply(2, new Lang.Method(sink, :hit), 500, null);
    ok = T.ck(logger, "current reply reaches its callback", sink.hits == 1 && sink.code == 500) && ok;
    // A reply that never comes is given up after the timeout, as a -1.
    n.busy = true; n.gen = 5; n.busyAt = Time.now().value() - (Config.REPLY_TIMEOUT_S + 5);
    n.pendingCb = new Lang.Method(sink, :hit);
    n.checkTimeout();
    ok = T.ck(logger, "timeout frees the queue as a failure", !n.busy && sink.code == -1 && sink.hits == 2 && n.gen == 6) && ok;
    n.busy = true; n.busyAt = Time.now().value();
    n.pendingCb = new Lang.Method(sink, :hit);
    n.checkTimeout();
    ok = T.ck(logger, "a fresh request is left alone", n.busy && sink.hits == 2) && ok;
    n.busy = false; n.pendingCb = null;
    return ok;
}

(:test)
function testFailedHeadRotates(logger) {
    var savedQ = Store.queue();
    var savedD = Store.dead();
    var a = "rot-a-" + Logic.uuid4();
    var b = "rot-b-" + Logic.uuid4();
    var ma = T.sampleMeta(); ma["id"] = a; Store.putMeta(ma);
    var mb = T.sampleMeta(); mb["id"] = b; Store.putMeta(mb);
    Store.put("q", [a, b]);
    Store.put("qd", []);
    var n = new Net();
    for (var i = 0; i < Config.UPLOAD_ROTATE_AFTER; i++) { n.failHead(a, false); }
    var q = Store.queue();
    var ok = T.ck(logger, "head goes to the back after repeated failures", q.size() == 2 && q[0].equals(b) && q[1].equals(a));
    for (var i = 0; i < Config.UPLOAD_BURY_AFTER - Config.UPLOAD_ROTATE_AFTER; i++) { n.failHead(a, false); }
    ok = T.ck(logger, "transport failures never bury", Store.dead().size() == 0 && Store.queue().indexOf(a) >= 0) && ok;
    n.failHead(a, true);
    ok = T.ck(logger, "server failures bury at the limit", Store.dead().indexOf(a) >= 0 && Store.queue().indexOf(a) < 0) && ok;
    Store.dropSession(a);
    Store.dropSession(b);
    Store.put("q", savedQ);
    Store.put("qd", savedD);
    return ok;
}

(:test)
function testRawRingKeepsNewest(logger) {
    // Heart-rate history comes oldest first: the cap must keep the newest.
    var raw = { "t" => [], "v" => [], "h" => 0 };
    for (var i = 0; i < 10; i++) { Body.rawAdd(raw, i, 60 + i, 4); }
    Body.rawOrder(raw);
    return T.ck(logger, "newest four, in time order", raw["t"].size() == 4 && raw["t"][0] == 6 && raw["t"][3] == 9
        && raw["v"][0] == 66 && raw["v"][3] == 69 && !raw.hasKey("h"));
}

(:test)
function testSummaryBeforeSummaryScreen(logger) {
    // Summary numbers before the summary screen (no end time yet) must not
    // dereference the missing end.
    T.startPress(0);
    var s = Workout.summary();
    var ok = T.ck(logger, "summary without an end time", s != null && s["dur"] >= 0 && s["sets"] == 0);
    Workout.finish(false);
    Workout.saved = false;
    return ok;
}

(:test)
function testDayPlansPruned(logger) {
    var d = Logic.localDate();
    var savedK = Store.get("wkk");
    for (var i = 0; i < Store.DAY_KEEP + 2; i++) {
        Store.cacheDay({ "date" => d, "unit" => "lbs", "workout" => { "id" => "p" + i, "name" => "P", "exercises" => [] } });
    }
    var ok = T.ck(logger, "oldest day plans removed", Store.get("wk_p0") == null && Store.get("wk_p1") == null);
    ok = T.ck(logger, "newest day plan kept", Store.planFor("p" + (Store.DAY_KEEP + 1)) != null) && ok;
    for (var i = 0; i < Store.DAY_KEEP + 2; i++) { Store.del("wk_p" + i); }
    Store.put("wkk", savedK == null ? [] : savedK);
    return ok;
}
