// Monte Carlo stress test for the GRIND fitness-age design.
// Truth is generated from literature-based error models; the estimator never sees truth.
// Usage: node fitness-age-sim.mjs [N]

const N = Number(process.argv[2] ?? 1500)
const DAYS = 180

// ---------- RNG ----------
let seed = 20261124
const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const randn = () => { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()) }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// ---------- Reference curves (provisional, HUNT-shaped, extended to 18) ----------
const interp = (pts, a) => {
  if (a <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (a <= pts[i][0]) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
  }
  return pts[pts.length - 1][1]
}
const VO2_MED = {
  M: [[18, 55.8], [25, 54.4], [35, 50.5], [45, 46.6], [55, 42.8], [65, 39.0], [75, 34.8], [90, 28.0]],
  F: [[18, 44.8], [25, 43.0], [35, 40.4], [45, 37.8], [55, 34.4], [65, 31.1], [75, 28.0], [90, 23.0]]
}
const VO2_SD = { M: [[18, 8.2], [50, 7.5], [75, 6.5], [90, 6.0]], F: [[18, 7.5], [50, 6.0], [75, 5.2], [90, 5.0]] }
const med = (s, a) => interp(VO2_MED[s], a)
const sdv = (s, a) => interp(VO2_SD[s], a)
// Fitness (cardio) age: age at which the reference median equals v. Clamped 18..90.
const cardioAge = (s, v) => {
  if (v >= med(s, 18)) return 18
  if (v <= med(s, 90)) return 90
  let lo = 18, hi = 90
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (med(s, m) > v) lo = m; else hi = m }
  return (lo + hi) / 2
}
const YEARS_PER_SD = 20 // midlife years-per-SD, ~equal for VO2max, grip and lnHRV (see doc)
const zAge = (age, z) => clamp(age - YEARS_PER_SD * z, 18, 90)
const RHR_BASE = { M: 60, F: 64 }, RHR_SD = 9
const lnHrvMu = (s, a) => Math.log(s === 'M' ? 58 : 54) - 0.018 * (a - 20)
const LNHRV_SD = 0.435
const W = { c: 0.55, s: 0.30, r: 0.15 }

// ---------- Scenarios ----------
const base = {
  sex: 'M', age: 18, zcMean: 0, zcSd: 1, runRate: 3 / 7, liftRate: 3 / 7, mapSd: 0.5, biasSd: 2.6,
  rtmK: 0.15, sickEpisodes: 1, alcoholRate: 1 / 14, heatFrac: 0, wearMiss: 0.1, anchor: null,
  detrain: null, weight: null, novice: false, devSd: 0.25, cycling: false, trend: 0
}
const scenarios = [
  ['S1 18M runner+lifter (you)', {}],
  ['S2 18F runner+lifter', { sex: 'F' }],
  ['S3 18M highly trained runner', { zcMean: 1.8, zcSd: 0.4 }],
  ['S4 18M sedentary, ~1 run/month, no lifting', { zcMean: -0.8, runRate: 1 / 30, liftRate: 0 }],
  ['S5 18M gym only, no runs', { runRate: 0 }],
  ['S6 18M frequent illness + alcohol', { sickEpisodes: 4, alcoholRate: 1 / 4 }],
  ['S7 18M injury: no running day 60-120', { detrain: [60, 120] }],
  ['S7b 18M still injured: no running day 100-180', { detrain: [100, 180] }],
  ['S8 25M losing 10 kg', { age: 25, weight: [90, 80] }],
  ['S9 18M + 5 km field test', { anchor: { day: 150, sd: 2.5 } }],
  ['S10 18M + lab CPET + grip test', { anchor: { day: 150, sd: 2.0 }, mapSd: 0.2 }],
  ['S11 45M average', { age: 45 }],
  ['S12 70F average', { sex: 'F', age: 70 }],
  ['S13 18M cyclist only', { cycling: true, biasSd: 3.5 }],
  ['S14 18M summer heat (40% hot runs)', { heatFrac: 0.4 }],
  ['S15 18M novice lifter (first 3 months)', { novice: true }],
  ['S16 18F HRV norm mismatch (device)', { sex: 'F', devSd: 0.5 }],
  ['S17 18M improving +8% over 6 months', { trend: 0.08 }]
]

