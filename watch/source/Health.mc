using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

// App health telemetry, uploaded through the rep lab queue (POST /telemetry).
//
// Crashes: the app marks itself alive at start ("alive" in storage, with
// what it was doing) and clears the mark on a clean stop. A watchdog or
// memory crash never reaches onStop, so the next start finds the mark and
// reports an "unclean_exit" carrying the last thing the app was doing.
// A flat battery or a watch reboot looks the same; the battery level in the
// mark tells those apart.
//
// Workouts: a "session" record per saved workout with its duration, sets,
// battery used, the peak memory and longest counter step seen in any set,
// and how rep lab uploads have been going.
//
// Every entry point is wrapped: telemetry must never be why the app stops.
module Health {
    function now() { return Time.now().value(); }

    function stats() {
        try { return System.getSystemStats(); } catch (e) { return null; }
    }

    function device() {
        var out = { "part" => null, "fw" => null, "ciq" => null };
        try {
            var d = System.getDeviceSettings();
            out["part"] = d.partNumber;
            if (d.firmwareVersion != null && d.firmwareVersion.size() >= 2) {
                out["fw"] = d.firmwareVersion[0] + "." + d.firmwareVersion[1];
            }
            if (d.monkeyVersion != null && d.monkeyVersion.size() >= 3) {
                out["ciq"] = d.monkeyVersion[0] + "." + d.monkeyVersion[1] + "." + d.monkeyVersion[2];
            }
        } catch (e) {
        }
        return out;
    }

    function context(phase) {
        var s = stats();
        var w = Workout.active();
        return {
            "at" => now(), "phase" => phase, "v" => Lab.VERSION,
            "workout" => w, "sets" => w && Workout.sets != null ? Workout.sets.size() : null,
            "set_running" => w && Workout.setRunning(), "manual" => Reps.manual, "listening" => Reps.listening,
            "analyses" => Reps.analyses, "longest_callback_ms" => Reps.longestStep,
            "mem" => s == null ? null : s.usedMemory, "mem_total" => s == null ? null : s.totalMemory,
            "battery" => s == null ? null : s.battery, "lab_queue" => Lab.queue().size()
        };
    }

    // Foreground start: report a run that never stopped cleanly, then mark
    // this one.
    function boot() {
        try {
            var prev = Store.get("alive");
            if (prev instanceof Lang.Dictionary) {
                prev["kind_hint"] = "no clean stop";
                record("unclean_exit", prev["at"], prev);
            }
            Store.put("alive", context("open"));
        } catch (e) {
            System.println("health boot " + e.getErrorMessage());
        }
    }

    // What the app is doing now, for the next start to report if this run
    // dies. Called at the moments a crash would cost something: a set
    // starting and a set being logged.
    function mark(phase) {
        try { Store.put("alive", context(phase)); } catch (e) { }
    }

    function stop() {
        try { Store.del("alive"); } catch (e) { }
    }

    function record(kind, at, data) {
        if (!Lab.enabled() || Config.DEMO_DATA) { return; }
        try {
            var id = Logic.uuid4();
            var dev = device();
            data["part"] = dev["part"]; data["fw"] = dev["fw"]; data["ciq"] = dev["ciq"];
            Lab.push("lh_" + id, { "sid" => null, "body" => {
                "id" => id, "kind" => kind, "at" => at == null ? null : Logic.isoUtc(at),
                "app_version" => Lab.VERSION, "data" => data
            } });
        } catch (e) {
            System.println("health record " + e.getErrorMessage());
        }
    }

    // --- per workout ----------------------------------------------------

    function workoutStart(sid) {
        try {
            var s = stats();
            Store.put("hw", { "sid" => sid, "t" => now(), "b" => s == null ? null : s.battery,
                "peak" => 0, "long" => 0, "labs" => 0, "rich" => 0, "mag" => 0, "beats" => 0, "gaps" => 0 });
        } catch (e) { }
    }

    function noteSet(diag) {
        try {
            var w = Store.get("hw");
            if (!(w instanceof Lang.Dictionary) || diag == null) { return; }
            if (diag["mem_peak"] != null && diag["mem_peak"] > w["peak"]) { w["peak"] = diag["mem_peak"]; }
            if (diag["longest_callback_ms"] != null && diag["longest_callback_ms"] > w["long"]) { w["long"] = diag["longest_callback_ms"]; }
            w["labs"] += 1;
            if (diag["rich"] == true) { w["rich"] += 1; }
            if (diag["mag_samples"] != null && diag["mag_samples"] > 0) { w["mag"] += 1; }
            if (diag["beats"] != null && diag["beats"] > 0) { w["beats"] += 1; }
            if (diag["interrupted"] == true) { w["gaps"] += 1; }
            Store.put("hw", w);
        } catch (e) { }
    }

    // A saved workout: one summary record. A discarded one sends nothing.
    function workoutEnd(sid, sets, saved, net) {
        try {
            var w = Store.get("hw");
            Store.del("hw");
            if (!saved || !(w instanceof Lang.Dictionary)) { return; }
            var s = stats();
            var b1 = s == null ? null : s.battery;
            var data = {
                "session_id" => sid, "duration_s" => now() - w["t"], "sets" => sets,
                "battery_start" => w["b"], "battery_end" => b1,
                "mem_peak" => w["peak"], "mem_total" => s == null ? null : s.totalMemory,
                "longest_callback_ms" => w["long"], "lab_sets" => w["labs"],
                "rich_sets" => w["rich"], "mag_sets" => w["mag"], "beat_sets" => w["beats"],
                "gap_sets" => w["gaps"], "rich_bad" => Reps.richBad()
            };
            if (net != null) {
                data["uploads_ok"] = net.labOk;
                data["uploads_failed"] = net.labFailed;
                data["upload_codes"] = net.labCodes;
            }
            record("session", now(), data);
        } catch (e) {
            System.println("health workout " + e.getErrorMessage());
        }
    }
}
