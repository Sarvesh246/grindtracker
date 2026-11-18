// Reference implementation of the watch's wrist rep counter (source/Reps.mc).
// Written in the same plain-loop style as the Monkey C port so the two can be
// compared line by line. Tune here, against tools/repsim.mjs, then port.
//
// Input: accelerometer at FS = 12.5 Hz (the watch samples 25 Hz and averages
// pairs), in g, plus the step counter sampled at the same rate.
//
// The rule above all others: a wrong number is worse than no number. When
// the counter isn't sure it says nothing and the set screen keeps the target.
//
// Pipeline:
//   0. The window runs from START to the finish press, so it opens with the
//      wrist coming down from the screen and may close with it rising. A
//      one-way move bounded by a still second near either end is held still.
//   1. Motion bouts: 1 s blocks with real movement, pauses up to 3 s kept
//      inside, walking (step counter climbing fast) cut out.
//   2. Per bout, the principal axis of motion (PCA by power iteration), so
//      the count doesn't care how the watch sits or which lift it is.
//   3. Rep period from the normalised autocorrelation (1.3-6.4 s; smallest
//      lag within 85 % of the best peak so multiples never win).
//   4. Band-limit to that period (minus a one-period moving average, smoothed
//      over a fifth of one).
//   5. Swings by Schmitt trigger. Each gets a fingerprint: size, phase length
//      (crossing to crossing, stable for lifts with two acceleration lobes
//      per stroke) and its 3-D direction in the watch's frame.
//   6. A rep is a complete pair, away and back, that also closes on the raw
//      signal. So a half motion (raising the wrist to press START) or a
//      one-way move (setting the weight down) can never be a rep.
//   7. Where the set is: the longest rhythmic chain of pairs whose swings
//      match the set's fingerprint closely; one off-size rep that keeps the
//      beat may sit inside it. Inside it every normal-sized pair counts; the
//      edges grow one rep at a time only while the next pair keeps the set's
//      own rhythm and fingerprint.
//   8. Trust: edges grown again with lenient rules must agree (a disputed
//      last rep counts when it closes cleanly on the beat); periodicity
//      measured over the counted reps; steady rhythm; a set the watch only
//      sees in pieces says nothing; 3-4 rep sets need a cleaner rhythm.
//
// tools/repsim.mjs measures it on synthetic sessions with the motions people
// actually make around a set. Run it after any change here.

export const FS = 12.5;
const BLOCK = 12;          // samples per motion block (~1 s)
const GAP_BLOCKS = 3;      // still blocks a bout may contain (pause at lockout)
const MIN_MOTION = 0.03;   // g: a block quieter than this is still
let LAG_MIN = 8;           // at 6.25 Hz: 1.28 s, the fastest rep we trust (tunable)
const LAG_MAX = 40;        // 6.4 s, the slowest
const PICK = 0.85;         // fraction of the best AC peak a shorter lag needs
export let MIN_AC = 0.60;  // tunable
export let MAX_CV = 0.32;  // tunable
export const MIN_REPS = 3;
const SHORT_REPS = 4;
const SHORT_AC = 0.7;
const SHORT_CV = 0.15;
const FRAG_AC = 0.35;      // another bout this periodic...
const FRAG_T = 0.25;       // ...at this close a period = the set came in pieces
let SWING_MIN = 0.45;      // of the median swing (tunable)
const SWING_MAX = 2.4;
export const MIN_AMP = 0.06; // g: median swing below this is tremor, not reps
const GAP_LO = 0.6;        // core rep gap vs period
const GAP_HI = 1.6;
const CORE_LO = 0.72;      // core swing size vs the median swing
const CORE_HI = 1.6;
const DUR_LO = 0.6;        // core swing duration vs the median
const DUR_HI = 1.7;
const DIR_COS = 0.85;      // core swing direction vs the mean direction
const EDGE_SIZE_HI = 1.45; // edge swings
const EDGE_DUR_LO = 0.6;
const EDGE_DUR_HI = 1.6;
const TRAIL_DUR_HI = 2.2;  // last reps grind slower
const EDGE_COS = 0.88;
const CLOSE = 0.5;         // pair must return within this share of its size
// Edge growth, normal / lenient: size floor, gap window vs the set's median
// gap (lo, leading hi, trailing hi), and whether a slow swing's size is
// duration-compensated. The two must agree.
const EDGE_RULES = [
  { size: 0.75, lo: 0.8, hi: 1.25, trail: 1.7, comp: true },
  { size: 0.6, lo: 0.6, hi: 1.6, trail: 2.0, comp: false },
];
// The window opens with the wrist coming down from START and closes with
// it rising to press START again. A one-way move followed (or preceded) by a
// still second within these spans is held still before analysis.
const TRIM_LEAD = 31;      // samples (2.5 s)
const TRIM_TRAIL = 19;     // samples (1.5 s)
const TRIM_STEP = 3;
// One off-size rep may sit inside a chain whose reps on both sides keep the
// beat, when the chain has at least this many strict reps.
const BRIDGE_GAP = 0.25;   // the bridged rep's gaps, vs the period
const BRIDGE_MIN = 4;
// The two edge readings differ by one trailing rep: count it when it closes
// this cleanly, keeps this beat and is this size on the way back.
const TRAIL_CLOSE = 0.12;
const TRAIL_GAP = 1.3;
const TRAIL_SIZE = 0.65;
const WALK_STEPS = 5;      // steps within WALK_WIN blocks = walking
const WALK_WIN = 4;