// ---------- Algorithm configs ----------
const CONFIGS = {
  naive: { gate: false, rtmK: 0, detrainModel: false, weightScale: false, thin: 1, R: 1.5, biasPrior: 0, noviceGuard: false, prior: false },
  final: { gate: true, rtmK: 0.12, detrainModel: true, weightScale: true, thin: 7, R: 1.5, biasPrior: 2.6, noviceGuard: true, prior: true }
}

// ---------- Kalman helpers (2-state [v, b]) ----------
function kUpdate(x, P, H, y, R) {
  const PH = [P[0][0] * H[0] + P[0][1] * H[1], P[1][0] * H[0] + P[1][1] * H[1]]
  const S = H[0] * PH[0] + H[1] * PH[1] + R
  const K = [PH[0] / S, PH[1] / S]
  const inn = y - (H[0] * x[0] + H[1] * x[1])
  x[0] += K[0] * inn; x[1] += K[1] * inn
  const P00 = P[0][0] - K[0] * PH[0], P01 = P[0][1] - K[0] * PH[1], P11 = P[1][1] - K[1] * PH[1]
  P[0][0] = P00; P[0][1] = P01; P[1][0] = P01; P[1][1] = P11
}

function simulatePerson(sc) {
  const s = sc.sex, age = sc.age
  const zc0 = sc.zcMean + sc.zcSd * randn()
  const v0 = med(s, age) + zc0 * sdv(s, age)
  const zs = 0.3 * zc0 + Math.sqrt(0.91) * randn()
  const zRhrInd = randn(), zHrvInd = randn()
  const bias = sc.biasSd * randn()
  const mapErr = sc.mapSd * randn()
  const devOff = sc.devSd * randn()
  // illness days
  const sick = new Set()
  for (let e = 0; e < sc.sickEpisodes; e++) { const d0 = Math.floor(rand() * (DAYS - 6)); for (let d = d0; d < d0 + 5; d++) sick.add(d) }
  const days = []
  for (let t = 0; t < DAYS; t++) {
    const W0 = sc.weight ? sc.weight[0] : 75, W1 = sc.weight ? sc.weight[1] : 75
    const w = W0 + (W1 - W0) * t / (DAYS - 1)
    let mult = 1 + sc.trend * t / (DAYS - 1)
    let running = true
    if (sc.detrain) {
      const [a, b] = sc.detrain
      if (t >= a && t < b) { mult *= 1 - 0.10 * (t - a) / (b - a); running = false }
      else if (t >= b) mult *= 1 - 0.10 * Math.max(0, 1 - (t - b) / 50)
    }
    const v = v0 * mult * (W0 / w) // absolute VO2 constant during fat loss
    const rhr = RHR_BASE[s] - 0.34 * (v - med(s, age)) - 8.6 * zRhrInd
    const lnHrv = lnHrvMu(s, age) - 0.035 * (rhr - RHR_BASE[s]) + 0.30 * zHrvInd
    days.push({ t, w, v, rhr, lnHrv, sick: sick.has(t), alcohol: rand() < sc.alcoholRate, running })
  }
  const zsT = zs // long-run strength (novice gains are neural, not health)
  const last = days[DAYS - 1]
  const zrTrue = (0.5 * (-(last.rhr - RHR_BASE[s]) / RHR_SD) + 0.5 * ((last.lnHrv - lnHrvMu(s, age)) / LNHRV_SD)) / 0.8
  return { s, age, days, zs: zsT, bias, mapErr, devOff, zrTrue }
}

