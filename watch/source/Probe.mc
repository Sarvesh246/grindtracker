using Toybox.Activity;
using Toybox.ActivityMonitor;
using Toybox.Lang;
using Toybox.Sensor;
using Toybox.SensorHistory;
using Toybox.System;
using Toybox.Time;
using Toybox.UserProfile;

// Phase 0 of the GRIND Body plan: find out which sensor values this watch
// actually fills in, before any feature depends on them.
//
// Writes one line per snapshot with System.println. On the watch that lands
// in GARMIN/APPS/LOGS/GRIND.TXT, but only if that file already exists (the
// device never creates it). "-" means the API answered with nothing, "!"
// means it threw, "n/a" means this firmware doesn't have the API.
// History values carry their age in minutes: "62@4" is 62, sampled 4 min ago.
module Probe {
    function log(tag) {
        if (!Config.PROBE) { return; }
        var t = System.getClockTime();
        System.println("probe " + tag + " " + t.hour.format("%02d") + ":" + t.min.format("%02d")
            + " | hist bb=" + hist(0) + " stress=" + hist(1) + " spo2=" + hist(2) + " hr=" + hist(3)
            + " temp=" + hist(4) + " press=" + hist(5)
            + " | day " + day()
            + " | now " + now()
            + " | me " + profile()
            + " | act " + act());
    }

    function n(v) {
        if (v == null) { return "-"; }
        if (v instanceof Lang.Float || v instanceof Lang.Double) { return v.format("%.1f"); }
        return v.toString();
    }

    function hist(kind) {
        if (!(Toybox has :SensorHistory)) { return "n/a"; }
        try {
            var opt = { :period => 1, :order => SensorHistory.ORDER_NEWEST_FIRST };
            var it = null;
            if (kind == 0) { if (!(SensorHistory has :getBodyBatteryHistory)) { return "n/a"; } it = SensorHistory.getBodyBatteryHistory(opt); }
            else if (kind == 1) { if (!(SensorHistory has :getStressHistory)) { return "n/a"; } it = SensorHistory.getStressHistory(opt); }
            else if (kind == 2) { if (!(SensorHistory has :getOxygenSaturationHistory)) { return "n/a"; } it = SensorHistory.getOxygenSaturationHistory(opt); }
            else if (kind == 3) { if (!(SensorHistory has :getHeartRateHistory)) { return "n/a"; } it = SensorHistory.getHeartRateHistory(opt); }
            else if (kind == 4) { if (!(SensorHistory has :getTemperatureHistory)) { return "n/a"; } it = SensorHistory.getTemperatureHistory(opt); }
            else { if (!(SensorHistory has :getPressureHistory)) { return "n/a"; } it = SensorHistory.getPressureHistory(opt); }
            if (it == null) { return "-"; }
            var s = it.next();
            if (s == null || s.data == null) { return "-"; }
            var age = s.when == null ? "?" : ((Time.now().value() - s.when.value()) / 60).toString();
            return n(s.data) + "@" + age;
        } catch (e) {
            return "!";
        }
    }

    // ActivityMonitor: the all-day counters.
    function day() {
        try {
            var i = ActivityMonitor.getInfo();
            if (i == null) { return "-"; }
            var act = i has :activeMinutesDay && i.activeMinutesDay != null ? i.activeMinutesDay.total : null;
            return "steps=" + n(i.steps)
                + " actmin=" + n(act)
                + " floors=" + n(i has :floorsClimbed ? i.floorsClimbed : null)
                + " resp=" + n(i has :respirationRate ? i.respirationRate : null)
                + " stress=" + n(i has :stressScore ? i.stressScore : null)
                + " ttr=" + n(i has :timeToRecovery ? i.timeToRecovery : null);
        } catch (e) {
            return "!";
        }
    }

    // Sensor.getInfo: what the sensors read right now.
    function now() {
        try {
            var i = Sensor.getInfo();
            if (i == null) { return "-"; }
            return "hr=" + n(i.heartRate)
                + " spo2=" + n(i has :oxygenSaturation ? i.oxygenSaturation : null)
                + " temp=" + n(i.temperature)
                + " press=" + n(i.pressure);
        } catch (e) {
            return "!";
        }
    }

    // UserProfile: resting HR, VO2 max, and the HR zones GRIND would colour by.
    function profile() {
        try {
            var p = UserProfile.getProfile();
            var z = "-";
            if (UserProfile has :getHeartRateZones) {
                var zs = UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_GENERIC);
                if (zs != null) {
                    z = "";
                    for (var k = 0; k < zs.size(); k++) { z += (k == 0 ? "" : ",") + n(zs[k]); }
                }
            }
            if (p == null) { return "zones=" + z; }
            return "rhr=" + n(p has :restingHeartRate ? p.restingHeartRate : null)
                + " avgrhr=" + n(p has :averageRestingHeartRate ? p.averageRestingHeartRate : null)
                + " vo2=" + n(p has :vo2maxRunning ? p.vo2maxRunning : null)
                + " zones=" + z;
        } catch (e) {
            return "!";
        }
    }

    // Activity: only meaningful while a workout is recording.
    function act() {
        try {
            var i = Activity.getActivityInfo();
            if (i == null) { return "-"; }
            return "hr=" + n(i.currentHeartRate)
                + " avg=" + n(i.averageHeartRate)
                + " te=" + n(i has :trainingEffect ? i.trainingEffect : null)
                + " cal=" + n(i.calories);
        } catch (e) {
            return "!";
        }
    }
}
