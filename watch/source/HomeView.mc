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

    function reset() {
        id = null;
        want = false;
    }

    // On a low-Charge day, one prompt before the first set offers one set
    // fewer per exercise. One press either way, and only once a day.
    function begin(plan) {
        reset();
        var c = Store.charge();
        var today = Logic.localDate();
        var asked = Store.get("lp");
        if (c != null && "easy".equals(c["b"]) && !today.equals(asked)) {
            Store.put("lp", today);
            var m = new WatchUi.Menu2({ :title => "Charge " + c["s"] + " Easy" });
            m.addItem(new WatchUi.MenuItem("Lighter today", "1 set less per lift", :lighter, null));
            m.addItem(new WatchUi.MenuItem("As planned", null, :planned, null));
            WatchUi.pushView(m, new LighterDelegate(plan), WatchUi.SLIDE_UP);
            return;
        }
        go(plan, false);
    }

    function go(plan, lighter) {
        Workout.start(plan);
        if (lighter) { Workout.trimSets(); }
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
        var charge = Store.charge();

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
                Draw.line(dc, 0.47, title, Pick.nameOf(did), Config.FG);
                var sub;
                if (plan != null) { sub = plan["ex"].size() + " exercises"; }
                else if (Pick.want || gNet.busy) { sub = "loading..."; }
                else if (!gNet.connected()) { sub = "Connect phone to load"; }
                else { sub = "START to load"; }
                if (charge != null && plan != null) {
                    // Charge replaces the exercise count: it's the line that
                    // changes what you do today.
                    Draw.line(dc, 0.615, [Graphics.FONT_TINY, Graphics.FONT_XTINY],
                        "Charge " + charge["s"] + " · " + charge["l"], chargeColor(charge));
                    Draw.line(dc, 0.705, [Graphics.FONT_XTINY], charge["a"], Config.DIM);
                } else {
                    Draw.line(dc, 0.63, [Graphics.FONT_TINY, Graphics.FONT_XTINY], sub, Config.DIM);
                }
                Draw.hint(dc, "START");
            }
            if (days != null && (days.size() > 1 || did == null)) { Draw.scrollArrows(dc); }
        }
        Draw.line(dc, 0.795, small, gNet.homeStatus(), gNet.statusColor());
        // The bezel shows Charge when GRIND has today's score.
        Draw.ring(dc, charge == null || Workout.active() ? 0.0 : charge["s"].toFloat() / 100, chargeColor(charge));
        Draw.debug(dc);
    }

    function chargeColor(c) {
        if (c == null) { return Config.ACCENT; }
        return "easy".equals(c["b"]) ? Config.DIM : Config.ACCENT;
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

class LighterDelegate extends WatchUi.Menu2InputDelegate {
    var plan;

    function initialize(p) {
        Menu2InputDelegate.initialize();
        plan = p;
    }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        Pick.go(plan, item.getId() == :lighter);
    }

    // BACK means "never mind": stay on Home, nothing started.
    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
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