function mean(a, lo, hi) {
  let s = 0;
  for (let i = lo; i < hi; i++) s += a[i];
  return s / (hi - lo);
}

// Centred moving average with shrinking edges. O(n) via a running sum.
export function movAvg(a, w) {
  const n = a.length;
  const out = new Array(n);
  if (w <= 1) { for (let i = 0; i < n; i++) out[i] = a[i]; return out; }
  const half = Math.floor(w / 2);
  let lo = 0, hi = 0, s = 0;
  for (let i = 0; i < n; i++) {
    const wantLo = Math.max(0, i - half);
    const wantHi = Math.min(n, i + half + 1);
    while (hi < wantHi) { s += a[hi]; hi++; }
    while (lo < wantLo) { s -= a[lo]; lo++; }
    out[i] = s / (hi - lo);
  }
  return out;
}

function sortNums(a) {
  // Insertion sort: the arrays are small (blocks, swings) and the port has no sort.
  for (let i = 1; i < a.length; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
  return a;
}

function median(a) {
  const s = sortNums(a.slice());
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Motion per 1 s block: sqrt of the summed per-axis variance.
function blockMotion(x, y, z, nb) {
  const out = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const lo = b * BLOCK, hi = lo + BLOCK;
    let v = 0;
    for (const a of [x, y, z]) {
      const m = mean(a, lo, hi);
      let s = 0;
      for (let i = lo; i < hi; i++) s += (a[i] - m) * (a[i] - m);
      v += s / BLOCK;
    }
    out[b] = Math.sqrt(v);
  }
  return out;
}

// [[startSample, endSample], ...] of motion, walking cut out.
export function bouts(x, y, z, steps) {
  const n = x.length;
  const nb = Math.floor(n / BLOCK);
  if (nb < 3) return [];
  const mo = blockMotion(x, y, z, nb);
  const thr = Math.max(MIN_MOTION, 0.15 * median(mo.slice()));
  const act = new Array(nb);
  for (let b = 0; b < nb; b++) {
    let walk = false;
    if (steps) {
      const b0 = Math.max(0, b - (WALK_WIN >> 1)), b1 = Math.min(nb - 1, b0 + WALK_WIN);
      const d = steps[Math.min(n - 1, b1 * BLOCK + BLOCK - 1)] - steps[b0 * BLOCK];
      walk = d >= WALK_STEPS;
    }
    act[b] = !walk && mo[b] > thr;
  }
  const out = [];
  let b = 0;
  while (b < nb) {
    if (!act[b]) { b++; continue; }
    let e = b, gap = 0, k = b + 1;
    while (k < nb) {
      if (act[k]) { e = k; gap = 0; } else { gap++; if (gap > GAP_BLOCKS) break; }
      k++;
    }
    out.push([Math.max(0, b * BLOCK - BLOCK / 2), Math.min(n, (e + 1) * BLOCK + BLOCK / 2)]);
    b = e + 1;
  }
  return out;
}

// Principal axis of the 3-axis signal over [lo, hi): power iteration on the
// covariance matrix.
export function principal(x, y, z, lo, hi) {
  const mx = mean(x, lo, hi), my = mean(y, lo, hi), mz = mean(z, lo, hi);
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (let i = lo; i < hi; i++) {
    const a = x[i] - mx, b = y[i] - my, c = z[i] - mz;
    cxx += a * a; cyy += b * b; czz += c * c; cxy += a * b; cxz += a * c; cyz += b * c;
  }
  // Start on the axis with the most variance (never orthogonal to the answer
  // in practice), then iterate.
  let vx = 0, vy = 0, vz = 0;
  if (cxx >= cyy && cxx >= czz) vx = 1; else if (cyy >= czz) vy = 1; else vz = 1;
  for (let it = 0; it < 25; it++) {
    const nx = cxx * vx + cxy * vy + cxz * vz;
    const ny = cxy * vx + cyy * vy + cyz * vz;
    const nz = cxz * vx + cyz * vy + czz * vz;
    const nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nn === 0) break;
    vx = nx / nn; vy = ny / nn; vz = nz / nn;
  }
  return [vx, vy, vz, mx, my, mz];
}

