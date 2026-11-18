using Toybox.System;
using Toybox.WatchUi;

// DEMO_DATA only: walks every screen on a timer by calling the same input
// handlers the buttons do, so the screens can be checked in the simulator
// hands-free. One step every Config.TOUR_STEP_MS.
module Tour {
    var step = 0;
    const LAST_STEP = 24;
    var failures = 0;

    function check(ok, message) {
        if (!ok) { failures++; System.println("tour failed at step " + step + ": " + message); }
    }

    function next() {
        step += 1;
        System.println("tour step " + step);
        if (step == 1) { new HomeDelegate().go(); }                       // Home -> set screen, weight focused
        else if (step == 2) { new SetDelegate().onSelect(); new SetDelegate().onPreviousPage(); } // reps focused, +1
        else if (step == 3) {
            check(!Workout.setRunning() && Workout.cur["r"] == 13, "setup edits");
            new SetDelegate().onSelect();
        } else if (step == 4) {
            check(Workout.setRunning() && Workout.sets.size() == 0 && WatchUi.getCurrentView()[0] instanceof SetView, "active set");
            new SetDelegate().onSelect();
        } else if (step == 5) {
            check(Workout.inRest() && Workout.sets.size() == 1 && Workout.sets[0]["r"] == 13, "finish opens rest");
            new RestDelegate().onPreviousPage();
        } else if (step == 6) {
            check(Workout.cur["rd"] == 35, "adjust rest");
            Menus.pause(false);
        } else if (step == 7) {
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
            new RestDelegate().skip();
        } else if (step == 8) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 9) { new RestDelegate().skip(); }
        else if (step == 10) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 11 || step == 13) { new RestDelegate().skip(); }
        else if (step == 12) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 14) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 15) {
            check(Workout.atSummary() && Workout.sets.size() == 5 && Workout.sets[4]["w"] == 0, "bodyweight final set");
            new SummaryDelegate().onNextPage();
        } else if (step == 16) {
            check(WatchUi.getCurrentView()[0].sel == 1, "discard highlighted");
            new SummaryDelegate().onNextPage(); new SummaryDelegate().onSelect();
        } else if (step == 17) {
            check(Workout.saved && Store.queue().indexOf(Workout.last["sid"]) >= 0, "saved offline");
            new SummaryDelegate().onSelect();
        } else if (step == 18) {
            check(!Workout.active() && WatchUi.getCurrentView()[0] instanceof HomeView, "returned home");
            // Readiness check: intro, settling, measuring, a good and a poor result.
            Readiness.state = :idle;
            WatchUi.pushView(new ReadinessView(), new ReadinessDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else if (step == 19) {
            new ReadinessDelegate().onSelect();
            check(Readiness.state == :settle || Readiness.state == :fail, "check begins");
        } else if (step == 20) {
            Readiness.stop();
            Readiness.state = :measure; Readiness.measureAt = System.getTimer() - 22000; Readiness.hr = 58;
            Readiness.rr = [900, 910, 905, 920]; Readiness.recentMove = true;
            WatchUi.requestUpdate();
        } else if (step == 21) {
            Readiness.state = :done; Readiness.result = Readiness.analyze([930,976,998,992,1015,994,994,989,973,965,924,891,881,881,898,895,897,950,946,956,987,1020,1015,999,966,939,936,919,915,886,879,901,909,904,947,974,988,1020,1014,1020,992,984,958,949,927,902,914,888,878,889,917,936,959,980], 0);
            check(Readiness.result["quality"].equals("good"), "good reading");
            WatchUi.requestUpdate();
        } else if (step == 22) {
            Readiness.result = Readiness.analyze([900, 905], 12);
            WatchUi.requestUpdate();
        } else if (step == 23) {
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
