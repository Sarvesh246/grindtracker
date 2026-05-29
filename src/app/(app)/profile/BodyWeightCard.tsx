'use client'
import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useUnit } from '@/lib/contexts/UnitContext'

interface Row {
  weight: number
  recorded_at: string
}

function todayDateKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BodyWeightCard() {
  const supabase = createClient()
  const { unitLabel } = useUnit()
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const since = new Date()
    since.setDate(since.getDate() - 90)
    const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`

    const { data } = await supabase
      .from('body_weights')
      .select('weight, recorded_at')
      .eq('user_id', user.id)
      .gte('recorded_at', sinceKey)
      .order('recorded_at', { ascending: true })

    setRows((data ?? []) as Row[])
    const today = todayDateKey()
    const todayRow = (data ?? []).find((r: Row) => r.recorded_at === today)
    if (todayRow) setDraft(String(todayRow.weight))
    setLoading(false)
  }

  async function handleSave() {
    const w = parseFloat(draft)
    if (!Number.isFinite(w) || w <= 0) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    await supabase.from('body_weights').upsert(
      { user_id: user.id, weight: w, recorded_at: todayDateKey() },
      { onConflict: 'user_id,recorded_at' },
    )
    await load()
    setSaving(false)
  }

  const latest = rows.length > 0 ? rows[rows.length - 1] : null
  const earliest = rows.length > 0 ? rows[0] : null
  const change = latest && earliest && latest.recorded_at !== earliest.recorded_at
    ? latest.weight - earliest.weight
    : 0

  const chartPoints = rows.map(r => ({
    date: r.recorded_at,
    displayDate: new Date(r.recorded_at + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    weight: r.weight,
  }))

  return (
    <div
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--card-md)',
        marginBottom: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            color: 'var(--text-primary)',
            letterSpacing: '1px',
            fontWeight: 'normal',
          }}
        >
          BODY WEIGHT
        </h2>
        {latest && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '22px',
                color: 'var(--text-primary)',
              }}
            >
              {latest.weight}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{unitLabel}</span>
            {change !== 0 && (
              <span
                style={{
                  fontSize: '11px',
                  color: change > 0 ? 'var(--accent)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {change > 0 ? '+' : ''}
                {change.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Log today"
          aria-label="Today's body weight"
          style={{
            flex: 1,
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '16px',
            padding: '10px 12px',
            height: '44px',
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !draft}
          style={{
            height: '44px',
            padding: '0 18px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: saving || !draft ? 'var(--surface-elevated)' : 'var(--accent)',
            color: saving || !draft ? 'var(--text-muted)' : 'var(--bg)',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            cursor: saving || !draft ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '...' : 'LOG'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Loading...</div>
      ) : chartPoints.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px 0' }}>
          No body weight data yet. Log your first reading above.
        </div>
      ) : (
        <div style={{ height: '120px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartPoints} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <XAxis
                dataKey="displayDate"
                stroke="transparent"
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: "'DM Sans', sans-serif" }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.floor(chartPoints.length / 4))}
              />
              <YAxis
                stroke="transparent"
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: "'DM Sans', sans-serif" }}
                tickLine={false}
                axisLine={false}
                width={32}
                domain={['dataMin - 2', 'dataMax + 2']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                itemStyle={{ color: 'var(--text-primary)' }}
                cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="weight"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
