// Rep lab report: the sets the watch recorded (migration 66), what was
// logged, what AUTO showed and when, and what the current counter in
// tools/reps.mjs makes of the same motion. Each set is also saved to
// watch/lab-data/<id>.json for replaying and tuning.
//
//   npm run replab                  last 7 days
//   npm run replab -- --days 30
//   npm run replab -- --offline     use the saved files, no network
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).
// Truth is `logged_reps`: fix a wrong AUTO number before finishing the set
// (or Undo and re-save it), and the recording carries the corrected count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './reps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'lab-data');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const days = +arg('--days', 7);
const offline = process.argv.includes('--offline');

async function pull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (npm run replab loads .env.local).');
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = [];
  for (let from = 0; ; from += 200) {
    const res = await fetch(`${url}/rest/v1/rep_lab_sets?select=*&created_at=gte.${since}&order=finished_at.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 199}` },
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes('PGRST205')) throw new Error('rep_lab_sets does not exist yet: paste docs/sql/66-rep-lab.sql into the Supabase SQL editor.');
      throw new Error(`rep_lab_sets: HTTP ${res.status} ${text}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < 200) break;
  }
  fs.mkdirSync(DATA, { recursive: true });
  for (const r of rows) fs.writeFileSync(path.join(DATA, `${r.id}.json`), JSON.stringify(r));
  return rows;
}

function local() {
  if (!fs.existsSync(DATA)) return [];
  const cutoff = Date.now() - days * 86_400_000;
  return fs.readdirSync(DATA).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')))
    .filter((r) => new Date(r.created_at).getTime() >= cutoff)
    .sort((a, b) => String(a.finished_at).localeCompare(String(b.finished_at)));
}

// Seconds from the last wrist motion to the first count shown after it, from
// the watch's timeline: kind 5 = settled, kind 2 = count shown.
function latency(events) {
  if (!Array.isArray(events)) return null;
  let settled = null;
  for (const e of events) {
    if (e[1] === 5) settled = e[0];
    if (e[1] === 2 && e[2] >= 0 && settled != null) return ((e[0] - settled) / 1000).toFixed(1);
  }
  return null;
}

let rows;
try {
  rows = offline ? local() : await pull();
} catch (err) {
  console.error(String(err.message ?? err));
  process.exitCode = 1;
  rows = null;
}
if (rows && rows.length === 0) console.log(`No rep lab sets in the last ${days} days.`);
if (rows && rows.length > 0) report(rows);

function report(rows) {

const score = { watch: { exact: 0, wrong: 0, none: 0 }, replay: { exact: 0, wrong: 0, none: 0 } };
const tally = (s, got, truth) => { if (got == null) s.none++; else if (got === truth) s.exact++; else s.wrong++; };
console.log('when              exercise                  logged  auto  shown  replay  settle→count  notes');
for (const r of rows) {
  const g = (v) => (v ?? []).map((n) => n / 1000);
  const a = r.motion_x?.length ? analyze(g(r.motion_x), g(r.motion_y), g(r.motion_z), r.steps?.length ? r.steps : new Array(r.motion_x.length).fill(0)) : null;
  const replay = a?.ok ? a.reps : null;
  tally(score.watch, r.auto_reps, r.logged_reps);
  tally(score.replay, replay, r.logged_reps);
  const notes = [r.typed && 'typed', r.corrected && 'corrected', r.clipped && 'clipped', r.diag?.interrupted && 'sensor gap', r.diag?.manual && 'manual'].filter(Boolean).join(',');
  console.log(
    `${String(r.finished_at ?? '').slice(5, 16).replace('T', ' ').padEnd(17)} ${String(r.exercise_name ?? '?').slice(0, 25).padEnd(25)} ${String(r.logged_reps).padStart(6)} ${String(r.auto_reps ?? '-').padStart(5)} ${(r.auto_shown ? 'yes' : 'no').padStart(6)} ${String(replay ?? '-').padStart(7)} ${String(latency(r.events) ?? '-').padStart(13)}  ${notes}`,
  );
}
const line = (name, s) => {
  const n = s.exact + s.wrong + s.none;
  return `${name}: exact ${s.exact}/${n}, wrong ${s.wrong}, no count ${s.none}`;
};
console.log(`\n${line('On the watch', score.watch)}\n${line('Current counter, replayed', score.replay)}`);
console.log(`Saved to ${path.relative(process.cwd(), DATA)}/`);
}