// Normalised autocorrelation at 6.25 Hz. Returns [lag in 12.5 Hz samples, peak].
export function period(s) {
  const n2 = Math.floor(s.length / 2);
  const d = new Array(n2);
  for (let i = 0; i < n2; i++) d[i] = (s[2 * i] + s[2 * i + 1]) / 2;
  const lmax = Math.min(LAG_MAX, Math.floor(n2 / 2));
  if (lmax <= LAG_MIN + 1) return [0, 0];
  const r = new Array(lmax + 2).fill(0);
  for (let L = LAG_MIN - 1; L <= lmax + 1 && L < n2; L++) {
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i + L < n2; i++) {
      sxy += d[i] * d[i + L]; sxx += d[i] * d[i]; syy += d[i + L] * d[i + L];
    }
    r[L] = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  }
  let best = 0;
  for (let L = LAG_MIN; L <= lmax; L++) {
    if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] > best) best = r[L];
  }
  if (best <= 0) return [0, 0];
  for (let L = LAG_MIN; L <= lmax; L++) {
    if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] >= PICK * best) {
      // Parabolic refinement around the integer peak.
      const a = r[L - 1], b = r[L], c = r[L + 1];
      const den = a - 2 * b + c;
      const off = den < 0 ? 0.5 * (a - c) / den : 0;
      return [2 * (L + Math.max(-0.5, Math.min(0.5, off))), r[L]];
    }
  }
  return [0, 0];
}

