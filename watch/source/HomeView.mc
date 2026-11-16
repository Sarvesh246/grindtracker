using Toybox.Graphics;
using Toybox.Timer;
using Toybox.WatchUi;

// Which workout day Home is offering. Starts as the day GRIND says is up
// next; UP/DOWN scroll through the user's other days. Lives for the session.
module Pick {
    var id = null;      // null = the default
    var want = false;   // START was pressed before that day's plan arrived

    function defaultId() {
        var wk = Store.today();
        return wk == null ? null : wk["id"];
    }

    function currentId() { return id != null ? id : defaultId(); }

    function indexOf(days, did) {
        if (did == null) { return -1; }
        for (var i = 0; i < days.size(); i++) {
            if (did.equals(days[i]["id"])) { return i; }
        }
        return -1;
    }

    function nameOf(did) {
        var d = Store.days();
        var i = d == null ? -1 : indexOf(d, did);
        return i >= 0 ? d[i]["name"] : did;
    }

    // Scroll one day. False if there is nothing to scroll to.
    function step(dir) {
        var d = Store.days();
        if (d == null) { return false; }
        var n = d.size();
        var cur = indexOf(d, currentId());
        if (n < 2 && cur >= 0) { return false; }
        var next = cur < 0 ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n;
        id = d[next]["id"];
        want = false;
        return true;
    }

    function begin(plan) {
        id = null;
        want = false;
        Workout.start(plan);
        Nav.buzz(80);
        Nav.show();
    }

    // A fetched day arrived. If START was already pressed for it, go.
    function arrived(did, ok) {
        if (!want || did == null || !did.equals(currentId())) { return; }
        want = false;
        var plan = ok ? Store.planFor(did) : null;
        if (plan != null && plan["ex"].size() > 0 && WatchUi.getCurrentView()[0] instanceof HomeView) {
            begin(plan);
        }
    }
}

class HomeView extends WatchUi.View {
    function initialize() { View.initialize(); }

    function onUpdate(dc) {
        Draw.clear(dc);
        // Home spells the sync state out lower down, so the top row is just the clock.
        Draw.line(dc, 0.15, [Graphics.FONT_XTINY], Draw.clock(), Config.DIM);
        var title = [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL];
        var small = [Graphics.FONT_XTINY];

        if (Workout.active()) {
            Draw.line(dc, 0.31, small, "UNFINISHED WORKOUT", Config.DIM);
            Draw.line(dc, 0.50, title, Workout.meta["nm"], Config.FG);
            Draw.line(dc, 0.65, [Graphics.FONT_TINY], Workout.sets.size() + " sets logged", Config.DIM);
            Draw.hint(dc, "START");
        } else {
            var wk = Store.today();
            var days = Store.days();
            var did = Pick.currentId();
            if (wk == null) {
                Draw.line(dc, 0.47, title, "No workout", Config.FG);
                Draw.line(dc, 0.63, [Graphics.FONT_TINY, Graphics.FONT_XTINY],
                    gNet.connected() ? "MENU to load" : "Connect phone to load", Config.DIM);
            } else if (did == null) {
                // Rest day or no plan, and nothing chosen.
                var rest = wk["reason"] != null && wk["reason"].equals("rest_day");
                Draw.line(dc, 0.47, title, rest ? "Rest day" : "No workout today", Config.FG);
                if (days != null) { Draw.line(dc, 0.63, [Graphics.FONT_XTINY], "UP/DOWN: train anyway", Config.DIM); }
            } else {
                var plan = Store.planFor(did);
                var isDefault = did.equals(Pick.defaultId());
                var pos = "";
                if (days != null && days.size() > 1) {
                    pos = "  " + (Pick.indexOf(days, did) + 1) + "/" + days.size();
                }
                Draw.line(dc, 0.31, small, (isDefault ? "TODAY" : "CHOSEN") + pos, Config.DIM);
                Draw.line(dc, 0.50, title, Pick.nameOf(did), Config.FG);
                var sub;
                if (plan != null) { sub = plan["ex"].size() + " exercises"; }
                else if (Pick.want || gNet.busy) { sub = "loading..."; }
                else if (!gNet.connected()) { sub = "Connect phone to load"; }
                else { sub = "START to load"; }
                Draw.line(dc, 0.65, [Graphics.FONT_TINY, Graphics.FONT_XTINY], sub, Config.DIM);
                Draw.hint(dc, "START");
            }
            if (days != null && (days.size() > 1 || did == null)) { Draw.scrollArrows(dc); }
        }
        Draw.line(dc, 0.78, small, gNet.homeStatus(), gNet.statusColor());
        Draw.ring(dc, 0.0, Config.ACCENT);
        Draw.debug(dc);
    }
}

class HomeDelegate extends WatchUi.BehaviorDelegate {
    var prefetch = null;

    function initialize() { BehaviorDelegate.initialize(); }

    function go() {
        if (Workout.active()) {
            // Recovered from storage after a crash, dead battery or force-quit.
            var m = new WatchUi.Menu2({ :title => "Unfinished" });
            m.addItem(new WatchUi.MenuItem("Resume", null, :resume, null));
            m.addItem(new WatchUi.MenuItem("Discard", null, :discard, null));
            WatchUi.pushView(m, new PauseDelegate(), WatchUi.SLIDE_UP);
            return true;
        }
        var did = Pick.currentId();
        if (did == null) { return true; }
        var plan = Store.planFor(did);
        if (plan != null) {
            if (plan["ex"].size() > 0) { Pick.begin(plan); }
        } else if (gNet.connected()) {
            // Not downloaded yet: fetch it and start the moment it lands.
            Pick.want = true;
            gNet.fetchDay(did);
            WatchUi.requestUpdate();
        }
        return true;
    }

    // UP / DOWN (or a swipe) scroll the days. The chosen day's plan is
    // fetched once the scrolling stops, so START is usually instant.
    function scroll(dir) {
        if (!Workout.active() && Pick.step(dir)) {
            if (prefetch != null) { prefetch.stop(); }
            prefetch = new Timer.Timer();
            prefetch.start(method(:onSettled), 700, false);
            WatchUi.requestUpdate();
        }
        return true;
    }

    function onSettled() {
        var did = Pick.currentId();
        if (did != null && Store.planFor(did) == null) { gNet.fetchDay(did); }
        WatchUi.requestUpdate();
    }

    function onPreviousPage() { return scroll(-1); }   // UP
    function onNextPage() { return scroll(1); }        // DOWN

    // START only. A tap would start a workout (and recording) whenever a
    // sleeve brushes the screen.
    function onSelect() { return go(); }
    function onTap(evt) { return true; }

    // MENU refreshes. If the server has refused a session for good, it opens
    // a menu instead so that state can be cleared.
    function onMenu() {
        var dead = Store.dead().size();
        if (dead == 0) {
            gNet.refresh();
            WatchUi.requestUpdate();
            return true;
        }
        var m = new WatchUi.Menu2({ :title => "GRIND" });
        m.addItem(new WatchUi.MenuItem("Refresh", null, :refresh, null));
        m.addItem(new WatchUi.MenuItem("Clear failed (" + dead + ")", "Deletes unsynced workouts", :clear, null));
        WatchUi.pushView(m, new HomeMenuDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}

class HomeMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        if (item.getId() == :clear) {
            var d = Store.dead();
            for (var i = 0; i < d.size(); i++) { Store.dropSession(d[i]); }
            Store.put("qd", []);
        } else {
            gNet.refresh();
        }
        WatchUi.requestUpdate();
    }
}
