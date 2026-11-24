'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Session = { id: string; day_type: string; started_at: string }

export function GarminActivityMatch({ activity, sessions, selected }: {
  activity: string
  sessions: Session[]
  selected: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(selected ?? '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch('/api/health/garmin-personal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', id: activity, session: value || null })
      })
      if (!response.ok) {
        setStatus('Could not save this match. The workout may already be linked.')
        return
      }
      setStatus(value ? 'Workout linked.' : 'Kept as a separate activity.')
      router.refresh()
    } catch {
      setStatus('Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="health-panel" onSubmit={save}>
      <h2>Match a GRIND workout</h2>
      <label className="garmin-trend-select">Workout
        <select value={value} disabled={busy} onChange={e => setValue(e.target.value)}>
          <option value="">Keep as separate activity</option>
          {sessions.map(s => <option key={s.id} value={s.id}>
            {s.day_type} · {new Date(s.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </option>)}
        </select>
      </label>
      <button type="submit" className="health-primary" disabled={busy}>Save match</button>
      {status && <p role="status">{status}</p>}
    </form>
  )
}
