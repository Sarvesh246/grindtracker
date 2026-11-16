using Toybox.Graphics;
using Toybox.Math;
using Toybox.System;

// Round-screen drawing helpers. Nothing takes pixels: positions are
// fractions of the screen and widths come from the circle's chord at that
// height, so text can't run off the bezel.
//
// Zones (fraction of height):  top .08-.22  status row
//                              upper .22-.40 exercise name
//                              center .40-.68 hero numbers
//                              lower .68-.84 counters / target
//                              bottom .84-.95 hint
module Draw {
    const C = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    const MARGIN = 10;

    function clear(dc) {
        dc.setColor(Config.BG, Config.BG);
        dc.clear();
    }

    function yAt(dc, frac) {
        return (dc.getHeight() * frac).toNumber();
    }

    // Widest a box `h` tall, centered vertically on y, can be inside the
    // circle, minus the margin on each side.
    function usableW(dc, y, h) {
        var r = dc.getWidth() / 2.0;
        var d = (y - r).abs() + h / 2.0;
        if (d >= r) { return 0; }
        return (2 * Math.sqrt(r * r - d * d)).toNumber() - 2 * MARGIN;
    }

    function truncate(dc, s, font, w) {
        if (dc.getTextWidthInPixels(s, font) <= w) { return s; }
        while (s.length() > 1 && dc.getTextWidthInPixels(s + "...", font) > w) {
            s = s.substring(0, s.length() - 1);
        }
        return s + "...";
    }

    // One centered line: first font that fits, else the last one truncated.
    function line(dc, frac, fonts, s, color) {
        var y = yAt(dc, frac);
        var font = fonts[fonts.size() - 1];
        for (var i = 0; i < fonts.size(); i++) {
            var w = usableW(dc, y, dc.getFontHeight(fonts[i]));
            if (dc.getTextWidthInPixels(s, fonts[i]) <= w) {
                font = fonts[i];
                break;
            }
        }
        s = truncate(dc, s, font, usableW(dc, y, dc.getFontHeight(font)));
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y, font, s, C);
    }

    // Exercise name in the upper zone: one line if it fits, else two lines
    // split at the space nearest the middle, each truncated with "...".
    function name(dc, s, color) {
        var one = [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL];
        var y = yAt(dc, 0.31);
        for (var i = 0; i < one.size(); i++) {
            if (dc.getTextWidthInPixels(s, one[i]) <= usableW(dc, y, dc.getFontHeight(one[i]))) {
                line(dc, 0.31, [one[i]], s, color);
                return;
            }
        }
        var mid = s.length() / 2;
        var cut = -1;
        for (var j = 0; j < s.length(); j++) {
            if (s.substring(j, j + 1).equals(" ") && (cut < 0 || (j - mid).abs() < (cut - mid).abs())) {
                cut = j;
            }
        }
        if (cut < 0) {
            line(dc, 0.31, [Graphics.FONT_TINY, Graphics.FONT_XTINY], s, color);
            return;
        }
        line(dc, 0.265, [Graphics.FONT_TINY, Graphics.FONT_XTINY], s.substring(0, cut), color);
        line(dc, 0.355, [Graphics.FONT_TINY, Graphics.FONT_XTINY], s.substring(cut + 1, s.length()), color);
    }

    // Bezel ring: a thin dim track plus an accent arc that starts at
    // 12 o'clock and runs clockwise for `frac` of the circle.
    function ring(dc, frac, color) {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var r = cx - 6 - 3;
        dc.setPenWidth(2);
        dc.setColor(Config.TRACK, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cy, r);
        var deg = (360 * frac).toNumber();
        if (deg > 0) {
            dc.setPenWidth(6);
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            if (deg >= 360) {
                dc.drawCircle(cx, cy, r);
            } else {
                dc.drawArc(cx, cy, r, Graphics.ARC_CLOCKWISE, 90, (90 - deg + 360) % 360);
            }
        }
        dc.setPenWidth(1);
    }

    function clock() {
        var t = System.getClockTime();
        return t.hour.format("%d") + ":" + t.min.format("%02d");
    }

    // Top status row: heart rate (or the clock), then the sync state.
    function status(dc, hr) {
        var left = hr != null ? "HR " + hr : clock();
        line(dc, 0.15, [Graphics.FONT_XTINY], left + "  " + gNet.status(), gNet.statusColor());
    }

    function hint(dc, s) {
        line(dc, 0.895, [Graphics.FONT_XTINY], s, Config.DIM);
    }

    // DEBUG: screen circle, zone boundaries drawn at their usable width,
    // and the tap columns of the logging screen.
    function debug(dc) {
        if (!Config.DEBUG_OVERLAY) { return; }
        var w = dc.getWidth();
        var cx = w / 2;
        dc.setPenWidth(1);
        dc.setColor(0xFF00FF, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cx, cx - 1);
        var zones = [0.08, 0.22, 0.40, 0.68, 0.84, 0.95];
        for (var i = 0; i < zones.size(); i++) {
            var y = yAt(dc, zones[i]);
            var half = usableW(dc, y, 0) / 2;
            dc.setColor(0x00AAFF, Graphics.COLOR_TRANSPARENT);
            dc.drawLine(cx - half, y, cx + half, y);
        }
        dc.setColor(0xFF8800, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(w / 4, yAt(dc, 0.40), w / 4, yAt(dc, 0.68));
        dc.drawLine(w * 3 / 4, yAt(dc, 0.40), w * 3 / 4, yAt(dc, 0.68));
    }
}
