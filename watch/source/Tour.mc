using Toybox.System;
using Toybox.WatchUi;

// DEMO_DATA only: walks every screen on a timer by calling the same input
// handlers the buttons do, so the screens can be checked in the simulator
// hands-free. One step every Config.TOUR_STEP_MS.
module Tour {
    var step = 0;
    const LAST_STEP = 33;
    var failures = 0;
    var restEnd = null;
    var pickerOpenedWith = null;

    function check(ok, message) {
        if (!ok) { failures++; System.println("tour failed at step " + step + ": " + message); }
    }

    function finishAndLog() {
        var input = new SetDelegate();
        input.onSelect();
        input.onSelect();
    }

    function next() {
        step += 1;
        System.println("tour step " + step);
        if (step == 1) { new HomeDelegate().go(); }                       // Home -> set screen, weight focused
        else if (step == 2) { new SetDelegate().onSelect(); new SetDelegate().onPreviousPage(); } // reps focused, +1
        else if (step == 3) {
            check(!Workout.setRunning() && Workout.cur["r"] == 13, "setup edits");
            var input = new SetDelegate();
            input.onBack();
            check(Workout.cur["f"] == 0, "BACK returns to weight after selecting reps");
            input.onPreviousPage();
            input.onSelect();
            input.onSelect();
        } else if (step == 4) {
            check(Workout.setRunning() && Workout.sets.size() == 0 && WatchUi.getCurrentView()[0] instanceof SetView, "active set");
            var input = new SetDelegate();
            input.onSelect();
            check(Workout.setEnded() && Workout.sets.size() == 0, "finish opens review");
            input.onBack();
            input.onPreviousPage();
            input.onBack();
            input.onPreviousPage();
            input.onSelect();
        } else if (step == 5) {
            check(Workout.inRest() && Workout.sets.size() == 1 && Workout.sets[0]["r"] == 14
                && Workout.sets[0]["w"] == 72.5, "review saves corrected weight and reps before rest");
            new RestDelegate().onPreviousPage();
        } else if (step == 6) {
            check(Workout.cur["rd"] == 35, "adjust rest");
            restEnd = Workout.cur["re"];
            Menus.pause(false);
        } else if (step == 7) {
            pickerOpenedWith = Workout.restLeft();
            new PauseDelegate(false).onSelect(new WatchUi.MenuItem("Switch exercise", null, :pick, null));
        } else if (step == 8) {
            var picker = WatchUi.getCurrentView()[0];
            check(picker instanceof WorkoutMenu && picker.lastLeft < pickerOpenedWith,
                "rest title counts down inside the exercise picker");
            new PickDelegate().onSelect(new WatchUi.MenuItem("Overhead Press", null, 1, null));
        } else if (step == 9) {
            check(WatchUi.getCurrentView()[0] instanceof RestView, "switch exercise returns to the rest screen");
            check(Workout.cur["re"] == restEnd && Workout.cur["ei"] == 1, "switch exercise keeps the original countdown");
            Menus.pause(false);
        } else if (step == 10) {
            new PauseDelegate(false).onSelect(new WatchUi.MenuItem("Switch exercise", null, :pick, null));
        } else if (step == 11) {
            new PickDelegate().onSelect(new WatchUi.MenuItem("Incline Dumbbell Bench Press", null, 0, null));
        } else if (step == 12) {
            new RestDelegate().skip();
        } else if (step == 13) { new SetDelegate().onSelect(); finishAndLog(); }
        else if (step == 14) { new RestDelegate().skip(); }
        else if (step == 15) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); finishAndLog(); }
        else if (step == 16 || step == 18) { new RestDelegate().skip(); }
        else if (step == 17) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); finishAndLog(); }
        else if (step == 19) { new SetDelegate().onSelect(); finishAndLog(); }
        else if (step == 20) {
            check(Workout.atSummary() && Workout.sets.size() == 5 && Workout.sets[4]["w"] == 0, "bodyweight final set");
            new SummaryDelegate().onBack();
        } else if (step == 21) {
            new FinishDelegate().onSelect(new WatchUi.MenuItem("Undo last set", null, :undo, null));
        } else if (step == 22) {
            check(WatchUi.getCurrentView()[0] instanceof SetView && !Workout.setRunning() && Workout.sets.size() == 4,
                "summary undo returns to set setup");
            new SetDelegate().onSelect();
        } else if (step == 23) {
            check(Workout.setRunning() && Workout.sets.size() == 4, "START after undo resets the set timer");
            finishAndLog();
        } else if (step == 24) {
            check(Workout.atSummary() && Workout.sets.size() == 5, "finishing the repeated set returns to summary");
            new SummaryDelegate().onNextPage();
        } else if (step == 25) {
            check(WatchUi.getCurrentView()[0].sel == 1, "discard highlighted");
            new SummaryDelegate().onNextPage(); new SummaryDelegate().onSelect();
        } else if (step == 26) {
            check(Workout.saved && Store.queue().indexOf(Workout.last["sid"]) >= 0, "saved offline");
            new SummaryDelegate().onSelect();
        } else if (step == 27) {
            check(!Workout.active() && WatchUi.getCurrentView()[0] instanceof HomeView, "returned home");
            // Readiness check: intro, settling, measuring, a good and a poor result.
            Readiness.state = :idle;
            WatchUi.pushView(new ReadinessView(), new ReadinessDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else if (step == 28) {
            new ReadinessDelegate().onSelect();
            check(Readiness.state == :settle || Readiness.state == :fail, "check begins");
        } else if (step == 29) {
            Readiness.stop();
            Readiness.state = :measure; Readiness.measureAt = System.getTimer() - 22000; Readiness.hr = 58;
            Readiness.rr = [900, 910, 905, 920]; Readiness.recentMove = true;
            WatchUi.requestUpdate();
        } else if (step == 30) {
            Readiness.state = :done; Readiness.result = Readiness.analyze([930,976,998,992,1015,994,994,989,973,965,924,891,881,881,898,895,897,950,946,956,987,1020,1015,999,966,939,936,919,915,886,879,901,909,904,947,974,988,1020,1014,1020,992,984,958,949,927,902,914,888,878,889,917,936,959,980], 0);
            check(Readiness.result["quality"].equals("good"), "good reading");
            WatchUi.requestUpdate();
        } else if (step == 31) {
            Readiness.result = Readiness.analyze([900, 905], 12);
            WatchUi.requestUpdate();
        } else if (step == 32) {
            new ReadinessDelegate().onBack();
        } else if (step == LAST_STEP) {
            check(!Workout.active() && WatchUi.getCurrentView()[0] instanceof HomeView && !Readiness.listening, "back home after the check");
            System.println("tour complete, failures=" + failures);
            // The demo workout must never reach the server.
            var q = Store.queue();
            for (var i = q.size() - 1; i >= 0; i--) {
                var m = Store.meta(q[i]);
                if (m != null && "demo".equals(m["wid"])) { Store.dropSession(q[i]); Store.dequeue(q[i]); }
            }
            WatchUi.requestUpdate();
        }
    }
}
