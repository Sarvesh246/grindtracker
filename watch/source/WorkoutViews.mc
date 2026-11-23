using Toybox.Lang;
using Toybox.Attention;
using Toybox.Graphics;
using Toybox.System;
using Toybox.WatchUi;

// The workout screen the app clock refreshes each second (GrindApp.onTick).
// Screens don't own timers: the watch allows only 3 running at once, and a
// screen shown twice without onHide used to leak one, which crashed the app
// when the rep analyser started its own a few seconds into a set.
module Clock {
    var view = null;
}

// Screens that refresh once a second while visible (heart rate, countdown).
class TickView extends WatchUi.View {
    var hr = null;

    function initialize() { View.initialize(); }

    function onShow() {
        Clock.view = self;
        if (Workout.setRunning() && !Workout.setEnded() && !Reps.manual) { Reps.start(); }
    }

    function onHide() {
        if (Clock.view == self) { Clock.view = null; }
    }

    function onSecond() {
        hr = Recorder.readHr();
        WatchUi.requestUpdate();
    }
}

// ---------------------------------------------------------------------------
// SET LOGGING
// ---------------------------------------------------------------------------

class SetView extends TickView {
    var displayedOffer = null;
    var fieldDivider = 0.5;
    function initialize() { TickView.initialize(); }

    function onSecond() {
        if (Reps.finalCountReady(System.getTimer())) {
            Workout.reviewSet(Reps.job == null ? Reps.offer() : null);
        }
        TickView.onSecond();
    }

    function onUpdate(dc) {
        var c = Workout.cur;
        if (c == null) { return; }
        var e = Workout.ex();
        var unit = Workout.meta["u"];
        // The rep counter's number, once it is sure, unless you've set reps
        // yourself this set. Not saved until the set is logged.
        var reviewing = Workout.setEnded() && Reps.finishBy == null;
        var auto = reviewing ? c["reviewAuto"] : Reps.offer();
        displayedOffer = auto;
        Draw.clear(dc);
        Draw.status(dc, hr);
        Draw.name(dc, e["name"], Config.FG);

        // Hero: weight and reps, each with its label underneath. The value
        // UP/DOWN changes is lime, number and label both.
        var w = Logic.fmtLoad(c["w"]);
        var r = (auto == null ? c["r"] : auto).toString();
        var cy = Draw.yAt(dc, 0.50);
        var cx = dc.getWidth() / 2;
        var xw = dc.getTextWidthInPixels("x", Graphics.FONT_SMALL);
        var gap = 14;
        // Between the -/+ tap columns.
        var room = Draw.usableW(dc, cy, 0) - 2 * (dc.getWidth() * 0.16).toNumber();
        var fonts = [Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE];
        var font = fonts[fonts.size() - 1];
        for (var i = 0; i < fonts.size(); i++) {
            var total = dc.getTextWidthInPixels(w, fonts[i]) + dc.getTextWidthInPixels(r, fonts[i]) + xw + 2 * gap;
            if (total <= room) { font = fonts[i]; break; }
        }
        var ww = dc.getTextWidthInPixels(w, font);
        var rw = dc.getTextWidthInPixels(r, font);
        var left = cx - (ww + rw + xw + 2 * gap) / 2;
        var rx = left + ww + xw + 2 * gap;
        fieldDivider = (left + ww + rx) / (2.0 * dc.getWidth());
        var vc = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
        dc.setColor(c["f"] == 0 ? Config.ACCENT : Config.FG, Graphics.COLOR_TRANSPARENT);
        dc.drawText(left, cy, font, w, vc);
        dc.setColor(Config.DIM, Graphics.COLOR_TRANSPARENT);
        dc.drawText(left + ww + gap, cy, Graphics.FONT_SMALL, "x", vc);
        dc.setColor(c["f"] == 1 ? Config.ACCENT : Config.FG, Graphics.COLOR_TRANSPARENT);
        dc.drawText(rx, cy, font, r, vc);

        var ly = cy + dc.getFontHeight(font) / 2 + 2;
        var lf = Graphics.FONT_XTINY;
        dc.setColor(c["f"] == 0 ? Config.ACCENT : Config.DIM, Graphics.COLOR_TRANSPARENT);
        dc.drawText(left + ww / 2, ly, lf, c["w"].toFloat() == 0.0 ? "BODYWEIGHT" : unit.toUpper(), Draw.C);
        dc.setColor(c["f"] == 1 ? Config.ACCENT : Config.DIM, Graphics.COLOR_TRANSPARENT);
        dc.drawText(rx + rw / 2, ly, lf, reviewing ? (auto == null ? "REPS" : "AUTO REPS") : Reps.repLabel(), Draw.C);

        // Tap columns.
        dc.setColor(Config.DIM, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() * 0.12, cy, Graphics.FONT_MEDIUM, "-", Draw.C);
        dc.drawText(dc.getWidth() * 0.88, cy, Graphics.FONT_MEDIUM, "+", Draw.C);

        // Set count and the whole rep target on one line; the target is
        // never cut off (shorter forms drop words, never numbers).
        var sn = "Set " + c["sn"] + "/" + e["sets"];
        if (Workout.setRunning()) {
            sn += "  " + Logic.fmtDuration(Logic.clamp((Workout.setEnded() ? c["setEnd"] : Workout.now()) - c["setAt"], 0, 86400));
        }
        var bare = Logic.bareTarget(e);
        Draw.fit(dc, 0.755, [Graphics.FONT_SMALL, Graphics.FONT_TINY],
            [sn + "  ·  " + Logic.repsText(e), sn + "  ·  " + bare, sn], Config.FG);
        var other = c["f"] == 0 ? "Reps" : "Weight";
        var action = Reps.finishBy != null ? "Checking final reps"
            : reviewing ? "BACK " + other + "  ·  START Log"
            : Workout.setRunning() ? "START to finish set"
            : (c["f"] == 0 ? "START for reps" : "BACK Weight  ·  START Begin");
        Draw.line(dc, 0.845, [Graphics.FONT_XTINY], action, Config.DIM);
        Draw.segments(dc, Workout.sets.size(), Workout.totalSets(), Config.ACCENT);
        Draw.startCue(dc, Config.FG);
        Draw.debug(dc);
    }
}

class SetDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }

    function current() {
        if (!Workout.active() || Workout.inRest() || Workout.atSummary()) { return null; }
        var v = WatchUi.getCurrentView()[0];
        return v instanceof SetView ? v : null;
    }

    function bump(dir) {
        var v = current();
        if (v == null || Reps.finishBy != null) { return true; }
        var shown = Workout.setEnded() ? Workout.cur["reviewAuto"] : v.displayedOffer;
        Workout.adjust(dir, shown);
        WatchUi.requestUpdate();
        return true;
    }

    // START advances from setup to lifting, review, and logging.
    function onSelect() {
        var view = current();
        if (view == null) { return true; }
        if (Reps.finishBy != null) { return true; }
        if (Workout.setEnded()) {
            return saveSet(Workout.cur["reviewAuto"]);
        }
        if (!Workout.setRunning() && Workout.cur["f"] == 0) {
            Workout.setFocus(1);
            WatchUi.requestUpdate();
            return true;
        }
        if (!Workout.setRunning()) {
            view.displayedOffer = null;
            Workout.beginSet();
            Nav.buzz(55);
            WatchUi.requestUpdate();
            return true;
        }
        Workout.endSetMotion();
        if (!Reps.checkFinalCount()) {
            Workout.reviewSet(Reps.countSettled ? Reps.offer() : null);
        }
        WatchUi.requestUpdate();
        return true;
    }

    function saveSet(offered) {
        Workout.logDisplayedSet(offered);
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
    // numbers in the middle select their own field.
    function onTap(evt) {
        var v = current();
        if (v == null || Reps.finishBy != null) { return true; }
        var xy = evt.getCoordinates();
        var size = System.getDeviceSettings().screenWidth;
        var y = xy[1].toFloat() / size;
        var x = xy[0].toFloat() / size;
        if (y < 0.40 || y > 0.68) { return true; }
        if (x < 0.25) { return bump(-1); }
        if (x > 0.75) { return bump(1); }
        Workout.setFocus(x < v.fieldDivider ? 0 : 1);
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() {
        if (current() == null || Reps.finishBy != null) { return true; }
        if (Workout.setEnded() || (!Workout.setRunning() && Workout.cur["f"] == 1)) {
            Workout.setFocus(1 - Workout.cur["f"]);
            WatchUi.requestUpdate();
            return true;
        }
        return Menus.pause(true);
    }

    function onMenu() {
        if (current() == null || Reps.finishBy != null || Workout.setEnded()) { return true; }
        return Menus.pause(true);
    }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

class RestView extends TickView {
    function initialize() { TickView.initialize(); }

    function onSecond() {
        if (Workout.active() && !Workout.inRest()) {
            Nav.show();
            return;
        }
        TickView.onSecond();
        // Smart rest (Settings -> Watch in GRIND): a short double buzz the
        // moment HR has come back down. The timer keeps running; START goes.
        if (Workout.cur != null && Workout.inRest() && Store.smartRest() && Hr.justRecovered(Workout.restElapsed())) {
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(60, 150), new Attention.VibeProfile(0, 120), new Attention.VibeProfile(60, 150)]);
            }
        }
    }

    function onUpdate(dc) {
        var c = Workout.cur;
        if (c == null) { return; }
        var e = Workout.ex();
        var left = Workout.inRest() ? Workout.restLeft() : 0;
        if (left < 0) { left = 0; }
        Draw.clear(dc);
        Draw.status(dc, hr);
        var rec = Store.smartRest() && Hr.recoveredNow(Workout.restElapsed());
        var label = rec ? "RECOVERED" : "REST";
        Draw.fit(dc, 0.265, [Graphics.FONT_TINY, Graphics.FONT_XTINY],
            [label + "  ·  " + Workout.lastRepLabel(), label], rec ? Config.ACCENT : Config.DIM);
        Draw.line(dc, 0.455, [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM], Logic.fmtDuration(left), Config.FG);
        // What's next, so you can load the bar while you wait.
        var load = Logic.fmtLoad(c["w"]) + (c["w"].toFloat() == 0.0 ? "" : " " + Workout.meta["u"]) + "  x  " + c["r"];
        Draw.line(dc, 0.655, [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL], load, Config.FG);
        Draw.line(dc, 0.745, [Graphics.FONT_TINY, Graphics.FONT_XTINY], e["name"], Config.DIM);
        var setTxt = "Set " + c["sn"] + "/" + e["sets"];
        if (hr != null && Hr.lastPeak != null && Hr.lastPeak > hr) {
            Draw.fit(dc, 0.825, [Graphics.FONT_XTINY], [setTxt + "   HR down " + (Hr.lastPeak - hr), setTxt], Config.DIM);
        } else {
            Draw.line(dc, 0.825, [Graphics.FONT_XTINY], setTxt, Config.DIM);
        }
        Draw.ring(dc, Workout.inRest() ? Workout.restFrac() : 0.0, rec ? Config.ACCENT : Config.FG);
        Draw.startCue(dc, Config.FG);
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
        if (!Workout.inRest()) { return true; }
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
        if (Workout.saved) { Draw.line(dc, 0.13, [Graphics.FONT_XTINY], Draw.clock(), Config.DIM); } else { Draw.status(dc, null); }
        Draw.line(dc, 0.265, [Graphics.FONT_TINY], Workout.saved ? "SAVED" : "WORKOUT DONE", Workout.saved ? Config.ACCENT : Config.DIM);
        Draw.line(dc, 0.41, [Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE], Logic.fmtDuration(s["dur"]), Config.FG);

        // Three columns: sets, volume, average heart rate.
        var w = dc.getWidth();
        var vy = Draw.yAt(dc, 0.555);
        var ly = Draw.yAt(dc, 0.64);
        var xs = [w * 0.25, w * 0.50, w * 0.75];
        var vals = [s["sets"].toString(), Logic.fmtThousands(s["vol"].toNumber()), s["hr"] == null ? "--" : s["hr"].toString()];
        var labs = ["SETS", s["unit"].toUpper(), "AVG HR"];
        for (var i = 0; i < 3; i++) {
            dc.setColor(Config.FG, Graphics.COLOR_TRANSPARENT);
            dc.drawText(xs[i], vy, dc.getTextWidthInPixels(vals[i], Graphics.FONT_SMALL) > w * 0.22 ? Graphics.FONT_TINY : Graphics.FONT_SMALL, vals[i], Draw.C);
            dc.setColor(Config.DIM, Graphics.COLOR_TRANSPARENT);
            dc.drawText(xs[i], ly, Graphics.FONT_XTINY, labs[i], Draw.C);
        }
        if (s["lastReps"] != null) {
            Draw.line(dc, 0.71, [Graphics.FONT_XTINY], "Last set  ·  " + s["lastReps"], Config.DIM);
        }

        if (Workout.saved) {
            // The server's answer once it lands: the XP this earned.
            var res = Store.get("lx");
            if (res instanceof Lang.Dictionary && s["sid"] != null && s["sid"].equals(res["sid"]) && res["xp"] != null) {
                var line = "+" + res["xp"] + " XP";
                if (res["st"] != null && res["st"] > 1) { line += "  ·  " + res["st"] + "-day streak"; }
                Draw.fit(dc, 0.785, [Graphics.FONT_SMALL, Graphics.FONT_TINY], [line, "+" + res["xp"] + " XP"], Config.ACCENT);
            } else {
                Draw.line(dc, 0.785, [Graphics.FONT_XTINY], gNet.workoutStatus(s["sid"]), gNet.statusColor());
            }
        } else {
            var y = Draw.yAt(dc, 0.785);
            dc.setColor(sel == 0 ? Config.ACCENT : Config.DIM, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.34, y, Graphics.FONT_SMALL, "Save", Draw.C);
            dc.setColor(sel == 1 ? Config.WARN : Config.DIM, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.66, y, Graphics.FONT_SMALL, "Discard", Draw.C);
            // A dot under the choice START will act on.
            dc.setColor(sel == 0 ? Config.ACCENT : Config.WARN, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(sel == 0 ? w * 0.34 : w * 0.66, y + dc.getFontHeight(Graphics.FONT_SMALL) / 2 + 6, 3);
        }
        Draw.ring(dc, 1.0, Config.ACCENT);
        Draw.startCue(dc, Config.FG);
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
        return v == null ? true : act(v.sel);
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
