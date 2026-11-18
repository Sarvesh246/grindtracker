// Synthetic wrist-accelerometer sessions for tuning the rep counter.
//   node watch/tools/repsim.mjs            accuracy report
//   node watch/tools/repsim.mjs --seed 7   one session, verbose (--whole: old timeline)
//
// Each session: things people do before a set (stand still, fidget, check the
// watch, sip water, pick the weight up, walk over), the set itself with
// per-rep tempo/size jitter, fatigue and sometimes a failed last rep, then
// what comes after (re-rack, walk off).
//
// Two timelines. "START window" is what the watch analyzes now: the buffer
// opens at START (the wrist coming down from the screen), may hold an unrack
// or a short walk, then the set, then a re-rack or partial, and ends once the
// wrist has been still for a second, when the settled count is computed.
// "Whole buffer" is the older free-running timeline with everything around
// the set, kept as a stress test for stray motion.
//
// Two timelines. "window" is what the watch analyzes now: the buffer opens
// at START (the wrist coming down from the screen), may hold an unrack or a
// short walk, then the set, then a re-rack or partial, and ends once the
// wrist has been still for a second, which is when the settled count is
// computed. "whole" is the older free-running buffer with everything around
// the set, kept as a stress test for stray motion. The watch sits at a random angle on
// the wrist. Physics: the accelerometer reads specific force (gravity + the
// limb's linear acceleration) in the watch's rotating frame, plus noise.
//
// Synthetic data can't prove the counter on real lifts, but it pins the
// failure modes that matter: extra reps from stray motion, walking counted as
// reps, and guessing on lifts the wrist barely moves in. For those the right
// answer is "no count", and the report scores it that way.

import { analyze } from './reps.mjs';

const RAW = 25; // Hz the watch samples at

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const uni = (r, a, b) => a + (b - a) * r();

function norm(v) { const n = Math.hypot(...v); return v.map((c) => c / n); }
// Rodrigues: rotate v by angle th (rad) about unit axis u.
function rot(v, u, th) {
  const c = Math.cos(th), s = Math.sin(th);
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [0, 1, 2].map((i) => v[i] * c + x[i] * s + u[i] * d * (1 - c));
}
const smooth = (p) => p * p * (3 - 2 * p); // 0..1 ease

