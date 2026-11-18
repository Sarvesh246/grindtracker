// Per-exercise tuning of the rep counter on one user's own labelled sets.
//
// Four decision thresholds (reps.mjs TUNE_RANGES) are searched by coordinate
// descent from the defaults. A wrong count costs three times what a missing
// one does: AUTO filling in the wrong number is worse than AUTO staying
// quiet, so a tuning may never buy exact counts with wrong ones.
//
// A tuning is only applied when it beats the defaults on sets it was NOT
// tuned on: 5-fold cross-validation, folds by recording order, needing at
// least MIN_SETS sets, a gain of max(2, 5%) exact counts and no more wrong
// counts than the defaults. Otherwise the defaults stay (applied = false),
// and the evidence is kept either way.
//
// Your sets can't show what a looser counter does to walking between sets,
// so every candidate is also run on 200 simulated no-lift sessions (walking,
// fidgeting, drinking, phone, stretching; repsim.mjs). A candidate that shows
// a count on more than one more of them than the defaults is never chosen.
//
// Used by the nightly job (src/lib/reps/tuning.ts) and `npm run replab -- --tune`.
import { analyze, cleanParams, TUNE_DEFAULTS } from './reps.mjs';
import { noSetSessions } from './repsim.mjs';

export const MIN_SETS = 20;
export const WRONG_COST = 3;
const FOLDS = 5;
const SWEEPS = 3;
const GRID = {
  ac: [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75],
  cv: [0.22, 0.27, 0.32, 0.38, 0.45],
  swing: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6],
  lag: [6, 7, 8, 9, 10],
};

/** A labelled set in the stored units: milli-g at 12.5 Hz. */
export function prepare(row) {
  const g = (a) => a.map((v) => v / 1000);
  const n = row.motion_x.length;
  return {
    x: g(row.motion_x), y: g(row.motion_y), z: g(row.motion_z),
    steps: row.steps?.length === n ? row.steps : new Array(n).fill(0),
    truth: row.logged_reps,
  };
}

/** Sets worth learning from: a real motion window and a plausible count,
 *  not cut short by a sensor gap. */
export function eligible(row) {
  return Array.isArray(row.motion_x) && row.motion_x.length >= 48
    && row.motion_y?.length === row.motion_x.length && row.motion_z?.length === row.motion_x.length
    && Number.isInteger(row.logged_reps) && row.logged_reps >= 1 && row.logged_reps <= 100
    && row.diag?.interrupted !== true;
}

const keyOf = (p) => `${p.ac}|${p.cv}|${p.swing}|${p.lag}`;

export const NO_SET_SESSIONS = 200;
export const NO_SET_SLACK = 2;
let corpus = null;
const fpMemo = new Map();

/** How many simulated no-lift sessions show a count with these settings. */
export function falsePositives(p) {
  const k = keyOf(p);
  if (fpMemo.has(k)) return fpMemo.get(k);
  if (!corpus) corpus = noSetSessions(NO_SET_SESSIONS);
  let n = 0;
  for (const s of corpus) { const r = analyze(s.x, s.y, s.z, s.steps, p); if (r && r.ok) n++; }
  fpMemo.set(k, n);
  return n;
}

const safe = (p) => falsePositives(p) <= falsePositives(TUNE_DEFAULTS) + NO_SET_SLACK;

/** Memoised counts: every fold re-evaluates the same settings on the same sets. */
export function makeEvaluator(sets) {
  const memo = new Map();
  return function count(i, p) {
    const k = keyOf(p);
    let row = memo.get(k);
    if (!row) { row = new Array(sets.length); memo.set(k, row); }
    if (row[i] === undefined) {
      const s = sets[i];
      const r = analyze(s.x, s.y, s.z, s.steps, p);
      row[i] = r && r.ok ? r.reps : null;
    }
    return row[i];
  };
}

export function score(count, sets, idx, p) {
  const out = { exact: 0, wrong: 0, none: 0 };
  for (const i of idx) {
    const got = count(i, p);
    if (got == null) out.none++;
    else if (got === sets[i].truth) out.exact++;
    else out.wrong++;
  }
  return out;
}

const utility = (s) => s.exact - WRONG_COST * s.wrong;
const distance = (p) => Object.keys(GRID).reduce((d, k) => d + Math.abs(GRID[k].indexOf(p[k]) - GRID[k].indexOf(TUNE_DEFAULTS[k])), 0);

/** Best settings on `idx`, by coordinate descent from the defaults. Ties
 *  keep the setting closer to the defaults. */
export function tune(count, sets, idx) {
  let best = { ...TUNE_DEFAULTS };
  let bestU = utility(score(count, sets, idx, best));
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let moved = false;
    for (const k of Object.keys(GRID)) {
      for (const v of GRID[k]) {
        if (v === best[k]) continue;
        const p = { ...best, [k]: v };
        const u = utility(score(count, sets, idx, p));
        if ((u > bestU || (u === bestU && distance(p) < distance(best))) && safe(p)) { best = p; bestU = u; moved = true; }
      }
    }
    if (!moved) break;
  }
  return best;
}

/** Only the keys that differ from the defaults: what the watch is sent. */
export function overrides(p) {
  const out = {};
  for (const k of Object.keys(TUNE_DEFAULTS)) if (p[k] !== TUNE_DEFAULTS[k]) out[k] = p[k];
  return cleanParams(out);
}

/**
 * The whole decision for one exercise. `rows` are stored rep_lab_sets rows,
 * oldest first. Returns null with too few usable sets.
 */
export function tuneExercise(rows) {
  const sets = rows.filter(eligible).map(prepare);
  if (sets.length < MIN_SETS) return null;
  const count = makeEvaluator(sets);
  const all = sets.map((_, i) => i);
  const def = { exact: 0, wrong: 0, none: 0 };
  const cv = { exact: 0, wrong: 0, none: 0 };
  for (let f = 0; f < FOLDS; f++) {
    const test = all.filter((i) => i % FOLDS === f);
    const train = all.filter((i) => i % FOLDS !== f);
    const p = tune(count, sets, train);
    const d = score(count, sets, test, TUNE_DEFAULTS);
    const t = score(count, sets, test, p);
    for (const k of ['exact', 'wrong', 'none']) { def[k] += d[k]; cv[k] += t[k]; }
  }
  const final = tune(count, sets, all);
  const params = overrides(final);
  const gain = cv.exact - def.exact;
  const applied = Object.keys(params).length > 0
    && gain >= Math.max(2, Math.ceil(0.05 * sets.length))
    && cv.wrong <= def.wrong;
  return {
    params: applied ? params : {},
    candidate: params,
    noSetCounts: { defaults: falsePositives(TUNE_DEFAULTS), tuned: falsePositives(final) },
    setsUsed: sets.length,
    defaultExact: def.exact, defaultWrong: def.wrong,
    tunedExact: cv.exact, tunedWrong: cv.wrong,
    applied,
  };
}
