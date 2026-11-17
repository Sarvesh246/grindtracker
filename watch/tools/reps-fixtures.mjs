// Deterministic fixtures shared with source/Tests.mc (testRepsParity*): the
// same generator in both languages, so the Monkey C port can be checked
// against tools/reps.mjs. Run `node watch/tools/reps-fixtures.mjs` for the
// numbers the watch tests expect.
import { analyze } from './reps.mjs';

let seed = 1;
const lcg = () => { seed = (seed * 75 + 74) % 65537; return seed / 65537 - 0.5; };
const smooth = (u) => u * u * (3 - 2 * u);

// Curl-like: gravity turning about the watch's x axis. Optional glance at
// the end: the wrist turns to the screen and stays there (START is pressed).
export function curl(reps, glance) {
  seed = 7;
  const th = [], ph = [];
  for (let i = 0; i < 37; i++) { th.push(0); ph.push(0); }
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < 4; i++) { th.push(0); ph.push(0); }
    for (let i = 0; i < 12; i++) { th.push(2 * smooth((i + 1) / 12)); ph.push(0); }
    for (let i = 0; i < 4; i++) { th.push(2); ph.push(0); }
    for (let i = 0; i < 20; i++) { th.push(2 - 2 * smooth((i + 1) / 20)); ph.push(0); }
  }
  for (let i = 0; i < 37; i++) { th.push(0); ph.push(0); }
  if (glance) {
    for (let i = 0; i < 6; i++) { th.push(0); ph.push(1.3 * smooth((i + 1) / 6)); }
    for (let i = 0; i < 15; i++) { th.push(0); ph.push(1.3); }
  }
  const x = [], y = [], z = [], s = [];
  for (let i = 0; i < th.length; i++) {
    const vy = -Math.sin(th[i]), vz = Math.cos(th[i]);
    x.push(vz * Math.sin(ph[i]) + 0.03 * lcg());
    y.push(vy + 0.03 * lcg());
    z.push(vz * Math.cos(ph[i]) + 0.03 * lcg());
    s.push(0);
  }
  return [x, y, z, s];
}

// Press-like: the hand moves 0.4 m straight up and down (linear
// acceleration, two lobes per stroke) with a slight wrist tilt.
export function press(reps) {
  seed = 11;
  const p = [];
  for (let i = 0; i < 37; i++) p.push(0);
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < 6; i++) p.push(0);
    for (let i = 0; i < 14; i++) p.push(smooth((i + 1) / 14));
    for (let i = 0; i < 6; i++) p.push(1);
    for (let i = 0; i < 18; i++) p.push(1 - smooth((i + 1) / 18));
  }
  for (let i = 0; i < 37; i++) p.push(0);
  const dt = 0.08;
  const x = [], y = [], z = [], s = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[Math.min(p.length - 1, i + 1)];
    const acc = (a - 2 * b + c) / (dt * dt) * 0.4 / 9.81;
    const tilt = 0.12 * p[i];
    x.push(Math.sin(tilt) + 0.02 * lcg());
    y.push(0.02 * lcg());
    z.push(Math.cos(tilt) + acc + 0.02 * lcg());
    s.push(0);
  }
  return [x, y, z, s];
}

// No set: random fidgeting, never periodic.
export function fidget() {
  seed = 3;
  const x = [], y = [], z = [], s = [];
  let a = 0, b = 0;
  for (let i = 0; i < 600; i++) {
    a += 0.15 * lcg(); b += 0.15 * lcg();
    a *= 0.97; b *= 0.97;
    x.push(Math.sin(a) + 0.03 * lcg());
    y.push(Math.sin(b) + 0.03 * lcg());
    z.push(Math.cos(a) * Math.cos(b) + 0.03 * lcg());
    s.push(0);
  }
  return [x, y, z, s];
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('reps-fixtures.mjs')) {
  const show = (name, d) => { const r = analyze(...d); console.log(name.padEnd(14), 'samples', d[0].length, 'reps', r.reps, 'ok', r.ok); };
  show('curl 8', curl(8, false));
  show('curl 8+glance', curl(8, true));
  show('curl 12', curl(12, false));
  show('press 6', press(6));
  show('fidget', fidget());
}
