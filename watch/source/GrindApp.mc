using Toybox.Application;
using Toybox.Attention;
using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;

var gNet = null;

class GrindApp extends Application.AppBase {
    var timer = null;
    var tour = null;

    function initialize() { AppBase.initialize(); }

    function onStart(state) {
        gNet = new Net();
        Workout.load();
        if (Config.DEMO_DATA && Store.today() == null) {
            Store.cacheToday({ "date" => Logic.localDate(), "unit" => Config.UNIT, "workout" => { "id" => "demo", "name" => "Push Day", "exercises" => [
                { "id" => "d1", "name" => "Incline Dumbbell Bench Press", "sets" => 2, "reps" => 8, "reps_max" => 12, "weight" => 62.5, "rest" => 20 },
                { "id" => "d2", "name" => "Overhead Press", "sets" => 1, "reps" => 6, "reps_max" => null, "weight" => 135, "rest" => null }
            ] } });
        }
        System.println("GRIND start, active=" + Workout.active() + " queue=" + Store.queue().size());
        // Sync trigger 1 of 3: on app open. (2: right after Save. 3: the tick.)
        gNet.refresh();
        gNet.flush();
        timer = new Timer.Timer();
        timer.start(method(:onTick), Config.SYNC_TICK_MS, true);
        if (Config.DEMO_DATA) {
            tour = new Timer.Timer();
            tour.start(method(:onTour), Config.TOUR_STEP_MS, true);
        }
    }

    function onTick() {
        gNet.tick();
        WatchUi.requestUpdate();
    }

    function onTour() {
        Tour.next();
        if (Tour.step >= 12) { tour.stop(); }
    }

    function onStop(state) {
        if (timer != null) { timer.stop(); }
        // If the system closes us mid-workout, keep the activity recorded so
        // far. The sets are already in storage and resume on next launch.
        Recorder.stop(true);
    }

    function getInitialView() {
        return [new HomeView(), new HomeDelegate()];
    }
}

module Nav {
    // Shows whichever screen the workout state calls for.
    function show() {
        if (!Workout.active()) {
            WatchUi.switchToView(new HomeView(), new HomeDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else if (Workout.atSummary()) {
            WatchUi.switchToView(new SummaryView(), new SummaryDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else if (Workout.inRest()) {
            WatchUi.switchToView(new RestView(), new RestDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else {
            WatchUi.switchToView(new SetView(), new SetDelegate(), WatchUi.SLIDE_IMMEDIATE);
        }
    }

    function buzz(ms) {
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(60, ms)]);
        }
    }
}