// Lifts. rot: wrist rotation (deg) through a rep; lin: hand travel (m);
// dir: travel direction in the world (z up); con/ecc: seconds up/down;
// hold: pause at each end; detect: whether a wrist can honestly see it.
const LIFTS = {
  // arms
  curl:            { rot: 115, axis: [1, 0, 0], lin: 0.25, dir: [0, 0, 1], con: 1.0, ecc: 1.6, hold: 0.3, detect: true },
  hammer_curl:     { rot: 95,  axis: [0, 1, 0], lin: 0.25, dir: [0, 0, 1], con: 1.0, ecc: 1.5, hold: 0.3, detect: true },
  lateral_raise:   { rot: 75,  axis: [0, 1, 0], lin: 0.45, dir: [0, 0, 1], con: 1.0, ecc: 1.5, hold: 0.4, detect: true },
  tricep_pushdown: { rot: 35,  axis: [1, 0, 0], lin: 0.25, dir: [0, 0, 1], con: 0.8, ecc: 1.3, hold: 0.3, detect: true },
  shoulder_press:  { rot: 12,  axis: [1, 0, 0], lin: 0.45, dir: [0, 0, 1], con: 1.0, ecc: 1.6, hold: 0.4, detect: true },
  // chest / back
  bench_press:     { rot: 6,   axis: [1, 0, 0], lin: 0.40, dir: [0, 0, 1], con: 1.0, ecc: 1.6, hold: 0.5, detect: true },
  push_up:         { rot: 28,  axis: [0, 1, 0], lin: 0.02, dir: [0, 0, 1], con: 0.9, ecc: 1.2, hold: 0.2, detect: true },
  row:             { rot: 25,  axis: [0, 1, 0], lin: 0.35, dir: [1, 0, 0], con: 0.9, ecc: 1.4, hold: 0.4, detect: true },
  lat_pulldown:    { rot: 30,  axis: [1, 0, 0], lin: 0.50, dir: [0, 0, 1], con: 1.0, ecc: 1.6, hold: 0.4, detect: true },
  pull_up:         { rot: 22,  axis: [1, 0, 0], lin: 0.05, dir: [0, 0, 1], con: 1.1, ecc: 1.5, hold: 0.4, detect: true },
  // legs
  squat:           { rot: 10,  axis: [1, 0, 0], lin: 0.50, dir: [0, 0, 1], con: 1.2, ecc: 1.8, hold: 0.6, detect: true },
  deadlift:        { rot: 18,  axis: [1, 0, 0], lin: 0.55, dir: [0, 0, 1], con: 1.2, ecc: 1.4, hold: 0.8, detect: true },
  goblet_lunge:    { rot: 12,  axis: [1, 0, 0], lin: 0.35, dir: [0, 0, 1], con: 1.1, ecc: 1.3, hold: 0.5, detect: true, stepsPerRep: 1 },
  leg_press:       { rot: 1,   axis: [1, 0, 0], lin: 0.01, dir: [1, 0, 0], con: 1.2, ecc: 1.6, hold: 0.4, detect: false },
  leg_extension:   { rot: 1,   axis: [1, 0, 0], lin: 0.01, dir: [0, 0, 1], con: 1.0, ecc: 1.5, hold: 0.4, detect: false },
  // abs
  crunch:          { rot: 35,  axis: [1, 0, 0], lin: 0.12, dir: [0, 0, 1], con: 0.9, ecc: 1.1, hold: 0.3, detect: true },
  sit_up:          { rot: 70,  axis: [1, 0, 0], lin: 0.40, dir: [0, 0, 1], con: 1.2, ecc: 1.4, hold: 0.3, detect: true },
  cable_crunch:    { rot: 30,  axis: [1, 0, 0], lin: 0.30, dir: [0, 0, 1], con: 1.0, ecc: 1.3, hold: 0.4, detect: true },
  hanging_leg_raise: { rot: 4, axis: [1, 0, 0], lin: 0.02, dir: [1, 0, 0], con: 1.2, ecc: 1.5, hold: 0.4, detect: false },
};

