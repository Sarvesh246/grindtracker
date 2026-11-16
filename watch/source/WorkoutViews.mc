using Toybox.Graphics;
using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;

// Screens that refresh once a second while visible (heart rate, countdown).
class TickView extends WatchUi.View {
    var timer = null;
    var hr = null;

    function initialize() { View.initialize(); }

    function onShow() {
        timer = new Timer.Timer();
        timer.start(method(:onSecond), 1000, true);
    }

    function onHide() {
        if (timer != null) { timer.stop(); timer = null; }
    }

    function onSecond() {
        hr = Recorder.sampleHr();
        WatchUi.requestUpdate();
    }
}

// ---------------------------------------------------------------------------
// SET LOGGING
// ---------------------------------------------------------------------------

class SetView extends TickView {
    function initialize() { TickView.initialize(); }

    function onUpdate(dc) {
        var c = Workout.cur;
        if (c == null) { return; }
        var e = Workout.ex();
        var unit = Workout.meta["u"];
        Draw.clear(dc);
        Draw.status(dc, hr);
        Draw.name(dc, e["name"], Config.FG);

        // Hero: weight x reps. Biggest number font that leaves room for the
        // -/+ tap columns on either side.
        var w = Logic.fmtWeight(c["w"]);
        var r = c["r"].toString();
        var cy = Draw.yAt(dc, 0.54);
        var cx = dc.getWidth() / 2;
        var fonts = [Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE];
        var room = dc.getWidth() / 2 - 2 * Draw.MARGIN; // the middle half, between the tap columns
        var font = fonts[fonts.size() - 1];
        var gap = 0;
        var xw = 0;
        for (var i = 0; i < fonts.size(); i++) {
            xw = dc.getTextWidthInPixels("x", Graphics.FONT_SMALL);
            gap = 10;
            var total = dc.getTextWidthInPixels(w, fonts[i]) + dc.getTextWidthInPixels(r, fonts[i]) + xw + 2 * gap;
            if (total <= room + 40) { font = fonts[i]; break; }
        }
        var ww = dc.getTextWidthInPixels(w, font);
        var rw = dc.getTextWidthInPixels(r, font);
        var left = cx - (ww + rw + xw + 2 * gap) / 2;
        var vc = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
        dc.setColor(c["f"] == 0 ? Config.ACCENT : Config.FG, Graphics.COLOR_TRANSPARENT);
        dc.drawText(left, cy, font, w, vc);
        dc.setColor(Config.DIM, Graphics.COLOR_TRANSPARENT);
        dc.drawText(left + ww + gap, cy, Graphics.FONT_SMALL, "x", vc);
        dc.setColor(c["f"] == 1 ? Config.ACCENT : Config.FG, Graphics.COLOR_TRANSPARENT);
        dc.drawText(left + ww + xw + 2 * gap, cy, font, r, vc);

        // Underline marks the value UP/DOWN will change.
        var uy = cy + dc.getFontHeight(font) / 2 - 4;
        var ux = c["f"] == 0 ? left : left + ww + xw + 2 * gap;
        dc.setColor(Config.ACCENT, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        dc.drawLine(ux, uy, ux + (c["f"] == 0 ? ww : rw), uy);
        dc.setPenWidth(1);

        // Tap columns.
        dc.setColor(Config.DIM, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() * 0.09, cy, Graphics.FONT_MEDIUM, "-", Draw.C);
        dc.drawText(dc.getWidth() * 0.91, cy, Graphics.FONT_MEDIUM, "+", Draw.C);

        Draw.line(dc, 0.715, [Graphics.FONT_SMALL], "Set " + c["sn"] + "/" + e["sets"], Config.FG);
        Draw.line(dc, 0.808, [Graphics.FONT_XTINY], target(e, unit), Config.DIM);
        Draw.hint(dc, c["f"] == 0 ? "START: reps" : "START: log");
        Draw.ring(dc, Workout.progress(), Config.ACCENT);
        Draw.debug(dc);
    }

    function target(e, unit) {
        var reps = e["reps"] == null ? "AMRAP" : e["reps"].toString();
        if (e["reps"] != null && e["reps_max"] != null) { reps += "-" + e["reps_max"]; }
        if (e["weight"] == null) { return "Target " + reps + " reps"; }
        return "Target " + Logic.fmtWeight(e["weight"]) + " " + unit + " x " + reps;
    }
}

class SetDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }

    function bump(dir) {
        Workout.adjust(dir);
        WatchUi.requestUpdate();
        return true;
    }

    // START: weight -> reps -> log. A new exercise starts on weight; later
    // sets start on reps, so they take one press.
    function onSelect() {
        if (Workout.cur["f"] == 0) {
            Workout.setFocus(1);
            WatchUi.requestUpdate();
            return true;
        }
        Workout.logSet();
        Nav.buzz(120);
        Nav.show();
        return true;
    }

    function onPreviousPage() { return bump(1); }   // UP
    function onNextPage() { return bump(-1); }      // DOWN

    function onSwipe(evt) {
        var d = evt.getDirection();
        if (d == WatchUi.SWIPE_UP) { return bump(1); }
        if (d == WatchUi.SWIPE_DOWN) { return bump(-1); }
        return true; // sideways swipes do nothing mid-workout
    }

    // Center zone, three columns: left quarter -1, right quarter +1, and the
    // numbers in the middle switch between weight and reps.
    function onTap(evt) {
        var xy = evt.getCoordinates();
        var size = System.getDeviceSettings().screenWidth;
        var y = xy[1].toFloat() / size;
        var x = xy[0].toFloat() / size;
        if (y < 0.40 || y > 0.68) { return true; }
        if (x < 0.25) { return bump(-1); }
        if (x > 0.75) { return bump(1); }
        Workout.setFocus(1 - Workout.cur["f"]);
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() { return Menus.pause(true); }
    function onMenu() { return Menus.pause(true); }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

class RestView extends TickView {
    function initialize() { TickView.initialize(); }

    function onSecond() {
        if (Workout.cur != null && Workout.inRest() && Workout.restLeft() <= 0) {
            Workout.endRest();
            Nav.buzz(600);
            Nav.show();
            return;
        }
        TickView.onSecond();
    }

    function onUpdate(dc) {
        var c = Workout.cur;
        if (c == null || !Workout.inRest()) { return; }
        var e = Workout.ex();
        var left = Workout.restLeft();
        if (left < 0) { left = 0; }
        Draw.clear(dc);
        Draw.status(dc, hr);
        Draw.line(dc, 0.30, [Graphics.FONT_TINY], "REST", Config.DIM);
        Draw.line(dc, 0.52, [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM], Logic.fmtDuration(left), Config.FG);
        Draw.line(dc, 0.725, [Graphics.FONT_TINY, Graphics.FONT_XTINY], "Next: " + e["name"], Config.FG);
        Draw.line(dc, 0.81, [Graphics.FONT_XTINY], "set " + c["sn"] + "/" + e["sets"], Config.DIM);
        Draw.hint(dc, "START: skip");
        Draw.ring(dc, Workout.restFrac(), Config.ACCENT);
        Draw.debug(dc);
    }
}

class RestDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }

    function add(secs) {
        Workout.adjustRest(secs);
        WatchUi.requestUpdate();
        return true;
    }

    function skip() {
        Workout.endRest();
        Nav.buzz(60);
        Nav.show();
        return true;
    }

    // START skips rest. A tap doesn't: a brushed screen shouldn't cut rest short.
    function onSelect() { return skip(); }
    function onTap(evt) { return true; }
    function onPreviousPage() { return add(Config.REST_STEP); }
    function onNextPage() { return add(-Config.REST_STEP); }

    function onSwipe(evt) {
        var d = evt.getDirection();
        if (d == WatchUi.SWIPE_UP) { return add(Config.REST_STEP); }
        if (d == WatchUi.SWIPE_DOWN) { return add(-Config.REST_STEP); }
        return true;
    }

    function onBack() { return Menus.pause(false); }
    function onMenu() { return Menus.pause(false); }
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

