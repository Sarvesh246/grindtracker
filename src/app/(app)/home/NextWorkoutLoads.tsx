'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { markAppDataStale } from '@/lib/cache/appDataCache'
import { useToast } from '@/lib/contexts/ToastContext'
import { useUnit } from '@/lib/contexts/UnitContext'
import { createClient } from '@/lib/supabase/client'
import type { LoadSuggestion } from '@/lib/utils/loadProgression'

export default function NextWorkoutLoads({ userId, suggestions }: { userId: string; suggestions: LoadSuggestion[] }) {
  const { unitLabel } = useUnit()
  return (
    <section className="home-next-loads" aria-label="Next workout loads">
      <h2>Next workout loads</h2>
      {suggestions.map(suggestion => (
        <LoadRow key={`${suggestion.exercise.id}:${unitLabel}`} userId={userId} suggestion={suggestion} />
      ))}
    </section>
  )
}

function LoadRow({ userId, suggestion }: { userId: string; suggestion: LoadSuggestion }) {
  const router = useRouter()
  const toast = useToast()
  const { unitLabel, fmt, toDisplay, fromDisplay } = useUnit()
  const [increment, setIncrement] = useState(unitLabel === 'kg' ? '2.5' : '5')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const { exercise, weight, reps, range } = suggestion
  const step = Number(increment)
  const load = Number((toDisplay(weight) + step).toFixed(1))
  const targetLbs = fromDisplay(load)
  const valid = Number.isFinite(targetLbs) && step >= 0.1 && load > Number(toDisplay(weight).toFixed(1)) && targetLbs <= 2000

  async function apply() {
    if (!valid || saving) return
    setSaving(true)
    setStatus('')
    try {
      const update = createClient().from('exercises').update({ weight_target: targetLbs })
        .eq('id', exercise.id).eq('user_id', userId).eq('active', true)
        .eq('sets_target', exercise.sets_target).eq('reps_target', exercise.reps_target)
      const { data, error } = await (exercise.weight_target == null
        ? update.is('weight_target', null)
        : update.eq('weight_target', exercise.weight_target)).select('id').maybeSingle()
      if (error) throw error
      if (!data) {
        setStatus('The plan changed. Refresh to see the current target.')
        return
      }
      markAppDataStale()
      toast.show(`Target set to ${load} ${unitLabel}`)
      router.refresh()
    } catch {
      setStatus('Could not save this target. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="home-next-load">
      <div>
        <strong>{exercise.name}</strong>
        <p>Last workout · {fmt(weight)} {unitLabel} × {reps.join(', ')}</p>
        <details>
          <summary>Change increment</summary>
          <label>
            Increment ({unitLabel})
            <input type="number" inputMode="decimal" min="0.1" step="0.1" value={increment}
              onChange={event => setIncrement(event.target.value)} />
          </label>
        </details>
      </div>
      <button type="button" className="press" data-haptic="medium" disabled={!valid || saving} onClick={apply}>
        {saving ? 'Saving…' : valid ? `Set ${load} ${unitLabel} · ${range} reps` : 'Enter a valid increment'}
      </button>
      {status && <p className="home-next-load-status" role="status">{status}</p>}
    </div>
  )
}