// A timeline of segments, each yields (t) -> { th, axis, pos, dir } of the wrist.
function session(r, liftName, reps, opts = {}) {
  const L = LIFTS[liftName];
  const segs = [];
  const pushHold = (d) => segs.push({ d, f: () => ({ th: 0, p: 0 }) });
  const pushMotion = (d, amp, prof, axis, dir, lin, lab) => segs.push({ lab, d, f: (t) => ({ th: amp * prof(t / d), p: lin * prof(t / d) }), axis, dir });
  const bump = (u) => (u < 0.5 ? smooth(u * 2) : smooth(2 - u * 2)); // up and back
  // Raise, hold (reading the screen, pressing START), lower.
  const glance = (u) => (u < 0.2 ? smooth(u / 0.2) : u < 0.8 ? 1 : smooth((1 - u) / 0.2));
  const oneWay = (u) => smooth(u);
  const events = [];

  const win = opts.window === true;
  // --- before the set
  const pre = opts.pre ?? (win
    ? ['pickup', 'still', 'walk'].filter((p) => r() < (p === 'walk' ? 0.12 : 0.45))
    : ['still', 'fidget', 'watch', 'drink', 'pickup', 'walk', 'still'].filter(() => r() < 0.45));
  if (win) {
    // START was just pressed while looking at the watch.
    pushMotion(uni(r, 0.5, 1.2), 80 * Math.PI / 180, (u) => 1 - smooth(u), [0, 1, 0], [0, 0, 1], 0.3, 'lower');
    pushHold(uni(r, 0.2, 2));
  } else {
    pushHold(uni(r, 1, 3));
  }
  for (const p of pre) {
    if (p === 'still') pushHold(uni(r, 1, 4));
    if (p === 'fidget') for (let k = 0; k < 3; k++) pushMotion(uni(r, 0.3, 0.8), uni(r, 5, 20) * Math.PI / 180, bump, norm([r() - 0.5, r() - 0.5, r() - 0.5]), [0, 0, 1], uni(r, 0, 0.05), 'fidget');
    if (p === 'watch') { pushMotion(uni(r, 2.5, 5), 80 * Math.PI / 180, glance, [0, 1, 0], [0, 0, 1], 0.3, 'watch'); }
    if (p === 'drink') { pushMotion(uni(r, 3, 6), 120 * Math.PI / 180, glance, [1, 0, 0], [0, 0, 1], 0.4, 'drink'); pushHold(uni(r, 0.5, 2)); }
    if (p === 'pickup') { pushMotion(uni(r, 1.5, 2.5), L.rot * uni(r, 0.6, 1.3) * Math.PI / 180, r() < 0.5 ? oneWay : bump, L.axis, [0, 0, 1], 0.5, 'pickup'); pushHold(uni(r, 0.3, 2)); }
    if (p === 'walk') { const d = uni(r, 5, 14); segs.push({ d, walk: true, lab: 'walk' }); events.push(['walk', d]); }
  }
  pushHold(uni(r, 0.5, 2));

  // --- the set
  const ampJ = opts.ampJ ?? 0.12, tempoJ = opts.tempoJ ?? 0.15;
  const tempo = uni(r, 0.75, 1.4) * (opts.tempo ?? 1);
  let real = reps;
  for (let k = 0; k < reps; k++) {
    const fat = k >= reps - 2 ? 1 + uni(r, 0, 0.4) : 1;
    const c = L.con * tempo * fat * (1 + tempoJ * gauss(r) * 0.6);
    const e = L.ecc * tempo * (1 + tempoJ * gauss(r) * 0.6);
    const h = L.hold * tempo * uni(r, 0.5, 1.5);
    const a = 1 + ampJ * gauss(r) * 0.6;
    const d = c + e + 2 * h;
    const prof = (u) => {
      const t = u * d;
      if (t < h) return 0;
      if (t < h + c) return smooth((t - h) / c);
      if (t < h + c + h) return 1;
      return 1 - smooth(Math.min(1, (t - 2 * h - c) / e));
    };
    segs.push({ d, f: (t) => ({ th: a * L.rot * Math.PI / 180 * prof(t / d), p: a * L.lin * prof(t / d) }), axis: L.axis, dir: L.dir, steps: L.stepsPerRep || 0, lab: 'R' + (k + 1) });
  }
  if ((segs.failedRep = opts.failed ?? r() < 0.2)) {
    // A failed rep: gets a third of the way and comes back down. Not a rep.
    const d = L.con * tempo * 2;
    segs.push({ lab: 'fail', d, f: (t) => ({ th: 0.33 * L.rot * Math.PI / 180 * bump(t / d), p: 0.33 * L.lin * bump(t / d) }), axis: L.axis, dir: L.dir });
  }

  // --- after the set
  pushHold(uni(r, 0.3, 2));
  const post = opts.post ?? (win
    ? ['rerack', 'partial'].filter((p) => r() < (p === 'partial' ? 0.15 : 0.5))
    : ['rerack', 'partial', 'watch', 'walk'].filter(() => r() < 0.4));
  for (const p of post) {
    if (p === 'rerack') pushMotion(uni(r, 1.2, 2.2), L.rot * uni(r, 0.4, 1.0) * Math.PI / 180, oneWay, L.axis, [0, 0, 1], 0.4, 'rerack');
    // Worst case: a half-size rep-like motion right after the set.
    if (p === 'partial') pushMotion(uni(r, 1.2, 2.2), L.rot * uni(r, 0.3, 0.6) * Math.PI / 180, bump, L.axis, L.dir, L.lin * 0.5, 'partial');
    if (p === 'watch') pushMotion(uni(r, 2.5, 5), 80 * Math.PI / 180, glance, [0, 1, 0], [0, 0, 1], 0.3, 'watch');
    if (p === 'walk') segs.push({ d: uni(r, 4, 10), walk: true });
    pushHold(uni(r, 0.5, 1.5));
  }
  if (win) {
    // The settled count is computed after a still second.
    pushHold(uni(r, 1.0, 2.0));
    return { segs, real, detect: L.detect, pre, post, failed: segs.failedRep };
  }
  // START is pressed while looking at the watch: the counter's buffer ends
  // in the middle of the first post-set glance.
  const gi = segs.findIndex((g, i) => g.lab === 'watch' && i > segs.findIndex((q) => q.lab === 'R1'));
  if (gi >= 0) { const g = segs[gi]; const d = g.d * 0.6; const f = g.f; segs[gi] = { ...g, d, f: (t) => f(t * g.d / d * 0.6) }; segs.length = gi + 1; }
  return { segs, real, detect: L.detect, pre, post, failed: segs.failedRep };
}

