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
module Body {
    function midnight() {
        var i = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return Gregorian.moment({ :year => i.year, :month => i.month, :day => i.day, :hour => 0, :minute => 0, :second => 0 }).value()
            - System.getClockTime().timeZoneOffset;
    }

    // [[epoch, value], ...] since midnight from one SensorHistory series.
    function history(kind, since) {
        var out = [];
        try {
            if (!(Toybox has :SensorHistory)) { return out; }
            var opt = { :period => new Time.Duration(Time.now().value() - since + 60), :order => SensorHistory.ORDER_OLDEST_FIRST };
            var it = null;
            if (kind == 0 && SensorHistory has :getBodyBatteryHistory) { it = SensorHistory.getBodyBatteryHistory(opt); }
            else if (kind == 1 && SensorHistory has :getStressHistory) { it = SensorHistory.getStressHistory(opt); }
            if (it == null) { return out; }
            var s = it.next();
            while (s != null) {
                if (s.data != null && s.when != null && s.data >= 0 && s.data <= 100) {
                    out.add([s.when.value(), s.data]);
                }
                s = it.next();
            }
        } catch (e) {
        }
        return out;
    }

    function num(v, lo, hi) {
        if (v == null) { return null; }
        var n = v.toNumber();
        return n < lo || n > hi ? null : n;
    }

    function snapshot() {
        var m = midnight();
        var bbH = history(0, m);
        var stH = history(1, m);
        var day = { "date" => Logic.localDate() };
        if (bbH.size() > 0) {
            day["body_battery"] = Logic.buckets(bbH, m);
            day["body_battery_now"] = num(bbH[bbH.size() - 1][1], 0, 100);
        }
        if (stH.size() > 0) { day["stress"] = Logic.buckets(stH, m); }
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