function observe(p, sc) {
  // generate observation stream once per person (shared by all configs)
  const obs = []
  let g = null
  for (const d of p.days) {
    const o = { t: d.t, w: d.w, alcohol: d.alcohol, sick: d.sick }
    if (rand() > sc.wearMiss) {
      o.rhr = d.rhr * (d.sick ? 1.06 : 1) * (d.alcohol ? 1.05 : 1) + 2.5 * randn()
      o.lnHrv = d.lnHrv + (d.sick ? Math.log(0.88) : 0) + (d.alcohol ? Math.log(0.85) : 0) + 0.15 * randn() + p.devOff * LNHRV_SD
    }
    if (d.running && rand() < sc.runRate) {
      const heat = rand() < sc.heatFrac
      const e = d.v + p.bias - sc.rtmK * (d.v - 50) + (d.sick ? -3 : 0) + (d.alcohol ? -1 : 0) + (heat ? -2 : 0) + (sc.cycling ? 2.5 : 2.0) * randn()
      g = g == null ? e : 0.75 * g + 0.25 * e // Garmin smooths its estimate
      o.garmin = g; o.vig = 25
    }
    if (rand() < sc.liftRate) {
      const novice = sc.novice ? 0.6 * Math.min(1, d.t / 90) : 0
      o.liftZ = p.zs + p.mapErr + novice + 0.2 * randn()
    }
    if (sc.anchor && d.t === sc.anchor.day) o.anchor = d.v + sc.anchor.sd * randn()
    obs.push(o)
  }
  return obs
}

