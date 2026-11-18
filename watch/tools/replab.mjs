// Rep lab report: the feedback loop for the rep counter.
//
//   record on the watch -> npm run replab -> tune tools/reps.mjs ->
//   npm run replab -- --offline (did it help on real sets?) -> port to
//   source/Reps.mc -> parity check -> sideload -> record more.
//
// For every set the watch recorded (migrations 66-67) it shows what was
// logged, what AUTO showed and how fast, and what the CURRENT counter in
// tools/reps.mjs makes of the same motion. Then accuracy per exercise, the
// kinds of miss, and the watch's own health (crashes, battery, memory, the
// longest counter step, uploads). Everything is saved under watch/lab-data/
// (gitignored) so tuning runs offline against your real lifts.
//
//   npm run replab                      last 30 days, pulled from the server
//   npm run replab -- --days 90
//   npm run replab -- --offline         the saved files only, no network
//   npm run replab -- --save-baseline   remember today's replay results
//   npm run replab -- --set <id-prefix> one set in detail (timeline, diag)
//
// After --save-baseline, every run lists the sets a change fixed or broke.
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).
// Truth is `logged_reps`: fix a wrong AUTO number before finishing the set
// (or Undo and re-save it), and the recording carries the corrected count.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './reps.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(HERE, '..', 'lab-data')
const HEALTH = path.join(DATA, 'telemetry')
const BASELINE = path.join(DATA, 'baseline.json')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const days = +arg('--days', 30)
const offline = process.argv.includes('--offline')
const saveBaseline = process.argv.includes('--save-baseline')
const only = arg('--set', null)

const EVENT = { 1: 'first batch', 2: 'count shown', 3: 'analysis done', 4: 'sensor gap', 5: 'wrist settled', 6: 'glance kept count', 7: 'taken over by hand' }
const GAP = ['?', 'sample gap', 'invalid sample count', 'unexpected sample count', 'invalid sample interval', 'unexpected sample spacing', 'missing accelerometer', 'sensor timeout']

