// Tunables. Everything a human might want to flip lives here.
module Config {
    // Draws the screen circle, zone boundaries and tap columns over every screen.
    const DEBUG_OVERLAY = false;
    // Seeds a fake workout when nothing is cached, to walk the screens
    // in the simulator without a token. Never ship with this on.
    const DEMO_DATA = false;
    const TOUR_STEP_MS = 3000;
    // Phase 0 of the GRIND Body plan: log every sensor value to
    // GARMIN/APPS/LOGS/GRIND.TXT on open, every 15 min, and on Save.
    // Done (2026-11-16 log); keep it for checking a new watch or firmware.
    const PROBE = false;

    // Unit the watch shows and uploads. "lbs" or "kg". The server converts.
    const UNIT = "lbs";
    // UP/DOWN step for weight, in UNIT. Use 2.5 for kg.
    const WEIGHT_STEP = 5.0;

    // Rest used when the exercise has no rest configured in GRIND.
    const DEFAULT_REST = 90;
    const REST_STEP = 15;

    // Sets per upload. Keeps the request dictionary small in memory.
    const SYNC_BATCH = 25;
    // The app ticks every 5 s (heart rate); sync work runs every 6th tick.
    const TICK_MS = 5000;
    const SYNC_EVERY_TICKS = 6;

    // GRIND Body. One heart-rate reading per HR_STEP seconds; a trace stops
    // growing after 12 hours. The daily snapshot is sent at most every
    // DAILY_EVERY seconds while the app is open.
    const HR_STEP = 5;
    const MAX_TRACE = 8640;
    const DAILY_EVERY = 900;
    // Smart rest: "recovered" once HR is this far below the set's peak.
    const SMART_REST_DROP = 25;

    // AMOLED palette: black background, thin lit strokes, one accent.
    const BG = 0x000000;
    const FG = 0xFFFFFF;
    const DIM = 0x8A8A8A;
    const TRACK = 0x2A2A2A;
    const ACCENT = 0xC8F135; // GRIND lime
    const WARN = 0xFF5A4F;
    // Heart-rate zones 1-5, as on the web: greys, dim lime, lime, and coral
    // only for zone 5.
    const ZONE_COLORS = [0x5A5A5A, 0x9A9A9A, 0x8FAE26, 0xC8F135, 0xFF7A45];
}
