import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFitnessAge, readFitnessProfile } from '@/lib/body/fitnessAge/queries'
import { validateCalibration, validateProfile, validateToday } from '@/lib/body/fitnessAge/validate'
import { localDateKey } from '@/lib/utils/formatting'

/**
 * Fitness age (docs/FITNESS-AGE-RESEARCH.md). No UI yet.
 *   GET  ?today=YYYY-MM-DD      → Cardio / Strength / Recovery / GRIND age
 *   PUT  {birth_date, sex, height_cm?}         → fitness profile
 *   POST calibration (see validate.ts)         → manual test, or accept/reject an auto-detected 5 km
 * Every read and write runs as the caller under RLS.
 */

async function caller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function json(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { supabase, user } = await caller()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const today = validateToday(new URL(request.url).searchParams.get('today'), localDateKey(new Date()))
  try {
    const [outcome, profile] = await Promise.all([getFitnessAge(supabase, user.id, today), readFitnessProfile(supabase, user.id)])
    return NextResponse.json({ ...outcome, profile: profile.profile })
  } catch (error) {
    console.error('[grind] fitness age', error)
    return NextResponse.json({ error: 'Failed to compute fitness age' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const { supabase, user } = await caller()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await json(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const v = validateProfile(body, localDateKey(new Date()))
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })
  const { data, error } = await supabase.from('fitness_profile')
    .upsert({ user_id: user.id, ...v.value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('birth_date,sex,height_cm').maybeSingle()
  if (error) {
    console.error('[grind] fitness profile', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
  return NextResponse.json({ profile: data })
}

export async function POST(request: Request) {
  const { supabase, user } = await caller()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await json(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const v = validateCalibration(body, localDateKey(new Date()))
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })
  const req = v.value
  const write = req.type === 'manual'
    ? supabase.from('fitness_calibrations').insert({ user_id: user.id, ...req.row, source: 'manual' })
    : supabase.from('fitness_calibrations').upsert({
      user_id: user.id, measured_on: req.measured_on, kind: 'run_5k', value: req.value,
      source: 'auto', activity_id: req.activity_id, status: req.status,
    }, { onConflict: 'user_id,activity_id' })
  const { error } = await write
  if (error) {
    console.error('[grind] fitness calibration', error)
    return NextResponse.json({ error: 'Failed to save calibration' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