function estimate(p, obs, sc, cfg) {
  const s = p.s, age = p.age
  // ---- cardio Kalman ----
  const x = [med(s, age), 0]
  const biasPrior = cfg.biasPrior ? (sc.cycling ? 3.5 : cfg.biasPrior) : 0
  const Rg = cfg.biasPrior && sc.cycling ? 2.0 : cfg.R
  const P = [[sdv(s, age) ** 2, 0], [0, biasPrior ? biasPrior ** 2 : 1e-6]]
  let rhrBase = null, hrvBase = null, lastTaken = -999, lastVig = null, everActive = false, lastG = null
  const rhrWin = [], hrvWin = [], runDays = []
  let decay = 1
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i]
    // predict
    if (cfg.weightScale && i > 0) { const r = obs[i - 1].w / o.w; x[0] *= r; P[0][0] *= r * r }
    P[0][0] += 0.05
    if (cfg.detrainModel && everActive && lastVig != null && o.t - lastVig > 21) {
      // only a drop relative to the person's OWN recent habit counts as detraining
      const habit = runDays.filter(t => t >= lastVig - 60 && t <= lastVig).length
      if (habit >= 6 && decay > 0.88) { x[0] *= 1 - 0.0015; decay *= 1 - 0.0015 }
    } else decay = 1
    // baselines (rolling 28-day median of non-gated nights)
    const flagged = cfg.gate && o.rhr != null && rhrBase != null && (o.rhr > rhrBase * 1.05 || o.lnHrv < hrvBase + Math.log(0.9))
    if (o.rhr != null && !flagged) { rhrWin.push(o.rhr); hrvWin.push(o.lnHrv); if (rhrWin.length > 28) { rhrWin.shift(); hrvWin.shift() } }
    if (rhrWin.length >= 7) { rhrBase = median(rhrWin); hrvBase = median(hrvWin) }
    // non-exercise prior once at day 14 (HUNT-style SEE 5.5)
    if (cfg.prior && o.t === 14) {
      const pv = p.days[14].v + 5.5 * randn() // stands in for age/sex/waist/RHR/activity model
      kUpdate(x, P, [1, 0], pv, 5.5 ** 2)
    }
    if (o.garmin != null) {
      everActive = true; lastVig = o.t; lastG = o.garmin; runDays.push(o.t)
      if (!flagged && o.t - lastTaken >= cfg.thin) {
        const k = cfg.rtmK
        const y = (o.garmin - 50 * k) / (1 - k)
        kUpdate(x, P, [1, 1 / (1 - k)], y, (Rg / (1 - k)) ** 2)
        lastTaken = o.t
      }
    }
    if (o.anchor != null) kUpdate(x, P, [1, 0], o.anchor, sc.anchor.sd ** 2)
  }
  const vHat = x[0], vSd = Math.sqrt(Math.max(P[0][0], 0.01))
  const cardio = cardioAge(s, vHat)
  const cardioLo = cardioAge(s, vHat + 1.2816 * vSd), cardioHi = cardioAge(s, vHat - 1.2816 * vSd)
  const garminOnly = lastG == null ? null : cardioAge(s, lastG)

  // ---- strength ----
  const lifts = obs.filter(o => o.liftZ != null && o.t >= DAYS - 42).map(o => o.liftZ)
  let zsHat = 0, zsVar = 1
  if (lifts.length) {
    zsHat = lifts.reduce((a, b) => a + b, 0) / lifts.length
    const firstLift = obs.find(o => o.liftZ != null)?.t ?? 0
    const histDays = DAYS - firstLift
    if (cfg.noviceGuard && sc.novice) zsHat -= 0.6 * Math.min(1, histDays / 90) * 0.7 // learn-in shrink (detected from steep e1RM slope)
    const mapAssumed = sc.mapSd
    zsVar = mapAssumed ** 2 + 0.04 / lifts.length
    // shrink toward population prior (Bayes)
    const w = 1 / (1 + zsVar); zsHat *= w; zsVar = zsVar * w
  }
  const strength = zAge(age, zsHat)
  const sLo = zAge(age, zsHat + 1.2816 * Math.sqrt(zsVar)), sHi = zAge(age, zsHat - 1.2816 * Math.sqrt(zsVar))

  // ---- recovery ----
  const rec = obs.filter(o => o.rhr != null && o.t >= DAYS - 28)
  let keep = cfg.gate ? rec.filter(o => !(o.rhr > (rhrBase ?? 1e9) * 1.05 || o.lnHrv < (hrvBase ?? -1e9) + Math.log(0.9))) : rec
  if (keep.length < 10) keep = rec // too many flagged nights: fall back rather than go blank
  const rhrM = median(keep.map(o => o.rhr)), hrvM = median(keep.map(o => o.lnHrv))
  const zrHat = (0.5 * (-(rhrM - RHR_BASE[s]) / RHR_SD) + 0.5 * ((hrvM - lnHrvMu(s, age)) / LNHRV_SD)) / 0.8
  const zrSd = 0.25 / 0.8 * 0.5 + 0.08
  const recovery = zAge(age, zrHat)
  const rLo = zAge(age, zrHat + 1.2816 * zrSd), rHi = zAge(age, zrHat - 1.2816 * zrSd)

  const grind = W.c * cardio + W.s * strength + W.r * recovery
  const gHalf = Math.sqrt((W.c * (cardioHi - cardioLo) / 2) ** 2 + (W.s * (sHi - sLo) / 2) ** 2 + (W.r * (rHi - rLo) / 2) ** 2)
  return { vHat, cardio, cardioLo, cardioHi, garminOnly, strength, sLo, sHi, recovery, rLo, rHi, grind, gLo: grind - gHalf, gHi: grind + gHalf }
}

function Phi(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p }
function median(a) { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 }

function truthOf(p) {
  const last = p.days[DAYS - 1]
  const cardio = cardioAge(p.s, last.v)
  const strength = zAge(p.age, p.zs)
  const recovery = zAge(p.age, p.zrTrue)
  return { v: last.v, cardio, strength, recovery, grind: W.c * cardio + W.s * strength + W.r * recovery }
}

const stat = () => ({ n: 0, ae: 0, w5: 0, cov: 0, ape: 0 })
const add = (st, est, tru, lo, hi) => { const e = Math.abs(est - tru); st.n++; st.ae += e; if (e <= 5) st.w5++; if (lo != null && tru >= lo - 1e-9 && tru <= hi + 1e-9) st.cov++ }
const fmt = st => st.n ? `${(st.ae / st.n).toFixed(1).padStart(4)}y ${String(Math.round(100 * st.w5 / st.n)).padStart(3)}%` : '   n/a   '
const cov = st => st.n ? `${Math.round(100 * st.cov / st.n)}%` : 'n/a'

