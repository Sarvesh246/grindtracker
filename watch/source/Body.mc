using Toybox.ActivityMonitor;
using Toybox.Application.Storage;
using Toybox.Background;
using Toybox.Lang;
using Toybox.Sensor;
using Toybox.SensorHistory;
using Toybox.System;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.UserProfile;

// GRIND Body, phase 1: the day's snapshot for POST /daily. Only the values the
// phase 0 probe saw this watch actually fill in: Body Battery, stress and
// heart-rate history, resting HR, recovery time, steps, active minutes,
// floors, SpO2 (the newest history sample, when recent), VO2 max and the
// live respiration rate. (Respiration history comes back empty.)
//
// Also runs in the background service (Bg.mc), which has 64 KB in all, so
// the history is bucketed as it is read: 96 slots per series whatever the
// hour, never a list of every sample.
(:background)
module Body {
    const BUILD_ID = "2026-11-21b";
    // Today's local date, YYYY-MM-DD. Logic.localDate() is this.
    function date() {
        var i = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return i.year.format("%04d") + "-" + i.month.format("%02d") + "-" + i.day.format("%02d");
    }

    // One sample into 96 fifteen-minute buckets from midnight; the latest
    // sample in a bucket wins. `at` holds each bucket's sample time.
    function bucket(out, at, t, v, midnight) {
        if (v == null || t < midnight) { return; }
        var b = (t - midnight) / 900;
        if (b < 0 || b > 95) { return; }
        if (at[b] == null || t > at[b]) { at[b] = t; out[b] = v.toNumber(); }
    }

    function midnight() {
        var i = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return Gregorian.moment({ :year => i.year, :month => i.month, :day => i.day, :hour => 0, :minute => 0, :second => 0 }).value()
            - System.getClockTime().timeZoneOffset;
    }

    // One SensorHistory series since midnight: [96 buckets, latest value],
    // or null when the watch has none.
    function history(kind, since) {
        try {
            if (!(Toybox has :SensorHistory)) { return null; }
            var opt = { :period => new Time.Duration(Time.now().value() - since + 60), :order => SensorHistory.ORDER_OLDEST_FIRST };
            var it = null;
            if (kind == 0 && SensorHistory has :getBodyBatteryHistory) { it = SensorHistory.getBodyBatteryHistory(opt); }
            else if (kind == 1 && SensorHistory has :getStressHistory) { it = SensorHistory.getStressHistory(opt); }
            if (it == null) { return null; }
            var out = new [96];
            var at = new [96];
            var last = null;
            var s = it.next();
            while (s != null) {
                if (s.data != null && s.when != null && s.when.value() >= since && s.data >= 0 && s.data <= 100) {
                    bucket(out, at, s.when.value(), s.data, since);
                    last = s.data;
                }
                s = it.next();
            }
            return last == null ? null : [out, last];
        } catch (e) {
        }
        return null;
    }

    // All-day heart rate since midnight: the average of each 15-minute bucket
    // (HR history comes every minute or two, so "latest wins" would be a
    // single beat-rate). Null when the watch has none.
    //
    // Also fills `raw` ({ "t", "v", "h" }) with every sample at or after
    // `rawFrom`, unaveraged: seconds from midnight and bpm. At most `rawMax`
    // of them, the newest (see rawAdd). The background process gets a smaller
    // cap than the app: it has 64 KB in all.
    const RAW_MAX = 480;
    const RAW_BG = 120;
    function heartRate(since, rawFrom, raw, rawMax) {
        try {
            if (!(Toybox has :SensorHistory) || !(SensorHistory has :getHeartRateHistory)) { return null; }
            var it = SensorHistory.getHeartRateHistory({ :period => new Time.Duration(Time.now().value() - since + 60), :order => SensorHistory.ORDER_OLDEST_FIRST });
            if (it == null) { return null; }
            var sum = new [96];
            var n = new [96];
            var any = false;
            var s = it.next();
            while (s != null) {
                if (s.data != null && s.when != null && s.data >= 25 && s.data <= 250) {
                    if (s.when.value() >= rawFrom) { rawAdd(raw, s.when.value() - since, s.data.toNumber(), rawMax); }
                    var b = (s.when.value() - since) / 900;
                    if (b >= 0 && b <= 95) {
                        sum[b] = (sum[b] == null ? 0 : sum[b]) + s.data.toNumber();
                        n[b] = (n[b] == null ? 0 : n[b]) + 1;
                        any = true;
                    }
                }
                s = it.next();
            }
            if (!any) { return null; }
            for (var i = 0; i < 96; i++) {
                if (n[i] != null) { sum[i] = (sum[i] + n[i] / 2) / n[i]; }
            }
            return sum;
        } catch (e) {
        }
        return null;
    }

    // Keeps the newest `max` raw samples. The history arrives oldest first,
    // so once full the oldest slot is overwritten and "h" marks the next one.
    function rawAdd(raw, t, v, max) {
        if (raw["t"].size() < max) { raw["t"].add(t); raw["v"].add(v); return; }
        var h = raw["h"];
        raw["t"][h] = t;
        raw["v"][h] = v;
        raw["h"] = (h + 1) % max;
    }

