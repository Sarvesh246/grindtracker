import type { SupabaseClient } from '@supabase/supabase-js'
import { ALGO_VERSION } from '../../../watch/tools/reps.mjs'
import { MIN_SETS, tuneExercise } from '../../../watch/tools/tune.mjs'

/**
 * The nightly half of per-exercise rep tuning: for every exercise with enough
 * labelled rep lab sets, re-tune the counter (watch/tools/tune.mjs) when it
 * has never been tuned, the counter algorithm changed, or 5+ new sets came in.
 * The result, applied or not, is kept with its cross-validated evidence in
 * rep_tuning; /today sends the applied ones to the watch (watch_rep_tuning).
 *
 * Runs with the service role. Bounded by a time budget: an unfinished queue
 * simply continues the next night.
 */

export const RETUNE_AFTER_NEW_SETS = 5
const LOOKBACK_DAYS = 365
const MAX_SETS_PER_EXERCISE = 400

interface Candidate { user_id: string; exercise_id: string; n: number }
interface TuningRow { user_id: string; exercise_id: string; algo_version: string; sets_used: number }

export interface TuningReport {
  considered: number
  tuned: { user_id: string; exercise_id: string; applied: boolean; sets: number; gain: number }[]
  skipped: number
  timedOut: boolean
}

/** Which exercises need (re)tuning, most data first. */
export function pending(counts: Candidate[], existing: TuningRow[], algo = ALGO_VERSION): Candidate[] {
  const had = new Map(existing.map(t => [`${t.user_id}|${t.exercise_id}`, t]))
  return counts
    .filter(c => c.n >= MIN_SETS)
    .filter(c => {
      const t = had.get(`${c.user_id}|${c.exercise_id}`)
      return !t || t.algo_version !== algo || c.n >= t.sets_used + RETUNE_AFTER_NEW_SETS
    })
    .sort((a, b) => b.n - a.n)
}

export async function runTuning(db: SupabaseClient, budgetMs = 45_000, now = () => Date.now()): Promise<TuningReport> {
  const start = now()
  const since = new Date(start - LOOKBACK_DAYS * 86_400_000).toISOString()
  const report: TuningReport = { considered: 0, tuned: [], skipped: 0, timedOut: false }

  // Light pass: usable sets per exercise, counted in SQL without the motion.
  const { data: counts, error: cErr } = await db.rpc('rep_tuning_candidates', { p_since: since })
  if (cErr) throw new Error(`rep_tuning_candidates: ${cErr.message}`)
  const { data: existing, error: exErr } = await db.from('rep_tuning').select('user_id,exercise_id,algo_version,sets_used')
  if (exErr) throw new Error(`rep_tuning: ${exErr.message}`)

  const queue = pending((counts ?? []) as Candidate[], (existing ?? []) as TuningRow[])
  report.considered = queue.length
  for (const c of queue) {
    if (now() - start > budgetMs) { report.timedOut = true; break }
    const { data, error } = await db
      .from('rep_lab_sets')
      .select('motion_x,motion_y,motion_z,steps,logged_reps,diag,finished_at')
      .eq('user_id', c.user_id)
      .eq('exercise_id', c.exercise_id)
      .gte('created_at', since)
      .order('finished_at', { ascending: true })
      .limit(MAX_SETS_PER_EXERCISE)
    if (error || !data) { report.skipped++; continue }
    const result = tuneExercise(data)
    if (!result) { report.skipped++; continue }
    const { error: upErr } = await db.from('rep_tuning').upsert({
      user_id: c.user_id,
      exercise_id: c.exercise_id,
      algo_version: ALGO_VERSION,
      params: result.params,
      sets_used: result.setsUsed,
      default_exact: result.defaultExact,
      default_wrong: result.defaultWrong,
      tuned_exact: result.tunedExact,
      tuned_wrong: result.tunedWrong,
      applied: result.applied,
      tuned_at: new Date(now()).toISOString(),
    })
    if (upErr) { report.skipped++; continue }
    report.tuned.push({ user_id: c.user_id, exercise_id: c.exercise_id, applied: result.applied, sets: result.setsUsed, gain: result.tunedExact - result.defaultExact })
  }
  return report
}
