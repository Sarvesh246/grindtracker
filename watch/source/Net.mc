using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

// API client + sync queue. One request in flight at a time, nothing here
// ever blocks or opens a dialog: the UI just reads status().
class Net {
    var busy = false;
    var authError = false;
    var fails = 0;       // upload failures in a row
    var nextAt = 0;      // epoch secs before which we don't retry uploads
    var todayAt = 0;     // same, for re-fetching a missing workout
    var dayWant = null;  // day id being fetched for the picker
    var upSid = null;
    var upSets = null;

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
        Communications.makeWebRequest(Secrets.API_BASE + path, params, {
            :method => post ? Communications.HTTP_REQUEST_METHOD_POST : Communications.HTTP_REQUEST_METHOD_GET,
            :headers => headers(),
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, cb);
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
            request("/today", { "date" => Logic.localDate(), "unit" => Config.UNIT }, false, method(:onToday));
        } else if (code == 401) {
            authError = true;
        }
        WatchUi.requestUpdate();
    }

    function onToday(code, data) {
        System.println("today -> " + code + " " + errCode(data));
        busy = false;
        if (code == 200 && data instanceof Lang.Dictionary && data["date"] != null) {
            Store.cacheToday(data);
            Store.put("ls", now());
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
            Store.cacheDay(data);
        } else if (code == 401) {
            authError = true;
        }
        Pick.arrived(id, ok);
        WatchUi.requestUpdate();
        flush();
    }

    // --- sync queue -----------------------------------------------------

    // Called every ~30 s while the app is open.
    function tick() {
        if (busy || authError || !connected()) { return; }
        if (Store.queue().size() > 0) {
            flush();
        } else if (Store.today() == null && now() >= todayAt) {
            refresh();
        } else if (!Workout.active()) {
            daily();
        }
    }

    // --- POST /daily ------------------------------------------------------

    // The day's body snapshot, at most every DAILY_EVERY seconds. Never
    // mid-workout: reading a day of sensor history is slow. Fire and forget:
    // a failure just waits for the next one.
    function daily() {
        if (busy || authError || !connected()) { return; }
        var last = Store.get("dl");
        if (last != null && now() - last < Config.DAILY_EVERY) { return; }
        Store.put("dl", now());
        request("/daily", Body.snapshot(), true, method(:onDaily));
    }

    function onDaily(code, data) {
        System.println("daily -> " + code + " " + errCode(data));
        busy = false;
        if (code == 401) { authError = true; }
        flush();
    }

    // Right after Save: don't wait out a backoff from an earlier failure.
    function kick() {
        nextAt = 0;
        flush();
    }

    function flush() {
        if (busy || authError || !connected() || now() < nextAt) { return; }
        var q = Store.queue();
        if (q.size() == 0) { return; }
        var sid = q[0];
        var meta = Store.meta(sid);
        var sets = meta == null ? [] : Store.sets(sid);
        if (meta == null || Logic.pendingCount(sets) == 0) {
            // Nothing left to send for this one.
            Store.dropSession(sid);
            Store.dequeue(sid);
            flush();
            return;
        }
        upSid = sid;
        upSets = sets;
        request("/sessions", Logic.buildPayload(meta, sets, Config.SYNC_BATCH, Store.get("h_" + sid)), true, method(:onUpload));
    }

    function onUpload(code, data) {
        var err = errCode(data);
        System.println("upload " + upSid + " -> " + code + " " + err);
        busy = false;
        var sid = upSid;
        var sets = upSets;
        upSid = null;
        upSets = null;
        var r = Logic.classify(code, err);
        if (r == Logic.R_OK) {
            fails = 0;
            nextAt = 0;
            var changed = Logic.applyResult(sets, data);
            keepResult(sid, data);
            for (var i = 0; i < changed.size(); i++) {
                Store.putSet(sid, changed[i], sets[changed[i]]);
            }
            Store.put("ls", now());
            if (changed.size() == 0) {
                // A 2xx that acknowledged none of our sets: don't spin on it.
                fails = 1;
                nextAt = now() + Logic.backoffSecs(fails);
            } else if (Logic.pendingCount(sets) == 0) {
                Store.dropSession(sid);
                Store.dequeue(sid);
                // The finished workout moved GRIND's "up next": fetch it, so
                // Home stops offering the day that was just done.
                if (Store.queue().size() == 0) {
                    Pick.reset();
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
            Store.bury(sid);
            flush();
        } else {
            fails += 1;
            nextAt = now() + Logic.backoffSecs(fails);
        }
        WatchUi.requestUpdate();
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

    // Longer form for Home.
    function homeStatus() {
        if (authError) { return "Auth error"; }
        var n = Store.queue().size();
        if (n > 0) { return n + " to sync"; }
        if (Store.dead().size() > 0) { return "sync failed"; }
        var ls = Store.get("ls");
        if (!connected()) { return "offline"; }
        if (ls == null) { return "not synced yet"; }
        return Logic.agoText(now() - ls);
    }
}
