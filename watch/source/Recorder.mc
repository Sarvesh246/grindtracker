using Toybox.Activity;
using Toybox.ActivityRecording;
using Toybox.System;

// Garmin activity (timer + heart rate, shows up in Garmin Connect). Every
// call is guarded: if recording is unavailable or throws, the workout and
// its sets carry on and still sync to GRIND.
module Recorder {
    var session = null;
    var hrSum = 0;
    var hrN = 0;
    var hrMax = 0;

    function start() {
        hrSum = 0; hrN = 0; hrMax = 0;
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

    function isOn() {
        return session != null;
    }

    // Current heart rate or null. Also feeds our own average, used when the
    // activity doesn't report one (recording failed, or resumed after a crash).
    function sampleHr() {
        var hr = null;
        try {
            var info = Activity.getActivityInfo();
            if (info != null) { hr = info.currentHeartRate; }
        } catch (e) {
            hr = null;
        }
        if (hr != null && hr > 0) {
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

    function stop(save) {
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
