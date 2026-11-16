using Toybox.Graphics;
using Toybox.WatchUi;

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
            if (wk == null) {
                Draw.line(dc, 0.47, title, "No workout", Config.FG);
                Draw.line(dc, 0.63, [Graphics.FONT_TINY, Graphics.FONT_XTINY],
                    gNet.connected() ? "MENU to load" : "Connect phone to load", Config.DIM);
            } else if (wk["ex"] == null) {
                var rest = wk["reason"] != null && wk["reason"].equals("rest_day");
                Draw.line(dc, 0.47, title, rest ? "Rest day" : "No workout today", Config.FG);
            } else {
                Draw.line(dc, 0.31, small, "TODAY", Config.DIM);
                Draw.line(dc, 0.50, title, wk["name"], Config.FG);
                Draw.line(dc, 0.65, [Graphics.FONT_TINY], wk["ex"].size() + " exercises", Config.DIM);
                Draw.hint(dc, "START");
            }
        }
        Draw.line(dc, 0.78, small, gNet.homeStatus(), gNet.statusColor());
        Draw.ring(dc, 0.0, Config.ACCENT);
        Draw.debug(dc);
    }
}

class HomeDelegate extends WatchUi.BehaviorDelegate {
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
        var wk = Store.today();
        if (wk != null && wk["ex"] != null && wk["ex"].size() > 0) {
            Workout.start(wk);
            Nav.buzz(80);
            Nav.show();
        }
        return true;
    }

    function onSelect() { return go(); }
    function onTap(evt) { return go(); }

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