class SummaryView extends WatchUi.View {
    var sel = 0; // 0 Save, 1 Discard

    function initialize() { View.initialize(); }

    function onUpdate(dc) {
        var s = Workout.summary();
        if (s == null) { return; }
        Draw.clear(dc);
        // Once saved, the sync state gets its own line, so the top row is just the clock.
        if (Workout.saved) { Draw.line(dc, 0.15, [Graphics.FONT_XTINY], Draw.clock(), Config.DIM); } else { Draw.status(dc, null); }
        Draw.line(dc, 0.27, [Graphics.FONT_TINY], Workout.saved ? "SAVED" : "WORKOUT DONE", Workout.saved ? Config.ACCENT : Config.DIM);
        Draw.line(dc, 0.42, [Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE], Logic.fmtDuration(s["dur"]), Config.FG);
        Draw.line(dc, 0.565, [Graphics.FONT_SMALL, Graphics.FONT_TINY],
            s["sets"] + " sets  " + s["vol"].toNumber().toString() + " " + s["unit"], Config.FG);
        Draw.line(dc, 0.655, [Graphics.FONT_XTINY], s["hr"] == null ? "avg HR --" : "avg HR " + s["hr"], Config.DIM);

        if (Workout.saved) {
            Draw.line(dc, 0.775, [Graphics.FONT_XTINY], gNet.status(), gNet.statusColor());
            Draw.hint(dc, "START: done");
        } else {
            var y = Draw.yAt(dc, 0.775);
            var w = dc.getWidth();
            dc.setColor(sel == 0 ? Config.ACCENT : Config.DIM, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.34, y, Graphics.FONT_SMALL, "Save", Draw.C);
            dc.setColor(sel == 1 ? Config.WARN : Config.DIM, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.66, y, Graphics.FONT_SMALL, "Discard", Draw.C);
            Draw.hint(dc, "START");
        }
        Draw.ring(dc, 1.0, Config.ACCENT);
        Draw.debug(dc);
    }
}