// Render a session to the watch's view: 12.5 Hz, g, and the step counter.
function render(r, segs, noise = 0.02) {
  const mount = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
  const mountAng = uni(r, 0, 2 * Math.PI);
  const pos = [], ori = [], walkMask = [], stepInc = [], labs = [];
  const dt = 1 / RAW;
  for (const s of segs) {
    const n = Math.round(s.d * RAW);
    const ph = uni(r, 0, 6.28);
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      labs.push(s.lab || '.');
      if (s.walk) {
        // Arm swing ~0.9 Hz, two steps per swing, heel-strike jolts.
        const f = 0.9;
        const th = 0.45 * Math.sin(2 * Math.PI * f * t + ph);
        const stepPh = (2 * f * t) % 1;
        const jolt = stepPh < 0.08 ? 0.5 * Math.sin(Math.PI * stepPh / 0.08) : 0;
        ori.push([th, [0, 1, 0]]);
        pos.push([0, 0, jolt * 0.004]);
        walkMask.push(jolt);
        stepInc.push(stepPh < (2 * f * dt) ? 1 : 0);
      } else {
        const st = s.f(t);
        ori.push([st.th, s.axis || [1, 0, 0]]);
        pos.push((s.dir || [0, 0, 1]).map((c) => c * st.p));
        walkMask.push(0);
        stepInc.push(s.steps && i === Math.floor(n * 0.4) ? s.steps : (r() < 0.1 / RAW ? 1 : 0));
      }
    }
  }
  const n = pos.length;
  // Linear acceleration by second difference, lightly smoothed.
  const acc = [];
  for (let i = 0; i < n; i++) {
    const a = pos[Math.max(0, i - 1)], b = pos[i], c = pos[Math.min(n - 1, i + 1)];
    acc.push([0, 1, 2].map((k) => (a[k] - 2 * b[k] + c[k]) / (dt * dt) / 9.81));
  }
  const X = [], Y = [], Z = [], S = [];
  let steps = 0, tremor = uni(r, 0, 6);
  for (let i = 0; i < n; i++) {
    const [th, ax] = ori[i];
    let f = [acc[i][0], acc[i][1], acc[i][2] + 1 + walkMask[i]];
    f = rot(f, ax, -th);
    f = rot(f, mount, mountAng);
    const tr = 0.008 * Math.sin(2 * Math.PI * 9 * i * dt + tremor);
    X.push(f[0] + noise * gauss(r) + tr); Y.push(f[1] + noise * gauss(r)); Z.push(f[2] + noise * gauss(r) + tr);
    steps += stepInc[i];
    S.push(steps);
  }
  // Average pairs to 12.5 Hz, as the watch does.
  const x = [], y = [], z = [], st = [];
  for (let i = 0; i + 1 < n; i += 2) {
    x.push((X[i] + X[i + 1]) / 2); y.push((Y[i] + Y[i + 1]) / 2); z.push((Z[i] + Z[i + 1]) / 2); st.push(S[i + 1]);
  }
  const lab = [];
  for (let i = 0; i + 1 < n; i += 2) lab.push(labs[i]);
  return { x, y, z, steps: st, lab };
}