// Schmitt-trigger swing detection on the band-limited signal y, then a
// fingerprint check on every swing. ax/ay/az are the bout's smoothed axes,
// v the principal axis. Returns { reps, cv, amp }.
//
// A rep is one up-swing and one down-swing. Each swing is kept only if it
// looks like the set's typical swing in the same direction:
//   size      within SWING_MIN..SWING_MAX of the median,
//   duration  within DUR_LO..DUR_HI of the median,
//   direction (3-D, in the watch's frame) within cos DIR_COS of the mean.
// Picking a dumbbell up, re-racking, sipping water, glancing at the watch:
// each is one swing of the wrong size, speed or direction, so none of them
// joins the count. Then only the longest run that keeps the rhythm counts.
export function countCycles(y, T, ax, ay, az, raw) {
  const n = y.length;
  // Threshold from the typical one-period window, not the whole bout: one
  // big pick-up must not lift it above small reps.
  const W = Math.max(4, Math.round(T));
  const wsd = [];
  for (let w0 = 0; w0 + W <= n; w0 += W) {
    let ss = 0;
    for (let i = w0; i < w0 + W; i++) ss += y[i] * y[i];
    wsd.push(Math.sqrt(ss / W));
  }
  if (wsd.length === 0) return { reps: 0, cv: 1, amp: 0 };
  const h = 0.45 * median(wsd);
  const refr = 0.45 * T;
  const ext = [];   // value of each extreme
  const ei = [];    // its sample index
  const kind = [];  // +1 max, -1 min
  const at = [];    // index of the crossing that closed it
  let state = 0, lastUp = -1e9, lastDn = -1e9;
  let lo = y[0], hi = y[0], loI = 0, hiI = 0;
  for (let i = 0; i < n; i++) {
    const v = y[i];
    if (v < lo) { lo = v; loI = i; }
    if (v > hi) { hi = v; hiI = i; }
    if (state !== 1 && v > h && i - lastUp >= refr) {
      ext.push(lo); ei.push(loI); kind.push(-1); at.push(i);
      state = 1; lastUp = i; hi = v; hiI = i; lo = v; loI = i;
    } else if (state !== -1 && v < -h && i - lastDn >= refr) {
      ext.push(hi); ei.push(hiI); kind.push(1); at.push(i);
      state = -1; lastDn = i; lo = v; loI = i; hi = v; hiI = i;
    }
  }
  if (state === 1) { ext.push(hi); ei.push(hiI); kind.push(1); }
  else { ext.push(lo); ei.push(loI); kind.push(-1); }
  at.push(n);
  const ns = ext.length - 1;
  if (ns < 2) return { reps: 0, cv: 1, amp: 0 };
  // Per swing: size, duration, unit 3-D direction.
  const mag = [], dur = [], dx = [], dy = [], dz = [];
  for (let k = 0; k < ns; k++) {
    mag.push(Math.abs(ext[k + 1] - ext[k]));
    // Phase length between threshold crossings: stable even when a phase
    // has two acceleration lobes and the extreme lands on either one.
    dur.push(Math.max(1, at[k + 1] - at[k]));
    const a = ax[ei[k + 1]] - ax[ei[k]], b = ay[ei[k + 1]] - ay[ei[k]], c = az[ei[k + 1]] - az[ei[k]];
    const l = Math.sqrt(a * a + b * b + c * c) || 1;
    dx.push(a / l); dy.push(b / l); dz.push(c / l);
  }
  // Per direction (0 up, 1 down): median size, median duration, mean
  // direction, and each swing's fit.
  const keep = new Array(ns).fill(false);
  const cosTo = new Array(ns).fill(0);
  const mmD = [0, 0], mdD = [0, 0];
  for (let di = 0; di < 2; di++) {
    const want = di === 0 ? -1 : 1;    // up-swings start at a min
    const idx = [];
    for (let k = 0; k < ns; k++) if (kind[k] === want) idx.push(k);
    if (idx.length === 0) continue;
    const mm = median(idx.map((k) => mag[k]));
    const md = median(idx.map((k) => dur[k]));
    let sx = 0, sy = 0, sz = 0;
    for (const k of idx) {
      if (mag[k] < SWING_MIN * mm || mag[k] > SWING_MAX * mm) continue;
      sx += dx[k]; sy += dy[k]; sz += dz[k];
    }
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    mmD[di] = mm; mdD[di] = md;
    for (const k of idx) {
      cosTo[k] = dx[k] * sx + dy[k] * sy + dz[k] * sz;
      // Core reps (the ones that define where the set is) must be
      // unmistakable; the loose band only applies inside that span.
      keep[k] = mag[k] >= CORE_LO * mm && mag[k] <= CORE_HI * mm
        && dur[k] >= DUR_LO * md && dur[k] <= DUR_HI * md && cosTo[k] >= DIR_COS;
    }
  }
  const di = (k) => (kind[k] === -1 ? 0 : 1);
  // A slower swing of a lift that moves the hand reads smaller (acceleration
  // goes with 1/duration^2): a grinding last rep must still count. So the
  // size floor also accepts the duration-compensated size.
  const big = (k, f) => {
    const m = mmD[di(k)], q = Math.min(2, dur[k] / mdD[di(k)]);
    return mag[k] >= f * m || mag[k] * q * q >= f * m;
  };
  const loose = (k) => big(k, SWING_MIN) && mag[k] <= SWING_MAX * mmD[di(k)];
  // A rep is a complete pair: away from the start position and back. Which
  // way is "away" depends on the lift, so try both and keep the better.
  // Counting only complete pairs means a half motion (raising the wrist to
  // press START, a one-way pick-up) can never become a rep.
  let best = { reps: 0, cv: 1, times: [] };
  for (const pol of [-1, 1]) {
    // A pair must also close on the raw signal: back near where it began.
    // Detrending turns a one-way move (setting the weight down) into a
    // there-and-back bump; the raw signal shows it never came back.
    const pairs = [];                  // swing index of each pair's first half
    for (let k = 0; k + 1 < ns; k++) {
      if (kind[k] !== pol) continue;
      const a = raw[ei[k]], b = raw[ei[k + 1]], c = raw[ei[k + 2]];
      if (Math.abs(c - a) <= CLOSE * Math.abs(b - a)) pairs.push(k);
    }
    const strictT = [];
    for (const k of pairs) if (keep[k] && keep[k + 1]) strictT.push(at[k]);
    const run = rhythmRun(strictT, T);
    let t0 = strictT[run.lo], t1 = strictT[run.lo + run.len - 1];
    // One rep that is off-size or off-speed must not split a set in two: a
    // chain may pass through a single rep-like pair that misses the strict
    // fingerprint, when it sits on the beat on both sides.
    const bridged = bridgeRun(pairs, keep, loose, at, T);
    if (bridged && bridged.strict > run.len) { t0 = bridged.t0; t1 = bridged.t1; run.len = bridged.strict; }
    if (run.len < 2) { if (run.len > best.reps) best = { reps: run.len, cv: 1, times: strictT.slice(run.lo, run.lo + 1) }; continue; }
    // Inside the span every normal-sized pair counts: one jittery swing in
    // the middle of a set is the set, not a stray motion.
    const times = [];
    for (const k of pairs) if (at[k] >= t0 && at[k] <= t1 && loose(k) && loose(k + 1)) times.push(at[k]);
    // Edge reps must continue the set's own rhythm closely and look like
    // its reps on every count: that is where stray motions try to join.
    // The edges are grown twice, normal and lenient. If a more lenient
    // reading would add a rep, the edge is ambiguous: no count is shown.
    const g = [];
    for (let j = 1; j < times.length; j++) g.push(times[j] - times[j - 1]);
    const cg = g.length ? median(g) : T;
    const first = pairs.findIndex((k) => at[k] === t0);
    const last = pairs.findIndex((k) => at[k] === t1);
    const grown = [];
    for (const R of EDGE_RULES) {
      const sizeOk = (k, f) => {
        const m = mmD[di(k)], q = Math.min(2, dur[k] / mdD[di(k)]);
        return mag[k] >= f * m || (R.comp && mag[k] * q * q >= f * m);
      };
      const half = (k, trail) => sizeOk(k, R.size) && mag[k] <= EDGE_SIZE_HI * mmD[di(k)]
        && dur[k] >= EDGE_DUR_LO * mdD[di(k)] && dur[k] <= (trail ? TRAIL_DUR_HI : EDGE_DUR_HI) * mdD[di(k)] && cosTo[k] >= EDGE_COS;
      // The pair's outer half borders whatever came before or after the
      // set, so it only has to be rep-sized; its inner half gets it all.
      const okEdge = (k, gap, trail) => gap >= R.lo * cg && gap <= (trail ? R.trail : R.hi) * cg
        && (trail ? half(k, true) && sizeOk(k + 1, R.size) : sizeOk(k, R.size) && half(k + 1, false));
      const tt = times.slice();
      for (let j = first - 1; j >= 0; j--) {
        const k = pairs[j];
        if (!okEdge(k, tt[0] - at[k], false)) break;
        tt.unshift(at[k]);
      }
      for (let j = last + 1; j < pairs.length; j++) {
        const k = pairs[j];
        if (!okEdge(k, at[k] - tt[tt.length - 1], true)) break;
        tt.push(at[k]);
      }
      grown.push(tt);
    }
    let agree = grown[0].length === grown[1].length;
    // The readings differ by one trailing rep: a slow last rep, or something
    // done after the set. A last rep returns cleanly to where it began.
    if (!agree && grown[1].length === grown[0].length + 1 && grown[1][0] === grown[0][0]) {
      const k = pairs.find((q) => at[q] === grown[1][grown[1].length - 1]);
      const gap = (at[k] - grown[0][grown[0].length - 1]) / cg;
      const cl = Math.abs(raw[ei[k + 2]] - raw[ei[k]]) / (Math.abs(raw[ei[k + 1]] - raw[ei[k]]) || 1);
      if (cl <= TRAIL_CLOSE && gap <= TRAIL_GAP && mag[k + 1] >= TRAIL_SIZE * mmD[di(k + 1)]) { grown[0] = grown[1]; agree = true; }
    }
    times.length = 0;
    for (const t of grown[0]) times.push(t);
    let cv = 0;
    if (times.length >= 3) {
      let m = 0;
      for (let j = 1; j < times.length; j++) m += times[j] - times[j - 1];
      m /= times.length - 1;
      let v = 0;
      for (let j = 1; j < times.length; j++) v += (times[j] - times[j - 1] - m) ** 2;
      cv = Math.sqrt(v / (times.length - 1)) / m;
    }
    if (times.length > best.reps || (times.length === best.reps && cv < best.cv)) best = { reps: times.length, cv, times, agree };
  }
  return { reps: best.reps, cv: best.cv, amp: Math.min(mmD[0] || 0, mmD[1] || 0), times: best.times, agree: best.agree === true };
}

