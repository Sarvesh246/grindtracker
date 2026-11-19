// Watch report: what the watch itself is doing, from the diagnostics it sends
// with every day snapshot (migration 70) and its workout heart-rate traces.
//
//   npm run watchreport                 last 7 days
//   npm run watchreport -- --days 30
//
// Sections:
//   background sync  how often the 15-minute event really fires, how late,
//                    how long a snapshot takes to arrive, and failed runs
//   battery          drain per hour off the charger, and what background
//                    sync costs
//   memory           headroom in the 64 KB background process
//   all-day HR       the watch's own sample rate, and what the 15-minute
//                    averages hide
//   sensors          which values the watch fills in, how fresh, and whether
//                    that changed with a firmware update
//   HR revisions     whether Garmin rewrites finished 15-min buckets (71)
//   respiration      how often the live rate is there, and its range
//   workout HR       where the last workout's readings came from, and the
//                    one-second traces: dropouts and gaps
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).
// Reads only; covers every user with a watch, so run it as the developer.

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const days = +arg('--days', 7)
const since = new Date(Date.now() - days * 86_400_000)

async function fetchAll(table, select, filter) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (npm run watchreport loads .env.local).')
  const rows = []
  for (let from = 0; ; from += 500) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${select}&${filter}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 499}` },
    })
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

const t = s => new Date(s).getTime()
const median = a => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const pct = (a, p) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
const f1 = v => (v == null ? '-' : (Math.round(v * 10) / 10).toString())
const mins = s => (s == null ? '-' : `${f1(s / 60)} min`)
const head = s => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 66 - s.length))}`)
const share = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-')

function byUser(rows) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.user_id)) m.set(r.user_id, [])
    m.get(r.user_id).push(r)
  }
  return m
}