const rows = []
for (const [name, over] of scenarios) {
  const sc = { ...base, ...over }
  const R = { naive: { c: stat(), s: stat(), r: stat(), g: stat(), ape: 0 }, final: { c: stat(), s: stat(), r: stat(), g: stat(), ape: 0 }, garmin: stat(), nf: stat(), gnf: stat(), snf: stat(), rnf: stat(), floor: 0, pct: 0 }
  let gN = 0
  for (let i = 0; i < N; i++) {
    const p = simulatePerson(sc)
    const obs = observe(p, sc)
    const tru = truthOf(p)
    for (const k of ['naive', 'final']) {
      const e = estimate(p, obs, sc, CONFIGS[k])
      const r = R[k]
      add(r.c, e.cardio, tru.cardio, e.cardioLo, e.cardioHi)
      add(r.s, e.strength, tru.strength, e.sLo, e.sHi)
      add(r.r, e.recovery, tru.recovery, e.rLo, e.rHi)
      add(r.g, e.grind, tru.grind, e.gLo, e.gHi)
      r.ape += Math.abs(e.vHat - tru.v) / tru.v
      if (k === 'final' && e.garminOnly != null) { add(R.garmin, e.garminOnly, tru.cardio); gN++ }
      if (k === 'final') {
        if (tru.cardio > 18.5) add(R.nf, e.cardio, tru.cardio, e.cardioLo, e.cardioHi); else R.floor++
        if (tru.grind > 18.5) add(R.gnf, e.grind, tru.grind, e.gLo, e.gHi)
        if (tru.strength > 18.5) add(R.snf, e.strength, tru.strength, e.sLo, e.sHi)
        if (tru.recovery > 18.5) add(R.rnf, e.recovery, tru.recovery, e.rLo, e.rHi)
        const zt = (tru.v - med(p.s, p.age)) / sdv(p.s, p.age), ze = (e.vHat - med(p.s, p.age)) / sdv(p.s, p.age)
        R.pct += Math.abs(Phi(ze) - Phi(zt)) * 100
      }
    }
  }
  rows.push({ name, R })
}

console.log(`N=${N} people per scenario, ${DAYS} days each. Cells: mean abs error (years) / % within ±5 yrs.`)
console.log('\nFloor-aware view (people whose TRUE age is above the 18 floor), FINAL algorithm:')
console.log('Scenario'.padEnd(42) + '| at floor | cardio(nf) cov80 | pctile err | strength(nf) | recovery(nf) | GRIND(nf) cov80')
for (const { name, R } of rows) {
  const n = R.final.c.n
  console.log(name.padEnd(42) + '| ' + String(Math.round(100 * R.floor / n)).padStart(5) + '%  | ' + fmt(R.nf) + ' ' + cov(R.nf).padStart(4)
    + ' | ' + (R.pct / n).toFixed(1).padStart(5) + ' pts  | ' + fmt(R.snf) + ' | ' + fmt(R.rnf) + ' | ' + fmt(R.gnf) + ' ' + cov(R.gnf).padStart(4))
}
console.log('\nAll people:')
console.log('Scenario'.padEnd(42) + '| GarminOnly | NAIVE cardio  VO2acc | FINAL cardio VO2acc cov80 | strength cov | recovery cov | GRIND age cov')
for (const { name, R } of rows) {
  const n = R.naive.c.n
  console.log(name.padEnd(42) + '| ' + fmt(R.garmin) + ' | ' + fmt(R.naive.c) + ' ' + (100 - 100 * R.naive.ape / n).toFixed(1) + '% | '
    + fmt(R.final.c) + ' ' + (100 - 100 * R.final.ape / n).toFixed(1) + '% ' + cov(R.final.c).padStart(4) + ' | '
    + fmt(R.final.s) + ' ' + cov(R.final.s).padStart(4) + ' | ' + fmt(R.final.r) + ' ' + cov(R.final.r).padStart(4) + ' | '
    + fmt(R.final.g) + ' ' + cov(R.final.g).padStart(4))
}