// The longest chain of pairs that keeps the beat, allowing single non-strict
// (but rep-like) pairs between strict ones. { t0, t1, strict } or null.
function bridgeRun(pairs, keep, loose, at, T) {
  const cand = [];
  for (const k of pairs) {
    const st = keep[k] && keep[k + 1];
    if (st || (loose(k) && loose(k + 1))) cand.push({ t: at[k], st });
  }
  let best = null;
  for (let i = 0; i < cand.length; i++) {
    if (!cand[i].st) continue;
    let j = i, lastStrict = i, n = 1;
    while (j + 1 < cand.length) {
      const g = cand[j + 1].t - cand[j].t;
      if (g < GAP_LO * T || g > GAP_HI * T) break;
      if (!cand[j + 1].st && !cand[j].st) break;
      if ((!cand[j + 1].st || !cand[j].st) && (g < (1 - BRIDGE_GAP) * T || g > (1 + BRIDGE_GAP) * T)) break;
      j++;
      if (cand[j].st) { lastStrict = j; n++; }
    }
    if (n >= BRIDGE_MIN && (!best || n > best.strict)) best = { t0: cand[i].t, t1: cand[lastStrict].t, strict: n };
    i = lastStrict;
  }
  return best;
}

function stillBlock(x, y, z, b) {
  let v = 0;
  for (const a of [x, y, z]) {
    const m = mean(a, b, b + BLOCK);
    for (let i = b; i < b + BLOCK; i++) v += (a[i] - m) * (a[i] - m);
  }
  return Math.sqrt(v / BLOCK) <= MIN_MOTION;
}

