using Toybox.Application.Storage;
using Toybox.Lang;
using Toybox.Time;

// Application.Storage layout. Values are kept small and split by key.
// Limits: the fr165m device profile gives the app 10 MB of storage in total
// (appStorageCapacity). Garmin also caps a single value (about 32 KB as I
// recall it; not measured here), and each setValue rewrites the whole value
// to flash. The largest thing we store is the cached workout, around 3 KB.
//
//   wk          trimmed GET /today response (the up-next day) + dy: day list
//   wk_<day>    the plan for one day (the up-next one, or one the user picked)
//   wkAt        epoch secs it was fetched
//   ls          epoch secs of the last successful sync
//   cur         position in the active workout (see Workout)
//   pl          plan snapshot the active workout was started from
//   m_<sid>     session meta
//   t_<sid>_<i> one logged set, i = 0,1,2...
//   q           session ids waiting for the server to confirm them
//   qd          session ids the server refused for good (kept, not retried)
//   dl          epoch secs of the last /daily snapshot (foreground or background)
//   bg          [epoch, status] of the last background run (Bg.mc)
//   rc          rep counting on (true/null) or off (false)
module Store {
    function get(k) { return Storage.getValue(k); }
    function put(k, v) { Storage.setValue(k, v); }
    function del(k) { Storage.deleteValue(k); }

    function list(k) {
        var v = Storage.getValue(k);
        if (v instanceof Lang.Array) { return v; }
        return [];
    }

    function queue() { return list("q"); }
    function dead() { return list("qd"); }

    // Keeps only the fields the watch uses, so a cached plan stays ~3 KB.
    // { date, unit, id, name, ex: [...] } for a workout day, or
    // { date, unit, reason } when nothing is planned.
    function trimPlan(data) {
        var out = { "date" => data["date"], "unit" => data["unit"] };
        var w = data["workout"];
        if (w instanceof Lang.Dictionary) {
            out["id"] = w["id"];
            out["name"] = w["name"];
            var ex = [];
            var src = w["exercises"];
            if (src instanceof Lang.Array) {
                for (var i = 0; i < src.size(); i++) {
                    var e = src[i];
                    ex.add({
                        "id" => e["id"], "name" => e["name"], "sets" => e["sets"],
                        "reps" => e["reps"], "reps_max" => e["reps_max"],
                        "weight" => e["weight"], "rest" => e["rest"]
                    });
                }
            }
            out["ex"] = ex;
        } else {
            out["reason"] = data["reason"];
        }
        return out;
    }

    // The default response (the day GRIND says is up next). Also keeps the
    // list of days for the picker, and the plan under its own day key.
    function cacheToday(data) {
        var out = trimPlan(data);
        var d = data["days"];
        if (d instanceof Lang.Array) {
            var dy = [];
            for (var i = 0; i < d.size(); i++) {
                dy.add({ "id" => d[i]["id"], "name" => d[i]["name"] });
            }
            out["dy"] = dy;
        }
        // GRIND Body: Charge for Home and the smart-rest switch.
        var b = data["body"];
        if (b instanceof Lang.Dictionary) {
            var c = b["charge"];
            if (c instanceof Lang.Dictionary) {
                out["ch"] = { "s" => c["score"], "b" => c["band"], "l" => c["label"], "a" => c["advice"] };
            }
            out["sr"] = b["smart_rest"] == true;
        }
        put("wk", out);
        put("wkAt", Time.now().value());
        if (out["id"] != null) { put("wk_" + out["id"], out); }
    }

    // A day the user picked (GET /today?day=...). The default stays as is.
    function cacheDay(data) {
        var out = trimPlan(data);
        if (out["id"] != null) { put("wk_" + out["id"], out); }
    }

    function isToday(w) {
        return w instanceof Lang.Dictionary && w["date"] != null && w["date"].equals(Logic.localDate());
    }

    // The default plan, only if it was fetched for today's local date.
    function today() {
        var w = get("wk");
        return isToday(w) ? w : null;
    }

    // The days to choose between, or null (old cache, or nothing planned).
    function days() {
        var w = today();
        if (w == null) { return null; }
        var d = w["dy"];
        return d instanceof Lang.Array && d.size() > 0 ? d : null;
    }

    // The plan for one day if we hold it for today's date, else null.
    function planFor(id) {
        var w = today();
        if (w != null && w["id"] != null && w["id"].equals(id)) { return w; }
        var p = get("wk_" + id);
        return isToday(p) && p["ex"] != null ? p : null;
    }

    // Today's Charge { s score, b band, l label, a advice }, or null.
    function charge() {
        var w = today();
        return w == null ? null : w["ch"];
    }

    function smartRest() {
        var w = today();
        return w != null && w["sr"] == true;
    }

    function meta(sid) { return get("m_" + sid); }
    function putMeta(m) { put("m_" + m["id"], m); }

    function putSet(sid, i, s) { put("t_" + sid + "_" + i, s); }

    // Each storage value is limited to 32 KB. Only completed chunks are
    // immutable; h_<sid> holds the latest tail and its committed chunk count.
    const TRACE_CHUNK = 1024;

    function heart(sid) {
        var record = get("h_" + sid);
        if (record == null || record["chunks"] == null) { return record; }
        var trace = [];
        for (var i = 0; i < record["chunks"]; i++) {
            var chunk = get("hc_" + sid + "_" + i);
            if (!(chunk instanceof Lang.Array) || chunk.size() != TRACE_CHUNK) {
                record["tr"] = null;
                return record;
            }
            trace.addAll(chunk);
        }
        trace.addAll(record["tr"]);
        record["tr"] = trace;
        return record;
    }

    function putHeart(sid, trace, zs, hz, sealed) {
        var chunks = trace.size() / TRACE_CHUNK;
        for (var i = sealed; i < chunks; i++) {
            put("hc_" + sid + "_" + i, trace.slice(i * TRACE_CHUNK, (i + 1) * TRACE_CHUNK));
        }
        put("h_" + sid, { "tr" => trace.slice(chunks * TRACE_CHUNK, null), "zs" => zs, "hz" => hz, "chunks" => chunks });
        return chunks;
    }

    // No stored count: read until the first gap. A crash between writing a
    // set and writing anything else can therefore never orphan it.
    function sets(sid) {
        var out = [];
        for (var i = 0; true; i++) {
            var s = get("t_" + sid + "_" + i);
            if (s == null) { break; }
            out.add(s);
        }
        return out;
    }

    function dropSession(sid) {
        for (var i = 0; true; i++) {
            var k = "t_" + sid + "_" + i;
            if (get(k) == null) { break; }
            del(k);
        }
        del("m_" + sid);
        for (var i = 0; get("hc_" + sid + "_" + i) != null; i++) { del("hc_" + sid + "_" + i); }
        del("h_" + sid);
    }

    function enqueue(sid) { put("q", Logic.qAdd(queue(), sid)); }
    function dequeue(sid) { put("q", Logic.qRemove(queue(), sid)); }

    function bury(sid) {
        put("qd", Logic.qAdd(dead(), sid));
        dequeue(sid);
    }
}
