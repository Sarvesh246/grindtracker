using Toybox.Application;
using Toybox.System;

// Compiled only in the generated, offline replay project. Log the offered
// count at the end of the recording and after two/six seconds of stillness.
(:test)
module Replay {
    function run(id, expected) {
        var axes = Application.loadResource(id);
        var n = axes[0].size();
        var finish = null;
        var two = null;
        var next = 0;
        Reps.reset();
        Reps.listening = true;
        // The last partial batch would still be on the sensor when START is
        // pressed. Deliver it on its regular callback with the quiet tail.
        var end = n * 40;
        for (var ms = 50; ms <= end + 6000; ms += 50) {
            if (ms % 1000 == 0) {
                var x = []; var y = []; var z = []; var ts = [];
                for (var i = 0; i < 25; i++) {
                    var k = Reps.imin(next, n - 1);
                    x.add(axes[0][k]); y.add(axes[1][k]); z.add(axes[2][k]);
                    ts.add(next * 40); next++;
                }
                Reps.onSamples(x, y, z, ts, ms, 0);
            }
            if (Reps.job != null) { Reps.advanceAnalysis(); }
            if (ms <= end && ms + 50 > end) { finish = Reps.offer(); }
            if (ms <= end + 2000 && ms + 50 > end + 2000) { two = Reps.offer(); }
        }
        System.println("REPLAY " + expected + " " + finish + " " + two + " " + Reps.offer());
        var valid = !Reps.interrupted;
        Reps.reset(); Reps.listening = false;
        return valid;
    }
}