// Hold the START wrist movements still: everything before the first still
// second within TRIM_LEAD of the start, and after the last still second
// within TRIM_TRAIL of the end. Modifies the arrays in place.
export function trimWindow(x, y, z) {
  const n = x.length;
  if (n < 2 * BLOCK) return;
  for (let b = 0; b <= Math.min(TRIM_LEAD, n - BLOCK); b += TRIM_STEP) {
    if (!stillBlock(x, y, z, b)) continue;
    for (let i = 0; i < b; i++) { x[i] = x[b]; y[i] = y[b]; z[i] = z[b]; }
    break;
  }
  for (let e = n; e - BLOCK >= Math.max(0, n - TRIM_TRAIL - BLOCK); e -= TRIM_STEP) {
    if (!stillBlock(x, y, z, e - BLOCK)) continue;
    for (let i = e; i < n; i++) { x[i] = x[e - 1]; y[i] = y[e - 1]; z[i] = z[e - 1]; }
    break;
  }
}

// Longest run in sorted crossing times whose gaps fit the rhythm.
// { len: crossings in the run, cv: spread of its gaps }.
export function rhythmRun(t, T) {
  if (t.length === 0) return { len: 0, cv: 1, lo: 0 };
  let bestLo = 0, bestLen = 1, lo = 0;
  for (let k = 1; k <= t.length; k++) {
    let ok = k < t.length;
    if (ok) {
      const g = t[k] - t[k - 1];
      ok = g >= GAP_LO * T && g <= GAP_HI * T;
    }
    if (!ok) {
      if (k - lo > bestLen) { bestLen = k - lo; bestLo = lo; }
      lo = k;
    }
  }
  let cv = 0;
  if (bestLen >= 3) {
    let m = 0;
    for (let k = bestLo + 1; k < bestLo + bestLen; k++) m += t[k] - t[k - 1];
    m /= bestLen - 1;
    let v = 0;
    for (let k = bestLo + 1; k < bestLo + bestLen; k++) v += (t[k] - t[k - 1] - m) ** 2;
    cv = Math.sqrt(v / (bestLen - 1)) / m;
  }
  return { len: bestLen, cv, lo: bestLo };
}

