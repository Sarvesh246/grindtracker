using Toybox.WatchUi;

// Pause menu and the discard confirm. Both are system Menu2s: fully usable
// with buttons or touch, and they cost almost no app memory.
module Menus {
    function pause(onSetScreen) {
        // Not "Paused": the rest timer and the recording keep running.
        var m = new WatchUi.Menu2({ :title => "Workout" });
        m.addItem(new WatchUi.MenuItem("Resume", null, :resume, null));
        var last = Workout.lastSetLabel();
        if (last != null) {
            m.addItem(new WatchUi.MenuItem("Undo last set", last, :undo, null));
        }
        if (onSetScreen) {
            m.addItem(new WatchUi.MenuItem("Change weight", null, :weight, null));
        }
        if (Workout.pickable().size() > 1 || hasSkipped()) {
            m.addItem(new WatchUi.MenuItem("Switch exercise", hasSkipped() ? "Or undo a skip" : "Do another one now", :pick, null));
        }
        m.addItem(new WatchUi.MenuItem("Skip exercise", "Undo it from Switch exercise", :skip, null));
        m.addItem(new WatchUi.MenuItem("End workout", null, :end, null));
        m.addItem(new WatchUi.MenuItem("Discard workout", null, :discard, null));
        WatchUi.pushView(m, new PauseDelegate(), WatchUi.SLIDE_UP);
        return true;
    }

    function hasSkipped() {
        if (!Workout.active()) { return false; }
        for (var i = 0; i < Workout.exCount(); i++) {
            if (Workout.isSkipped(i) && !Workout.isDone(i)) { return true; }
        }
        return false;
    }

    // Every exercise with sets left, in plan order; skipped ones say so and
    // come back when chosen. `replace` swaps out the menu this came from.
    function exercises(replace) {
        var m = new WatchUi.Menu2({ :title => "Exercises" });
        var list = Workout.pickable();
        for (var i = 0; i < list.size(); i++) {
            m.addItem(new WatchUi.MenuItem(list[i][1], list[i][2], list[i][0], null));
        }
        if (replace) {
            WatchUi.switchToView(m, new PickDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else {
            WatchUi.pushView(m, new PickDelegate(), WatchUi.SLIDE_UP);
        }
        return true;
    }

    // BACK on a finished workout with nothing left to log.
    function finish() {
        var m = new WatchUi.Menu2({ :title => "Workout done" });
        m.addItem(new WatchUi.MenuItem("Save workout", null, :save, null));
        var last = Workout.lastSetLabel();
        if (last != null) {
            m.addItem(new WatchUi.MenuItem("Undo last set", last, :undo, null));
        }
        if (hasSkipped()) {
            m.addItem(new WatchUi.MenuItem("Back to workout", "Undo a skipped exercise", :pick, null));
        }
        m.addItem(new WatchUi.MenuItem("Discard workout", null, :discard, null));
        WatchUi.pushView(m, new FinishDelegate(), WatchUi.SLIDE_UP);
        return true;
    }

    // `push` when opened from a normal screen; from the pause menu it
    // replaces that menu, so the confirm always sits exactly one above the
    // workout screen.
    function confirmDiscard(push) {
        var m = new WatchUi.Menu2({ :title => "Discard workout?" });
        m.addItem(new WatchUi.MenuItem("Keep", null, :keep, null));
        m.addItem(new WatchUi.MenuItem("Discard", "Deletes logged sets", :yes, null));
        if (push) {
            WatchUi.pushView(m, new ConfirmDelegate(), WatchUi.SLIDE_UP);
        } else {
            WatchUi.switchToView(m, new ConfirmDelegate(), WatchUi.SLIDE_IMMEDIATE);
        }
        return true;
    }
}

class PauseDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item) {
        var id = item.getId();
        if (id == :discard) {
            Menus.confirmDiscard(false);
            return;
        }
        if (id == :pick) {
            Menus.exercises(true);
            return;
        }
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        if (id == :weight) {
            Workout.setFocus(0);
        } else if (id == :undo) {
            Workout.undoSet();
            Nav.buzz(60);
            Nav.show();
        } else if (id == :skip) {
            Workout.skipExercise();
            Nav.show();
        } else if (id == :end) {
            Workout.toSummary();
            Nav.show();
        } else if (id == :resume && !Recorder.isOn()) {
            // Resuming a recovered workout from Home: restart recording.
            Workout.resume();
            Nav.show();
        }
    }
}

class ConfirmDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        if (item.getId() == :yes) {
            Workout.finish(false);
            Nav.show();
        }
    }
}

class FinishDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item) {
        if (item.getId() == :pick) {
            Menus.exercises(true);
            return;
        }
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        if (item.getId() == :undo) {
            Workout.undoSet();
            Nav.buzz(60);
            Nav.show();
            return;
        }
        // 0 = Save, 1 = Discard (which still asks to confirm).
        new SummaryDelegate().act(item.getId() == :save ? 0 : 1);
    }
}

// The exercise picker: the chosen one becomes current (un-skipped if needed).
class PickDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        Workout.choose(item.getId());
        Nav.buzz(60);
        Nav.show();
    }
}
