using Toybox.ActivityMonitor;
using Toybox.Lang;
using Toybox.Sensor;
using Toybox.SensorHistory;
using Toybox.System;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.UserProfile;

// GRIND Body, phase 1: the day's snapshot for POST /daily. Only the values the
// phase 0 probe saw this watch actually fill in: Body Battery and stress
// history, resting HR, recovery time, steps, active minutes, floors, live
// SpO2 and VO2 max. (Respiration and SpO2 history came back empty.)
//
// Also runs in the background service (Bg.mc), which has 64 KB in all, so
// the history is bucketed as it is read: 96 slots per series whatever the
// hour, never a list of every sample.
(:background)
module Body {
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

    function num(v, lo, hi) {
        if (v == null) { return null; }
        var n = v.toNumber();
        return n < lo || n > hi ? null : n;
    }

    function snapshot() {
        var m = midnight();
        var day = { "date" => date() };
        var bb = history(0, m);
        if (bb != null) {
            day["body_battery"] = bb[0];
            day["body_battery_now"] = num(bb[1], 0, 100);
        }
        bb = null;
        var st = history(1, m);
        if (st != null) { day["stress"] = st[0]; }
        st = null;
        try {
            var a = ActivityMonitor.getInfo();
            if (a != null) {
                day["steps"] = num(a.steps, 0, 200000);
                if (a has :floorsClimbed) { day["floors"] = num(a.floorsClimbed, 0, 2000); }
                if (a has :activeMinutesDay && a.activeMinutesDay != null) { day["active_minutes"] = num(a.activeMinutesDay.total, 0, 1440); }
                if (a has :timeToRecovery) { day["recovery_hours"] = num(a.timeToRecovery, 0, 200); }
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
        try {
            var s = Sensor.getInfo();
            if (s != null && s has :oxygenSaturation) { day["spo2"] = num(s.oxygenSaturation, 50, 100); }
        } catch (e) {
        }
        // The server is strict about shapes: leave nulls out entirely.
        var keys = day.keys();
        for (var i = 0; i < keys.size(); i++) {
            if (day[keys[i]] == null) { day.remove(keys[i]); }
        }
        return day;
    }
}
