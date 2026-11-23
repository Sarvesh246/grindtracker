using Toybox.Lang;
using Toybox.UserProfile;

// GRIND Body, phase 1: the workout's heart rate. Driven by the app's 1 s
// tick while a workout is open. Keeps
//   - a trace, one reading per HR_STEP seconds from the session start,
//   - seconds in each of the user's zones,
//   - per set: the peak (60 s before lifting ends to 20 s after, since
//     wrist HR lags the effort), the end-of-lift reading, and how far
//     HR fell 60 s into the rest.
// Stored under h_<sid> every couple of minutes, so a crash loses little.
module Hr {
    var sid = null;
    var st = 0;
    var trace = null;
    var zs = null;
    var zones = null;
    var now = null;       // latest reading, or null
    var pend = null;      // { "i" set index, "t" lifting ended at, "pk" peak, "pkDone" }
    var lastPeak = null;  // peak of the most recent set, for smart rest
    var buzzed = false;   // smart rest already announced this rest
    var unsaved = 0;
    var sealed = 0;

    function begin(meta) {
        sid = meta["id"];
        st = meta["st"];
        pend = null;
        lastPeak = null;
        buzzed = false;
        var rec = Store.heart(sid);
        sealed = 0;
        trace = null; zs = null; zones = null; now = null; unsaved = 0;
        if (rec instanceof Lang.Dictionary) {
            trace = rec["tr"];
            if (trace != null && rec["chunks"] != null) { sealed = rec["chunks"]; }
            zs = rec["zs"];
            zones = rec["hz"];
        }
        if (trace == null) { trace = []; }
        if (zs == null) { zs = [0, 0, 0, 0, 0]; }
        if (zones == null) { zones = readZones(); }
    }

    // [z1, z2, z3, z4, z5, max] from the watch's user profile, or null.
    function readZones() {
        try {
            if (UserProfile has :getHeartRateZones) {
                var z = UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_GENERIC);
                if (z != null && z.size() >= 5) { return z; }
            }
        } catch (e) {
        }
        return null;
    }

    function idx(t) { return (t - st) / Config.HR_STEP; }

    // One tick. `t` is the epoch now.
    function sample(t) {
        if (sid == null) { return; }
        now = Recorder.sampleHr();
        if (now == null) { return; }
        var i = idx(t);
        if (i >= sealed * Store.TRACE_CHUNK) { Logic.traceSet(trace, i, now); }
        var z = Logic.zoneOf(now, zones);
        if (z > 0) { zs[z - 1] += Config.HR_STEP; }
        if (pend != null) { advance(t); }
        unsaved += 1;
        if (unsaved * Config.HR_STEP >= 120) { save(); } // flash write every 2 min
    }

    function advance(t) {
        var age = t - pend["t"];
        if (!pend["pkDone"]) {
            if (age <= 20 && now > pend["pk"]) { pend["pk"] = now; }
            if (age >= 20) {
                pend["pkDone"] = true;
                lastPeak = pend["pk"];
                patchSet(pend["i"], "hp", pend["pk"]);
            }
        }
        if (age >= 60) {
            if (age < 60 + Config.HR_STEP) { patchSet(pend["i"], "hd", pend["pk"] - now); }
            pend = null;
        }
    }

    function closeRecovery() {
        if (pend != null && !pend["pkDone"]) { patchSet(pend["i"], "hp", pend["pk"]); }
        pend = null;
    }

    function onSetLogged(i, t, loggedAt) {
        if (sid == null) { return; }
        closeRecovery();
        var age = loggedAt - t;
        var atEnd = idx(t);
        var endHr = Logic.peakIn(trace, atEnd, atEnd);
        if (endHr == null) { endHr = Logic.peakIn(trace, atEnd - 1, atEnd - 1); }
        if (endHr == null && age == 0) { endHr = now; }
        if (endHr != null) { patchSet(i, "he", endHr); }

        // The review may already span part of the rest. Use the recorded
        // samples in each window, then watch for any reading still ahead.
        var pk = Logic.peakIn(trace, atEnd - 60 / Config.HR_STEP, idx(t + 20));
        if (endHr != null && (pk == null || endHr > pk)) { pk = endHr; }
        lastPeak = pk;
        buzzed = false;
        if (pk == null) { return; }
        var peakReady = age >= 20;
        if (peakReady) { patchSet(i, "hp", pk); }
        if (age >= 60) {
            var atRest = idx(t + 60);
            var restHr = Logic.peakIn(trace, atRest, atRest);
            if (restHr != null) { patchSet(i, "hd", pk - restHr); }
            if (restHr != null || age > 60) { return; }
        }
        pend = { "i" => i, "t" => t, "pk" => pk, "pkDone" => peakReady };
    }

    // The set at index i was taken back: stop tracking its peak and drop.
    function onSetUndone(i) {
        if (pend != null && pend["i"] >= i) { pend = null; }
        lastPeak = null;
        buzzed = false;
    }

    function patchSet(i, k, v) {
        var sets = Workout.sets;
        if (sets == null || i >= sets.size()) { return; }
        sets[i][k] = v;
        Store.putSet(sid, i, sets[i]);
    }

    // Smart rest: true exactly once per rest, when HR has come back down.
    function justRecovered(elapsed) {
        if (buzzed || !Logic.recovered(lastPeak, now, elapsed, zones)) { return false; }
        buzzed = true;
        return true;
    }

    function recoveredNow(elapsed) { return buzzed || Logic.recovered(lastPeak, now, elapsed, zones); }

    function save() {
        if (sid == null) { return; }
        sealed = Store.putHeart(sid, trace, zs, zones, sealed);
        unsaved = 0;
        Recorder.saveCounts();
    }

    // Save: keep the record for upload. Discard: Store.dropSession removes it.
    function end(keep) {
        if (keep) { closeRecovery(); }
        if (keep) { save(); }
        sid = null; trace = null; zs = null; pend = null; now = null;
    }
}