async function fetchAll(table, order) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (npm run replab loads .env.local).')
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const rows = []
  for (let from = 0; ; from += 200) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&created_at=gte.${since}&order=${order}.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 199}` },
    })
    if (!res.ok) {
      const text = await res.text()
      if (text.includes('PGRST205')) return null // table not there yet
      throw new Error(`${table}: HTTP ${res.status} ${text}`)
    }
    const page = await res.json()
    rows.push(...page)
    if (page.length < 200) break
  }
  return rows
}

function save(dir, rows) {
  fs.mkdirSync(dir, { recursive: true })
  for (const r of rows) fs.writeFileSync(path.join(dir, `${r.id}.json`), JSON.stringify(r))
}

function load(dir, sortKey) {
  if (!fs.existsSync(dir)) return []
  const cutoff = Date.now() - days * 86_400_000
  return fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'baseline.json')
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(r => r && r.id && new Date(r.created_at).getTime() >= cutoff)
    .sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])))
}

// Seconds from the wrist going still to the first count shown after it.
function latency(events) {
  if (!Array.isArray(events)) return null
  let settled = null
  for (const e of events) {
    if (e[1] === 5) settled = e[0]
    if (e[1] === 2 && e[2] >= 0 && settled != null) return (e[0] - settled) / 1000
  }
  return null
}

function replay(r) {
  if (!r.motion_x?.length) return null
  const g = v => (v ?? []).map(n => n / 1000)
  const a = analyze(g(r.motion_x), g(r.motion_y), g(r.motion_z), r.steps?.length === r.motion_x.length ? r.steps : new Array(r.motion_x.length).fill(0))
  return a?.ok ? a.reps : null
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-')
const quant = (xs, q) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const blank = () => ({ exact: 0, over: 0, under: 0, none: 0, n: 0 })
function tally(s, got, truth) {
  s.n++
  if (got == null) s.none++
  else if (got === truth) s.exact++
  else if (got > truth) s.over++
  else s.under++
}
const line = s => `exact ${s.exact}/${s.n} (${pct(s.exact, s.n)})  over ${s.over}  under ${s.under}  no count ${s.none}`

function detail(r) {
  console.log(`\n${r.id}  ${r.exercise_name} set ${r.set_number}  ${r.weight ?? ''} ${r.unit ?? ''}`)
  console.log(`logged ${r.logged_reps}${r.corrected ? ' (corrected)' : ''}  auto ${r.auto_reps ?? '-'}  shown ${r.auto_shown}  typed ${r.typed}  replay ${replay(r) ?? '-'}`)
  console.log(`samples ${r.motion_x?.length ?? 0}  compass ${r.mag_x?.length ?? 0}  hr ${(r.hr ?? []).join(' ')}  beats ${r.beats?.length ?? 0}`)
  console.log('timeline:')
  for (const e of r.events ?? []) {
    const extra = e[1] === 4 ? GAP[e[2]] ?? e[2] : e.slice(2).join(' ')
    console.log(`  ${(e[0] / 1000).toFixed(1).padStart(6)} s  ${EVENT[e[1]] ?? e[1]}  ${extra}`)
  }
  console.log('diag:', JSON.stringify(r.diag))
}

function accuracy(rows) {
  const watch = blank()
  const now = blank()
  const byEx = new Map()
  const misses = new Map()
  const lat = []
  const results = {}
  console.log('when         exercise                  logged  auto  shown  replay  settle→count  notes')
  for (const r of rows) {
    const rep = replay(r)
    results[r.id] = rep
    tally(watch, r.auto_reps, r.logged_reps)
    tally(now, rep, r.logged_reps)
    const name = r.exercise_name ?? '?'
    if (!byEx.has(name)) byEx.set(name, { watch: blank(), now: blank() })
    tally(byEx.get(name).watch, r.auto_reps, r.logged_reps)
    tally(byEx.get(name).now, rep, r.logged_reps)
    const miss = rep == null ? 'no count' : rep - r.logged_reps
    if (miss !== 0) misses.set(miss, (misses.get(miss) ?? 0) + 1)
    const l = latency(r.events)
    if (l != null) lat.push(l)
    const notes = [r.typed && 'typed', r.corrected && 'corrected', r.clipped && 'clipped', r.diag?.interrupted && 'sensor gap',
      r.diag?.slim && 'slim', r.mag_x?.length && 'compass'].filter(Boolean).join(',')
    console.log(
      `${String(r.finished_at ?? '').slice(5, 16).replace('T', ' ').padEnd(12)} ${name.slice(0, 25).padEnd(25)} ${String(r.logged_reps).padStart(6)} ${String(r.auto_reps ?? '-').padStart(5)} ${(r.auto_shown ? 'yes' : 'no').padStart(6)} ${String(rep ?? '-').padStart(7)} ${String(l == null ? '-' : l.toFixed(1)).padStart(13)}  ${notes}`,
    )
  }
  console.log(`\nOn the watch:              ${line(watch)}`)
  console.log(`Current counter, replayed: ${line(now)}`)
  if (lat.length) console.log(`Wrist still → count shown: median ${quant(lat, 0.5).toFixed(1)} s, 90th ${quant(lat, 0.9).toFixed(1)} s, worst ${Math.max(...lat).toFixed(1)} s`)
  console.log('\nBy exercise (replay):')
  for (const [name, s] of [...byEx].sort((a, b) => b[1].now.n - a[1].now.n)) {
    console.log(`  ${name.slice(0, 30).padEnd(30)} ${line(s.now)}`)
  }
  if (misses.size) {
    console.log('\nMisses (replay − logged):', [...misses].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${typeof k === 'number' && k > 0 ? '+' : ''}${k}: ${v}`).join('  '))
  }
  return results
}

