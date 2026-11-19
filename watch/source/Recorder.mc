using Toybox.Activity;
using Toybox.ActivityRecording;
using Toybox.Application.Storage;
using Toybox.Sensor;
using Toybox.System;

// Garmin activity (timer + heart rate, shows up in Garmin Connect). Every
// call is guarded: if recording is unavailable or throws, the workout and
// its sets carry on and still sync to GRIND.
module Recorder {
    var session = null;
    var hrSum = 0;
    var hrN = 0;
    var hrMax = 0;
    // This workout's heart-rate reads: [reads, misses, from the recording,
    // from the sensor fallback]. The one watch workout before these existed
    // logged zero seconds in every zone, so the next diagnostics snapshot
    // carries them (Body.diag, "wk_hr") to show where readings come from.
    var wk = [0, 0, 0, 0];

    function start() {
        hrSum = 0; hrN = 0; hrMax = 0;
        wk = [0, 0, 0, 0];
        enableHr(true);
        ensureRecording();
    }

    // Nothing else turns the optical sensor on: Activity info only carries a
    // heart rate while the recording has one, and the fallback in readHr
    // needs the sensor itself running.
    function enableHr(on) {
        try {
            if (Toybox has :Sensor && Sensor has :setEnabledSensors) {
                Sensor.setEnabledSensors(on ? [Sensor.SENSOR_HEARTRATE] : []);
            }
        } catch (e) {
            System.println("hr sensor failed: " + e.getErrorMessage());
        }
    }

    function ensureRecording() {
        try {
            if (Toybox has :ActivityRecording && session == null) {
                session = ActivityRecording.createSession({
                    :name => "GRIND",
                    :sport => Activity.SPORT_TRAINING,
                    :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING
                });
                session.start();
            }
        } catch (e) {
            System.println("rec start failed: " + e.getErrorMessage());
            session = null;
        }
    }

    // Current heart rate or null: the recording's, else the sensor's own.
    // `src` gets 1 for the recording, 2 for the sensor.
    function readFrom(src) {
        var hr = null;
        try {
            var info = Activity.getActivityInfo();
            if (info != null) { hr = info.currentHeartRate; }
        } catch (e) {
            hr = null;
        }
        if (Logic.validHr(hr)) { src[0] = 1; return hr; }
        try {
            var s = Sensor.getInfo();
            if (s != null) { hr = s.heartRate; }
        } catch (e) {
            hr = null;
        }
        if (Logic.validHr(hr)) { src[0] = 2; return hr; }
        return null;
    }

    function readHr() { return readFrom([0]); }

    // One workout reading. Also feeds our own average, used when the
    // activity doesn't report one (recording failed, or resumed after a crash).
    function sampleHr() {
        var src = [0];
        var hr = readFrom(src);
        wk[0] += 1;
        if (hr == null) { wk[1] += 1; } else { wk[1 + src[0]] += 1; }
        if (hr != null) {
            hrSum += hr; hrN += 1;
            if (hr > hrMax) { hrMax = hr; }
            return hr;
        }
        return null;
    }

    // { "ha" avg, "hm" max, "cal" calories }, any of them possibly null.
    function stats() {
        var out = { "ha" => null, "hm" => null, "cal" => null };
        try {
            var info = Activity.getActivityInfo();
            if (info != null && session != null) {
                out["ha"] = info.averageHeartRate;
                out["hm"] = info.maxHeartRate;
                out["cal"] = info.calories;
            }
        } catch (e) {
        }
        if (out["ha"] == null && hrN > 0) { out["ha"] = hrSum / hrN; }
        if (out["hm"] == null && hrMax > 0) { out["hm"] = hrMax; }
        return out;
    }

    // Garmin's aerobic training effect (0-5) for the session so far, or null.
    function trainingEffect() {
        try {
            var info = Activity.getActivityInfo();
            if (info != null && session != null && info has :trainingEffect) { return info.trainingEffect; }
        } catch (e) {
        }
        return null;
    }

    // Garmin's own strength screen ("Set 1") numbers sets by lap, and a
    // Connect IQ session has no other way to tell it a set ended. One lap
    // per logged set keeps its count in step; each lap in Garmin Connect is
    // then that set plus the rest after it.
    function setLogged() {
        if (session == null) { return; }
        try {
            if (session.isRecording()) { session.addLap(); }
        } catch (e) {
            System.println("rec lap failed: " + e.getErrorMessage());
        }
    }

    // Kept for the next day snapshot's diagnostics.
    function saveCounts() {
        try {
            if (wk[0] > 0) { Storage.setValue("wkhr", wk); }
        } catch (e) {
        }
    }

    function stop(save) {
        saveCounts();
        enableHr(false);
        if (session == null) { return; }
        try {
            if (session.isRecording()) { session.stop(); }
            if (save) { session.save(); } else { session.discard(); }
        } catch (e) {
            System.println("rec stop failed: " + e.getErrorMessage());
        }
        session = null;
    }
}