// Distractor-only sessions: no set at all. Any count is a false rep.
function noise(r) {
  const segs = [];
  const add = (d, amp, axis, lin, lab, prof) => segs.push({ lab, d, f: (t) => ({ th: amp * prof(t / d), p: lin * prof(t / d) }), axis, dir: [0, 0, 1] });
  const bump = (u) => Math.sin(Math.PI * u) ** 2;
  const glance = (u) => (u < 0.2 ? smooth(u / 0.2) : u < 0.8 ? 1 : smooth((1 - u) / 0.2));
  const kinds = ['walk', 'fidget', 'watch', 'drink', 'phone', 'stretch', 'gesture', 'towel'];
  for (let k = 0; k < 7; k++) {
    const p = kinds[Math.floor(r() * kinds.length)];
    if (p === 'walk') segs.push({ d: uni(r, 6, 20), walk: true, lab: 'walk' });
    if (p === 'fidget') for (let j = 0; j < 4; j++) add(uni(r, 0.4, 1), uni(r, 0.1, 0.4), norm([r() - 0.5, r() - 0.5, r() - 0.5]), 0.03, 'fidget', bump);
    if (p === 'watch') add(uni(r, 2.5, 6), 1.4, [0, 1, 0], 0.3, 'watch', glance);
    if (p === 'drink') add(uni(r, 3, 6), 2.0, [1, 0, 0], 0.4, 'drink', glance);
    if (p === 'phone') for (let j = 0; j < 10; j++) add(uni(r, 0.3, 0.6), uni(r, 0.02, 0.08), [0, 1, 0], 0.01, 'phone', bump);
    if (p === 'stretch') { add(uni(r, 2, 4), 1.2, [0, 1, 0], 0.4, 'stretch', glance); add(uni(r, 2, 4), 1.0, [1, 0, 0], 0.3, 'stretch', glance); }
    // Talking with your hands: irregular swings of varying size and speed.
    if (p === 'gesture') for (let j = 0; j < 6; j++) add(uni(r, 0.6, 2.0), uni(r, 0.2, 0.9), norm([r() - 0.5, r() - 0.5, r() - 0.5]), 0.1, 'gesture', bump);
    // Wiping the bench / face: a few quick back-and-forths.
    if (p === 'towel') for (let j = 0; j < 4; j++) add(uni(r, 0.5, 1.0), uni(r, 0.3, 0.6), [0, 0, 1], 0.15, 'towel', bump);
    segs.push({ d: uni(r, 1, 6), f: () => ({ th: 0, p: 0 }), lab: '.' });
  }
  return segs;
}

