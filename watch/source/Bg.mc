using Toybox.Application.Storage;
using Toybox.Background;
using Toybox.Communications;
using Toybox.System;
using Toybox.Time;

// Background day sync: with the app closed, the watch wakes this every
// EVERY seconds and sends the day's snapshot (Body.snapshot) to POST /daily,
// so Charge on the web is fresh without opening the app. Costs one short
// radio burst through the phone each time.
//
// A background process gets 64 KB for code and data together. Only what is
// marked (:background) is loaded: this, Body, Secrets and the app class.
// Nothing here may touch Net, Workout, Store or the UI.
(:background)
module Bg {
    const EVERY = 7200;          // 2 h; Connect IQ allows 5 min at the least
    const MIN_GAP = 1800;        // skip if a snapshot went out this recently

    // Called from the foreground on every launch. Registering again with
    // the same period is skipped so the 2 h rhythm isn't restarted.
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
    function initialize() { ServiceDelegate.initialize(); }

    function onTemporalEvent() {
        var last = Storage.getValue("dl");
        var now = Time.now().value();
        if (!System.getDeviceSettings().phoneConnected || (last != null && now - last < Bg.MIN_GAP)) {
            Background.exit(null);
            return;
        }
        Communications.makeWebRequest(Secrets.API_BASE + "/daily", Body.snapshot(), {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Authorization" => "Bearer " + Secrets.TOKEN,
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, method(:onDone));
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
        Background.exit(code);
    }
}
