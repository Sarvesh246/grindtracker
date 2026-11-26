using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

// Routes one reply to the request that asked for it. A reply that comes
// back after its request was given up (timed out) is ignored: it belongs to
// an older generation, and must not clear `busy` for the request in flight.
class NetReply {
    var net;
    var gen;
    var cb;

    function initialize(n, g, c) {
        net = n;
        gen = g;
        cb = c;
    }

    function onResponse(code, data) {
        net.onReply(gen, cb, code, data);
    }
}

// API client + sync queue. One request in flight at a time, nothing here
// ever blocks or opens a dialog: the UI just reads status().
class Net {
    var busy = false;
    var gen = 0;             // request generation: bumped on every request
    var busyAt = 0;          // epoch secs the request in flight was sent
    var pendingCb = null;    // its callback, for a timeout
    var headSid = null;      // the workout at the head of the queue, last failed
    var headTries = 0;       // consecutive failures of headSid
    var authError = false;
    var fails = 0;       // upload failures in a row
    var nextAt = 0;      // epoch secs before which we don't retry uploads
    var todayAt = 0;     // same, for re-fetching a missing workout
    var dailyRetryAt = 0;
    var cachedDayAttempts = [];
    var dayWant = null;  // day id being fetched for the picker
    var upSid = null;
    var upSets = null;
    var upPayload = null;
    var sensorKey = null;
    var sensorNextAt = 0;
    var labKey = null;
    var labOk = 0;           // this run's rep lab uploads, for the health record
    var labFailed = 0;
    var labCodes = [];       // the last few failure codes
    var labFails = 0;
    var labNextAt = 0;

    function initialize() {
    }

    function now() { return Time.now().value(); }

    // Demo data must never reach the server, so a demo build is offline.
    function connected() {
        if (Config.DEMO_DATA) { return false; }
        return System.getDeviceSettings().phoneConnected;
    }

    function headers() {
        return {
            "Authorization" => "Bearer " + Secrets.TOKEN,
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
        };
    }

