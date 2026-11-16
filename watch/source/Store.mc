using Toybox.Application.Storage;
using Toybox.Lang;
using Toybox.Time;

// Application.Storage layout. Values are kept small and split by key.
// Limits: the fr165m device profile gives the app 10 MB of storage in total
// (appStorageCapacity). Garmin also caps a single value (about 32 KB as I
// recall it; not measured here), and each setValue rewrites the whole value
// to flash. The largest thing we store is the cached workout, around 3 KB.
//
//   wk          trimmed GET /today response
//   wkAt        epoch secs it was fetched
//   ls          epoch secs of the last successful sync
//   cur         position in the active workout (see Workout)
//   pl          plan snapshot the active workout was started from
//   m_<sid>     session meta
//   t_<sid>_<i> one logged set, i = 0,1,2...
//   q           session ids waiting for the server to confirm them
//   qd          session ids the server refused for good (kept, not retried)
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

    // Keeps only the fields the watch uses, so the cached value stays ~3 KB.
    function cacheToday(data) {
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
        put("wk", out);
        put("wkAt", Time.now().value());
    }

    // The cached workout, only if it was fetched for today's local date.
    function today() {
        var w = get("wk");
        if (w instanceof Lang.Dictionary && w["date"] != null && w["date"].equals(Logic.localDate())) {
            return w;
        }
        return null;
    }

    function meta(sid) { return get("m_" + sid); }
    function putMeta(m) { put("m_" + m["id"], m); }

    function putSet(sid, i, s) { put("t_" + sid + "_" + i, s); }

    // No stored count: read until the first gap. A crash between writing a
    // set and writing anything else can therefore never orphan it.
    function sets(sid) {
        var out = [];
        for (var i = 0; i < 200; i++) {
            var s = get("t_" + sid + "_" + i);
            if (s == null) { break; }
            out.add(s);
        }
        return out;
    }

    function dropSession(sid) {
        for (var i = 0; i < 200; i++) {
            var k = "t_" + sid + "_" + i;
            if (get(k) == null) { break; }
            del(k);
        }
        del("m_" + sid);
    }

    function enqueue(sid) { put("q", Logic.qAdd(queue(), sid)); }
    function dequeue(sid) { put("q", Logic.qRemove(queue(), sid)); }

    function bury(sid) {
        dequeue(sid);
        put("qd", Logic.qAdd(dead(), sid));
    }
}