// Best normalised autocorrelation of y[a0, a1) at lags within 15 % of T.
export function spanAc(y, a0, a1, T) {
  let best = 0;
  const l0 = Math.max(1, Math.floor(0.85 * T)), l1 = Math.ceil(1.15 * T);
  for (let L = l0; L <= l1; L++) {
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = a0; i + L < a1; i++) {
      sxy += y[i] * y[i + L]; sxx += y[i] * y[i]; syy += y[i + L] * y[i + L];
    }
    const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    if (r > best) best = r;
  }
  return best;
}

// One bout -> { reps, ac, cv, T, ok }.
export function analyzeBout(x, y, z, lo, hi) {
  const n = hi - lo;
  const res = { reps: 0, ac: 0, cv: 1, T: 0, ok: false, lo, hi };
  if (n < 3 * FS) return res;
  const [vx, vy, vz, mx, my, mz] = principal(x, y, z, lo, hi);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = vx * (x[lo + i] - mx) + vy * (y[lo + i] - my) + vz * (z[lo + i] - mz);
  }
  // Drift out before looking for the period (5 s window).
  const slow = movAvg(s, 63);
  const s1 = new Array(n);
  for (let i = 0; i < n; i++) s1[i] = s[i] - slow[i];
  const [T, ac0] = period(s1);
  let ac = ac0;
  res.ac = ac;
  res.T = T;
  if (T <= 0 || n < 1.8 * T) return res;
  const base = movAvg(s, Math.max(3, Math.round(T)));
  const y1 = new Array(n);
  for (let i = 0; i < n; i++) y1[i] = s[i] - base[i];
  const yy = movAvg(y1, Math.max(1, Math.round(T / 5)));
  // The axes, smoothed the same way, for the swing directions.
  const w5 = Math.max(1, Math.round(T / 5));
  const ax = movAvg(x.slice(lo, hi), w5), ay = movAvg(y.slice(lo, hi), w5), az = movAvg(z.slice(lo, hi), w5);
  const raw = movAvg(s, w5);
  const c = countCycles(yy, T, ax, ay, az, raw);
  res.reps = c.reps;
  res.cv = c.cv;
  // Periodicity over the counted reps only: a big pick-up beside small
  // squat reps must not make a clean set look aperiodic.
  if (c.reps >= 2) {
    const a0 = Math.max(0, c.times[0] - Math.round(0.6 * T));
    const a1 = Math.min(n, c.times[c.times.length - 1] + Math.round(1.2 * T));
    res.ac = spanAc(yy, a0, a1, T);
  }
  ac = res.ac;
  res.amp = c.amp;
  res.times = (c.times || []).map((t) => lo + t);
  // Three or four "reps" happen by accident far more often than fifteen
  // do, so a short set needs a cleaner rhythm to be believed.
  const short = c.reps <= SHORT_REPS;
  res.why = c.reps < MIN_REPS ? 'few' : !c.agree ? 'edge' : res.ac < (short ? SHORT_AC : MIN_AC) ? 'ac' : c.cv > (short ? SHORT_CV : MAX_CV) ? 'cv' : c.amp < MIN_AMP ? 'amp' : '';
  res.ok = res.ac >= (short ? SHORT_AC : MIN_AC) && c.cv <= (short ? SHORT_CV : MAX_CV)
    && n <= (c.reps + 3) * T * 1.3
    && c.reps >= MIN_REPS && c.amp >= MIN_AMP && c.agree;
  return res;
}