    // Puts the ring back in time order and drops the cursor.
    function rawOrder(raw) {
        var h = raw["h"];
        if (h != null && h > 0) {
            var t = raw["t"].slice(h, null); t.addAll(raw["t"].slice(0, h)); raw["t"] = t;
            var v = raw["v"].slice(h, null); v.addAll(raw["v"].slice(0, h)); raw["v"] = v;
        }
        raw.remove("h");
    }

    function num(v, lo, hi) {
        if (v == null) { return null; }
        var n = v.toNumber();
        return n < lo || n > hi ? null : n;
    }

    function iso(t) {
        var u = Gregorian.utcInfo(new Time.Moment(t), Time.FORMAT_SHORT);
        return u.year.format("%04d") + "-" + u.month.format("%02d") + "-" + u.day.format("%02d") + "T"
            + u.hour.format("%02d") + ":" + u.min.format("%02d") + ":" + u.sec.format("%02d") + "Z";
    }

    function ver(a) {
        if (!(a instanceof Lang.Array)) { return null; }
        var s = "";
        for (var i = 0; i < a.size(); i++) { s += (i == 0 ? "" : ".") + a[i]; }
        return s;
    }

    // The watch itself, for understanding it (POST /daily `diag`): battery,
    // memory, firmware, how the last background run went, and which sensor
    // values it fills in right now. Never shown to the user.
    function diag(now) {
        var d = { "taken_at" => iso(now), "app_version" => BUILD_ID };
        try {
            var s = System.getSystemStats();
            d["battery"] = num(s.battery, 0, 100);
            if (s has :charging) { d["charging"] = s.charging; }
            d["free_mem"] = s.freeMemory;
            d["total_mem"] = s.totalMemory;
        } catch (e) {
        }
        try {
            var ds = System.getDeviceSettings();
            d["part"] = ds.partNumber;
            if (ds has :firmwareVersion) { d["fw"] = ver(ds.firmwareVersion); }
            d["ciq"] = ver(ds.monkeyVersion);
        } catch (e) {
        }
        try {
            var bg = Storage.getValue("bg");
            if (bg instanceof Lang.Array && bg.size() == 2 && bg[0] instanceof Lang.Number) {
                d["prev_bg_at"] = iso(bg[0]);
                d["prev_bg_code"] = bg[1];
            }
            var per = Background.getTemporalEventRegisteredTime();
            if (per instanceof Time.Duration) { d["period_s"] = per.value(); }
            var wk = Storage.getValue("wkhr");
            if (wk instanceof Lang.Array && wk.size() == 4) { d["wk_hr"] = wk; }
        } catch (e) {
        }
        d["probe"] = probe(now);
        var keys = d.keys();
        for (var i = 0; i < keys.size(); i++) {
            if (d[keys[i]] == null) { d.remove(keys[i]); }
        }
        return d;
    }

    // The newest sample of one SensorHistory series that has a value:
    // [value, age in minutes], or -1 empty, -2 threw, -3 not on this firmware.
    // Looks back NEWEST_LOOK samples, because the newest is often blank
    // (stress can't be read while you move) and reading only that one made a
    // full stress history look 79% empty.
    const NEWEST_LOOK = 6;
    function newest(kind, now) {
        if (!(Toybox has :SensorHistory)) { return -3; }
        try {
            var opt = { :period => NEWEST_LOOK, :order => SensorHistory.ORDER_NEWEST_FIRST };
            var it = null;
            if (kind == 0) { if (!(SensorHistory has :getBodyBatteryHistory)) { return -3; } it = SensorHistory.getBodyBatteryHistory(opt); }
            else if (kind == 1) { if (!(SensorHistory has :getStressHistory)) { return -3; } it = SensorHistory.getStressHistory(opt); }
            else if (kind == 2) { if (!(SensorHistory has :getHeartRateHistory)) { return -3; } it = SensorHistory.getHeartRateHistory(opt); }
            else if (kind == 3) { if (!(SensorHistory has :getOxygenSaturationHistory)) { return -3; } it = SensorHistory.getOxygenSaturationHistory(opt); }
            else if (kind == 4) { if (!(SensorHistory has :getTemperatureHistory)) { return -3; } it = SensorHistory.getTemperatureHistory(opt); }
            else { if (!(SensorHistory has :getPressureHistory)) { return -3; } it = SensorHistory.getPressureHistory(opt); }
            if (it == null) { return -1; }
            var s = it.next();
            for (var i = 0; i < NEWEST_LOOK && s != null && s.data == null; i++) { s = it.next(); }
            if (s == null || s.data == null) { return -1; }
            if (s.when == null) { return [s.data, -1]; }
            // A sample stamped after `now` gives a negative age; the server
            // rejects a negative age and so the whole snapshot. Clamp it.
            var age = (now - s.when.value()) / 60;
            return [s.data, age < 0 ? 0 : age];
        } catch (e) {
            return -2;
        }
    }

    // A SpO2 history sample is worth sending when it is under SPO2_MAX_AGE
    // minutes old (and its age is known).
    const SPO2_MAX_AGE = 30;
    function spo2Fresh(ageMin) { return ageMin != null && ageMin >= 0 && ageMin <= SPO2_MAX_AGE; }

