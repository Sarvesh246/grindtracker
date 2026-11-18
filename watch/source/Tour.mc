using Toybox.System;
using Toybox.WatchUi;

// DEMO_DATA only: walks every screen on a timer by calling the same input
// handlers the buttons do, so the screens can be checked in the simulator
// hands-free. One step every Config.TOUR_STEP_MS.
module Tour {
    var step = 0;

    function next() {
        step += 1;
        System.println("tour step " + step);
        if (step == 1) { new HomeDelegate().go(); }                       // Home -> set screen, weight focused
        else if (step == 2) { new SetDelegate().onSelect(); new SetDelegate().onPreviousPage(); } // reps focused, +1
        else if (step == 3) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 4) { new RestDelegate().onPreviousPage(); }      // +15 s
        else if (step == 5) { Menus.pause(false); }                       // pause menu
        else if (step == 6) { WatchUi.popView(WatchUi.SLIDE_IMMEDIATE); new RestDelegate().skip(); } // set 2
        else if (step == 7) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 8) { new RestDelegate().skip(); }                // exercise 2, long name gone
        else if (step == 9) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 10 || step == 12) { new RestDelegate().skip(); }
        else if (step == 11) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 13) { new SetDelegate().onSelect(); new SetDelegate().onSelect(); }
        else if (step == 14) { new SummaryDelegate().onNextPage(); }      // Discard highlighted
        else if (step == 15) { new SummaryDelegate().onNextPage(); new SummaryDelegate().onSelect(); } // Save
        else if (step == 16) {                                            // back Home
            new SummaryDelegate().onSelect();
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