function backgroundSync(rows) {
  head('background sync')
  const bg = rows.filter(r => r.source === 'background')
  console.log(`${rows.length} stored snapshots, ${bg.length} from the background (${share(bg.length, rows.length)})`)
  if (!bg.length) {
    console.log('No background snapshots: the 15-minute event is not firing, or the app was not opened after install.')
    return
  }
  const gaps = []
  for (const list of byUser(bg).values()) {
    const ts = list.map(r => t(r.taken_at ?? r.received_at)).sort((a, b) => a - b)
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 1000)
  }
  const period = median(bg.map(r => r.diag?.period_s).filter(v => v != null)) ?? 900
  const onTime = gaps.filter(g => g <= period + 120).length
  const missed = gaps.filter(g => g > period * 1.6)
  console.log(`period ${mins(period)}; gap between runs: median ${mins(median(gaps))}, 90th ${mins(pct(gaps, 0.9))}`)
  console.log(`on time (≤ period + 2 min) ${share(onTime, gaps.length)}; ${missed.length} gaps of a missed run or more (longest ${mins(Math.max(0, ...missed))})`)
  console.log('  (a gap also opens when the open app synced recently, or the phone was out of reach)')
  const trip = rows.filter(r => r.taken_at).map(r => (t(r.received_at) - t(r.taken_at)) / 1000)
  console.log(`snapshot to server: median ${f1(median(trip))} s, 90th ${f1(pct(trip, 0.9))} s (includes any watch-phone clock skew)`)
  const codes = new Map()
  for (const r of rows) {
    const c = r.diag?.prev_bg_code
    if (c != null) codes.set(c, (codes.get(c) ?? 0) + 1)
  }
  if (codes.size) {
    const list = [...codes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c === 200 ? '200 ok' : c === -1 ? '-1 threw' : c}: ${n}`)
    console.log(`previous background run, as reported by the next snapshot: ${list.join(', ')}`)
    console.log('  (non-200 runs never stored anything, so this is the only place they show)')
  }
}

// Battery reads in whole percent and drains well under 1%/h, so most 15-minute
// pairs show no drop at all and a median of pair rates comes out 0. Instead,
// split the readings into discharge stretches (broken by charging, a rise, or
// a gap of over 2 h) and measure each stretch end to end.
function dischargeStretches(list) {
  const s = list.filter(r => r.taken_at && r.battery != null).sort((a, b) => t(a.taken_at) - t(b.taken_at))
  const out = []
  let cur = []
  const close = () => {
    if (cur.length > 1) out.push(cur)
    cur = []
  }
  for (const r of s) {
    if (r.charging) { close(); continue }
    const prev = cur[cur.length - 1]
    if (prev && (r.battery > prev.battery || t(r.taken_at) - t(prev.taken_at) > 2 * 3_600_000)) close()
    cur.push(r)
  }
  close()
  return out
}

function battery(rows) {
  head('battery')
  let drop = 0, hours = 0, bgDrop = 0, bgHours = 0, n = 0
  for (const list of byUser(rows).values()) {
    for (const st of dischargeStretches(list)) {
      const h = (t(st[st.length - 1].taken_at) - t(st[0].taken_at)) / 3_600_000
      if (h < 1) continue // too short to see a whole-percent drop
      const d = st[0].battery - st[st.length - 1].battery
      drop += d
      hours += h
      n++
      if (st.every(r => r.source === 'background')) { bgDrop += d; bgHours += h }
    }
  }
  if (!hours) {
    console.log('No battery stretch of an hour or more yet (needs migration 70 and the new watch build).')
    return
  }
  console.log(`off the charger: ${f1(drop / hours)}%/h (≈ ${f1((24 * drop) / hours)}%/day), ${f1(drop)}% over ${f1(hours)} h in ${n} stretches`)
  if (bgHours) console.log(`with only background snapshots (app closed): ${f1(bgDrop / bgHours)}%/h over ${f1(bgHours)} h`)
  console.log('  Compare with a day before the 15-minute build to see what background sync costs.')
}

function memory(rows) {
  head('memory')
  const bg = rows.filter(r => r.source === 'background' && r.free_mem != null)
  if (!bg.length) {
    console.log('No background memory readings yet.')
    return
  }
  const free = bg.map(r => r.free_mem)
  const total = median(bg.map(r => r.diag?.total_mem).filter(v => v != null))
  console.log(`background process: free at snapshot median ${f1(median(free) / 1024)} KB, lowest ${f1(Math.min(...free) / 1024)} KB of ${f1(total / 1024)} KB`)
  if (Math.min(...free) < 6 * 1024) console.log('  ! under 6 KB free at least once: the background process is close to running out')
}

function allDayHr(rows, daysRows) {
  head('all-day heart rate')
  const withRaw = rows.filter(r => r.hr_t?.length)
  if (!withRaw.length) {
    console.log('No raw samples yet.')
    return
  }
  const steps = []
  const spread = []
  const diffs = []
  const daily = new Map(daysRows.map(d => [`${d.user_id} ${d.local_date}`, d.hr_series]))
  // Each snapshot re-sends a minute of overlap, so merge a day's samples by
  // time first; otherwise a bucket split across two snapshots is counted as
  // two half-buckets and the overlap sample twice.
  const perDay = new Map()
  for (const r of withRaw) {
    const k = `${r.user_id} ${r.local_date}`
    if (!perDay.has(k)) perDay.set(k, new Map())
    const m = perDay.get(k)
    r.hr_t.forEach((s, i) => m.set(s, r.hr_v[i]))
  }
  let n = 0
  for (const [k, m] of perDay) {
    const ts = [...m.keys()].sort((a, b) => a - b)
    n += ts.length
    for (let i = 1; i < ts.length; i++) steps.push(ts[i] - ts[i - 1])
    const buckets = new Map()
    for (const s of ts) {
      const b = Math.floor(s / 900)
      if (!buckets.has(b)) buckets.set(b, [])
      buckets.get(b).push(m.get(s))
    }
    const series = daily.get(k)
    for (const [b, v] of buckets) {
      if (v.length < 3) continue
      spread.push(Math.max(...v) - Math.min(...v))
      const mean = v.reduce((x, y) => x + y, 0) / v.length
      if (series?.[b] != null) diffs.push(Math.abs(series[b] - mean))
    }
  }
  console.log(`${n} samples (overlap removed) in ${withRaw.length} snapshots`)
  console.log(`sample spacing: median ${f1(median(steps))} s, 10th ${f1(pct(steps, 0.1))} s, 90th ${f1(pct(steps, 0.9))} s`)
  console.log(`within one 15-min bucket, highest minus lowest: median ${f1(median(spread))} bpm, 90th ${f1(pct(spread, 0.9))} bpm`)
  console.log('  That spread is what the 15-minute average on the Health page flattens.')
  if (diffs.length) console.log(`stored bucket average vs raw mean: median off by ${f1(median(diffs))} bpm (should be ~0)`)
}

// Migration 71: every snapshot's own 15-min averages. A bucket that is
// already complete (its 15 min ended before the earlier snapshot) and still
// changes in a later snapshot means Garmin rewrote its HR history.
function hrRevisions(rows) {
  head('heart-rate history revisions')
  const withAvg = rows.filter(r => r.hr_avg?.length === 96 && r.taken_at)
  if (withAvg.length < 2) {
    console.log('Not enough snapshots with their own averages yet (needs migration 71).')
    return
  }
  let compared = 0
  const moves = []
  const late = new Map()
  for (const list of byUser(withAvg).values()) {
    const byDay = new Map()
    for (const r of list) {
      if (!byDay.has(r.local_date)) byDay.set(r.local_date, [])
      byDay.get(r.local_date).push(r)
    }
    for (const snaps of byDay.values()) {
      snaps.sort((a, b) => t(a.taken_at) - t(b.taken_at))
      for (let i = 1; i < snaps.length; i++) {
        const a = snaps[i - 1], b = snaps[i]
        const midnight = t(`${a.local_date}T00:00:00`) // local wall clock, read as local
        const done = Math.floor((t(a.taken_at) - midnight) / 900_000) - 1
        for (let k = 0; k <= Math.min(done, 95); k++) {
          if (a.hr_avg[k] == null || b.hr_avg[k] == null) continue
          compared++
          const d = Math.abs(b.hr_avg[k] - a.hr_avg[k])
          if (d > 0) {
            moves.push(d)
            const hour = Math.floor(k / 4)
            late.set(hour, (late.get(hour) ?? 0) + 1)
          }
        }
      }
    }
  }
  console.log(`${compared} complete buckets compared between consecutive snapshots; ${moves.length} changed (${share(moves.length, compared)})`)
  if (moves.length) {
    console.log(`  by how much: median ${f1(median(moves))} bpm, largest ${Math.max(...moves)} bpm`)
    const hours = [...late].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([h, n]) => `${String(h).padStart(2, '0')}:00 ×${n}`)
    console.log(`  mostly in the hours ${hours.join(', ')} (local)`)
  }
}

function respiration(rows) {
  head('respiration')
  const vals = rows.map(r => r.diag?.probe?.resp).filter(Array.isArray).map(v => v[0])
  const probed = rows.filter(r => r.diag?.probe?.resp !== undefined).length
  if (!probed) {
    console.log('No respiration probes yet.')
    return
  }
  console.log(`live rate filled in ${share(vals.length, probed)} of ${probed} snapshots; median ${f1(median(vals))}/min, 10th ${f1(pct(vals, 0.1))}, 90th ${f1(pct(vals, 0.9))}`)
}

function workoutReads(rows) {
  head('workout heart-rate reads')
  const last = [...rows].reverse().find(r => Array.isArray(r.diag?.wk_hr))
  if (!last) {
    console.log('No workout recorded on this build yet.')
    return
  }
  const [n, miss, act, sens] = last.diag.wk_hr
  console.log(`last workout (reported ${last.taken_at?.slice(0, 16)}): ${n} reads, ${miss} missed (${share(miss, n)})`)
  console.log(`  from the Garmin recording ${act}, from the sensor fallback ${sens}`)
  if (n && miss === n) console.log('  ! no reading at all: the sensor never delivered heart rate')
}

function sensors(rows) {
  head('sensors')
  const when = r => t(r.taken_at ?? r.received_at)
  const probed = rows.filter(r => r.diag?.probe).sort((a, b) => when(a) - when(b))
  if (!probed.length) {
    console.log('No probe data yet.')
    return
  }
  const keys = [...new Set(probed.flatMap(r => Object.keys(r.diag.probe)))].sort()
  const word = { '-1': 'empty', '-2': 'threw', '-3': 'n/a' }
  console.log('value      filled   typical age   otherwise')
  for (const k of keys) {
    const vals = probed.map(r => r.diag.probe[k]).filter(v => v !== undefined)
    const filled = vals.filter(Array.isArray)
    const ages = filled.map(v => v[1]).filter(a => a >= 0)
    const other = new Map()
    for (const v of vals) if (!Array.isArray(v)) other.set(word[v] ?? v, (other.get(word[v] ?? v) ?? 0) + 1)
    const otherText = [...other].map(([w, c]) => `${w} ${c}`).join(', ')
    console.log(`${k.padEnd(10)} ${share(filled.length, vals.length).padStart(6)}   ${(ages.length ? `${median(ages)} min` : '-').padEnd(13)} ${otherText}`)
  }
  // Per watch: each firmware it ran, and any value that started or stopped
  // being filled in when the firmware changed.
  for (const list of byUser(probed).values()) {
    const builds = []
    for (const r of list) {
      const id = `${r.diag.part ?? '?'} fw ${r.diag.fw ?? '?'} ciq ${r.diag.ciq ?? '?'}`
      if (!builds.length || builds[builds.length - 1].id !== id) builds.push({ id, at: r.taken_at ?? r.received_at, rows: [] })
      builds[builds.length - 1].rows.push(r)
    }
    console.log(`\nwatch: ${builds.map(b => `${b.id} (from ${b.at.slice(0, 10)})`).join(' → ')}`)
    const filled = (rows, k) => rows.filter(r => Array.isArray(r.diag.probe[k])).length / rows.length
    for (let i = 1; i < builds.length; i++) {
      const changed = keys.filter(k => Math.abs(filled(builds[i - 1].rows, k) - filled(builds[i].rows, k)) >= 0.5)
      if (changed.length) console.log(`  ! with ${builds[i].id}: ${changed.map(k => `${k} ${filled(builds[i].rows, k) >= 0.5 ? 'now filled' : 'now missing'}`).join(', ')}`)
    }
  }
}

function workoutHr(sessions) {
  head('workout heart rate')
  const fine = sessions.filter(s => s.hr_step === 1 && s.hr_trace?.length)
  const old = sessions.length - fine.length
  if (!fine.length) {
    console.log(`No one-second traces yet${old ? ` (${old} older ${old === 1 ? 'trace' : 'traces'} at 5 s)` : ''}.`)
    return
  }
  const dropouts = []
  const longest = []
  for (const s of fine) {
    const tr = s.hr_trace
    let none = 0, run = 0, max = 0
    for (const v of tr) {
      if (v == null || v === 0) { none++; run++; max = Math.max(max, run) } else run = 0
    }
    dropouts.push(none / tr.length)
    longest.push(max)
  }
  console.log(`${fine.length} one-second traces, median ${f1(median(fine.map(s => s.hr_trace.length)) / 60)} min long`)
  console.log(`seconds with no reading: median ${f1(100 * median(dropouts))}%, worst ${f1(100 * Math.max(...dropouts))}%`)
  console.log(`longest gap per workout: median ${median(longest)} s, worst ${Math.max(...longest)} s`)
}

const iso = since.toISOString()
const [syncs, daysRows, sessions] = await Promise.all([
  // hr_avg is migration 71; before it, read the rest.
  fetchAll('body_sync_log', 'user_id,local_date,received_at,source,taken_at,battery,charging,free_mem,hr_t,hr_v,hr_avg,diag', `received_at=gte.${iso}&order=received_at.asc`)
    .catch(() => fetchAll('body_sync_log', 'user_id,local_date,received_at,source,taken_at,battery,charging,free_mem,hr_t,hr_v,diag', `received_at=gte.${iso}&order=received_at.asc`)),
  fetchAll('daily_body', 'user_id,local_date,hr_series', `local_date=gte.${iso.slice(0, 10)}`),
  fetchAll('sessions', 'id,user_id,started_at,hr_step,hr_trace', `started_at=gte.${iso}&hr_trace=not.is.null&order=started_at.asc`),
])
console.log(`Watch report, last ${days} days`)
backgroundSync(syncs)
battery(syncs)
memory(syncs)
allDayHr(syncs, daysRows)
hrRevisions(syncs)
respiration(syncs)
sensors(syncs)
workoutReads(syncs)
workoutHr(sessions)
