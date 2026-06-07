'use client'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface ChartPoint {
  date: string
  displayDate: string
  value: number
  label: string
  isPR: boolean
}

interface TooltipPayload {
  payload: ChartPoint
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload

  return (
    <div style={{
      backgroundColor: 'var(--surface-elevated)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '10px 14px',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        {point.displayDate}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '16px',
        color: 'var(--text-primary)',
      }}>
        {point.label}
      </div>
      {point.isPR && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          marginTop: '4px',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-text)' }}>
            <polyline points="8 6 12 2 16 6"/><path d="M12 2v10"/>
            <path d="M5 17l1.5-5h11L19 17"/><path d="M3 22h18"/>
          </svg>
          <span style={{ fontSize: '11px', color: 'var(--accent-text)', fontWeight: 600 }}>PR</span>
        </div>
      )}
    </div>
  )
}

interface CustomDotProps {
  cx?: number
  cy?: number
  payload?: ChartPoint
}

function CustomDot({ cx, cy, payload }: CustomDotProps) {
  if (cx === undefined || cy === undefined || !payload) return null

  if (payload.isPR) {
    return (
      <g>
        {/* PR halo: use accent-wash so it's visible on both dark and light backgrounds */}
        <circle cx={cx} cy={cy} r={9} fill="var(--accent)" opacity={0.2} />
        <circle cx={cx} cy={cy} r={5} fill="var(--accent)" />
      </g>
    )
  }

  {/* Regular dot: use accent-text (olive in light, lime in dark) at full opacity for visibility */}
  return <circle cx={cx} cy={cy} r={3.5} fill="var(--accent-text)" />
}

export default function ProgressChart({ data }: { data: ChartPoint[] }) {
  const values = data.map(d => d.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const padding = Math.max((maxV - minV) * 0.2, 5)
  // Never let the Y-axis go negative — weights and volumes are always ≥ 0.
  const yMin = Math.max(0, Math.floor(minV - padding))
  const yMax = Math.ceil(maxV + padding)

  const showAllLabels = data.length <= 6
  const tickInterval = showAllLabels ? 0 : Math.floor(data.length / 5)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 28, bottom: 8, left: -8 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="displayDate"
          stroke="transparent"
          tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: "'DM Sans', sans-serif" }}
          tickLine={false}
          axisLine={false}
          interval={tickInterval}
        />
        <YAxis
          stroke="transparent"
          tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: "'DM Sans', sans-serif" }}
          tickLine={false}
          axisLine={false}
          domain={[yMin, yMax]}
          tickFormatter={(v) => v === 0 ? 'BW' : String(v)}
          width={36}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--accent-text)"
          strokeWidth={2}
          dot={<CustomDot />}
          activeDot={{ r: 6, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
