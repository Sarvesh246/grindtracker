using Toybox.Application.Storage;
using Toybox.Background;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

// Background sync: with the app closed, the watch wakes this every
// EVERY seconds and sends the day's snapshot (Body.snapshot) to POST /daily,
// so Charge on the web is fresh without opening the app. Costs one short
// radio burst through the phone each time.
//
// A background process gets 64 KB for code and data together. Only what is
// marked (:background) is loaded: this, Body, Secrets and the app class.
// Nothing here may touch Net, Workout, Store or the UI.
(:background)
module Bg {
    const EVERY = 900;           // 15 min, one bucket; Connect IQ allows 5 min at the least
    const MIN_GAP = 600;         // skip if the open app sent one this recently

    // Called from the foreground on every launch. Registering again with
    // the same period is skipped so the rhythm isn't restarted; a build with
    // a new EVERY takes over the first time the app is opened.
    function register() {
        try {
            if (!(Toybox has :Background)) { return; }
            var cur = Background.getTemporalEventRegisteredTime();
            if (cur instanceof Time.Duration && cur.value() == EVERY) { return; }
            Background.registerForTemporalEvent(new Time.Duration(EVERY));
        } catch (e) {
            System.println("bg register failed: " + e.getErrorMessage());
        }
    }

    function unregister() {
        try { Background.deleteTemporalEvent(); } catch (e) { }
    }
}

(:background)
class GrindService extends System.ServiceDelegate {
    var sid = null;
    var index = 0;
    var requests = 0;
    var ended = false;

    function initialize() { ServiceDelegate.initialize(); }

    function onTemporalEvent() {
        if (!System.getDeviceSettings().phoneConnected) {
            Background.exit(null);
            return;
        }
        if (!foreground() && selectWorkout() && sendWorkout()) { return; }
        sendDaily();
    }

    function foreground() {
        var fg = Storage.getValue("fg");
        var now = Time.now().value();
        return fg != null && now >= fg && now - fg < 60;
    }

    function selectWorkout() {
        var queue = Storage.getValue("q");
        if (!(queue instanceof Lang.Array) || queue.size() == 0) { return false; }
        var previous = queue.indexOf(Storage.getValue("buLast"));
        for (var i = 1; i <= queue.size(); i++) {
            var id = queue[(previous + i) % queue.size()];
            var count = Storage.getValue("bt_" + id);
            if (count == null || count <= 0 || Storage.getValue("bd_" + id) != null) { continue; }
            var next = Storage.getValue("ba_" + id);
            if (next == null) { next = 0; }
            if (Storage.getValue("bu_" + id + "_" + next) == null) { continue; }
            Storage.setValue("buLast", id);
            sid = id;
            index = next;
            return true;
        }
        return false;
    }

    function sendWorkout() {
        // A service run has a short lifetime. The stored cursor lets a future
        // wake continue even if the OS terminates this one between requests.
        if (requests >= 3 || foreground()) { return false; }
        var packet = Storage.getValue("bu_" + sid + "_" + index);
        if (!(packet instanceof Lang.Dictionary)) { return false; }
        ended = packet["ended_at"] != null;
        requests += 1;
        try {
            Communications.makeWebRequest(Secrets.API_BASE + "/sessions?compact=1", packet, {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => headers(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            }, method(:onWorkout));
            return true;
        } catch (e) {
            return false;
        }
    }

    function onWorkout(code, data) {
        System.println("bg workout " + sid + " batch " + index + " -> " + code);
        if ((code == 200 || code == 201) && data instanceof Lang.Dictionary && data["ok"] == true
            && Storage.getValue("bu_" + sid + "_" + index) != null) {
            if (ended) {
                var session = data["session"];
                if (session instanceof Lang.Dictionary && "completed".equals(session["status"])) {
                    if (data["count"] == Storage.getValue("bt_" + sid) || session["completed_now"] == false) {
                        // A retry after a lost final response can acknowledge
                        // only the final batch once staging has been cleared.
                        data["at"] = Time.now().value();
                        Storage.setValue("bd_" + sid, data);
                    } else {
                        // The server did not confirm all staged sets. Let the
                        // foreground reconcile from the complete local copy.
                        Storage.setValue("bt_" + sid, 0);
                    }
                }
            } else {
                index += 1;
                Storage.setValue("ba_" + sid, index);
                if (sendWorkout()) { return; }
            }
        }
        if (Storage.getValue("bt_" + sid) != null) {
            if (code == 409 && data instanceof Lang.Dictionary && data["error"] instanceof Lang.Dictionary
                && "incomplete_batch".equals(data["error"]["code"])) {
                Storage.setValue("ba_" + sid, 0);
            } else if (code == 409 || code == 422) {
                // Leave an actionable refusal for the foreground retry flow.
                Storage.setValue("bt_" + sid, 0);
            }
        }
        sendDaily();
    }

    function headers() {
        return {
            "Authorization" => "Bearer " + Secrets.TOKEN,
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
        };
    }

    function sendDaily() {
        var last = Storage.getValue("dl");
        var now = Time.now().value();
        if (last != null && now >= last && now - last < Bg.MIN_GAP) {
            Background.exit(null);
            return;
        }
        try {
            Communications.makeWebRequest(Secrets.API_BASE + "/daily", Body.snapshot("background"), {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => headers(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            }, method(:onDone));
        } catch (e) {
            onDone(-1, null);
        }
    }

    // Storage is writable from the background on this watch (CIQ 3.2+).
    // "dl" is the same key the foreground uses, so the two never double up.
    function onDone(code, data) {
        var now = Time.now().value();
        try {
            if (code == 200 || code == 201) { Storage.setValue("dl", now); }
            Storage.setValue("bg", [now, code]);
        } catch (e) {
        }
        System.println("bg daily -> " + code);
        Background.exit(code);
    }
}