class SummaryDelegate extends WatchUi.BehaviorDelegate {
    var view;

    function initialize() { BehaviorDelegate.initialize(); }

    function act(sel) {
        if (Workout.saved || !Workout.active()) {
            Workout.saved = false;
            Nav.show(); // back to Home
            return true;
        }
        if (sel == 1) { return Menus.confirmDiscard(true); }
        if (Workout.sets.size() == 0) {
            // Nothing logged: the server would refuse an empty workout.
            Workout.finish(false);
            Nav.show();
            return true;
        }
        Workout.finish(true);
        Nav.buzz(200);
        gNet.kick(); // sync trigger 2 of 3: right after Save
        WatchUi.requestUpdate();
        return true;
    }

    function current() {
        var v = WatchUi.getCurrentView()[0];
        return v instanceof SummaryView ? v : null;
    }

    function toggle() {
        var v = current();
        if (v != null && !Workout.saved) { v.sel = 1 - v.sel; }
        WatchUi.requestUpdate();
        return true;
    }

    function onSelect() {
        var v = current();
        return act(v == null ? 0 : v.sel);
    }

    function onPreviousPage() { return toggle(); }
    function onNextPage() { return toggle(); }

    // Lower zone: left half Save, right half Discard.
    function onTap(evt) {
        if (Workout.saved) { return act(0); }
        var xy = evt.getCoordinates();
        var size = System.getDeviceSettings().screenWidth;
        if (xy[1].toFloat() / size < 0.70) { return true; }
        return act(xy[0] < size / 2 ? 0 : 1);
    }

    // BACK never drops a workout. After saving it goes Home. Before that it
    // returns to logging if there are sets left; otherwise it offers
    // Save / Discard rather than doing nothing.
    function onBack() {
        if (Workout.saved || !Workout.active()) { return act(0); }
        if (Workout.canLeaveSummary()) {
            Workout.leaveSummary();
            Nav.show();
            return true;
        }
        return Menus.finish();
    }

    function onMenu() { return true; }
}
