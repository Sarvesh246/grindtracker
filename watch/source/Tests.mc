using Toybox.Lang;
using Toybox.Test;

// Run: build with --unit-test, then `monkeydo bin/grind-test.prg fr165m -t`.
// (:test) code is stripped from normal builds.

// Helpers live in a module: a bare (:test) function is run as a test.
(:test)
module T {
    function ck(logger, name, cond) {
        if (!cond) { logger.error("FAILED: " + name); }
        return cond;
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
    var p = Logic.buildPayload(meta, sets, 25);
    var ok = T.ck(logger, "ids", p["id"].equals(meta["id"]) && p["workout_id"].equals("push"));
    ok = T.ck(logger, "started_at", p["started_at"].equals("2026-11-16T17:00:00Z")) && ok;
    ok = T.ck(logger, "open session has no ended_at", !p.hasKey("ended_at")) && ok;
    ok = T.ck(logger, "no hr when unknown", !p.hasKey("heart_rate") && !p.hasKey("calories")) && ok;
    ok = T.ck(logger, "offset", p["utc_offset_seconds"] == -18000) && ok;
    ok = T.ck(logger, "only unsynced", p["sets"].size() == 2 && p["sets"][0]["id"].equals("s2")) && ok;
    var s = p["sets"][1];
    ok = T.ck(logger, "set fields", s["exercise_id"].equals("ex-1") && s["set_number"] == 3 && s["reps"] == 7
        && s["weight"] == 140.0 && s["unit"].equals("lbs") && s["completed_at"].equals("2026-11-16T17:05:00Z")) && ok;
    ok = T.ck(logger, "rest only when known", s["rest_seconds"] == 120 && !p["sets"][0].hasKey("rest_seconds")) && ok;

    meta["en"] = 1794851550;
    meta["ha"] = 128; meta["hm"] = 300; meta["cal"] = 410; // max out of range: dropped
    p = Logic.buildPayload(meta, sets, 1);
    ok = T.ck(logger, "ended_at", p["ended_at"].equals("2026-11-16T17:52:30Z")) && ok;
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
    var ok = T.ck(logger, "prefilled from target", Workout.cur["w"] == 135.0 && Workout.cur["r"] == 8 && Workout.cur["f"] == 0);
    ok = T.ck(logger, "total", Workout.totalSets() == 4 && Workout.progress() == 0.0) && ok;
    Workout.adjust(1);
    ok = T.ck(logger, "weight step", Workout.cur["w"] == 135.0 + Config.WEIGHT_STEP) && ok;
    Workout.adjust(-1);
    Workout.setFocus(1);
    Workout.adjust(1);
    ok = T.ck(logger, "reps step", Workout.cur["r"] == 9) && ok;

    ok = T.ck(logger, "first set not last", !Workout.logSet()) && ok;
    ok = T.ck(logger, "resting", Workout.inRest() && Workout.restLeft() > 55 && Workout.restLeft() <= 60) && ok;
    ok = T.ck(logger, "next set, reps focused, values carried", Workout.cur["sn"] == 2 && Workout.cur["f"] == 1
        && Workout.cur["w"] == 135.0 && Workout.cur["r"] == 9) && ok;
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
        && Workout.cur["sn"] == 2 && Workout.sets[0]["r"] == 9 && Workout.sets[0]["n"] == 1) && ok;

    ok = T.ck(logger, "second set moves on", !Workout.logSet()) && ok;
    ok = T.ck(logger, "next exercise defaults", Workout.cur["ei"] == 1 && Workout.cur["sn"] == 1
        && Workout.cur["w"] == 0.0 && Workout.cur["r"] == 8 && Workout.cur["f"] == 0) && ok;
    ok = T.ck(logger, "rest from finished exercise", Workout.cur["rd"] == 60) && ok;
    ok = T.ck(logger, "set numbers", Workout.sets[1]["n"] == 2 && Workout.sets[1]["rs"] != null) && ok;
    Workout.endRest();

    Workout.skipExercise();
    ok = T.ck(logger, "skip last -> summary", Workout.atSummary() && Workout.totalSets() == 2 && Workout.progress() == 1.0) && ok;
    ok = T.ck(logger, "nothing left to go back to", !Workout.canLeaveSummary()) && ok;
    var s = Workout.summary();
    ok = T.ck(logger, "summary", s["sets"] == 2 && s["vol"] == 2430.0 && s["dur"] >= 0) && ok;

    Workout.finish(true);
    var m = Store.meta(sid);
    ok = T.ck(logger, "saved + queued", !Workout.active() && Workout.saved && Store.get("cur") == null
        && Store.queue().indexOf(sid) >= 0 && m["en"] != null && Store.sets(sid).size() == 2) && ok;
    var p = Logic.buildPayload(m, Store.sets(sid), Config.SYNC_BATCH);
    ok = T.ck(logger, "payload", p.hasKey("ended_at") && p["sets"].size() == 2 && p["sets"][1]["set_number"] == 2) && ok;
    Store.dequeue(sid);
    Store.dropSession(sid);

    // Discard wipes the session and never queues it.
    Workout.start(plan);
    sid = Workout.cur["sid"];
    Workout.setFocus(1);
    Workout.logSet();
    Workout.finish(false);
    ok = T.ck(logger, "discarded", !Workout.active() && Store.sets(sid).size() == 0 && Store.meta(sid) == null
        && Store.queue().indexOf(sid) < 0) && ok;
    Workout.saved = false;
    return ok;
}
