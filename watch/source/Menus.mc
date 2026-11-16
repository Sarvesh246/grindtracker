using Toybox.WatchUi;

// Pause menu and the discard confirm. Both are system Menu2s: fully usable
// with buttons or touch, and they cost almost no app memory.
module Menus {
    function pause(onSetScreen) {
        var m = new WatchUi.Menu2({ :title => "Paused" });
        m.addItem(new WatchUi.MenuItem("Resume", null, :resume, null));
        if (onSetScreen) {
            m.addItem(new WatchUi.MenuItem("Change weight", null, :weight, null));
        }
        m.addItem(new WatchUi.MenuItem("Skip exercise", null, :skip, null));
        m.addItem(new WatchUi.MenuItem("End workout", null, :end, null));
        m.addItem(new WatchUi.MenuItem("Discard workout", null, :discard, null));
        WatchUi.pushView(m, new PauseDelegate(), WatchUi.SLIDE_UP);
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
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        if (id == :weight) {
            Workout.setFocus(0);
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