function compareBaseline(rows, results) {
  if (!fs.existsSync(BASELINE)) {
    console.log('\nNo baseline yet: --save-baseline remembers these results, and later runs list what a change fixed or broke.')
    return
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const fixed = []
  const broke = []
  for (const r of rows) {
    if (!(r.id in base.results)) continue
    const was = base.results[r.id] === r.logged_reps
    const is = results[r.id] === r.logged_reps
    if (!was && is) fixed.push(r)
    if (was && !is) broke.push(r)
  }
  console.log(`\nAgainst the baseline of ${base.saved_at.slice(0, 16)}: fixed ${fixed.length}, broke ${broke.length}`)
  for (const r of broke) console.log(`  broke  ${r.id.slice(0, 8)} ${r.exercise_name} logged ${r.logged_reps} now ${results[r.id] ?? '-'} (was ${base.results[r.id] ?? '-'})`)
  for (const r of fixed) console.log(`  fixed  ${r.id.slice(0, 8)} ${r.exercise_name} logged ${r.logged_reps} (was ${base.results[r.id] ?? '-'})`)
}

function health(rows) {
  if (!rows.length) {
    console.log('\nWatch health: no records yet.')
    return
  }
  const crashes = rows.filter(r => r.kind === 'unclean_exit')
  const sessions = rows.filter(r => r.kind === 'session')
  console.log(`\nWatch health (${rows.length} records)`)
  console.log(`  Runs that never stopped cleanly: ${crashes.length}`)
  for (const c of crashes) {
    const d = c.data ?? {}
    const flat = typeof d.battery === 'number' && d.battery < 3
    console.log(`    ${String(c.at ?? c.created_at).slice(0, 16)}  during ${d.phase ?? '?'}  ${flat ? 'battery flat (probably not a crash)' : `battery ${d.battery ?? '?'}%`}  mem ${d.mem ?? '?'}/${d.mem_total ?? '?'}  longest step ${d.longest_callback_ms ?? '?'} ms  v${c.app_version ?? '?'}`)
  }
  if (sessions.length) {
    const num = k => sessions.map(s => s.data?.[k]).filter(v => typeof v === 'number')
    const drain = sessions
      .filter(s => typeof s.data?.battery_start === 'number' && typeof s.data?.battery_end === 'number' && s.data?.duration_s > 600)
      .map(s => ((s.data.battery_start - s.data.battery_end) * 3600) / s.data.duration_s)
    const memPct = sessions.filter(s => s.data?.mem_peak && s.data?.mem_total).map(s => (100 * s.data.mem_peak) / s.data.mem_total)
    console.log(`  Workouts: ${sessions.length}`)
    if (drain.length) console.log(`  Battery: ${quant(drain, 0.5).toFixed(1)} %/hour median, ${Math.max(...drain).toFixed(1)} worst`)
    if (memPct.length) console.log(`  Peak memory in a set: ${Math.max(...memPct).toFixed(0)}% of the app's limit`)
    const long = num('longest_callback_ms')
    if (long.length) console.log(`  Longest counter step: ${Math.max(...long)} ms (watchdog risk starts in the hundreds)`)
    const failed = num('uploads_failed').reduce((a, b) => a + b, 0)
    const codes = sessions.flatMap(s => s.data?.upload_codes ?? [])
    console.log(`  Uploads: ${num('uploads_ok').reduce((a, b) => a + b, 0)} ok, ${failed} failed${codes.length ? ` (codes ${[...new Set(codes)].join(' ')})` : ''}`)
    const sum = k => num(k).reduce((a, b) => a + b, 0)
    console.log(`  Sets with compass ${sum('mag_sets')}/${sum('lab_sets')}, with beat intervals ${sum('beat_sets')}, with a sensor gap ${sum('gap_sets')}`)
    const bad = Math.max(0, ...num('rich_bad'))
    if (bad >= 2) console.log('  The extra sensors switched themselves off after broken streams: check the gaps above.')
  }
}

let sets = null
let telemetry = []
try {
  if (offline) {
    sets = load(DATA, 'finished_at')
    telemetry = load(HEALTH, 'created_at')
  } else {
    sets = await fetchAll('rep_lab_sets', 'finished_at')
    if (sets == null) throw new Error('rep_lab_sets does not exist yet: paste docs/sql/66-rep-lab.sql into the Supabase SQL editor.')
    save(DATA, sets)
    const t = await fetchAll('watch_telemetry', 'created_at')
    if (t == null) console.log('watch_telemetry does not exist yet: paste docs/sql/67-watch-telemetry.sql to get crash and health reports.')
    else { telemetry = t; save(HEALTH, t) }
  }
} catch (err) {
  console.error(String(err.message ?? err))
  process.exitCode = 1
}

if (sets && only) {
  const r = sets.find(s => s.id.startsWith(only))
  if (r) detail(r)
  else console.log(`No set starting ${only}.`)
} else if (sets) {
  if (sets.length === 0) console.log(`No rep lab sets in the last ${days} days.`)
  else {
    const results = accuracy(sets)
    compareBaseline(sets, results)
    if (saveBaseline) {
      fs.mkdirSync(DATA, { recursive: true })
      fs.writeFileSync(BASELINE, JSON.stringify({ saved_at: new Date().toISOString(), results }))
      console.log(`Baseline saved: ${Object.keys(results).length} sets.`)
    }
  }
  health(telemetry)
  console.log(`\nSaved under ${path.relative(process.cwd(), DATA)}/`)
}