// The whole buffer -> { reps, ok, ac, cv, T, bouts }. The set is the bout
// with the best reps x periodicity score; ties go to the later bout.
// Per-exercise tuning (src/lib/reps/tuning.ts, Reps.configure on the watch):
// four decision thresholds a user's own sets may move, inside ranges that
// keep the counter's structure intact. Anything outside, or any other key,
// is ignored here and on the watch alike. Bump ALGO_VERSION whenever the
// counter changes in a way that makes old tunings meaningless.
export const ALGO_VERSION = '2026-11-18';
export const TUNE_DEFAULTS = Object.freeze({ ac: 0.60, cv: 0.32, swing: 0.45, lag: 8 });
export const TUNE_RANGES = Object.freeze({ ac: [0.45, 0.75], cv: [0.22, 0.45], swing: [0.30, 0.60], lag: [6, 10] });

/** Valid overrides only, rounded the way the watch stores them. */
export function cleanParams(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const k of Object.keys(TUNE_RANGES)) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = TUNE_RANGES[k];
    if (v < lo || v > hi) continue;
    out[k] = k === 'lag' ? Math.round(v) : Math.round(v * 100) / 100;
  }
  return out;
}

function applyParams(p) {
  const q = { ...TUNE_DEFAULTS, ...cleanParams(p) };
  MIN_AC = q.ac; MAX_CV = q.cv; SWING_MIN = q.swing; LAG_MIN = q.lag;
}

export function analyze(x, y, z, steps, params) {
  if (params) {
    applyParams(params);
    try { return analyzeDefault(x, y, z, steps); } finally { applyParams(null); }
  }
  return analyzeDefault(x, y, z, steps);
}

function analyzeDefault(x, y, z, steps) {
  x = x.slice(); y = y.slice(); z = z.slice();
  trimWindow(x, y, z);
  if (x.length) {
    const pad = a => Array(BLOCK).fill(a[0]).concat(a);
    x = pad(x); y = pad(y); z = pad(z); steps = pad(steps);
  }
  const bs = bouts(x, y, z, steps);
  let best = null, bestScore = 0;
  const all = [];
  for (const [lo, hi] of bs) {
    const r = analyzeBout(x, y, z, lo, hi);
    all.push(r);
    if (!r.ok) continue;
    const score = r.reps * r.ac;
    if (score >= bestScore) { best = r; bestScore = score; }
  }
  if (!best) return { reps: 0, ok: false, bouts: all };
  // A set the counter only sees in pieces (the wrist barely moves, so the
  // motion keeps dropping out) shows up as several rep-like bouts with the
  // same rhythm. Any one piece would be an undercount: say nothing.
  for (const r of all) {
    if (r === best || r.reps < 2 || r.ac < FRAG_AC) continue;
    if (Math.abs(r.T - best.T) <= FRAG_T * best.T) return { reps: 0, ok: false, bouts: all, frag: true };
  }
  return { reps: best.reps, ok: true, amp: best.amp, ac: best.ac, cv: best.cv, T: best.T, bouts: all, times: best.times.map(t => Math.max(0, t - BLOCK)) };
}
