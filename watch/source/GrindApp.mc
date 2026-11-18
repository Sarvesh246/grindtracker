using Toybox.Application;
using Toybox.Attention;
using Toybox.System;
using Toybox.Time;
using Toybox.Timer;
using Toybox.WatchUi;

var gNet = null;

// Marked (:background) because Connect IQ also loads the app class in the
// background process (Bg.mc). onStart and onStop run there too, so all
// foreground setup lives in boot(), reached only from getInitialView().
(:background)
class GrindApp extends Application.AppBase {
    var timer = null;
    var ticks = 0;
    var tour = null;
    var fg = false;

    function initialize() { AppBase.initialize(); }

    function onStart(state) {
    }

    function getServiceDelegate() {
        return [new GrindService()];
    }

    // A background run finished while the app was open (or since it last
    // was): its result is already in storage, this just logs it.
    function onBackgroundData(data) {
        System.println("bg daily -> " + data);
    }

    function boot() {
        fg = true;
        gNet = new Net();
        Workout.load();
        if (Config.DEMO_DATA && !Workout.active()) {
            Store.cacheToday({ "date" => Logic.localDate(), "unit" => Config.UNIT, "workout" => { "id" => "demo", "name" => "Push Day", "exercises" => [
                { "id" => "d1", "name" => "Incline Dumbbell Bench Press", "sets" => 2, "reps" => 8, "reps_max" => 12, "weight" => 62.5, "rest" => 20 },
                { "id" => "d2", "name" => "Overhead Press", "sets" => 1, "reps" => 6, "reps_max" => null, "weight" => 135, "rest" => null },
                { "id" => "d3", "name" => "Dips", "sets" => 2, "reps" => null, "reps_max" => null, "weight" => null, "rest" => 60 }
            ] }, "days" => [{ "id" => "demo", "name" => "Push Day" }, { "id" => "pull", "name" => "Pull Day" }, { "id" => "legs", "name" => "Legs" }],
            "body" => { "charge" => { "score" => 72, "band" => "steady", "label" => "Steady", "advice" => "Train as planned" }, "smart_rest" => true } });
        }
        System.println("GRIND start, active=" + Workout.active() + " queue=" + Store.queue().size());
        Probe.log("open");
        // Sync trigger 1 of 3: on app open. (2: right after Save. 3: the tick.)
        gNet.refresh();
        gNet.flush();
        timer = new Timer.Timer();
        timer.start(method(:onTick), Config.TICK_MS, true);
        if (Config.DEMO_DATA && Config.TOUR) {
            tour = new Timer.Timer();
            tour.start(method(:onTour), Config.TOUR_STEP_MS, true);
        }
        if (Config.DEMO_DATA) { Bg.unregister(); } else { Bg.register(); }
    }

    // Every second: the visible workout screen. Every HR_STEP s: heart rate
    // while a workout is open. Every 30 s: sync.
    function onTick() {
        ticks += 1;
        var v = Clock.view;
        if (v != null) { v.onSecond(); }
        if (ticks % Config.HR_STEP == 0 && Workout.active() && !Workout.atSummary()) { Hr.sample(Time.now().value()); }
        if (ticks % Config.SYNC_EVERY_TICKS != 0) { return; }
        if (ticks % 900 == 0) { Probe.log("tick"); } // every 15 min while open
        gNet.tick();
        WatchUi.requestUpdate();
    }

    function onTour() {
        Tour.next();
        if (Tour.step >= 12) { tour.stop(); }
    }

    function onStop(state) {
        if (!fg) { return; }
        if (timer != null) { timer.stop(); }
        // Closing mid-workout drops the Garmin recording instead of saving
        // it. Resuming starts a new recording, so saving here posted one
        // Garmin/Strava activity per close-and-resume. The sets and our own
        // HR trace are in storage, and Save on the summary records the one
        // activity that counts.
        Hr.save();
        Reps.stop();
        Recorder.stop(false);
    }

    function getInitialView() {
        boot();
        return [new HomeView(), new HomeDelegate()];
    }
}

module Nav {
    // Shows whichever screen the workout state calls for.
    function show() {
        if (!Workout.active() || Workout.atSummary()) { Reps.stop(); }
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