function lifts(window) {
  const rows = [];
  const tot = { n: 0, exact: 0, one: 0, abst: 0, wrong: 0 };
  for (const name of Object.keys(LIFTS)) {
    const s = { n: 0, exact: 0, one: 0, abst: 0, wrong: 0, over: 0 };
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed * 7919 + name.length * 31);
      const reps = 3 + Math.floor(r() * 13); // 3..15
      const ses = session(r, name, reps, { window });
      const d = render(r, ses.segs);
      const a = analyze(d.x, d.y, d.z, d.steps);
      s.n++;
      if (!a.ok) { s.abst++; if (process.env.WHY) { const b = a.bouts.slice().sort((p, q) => q.reps - p.reps)[0]; const w = a.frag ? 'frag' : b ? (b.why || (b.T ? 'n<3T' : 'noT')) : 'nobout'; (s.why ||= {})[w] = (s.why[w] || 0) + 1; } }
      else if (a.reps === ses.real) { s.exact++; if (process.env.AMPS) (s.amps ||= []).push(a.amp); }
      else {
        s.wrong++; if (Math.abs(a.reps - ses.real) <= 1) s.one++; if (a.reps > ses.real) s.over++;
        if (process.env.DIAG === name) console.log(seed, 'real', ses.real, 'got', a.reps, 'counted', (a.times || []).map((t) => d.lab[t]).join(' '), 'pre', ses.pre.join(','), 'post', ses.post.join(','), 'failed', ses.failed, a.bouts.filter((b) => b.reps).map((b) => `[${b.lo}-${b.hi} r${b.reps} ac${b.ac.toFixed(2)} cv${b.cv.toFixed(2)} T${b.T.toFixed(0)} ${b.ok ? 'OK' : ''}]`).join(' '));
      }
    }
    const det = LIFTS[name].detect;
    if (process.env.AMPS && s.amps) { const q = s.amps.sort((a, b) => a - b); console.log('AMP', name, q[0].toFixed(3), q[Math.floor(q.length * 0.05)].toFixed(3), q[Math.floor(q.length / 2)].toFixed(3)); }
    if (process.env.WHY && s.why) console.log('WHY', name, JSON.stringify(s.why));
    rows.push(`${name.padEnd(18)} ${det ? 'see ' : 'hide'}  exact ${pct(s.exact, s.n)}  shown-wrong ${pct(s.wrong, s.n)} (±1 ${s.one}, over ${s.over})  silent ${pct(s.abst, s.n)}`);
    if (det) { tot.n += s.n; tot.exact += s.exact; tot.wrong += s.wrong; tot.abst += s.abst; }
  }
  return { rows, tot };
}

function report() {
  const { rows, tot } = lifts(true);
  const whole = lifts(false).tot;
  let fp = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const r = rng(seed * 104729);
    const d = render(r, noise(r));
    const a = analyze(d.x, d.y, d.z, d.steps);
    if (a.ok) { fp++; if (process.env.DIAG === 'noise') console.log(seed, 'amp', a.amp.toFixed(3), 'got', a.reps, 'counted', a.times.map((t) => d.lab[t]).join(' '), 'ac', a.ac.toFixed(2), 'cv', a.cv.toFixed(2), 'T', a.T.toFixed(0)); }
  }
  console.log(rows.join('\n'));
  console.log(`\nwrist-visible lifts, START window: exact ${pct(tot.exact, tot.n)}, shown wrong ${pct(tot.wrong, tot.n)}, silent ${pct(tot.abst, tot.n)}`);
  console.log(`wrist-visible lifts, whole buffer: exact ${pct(whole.exact, whole.n)}, shown wrong ${pct(whole.wrong, whole.n)}, silent ${pct(whole.abst, whole.n)}`);
  console.log(`no-set sessions (walk, fidget, drink, phone, stretch): count shown ${pct(fp, N)}`);
}
const pct = (a, b) => `${((100 * a) / b).toFixed(1).padStart(5)}%`;

const si = process.argv.indexOf('--seed');
if (si > 0) {
  const seed = +process.argv[si + 1];
  const name = process.argv[si + 2] || 'curl';
  const r = rng(seed * 7919 + name.length * 31);
  const reps = 3 + Math.floor(r() * 13);
  const ses = session(r, name, reps, { window: !process.argv.includes('--whole') });
  const d = render(r, ses.segs);
  const a = analyze(d.x, d.y, d.z, d.steps);
  console.log({ name, real: ses.real, got: a.reps, ok: a.ok, bouts: a.bouts.map((b) => ({ lo: b.lo, hi: b.hi, reps: b.reps, ac: +b.ac.toFixed(2), cv: +b.cv.toFixed(2), T: +b.T.toFixed(1), amp: +(b.amp || 0).toFixed(3), ok: b.ok })) });
} else {
  report();
}