    function request(path, params, post, cb) {
        busy = true;
        gen += 1;
        busyAt = now();
        pendingCb = cb;
        try {
            Communications.makeWebRequest(Secrets.API_BASE + path, params, {
                :method => post ? Communications.HTTP_REQUEST_METHOD_POST : Communications.HTTP_REQUEST_METHOD_GET,
                :headers => headers(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            }, new Lang.Method(new NetReply(self, gen, cb), :onResponse));
        } catch (e) {
            System.println("request " + path + " failed: " + e.getErrorMessage());
            pendingCb = null;
            cb.invoke(-1, null);
        }
    }

    function onReply(g, cb, code, data) {
        if (g != gen) {
            System.println("late reply " + code + " ignored");
            return;
        }
        pendingCb = null;
        cb.invoke(code, data);
    }

    // A reply that never comes would hold `busy` for ever and stop all sync
    // until relaunch. Past REPLY_TIMEOUT_S, give the request up as a
    // transport failure (-1), which every callback already handles.
    function checkTimeout() {
        if (!busy || now() - busyAt <= Config.REPLY_TIMEOUT_S) { return; }
        System.println("request timed out");
        var cb = pendingCb;
        pendingCb = null;
        gen += 1;
        busy = false;
        if (cb != null) { cb.invoke(-1, null); }
    }

    function errCode(data) {
        if (data instanceof Lang.Dictionary && data["error"] instanceof Lang.Dictionary) {
            return data["error"]["code"];
        }
        return null;
    }

    // --- GET /ping then GET /today -------------------------------------

    // Manual refresh and app open. Ping first: it's the cheapest way to
    // learn the token is bad before anything else is tried.
    function refresh() {
        if (busy) { return; }
        if (!connected()) {
            System.println("refresh: phone not connected");
            return;
        }
        todayAt = now() + 120;
        request("/ping", null, false, method(:onPing));
    }

    function onPing(code, data) {
        System.println("ping -> " + code + " " + errCode(data));
        busy = false;
        if (code == 200) {
            authError = false;
            if (data instanceof Lang.Dictionary) { System.println("server_time " + data["server_time"]); }
            if (!tickUploads()) {
                request("/today", { "date" => Logic.localDate(), "unit" => Config.UNIT }, false, method(:onToday));
            }
        } else if (code == 401) {
            authError = true;
        }
        WatchUi.requestUpdate();
    }

    function onToday(code, data) {
        System.println("today -> " + code + " " + errCode(data));
        busy = false;
        if (code == 200 && data instanceof Lang.Dictionary && data["date"] != null) {
            if (Store.cacheToday(data)) {
                Store.put("ls", now());
                var wk = Store.today();
                cachedDayAttempts = wk != null && wk["id"] != null ? [wk["id"]] : [];
            }
        } else if (code == 401) {
            authError = true;
        }
        WatchUi.requestUpdate();
        if (Store.queue().size() > 0) { flush(); } else if (!Workout.active()) { daily(); }
    }

    // --- a day the user chose on Home ----------------------------------

    // GET /today?day=<id>. Returns false if it could not start (busy / no phone).
    function fetchDay(id) {
        if (busy || !connected() || id == null) { return false; }
        dayWant = id;
        request("/today", { "date" => Logic.localDate(), "unit" => Config.UNIT, "day" => id }, false, method(:onDay));
        return true;
    }

    function onDay(code, data) {
        System.println("day " + dayWant + " -> " + code + " " + errCode(data));
        busy = false;
        var id = dayWant;
        dayWant = null;
        var ok = code == 200 && data instanceof Lang.Dictionary && data["workout"] instanceof Lang.Dictionary
            && id != null && id.equals(data["workout"]["id"]);
        if (ok) {
            ok = Store.cacheDay(data);
            if (ok && cachedDayAttempts.indexOf(id) < 0) { cachedDayAttempts.add(id); }
        } else if (code == 401) {
            authError = true;
        }
        Pick.arrived(id, ok);
        WatchUi.requestUpdate();
        flush();
    }

    // Fill the offline roster one routine at a time, behind workout uploads.
    // A failure is retried on the next full refresh, so one bad day cannot
    // block the rest of the roster or repeatedly occupy the connection.
    function cacheNextDay() {
        var days = Store.days();
        if (days == null) { return false; }
        for (var i = 0; i < days.size(); i++) {
            var id = days[i]["id"];
            if (cachedDayAttempts.indexOf(id) < 0) {
                cachedDayAttempts.add(id);
                return fetchDay(id);
            }
        }
        return false;
    }

    // --- sync queue -----------------------------------------------------

    // Called every ~30 s while the app is open.
    function tick() {
        checkTimeout();
        if (busy || authError || !connected()) { return; }
        if (Store.queue().size() > 0) {
            flush();
        } else if (Store.today() == null && now() >= todayAt) {
            refresh();
        } else if (!Workout.active() && cacheNextDay()) {
            return;
        } else if (labDue()) {
            lab();
        } else if (!Workout.active()) {
            daily();
        }
    }

    // Also runs between normal sync ticks so a newly reconnected phone can
    // carry saved workouts promptly. The normal tick handles other traffic.
    function tickUploads() {
        if (busy || authError || now() < nextAt || !connected() || (Store.queue().size() == 0 && !sensorDue())) { return false; }
        flush();
        return true;
    }

    // --- POST /daily ------------------------------------------------------

    // The day's body snapshot, at most every DAILY_EVERY seconds. Never
    // mid-workout: reading a day of sensor history is slow. Fire and forget:
    // a failure just waits for the next one.
    function daily() {
        if (busy || authError || !connected() || now() < dailyRetryAt) { return; }
        var last = Store.get("dl");
        if (last != null && last <= now() && now() - last < Config.DAILY_EVERY) { return; }
        dailyRetryAt = now() + 120;
        request("/daily", Body.snapshot("app"), true, method(:onDaily));
    }

    function onDaily(code, data) {
        System.println("daily -> " + code + " " + errCode(data));
        busy = false;
        if (code == 200 || code == 201) { Store.put("dl", now()); }
        if (code == 401) { authError = true; }
        flush();
    }

    // Right after Save: don't wait out a backoff from an earlier failure.
    function kick() {
        nextAt = 0;
        sensorNextAt = 0;
        flush();
    }

    function flush() {
        if (busy) { return; }
        var q = Store.queue();
        if (q.size() > 0) {
            var queuedMeta = Store.meta(q[0]);
            if (queuedMeta != null && reconcileBackground(q[0], queuedMeta)) { return; }
        }
        if (authError || !connected() || now() < nextAt) { return; }
        if (q.size() == 0) {
            if (sensorDue()) { sendSensor(); }
            else if (labDue()) { lab(); }
            return;
        }
        var sid = q[0];
        var meta = Store.meta(sid);
        var sets = meta == null ? [] : Store.sets(sid);
        if (meta == null || Logic.pendingCount(sets) == 0) {
            // Nothing left to send for this one.
            retire(sid, sets);
            // Drain another item on the next sync tick. A long queue of
            // interrupted cleanups must not exhaust the call stack.
            return;
        }
        upSid = sid;
        upSets = sets;
        var heart = Logic.pendingCount(sets) <= Config.SYNC_BATCH ? Store.heart(sid) : null;
        upPayload = Logic.buildPayload(meta, sets, Config.SYNC_BATCH, heart);
        upPayload["saved_upload"] = true;
        request("/sessions", upPayload, true, method(:onUpload));
    }

    function reconcileBackground(sid, meta) {
        var receipt = Store.get("bd_" + sid);
        if (!(receipt instanceof Lang.Dictionary)) { return false; }
        for (var i = 0; true; i++) {
            var packet = Store.get("bu_" + sid + "_" + i);
            if (packet == null) { break; }
            var batch = packet["sets"];
            for (var j = 0; j < batch.size(); j++) {
                var set = batch[j];
                if (set["hr_peak"] != null || set["hr_end"] != null || set["hr_rest_drop_60"] != null) {
                    packet["sensor_retry"] = true;
                    Store.keepSensor(batch[0]["id"], packet);
                    break;
                }
            }
        }
        var sensor = Logic.buildPayload(meta, [], Config.SYNC_BATCH, Store.heart(sid));
        if (sensor["hr"] != null) {
            sensor["sensor_retry"] = true;
            Store.keepSensor(sid, sensor);
        }
        keepResult(sid, receipt);
        if (receipt["at"] != null) { Store.put("ls", Logic.latest(Store.get("ls"), receipt["at"])); }
        retire(sid, []);
        if (Store.queue().size() == 0) {
            Pick.reset();
            refresh();
        }
        WatchUi.requestUpdate();
        return true;
    }

    function retire(sid, sets) {
        for (var i = 0; i < sets.size(); i++) {
            if (sets[i]["y"] == 2) { Store.bury(sid); return; }
        }
        Store.recordWorkout(Store.meta(sid));
        Store.dropSession(sid);
        Store.dequeue(sid);
    }

    function onUpload(code, data) {
        var err = errCode(data);
        System.println("upload " + upSid + " -> " + code + " " + err);
        busy = false;
        var sid = upSid;
        var sets = upSets;
        upSid = null;
        upSets = null;
        var payload = upPayload;
        upPayload = null;
        var r = Logic.classify(code, err);
        if (r == Logic.R_OK) {
            var sensor = data instanceof Lang.Dictionary ? data["sensor"] : null;
            if (payload != null && sensor instanceof Lang.Dictionary && "pending".equals(sensor["status"])) {
                var batch = payload["sets"];
                var key = batch.size() == 0 ? sid : batch[0]["id"];
                payload["sensor_retry"] = true;
                Store.keepSensor(key, payload);
            }
            var changed = Logic.applyResult(sets, data);
            if (changed.size() == 0) {
                // A 2xx without a matching set ID has made no progress.
                fails += 1;
                failHead(sid, true);
                nextAt = now() + Logic.backoffSecs(fails);
                WatchUi.requestUpdate();
                return;
            }
            fails = 0;
            nextAt = 0;
            keepResult(sid, data);
            if (data instanceof Lang.Dictionary && data["sets"] instanceof Lang.Dictionary) {
                var rejected = data["sets"]["rejected"];
                if (rejected instanceof Lang.Array && rejected.size() > 0) {
                    rememberIssue(sid, rejected[0]["code"]);
                }
            }
            for (var i = 0; i < changed.size(); i++) {
                Store.putSet(sid, changed[i], sets[changed[i]]);
            }
            Store.put("ls", now());
            if (Logic.pendingCount(sets) == 0) {
                retire(sid, sets);
                // The finished workout moved GRIND's "up next": fetch it, so
                // Home stops offering the day that was just done.
                if (Store.queue().size() == 0) {
                    Pick.reset();
                    WatchUi.requestUpdate();
                    refresh();
                    return;
                }
            }
            flush();
        } else if (r == Logic.R_AUTH) {
            authError = true;
        } else if (r == Logic.R_DEAD) {
            // The server will never take this as-is. Keep the data on the
            // watch, stop retrying it, and let the rest of the queue through.
            rememberIssue(sid, err);
            Store.bury(sid);
            flush();
        } else {
            fails += 1;
            // A 5xx is usually an outage or a deploy, not this workout: it
            // rotates the queue but never buries a workout.
            failHead(sid, false);
            nextAt = now() + Logic.backoffSecs(fails);
        }
        WatchUi.requestUpdate();
    }

    // One workout that keeps failing must not hold up the queue behind it:
    // after UPLOAD_ROTATE_AFTER failures in a row it moves to the back, and
    // each failure is counted on the session. Only a deterministic failure
    // (a 2xx that acknowledges nothing) can bury it after UPLOAD_BURY_AFTER,
    // and a buried workout stays on the watch.
    function failHead(sid, deterministic) {
        var m = Store.meta(sid);
        var n = 1;
        if (m != null) {
            n = (m["fx"] == null ? 0 : m["fx"]) + 1;
            m["fx"] = n;
            Store.putMeta(m);
        }
        if (deterministic && n >= Config.UPLOAD_BURY_AFTER) {
            rememberIssue(sid, "no_receipt");
            Store.bury(sid);
            headTries = 0;
            return;
        }
        if (sid.equals(headSid)) { headTries += 1; } else { headSid = sid; headTries = 1; }
        if (headTries < Config.UPLOAD_ROTATE_AFTER) { return; }
        headTries = 0;
        var q = Store.queue();
        if (q.size() > 1 && q[0].equals(sid)) {
            q = q.slice(1, null);
            q.add(sid);
            Store.put("q", q);
            System.println("upload " + sid + " moved to the back after failures");
        }
    }

    function sensorDue() {
        return now() >= sensorNextAt && Store.sensors().size() > 0;
    }

    function sendSensor() {
        var q = Store.sensors();
        if (q.size() == 0) { return; }
        sensorKey = q[0];
        var payload = Store.get("hs_" + sensorKey);
        if (payload == null) {
            Store.retireSensor(sensorKey);
            sensorKey = null;
            return;
        }
        request("/sessions", payload, true, method(:onSensor));
    }

    function onSensor(code, data) {
        busy = false;
        var key = sensorKey;
        sensorKey = null;
        if ((code == 200 || code == 201) && data instanceof Lang.Dictionary
            && data["sensor"] instanceof Lang.Dictionary && "stored".equals(data["sensor"]["status"])) {
            Store.retireSensor(key);
            sensorNextAt = 0;
        } else {
            var q = Store.sensors();
            Store.put("qh", Logic.qAdd(Logic.qRemove(q, key), key));
            sensorNextAt = now() + 60;
            if (code == 401) { authError = true; }
        }
        WatchUi.requestUpdate();
        flush();
    }

    function rememberIssue(sid, code) {
        var m = Store.meta(sid);
        if (m == null) { return; }
        m["err"] = code == null ? "upload_refused" : code;
        Store.putMeta(m);
    }

    function retryWorkout(sid) {
        if (Store.dead().indexOf(sid) >= 0) {
            var sets = Store.sets(sid);
            for (var i = 0; i < sets.size(); i++) {
                if (sets[i]["y"] == 2) {
                    sets[i]["y"] = 0;
                    Store.putSet(sid, i, sets[i]);
                }
            }
            var m = Store.meta(sid);
            if (m != null) {
                m["fx"] = 0;
                m["err"] = null;
                Store.putMeta(m);
            }
            Store.enqueue(sid);
            Store.put("qd", Logic.qRemove(Store.dead(), sid));
        }
        kick();
    }

    // --- POST /rep-lab ------------------------------------------------------

    // Rep lab recordings go after every workout upload, one per request,
    // with their own backoff so a problem here never delays a workout.
    function labDue() {
        return !busy && !authError && connected() && now() >= labNextAt && Lab.next() != null;
    }

    function lab() {
        var key = Lab.next();
        if (key == null) { return; }
        var r = Store.get(key);
        labKey = key;
        var kind = key.substring(0, 3);
        request(kind.equals("lh_") ? "/telemetry" : kind.equals("lr_") ? "/readiness" : "/rep-lab", r["body"], true, method(:onLab));
    }

    function onLab(code, data) {
        var err = errCode(data);
        System.println("lab " + labKey + " -> " + code + " " + err);
        busy = false;
        var key = labKey;
        labKey = null;
        var r = Logic.classify(code, err);
        if (r == Logic.R_OK || r == Logic.R_DEAD) {
            // Stored, or never storable as sent (its workout was refused):
            // either way it must not block the records behind it.
            Lab.drop(key);
            if (r == Logic.R_OK) { labOk += 1; }
            labFails = 0;
            labNextAt = 0;
        } else if (r == Logic.R_AUTH) {
            authError = true;
        } else {
            labFails += 1;
            labFailed += 1;
            labCodes.add(code);
            if (labCodes.size() > 5) { labCodes = labCodes.slice(labCodes.size() - 5, null); }
            labNextAt = now() + Logic.backoffSecs(labFails);
            // Bluetooth-side failures (negative codes) three times running:
            // try the smaller version of the record before giving up on it.
            if (code < 0 && labFails == 3 && Lab.slim(key)) { labNextAt = now() + 5; }
            // A record the phone keeps failing to carry (too large for the
            // bridge, say) must not hold up the ones behind it for ever.
            if (labFails >= 8) { Lab.drop(key); labFails = 0; labNextAt = 0; }
        }
        if (Store.queue().size() > 0) {
            if (tickUploads()) { WatchUi.requestUpdate(); }
        } else if (r == Logic.R_OK || r == Logic.R_DEAD) {
            if (labDue()) { lab(); }
        }
    }

    // The XP and streak a finished upload earned, for the summary screen.
    function keepResult(sid, data) {
        if (!(data instanceof Lang.Dictionary) || !(data["session"] instanceof Lang.Dictionary)) { return; }
        var se = data["session"];
        if (!"completed".equals(se["status"]) || se["xp_earned"] == null) { return; }
        var st = data["stats"] instanceof Lang.Dictionary ? data["stats"]["current_streak"] : null;
        Store.put("lx", { "sid" => sid, "xp" => se["xp_earned"], "st" => st });
    }

    // --- what the UI shows ----------------------------------------------

    // Short form for the status row.
    function status() {
        if (authError) { return "Auth error"; }
        var n = Store.queue().size();
        if (n > 0) { return n + " to sync"; }
        if (Store.dead().size() > 0) { return "sync failed"; }
        if (!connected()) { return "offline"; }
        return "synced";
    }

    function statusColor() {
        if (authError || Store.dead().size() > 0) { return Config.WARN; }
        return Config.DIM;
    }

    function workoutStatus(sid) {
        if (Store.dead().indexOf(sid) >= 0) { return "Needs attention"; }
        if (Store.queue().indexOf(sid) < 0) { return Store.sensorPending(sid) ? "Sets synced · HR pending" : "Synced to GRIND"; }
        if (authError) { return "Auth error"; }
        if (Store.get("bd_" + sid) != null) { return "Sets synced to GRIND"; }
        if (busy && sid.equals(upSid)) { return "Syncing to GRIND…"; }
        return connected() ? "Waiting to sync" : "Waiting for phone";
    }

    // Longer form for Home. The last contact of any kind: a workout upload
    // ("ls") or a day snapshot, open or in the background ("dl"), so it
    // agrees with the Health page's "Received".
    function homeStatus() {
        if (authError) { return "Auth error"; }
        var n = Store.queue().size();
        if (n > 0) { return n + " to sync"; }
        if (Store.dead().size() > 0) { return "sync failed"; }
        if (!connected()) { return "offline"; }
        var ls = Logic.latest(Store.get("ls"), Store.get("dl"));
        if (ls == null) { return "not synced yet"; }
        return Logic.agoText(now() - ls);
    }
}