    // A live value as a probe entry.
    function live(v) { return v == null ? -1 : [v, 0]; }

    function probe(now) {
        var p = {
            "bb_h" => newest(0, now), "stress_h" => newest(1, now), "hr_h" => newest(2, now),
            "spo2_h" => newest(3, now), "temp_h" => newest(4, now), "press_h" => newest(5, now)
        };
        try {
            var a = ActivityMonitor.getInfo();
            p["resp"] = a has :respirationRate ? live(a.respirationRate) : -3;
            p["stress"] = a has :stressScore ? live(a.stressScore) : -3;
            p["ttr"] = a has :timeToRecovery ? live(a.timeToRecovery) : -3;
        } catch (e) {
            p["resp"] = -2;
        }
        try {
            var i = Sensor.getInfo();
            p["hr"] = live(i.heartRate);
            p["spo2"] = i has :oxygenSaturation ? live(i.oxygenSaturation) : -3;
            p["temp"] = live(i.temperature);
            p["press"] = live(i.pressure);
        } catch (e) {
            p["hr"] = -2;
        }
        try {
            var u = UserProfile.getProfile();
            p["rhr"] = u has :restingHeartRate ? live(u.restingHeartRate) : -3;
            p["avg_rhr"] = u has :averageRestingHeartRate ? live(u.averageRestingHeartRate) : -3;
            p["vo2"] = u has :vo2maxRunning ? live(u.vo2maxRunning) : -3;
        } catch (e) {
            p["rhr"] = -2;
        }
        return p;
    }

    // `source`: "app" with the app open, "background" from Bg.mc.
    function snapshot(source) {
        var m = midnight();
        var day = { "date" => date(), "source" => source };
        // Where on the day's curve the running totals below belong.
        var b = (Time.now().value() - m) / 900;
        if (b >= 0 && b <= 95) { day["bucket"] = b; }
        var bb = history(0, m);
        if (bb != null) {
            day["body_battery"] = bb[0];
            day["body_battery_now"] = num(bb[1], 0, 100);
        }
        bb = null;
        var st = history(1, m);
        if (st != null) { day["stress"] = st[0]; }
        st = null;
        // Raw samples since the last stored snapshot, with a minute of
        // overlap, never more than 4 hours back.
        var dl = Storage.getValue("dl");
        var now = Time.now().value();
        var rawFrom = dl instanceof Lang.Number ? dl - 60 : 0;
        if (rawFrom < now - 4 * 3600) { rawFrom = now - 4 * 3600; }
        var raw = { "t" => [], "v" => [], "h" => 0 };
        day["heart_rate"] = heartRate(m, rawFrom, raw, source.equals("background") ? RAW_BG : RAW_MAX);
        if (raw["t"].size() > 0) { rawOrder(raw); day["hr_raw"] = raw; }
        raw = null;
        day["diag"] = diag(now);
        try {
            var a = ActivityMonitor.getInfo();
            if (a != null) {
                day["steps"] = num(a.steps, 0, 200000);
                if (a has :floorsClimbed) { day["floors"] = num(a.floorsClimbed, 0, 2000); }
                if (a has :activeMinutesDay && a.activeMinutesDay != null) { day["active_minutes"] = num(a.activeMinutesDay.total, 0, 1440); }
                if (a has :timeToRecovery) { day["recovery_hours"] = num(a.timeToRecovery, 0, 200); }
                // Live only: the respiration history comes back empty on
                // this watch, but the live rate is filled in most snapshots.
                if (a has :respirationRate) { day["respiration"] = num(a.respirationRate, 4, 60); }
            }
        } catch (e) {
        }
        try {
            var p = UserProfile.getProfile();
            if (p != null) {
                if (p has :restingHeartRate) { day["resting_hr"] = num(p.restingHeartRate, 20, 150); }
                if (p has :vo2maxRunning) { day["vo2max"] = num(p.vo2maxRunning, 10, 100); }
            }
        } catch (e) {
        }
        // Wrist temperature, one decimal: a weak signal on its own (skin and
        // room together), used by body signals only to back up others.
        try {
            var si = Sensor.getInfo();
            if (si != null && si.temperature != null) {
                var tc = si.temperature.toFloat();
                if (tc > 0 && tc < 50) { day["temperature"] = (tc * 10).toNumber() / 10.0; }
            }
        } catch (e) {
        }
        // SpO2 from the newest history sample, and only a recent one: the live
        // Sensor value is the last reading the watch took, and the diagnostics
        // showed it holding at one number for nine hours after the history
        // had nothing newer. Left out, the server keeps the day's last value.
        var ox = newest(3, now);
        if (ox instanceof Lang.Array && spo2Fresh(ox[1])) { day["spo2"] = num(ox[0], 50, 100); }
        // The server is strict about shapes: leave nulls out entirely.
        var keys = day.keys();
        for (var i = 0; i < keys.size(); i++) {
            if (day[keys[i]] == null) { day.remove(keys[i]); }
        }
        return day;
    }
}
