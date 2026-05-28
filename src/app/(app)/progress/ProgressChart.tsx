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
  weight: number
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
      backgroundColor: '#242424',
      border: '1px solid #2e2e2e',
      borderRadius: '8px',
      padding: '10px 14px',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ fontSize: '12px', color: '#888888', marginBottom: '4px' }}>
        {point.displayDate}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '16px',
        color: '#f0f0f0',
      }}>
        {point.weight} lbs
      </div>
      {point.isPR && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          marginTop: '4px',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="8 6 12 2 16 6"/><path d="M12 2v10"/>
            <path d="M5 17l1.5-5h11L19 17"/><path d="M3 22h18"/>
          </svg>
          <span style={{ fontSize: '11px', color: '#c8f135', fontWeight: 600 }}>PR</span>
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
        <circle cx={cx} cy={cy} r={8} fill="rgba(200, 241, 53, 0.2)" />
        <circle cx={cx} cy={cy} r={5} fill="#c8f135" />
      </g>
    )
  }

  return <circle cx={cx} cy={cy} r={3} fill="#c8f135" opacity={0.5} />
}

export default function ProgressChart({ data }: { data: ChartPoint[] }) {
  const weights = data.map(d => d.weight)
  const minWeight = Math.min(...weights)
  const maxWeight = Math.max(...weights)
  const padding = Math.max((maxWeight - minWeight) * 0.2, 5)
  const yMin = Math.floor(minWeight - padding)
  const yMax = Math.ceil(maxWeight + padding)

  const showAllLabels = data.length <= 6
  const tickInterval = showAllLabels ? 0 : Math.floor(data.length / 5)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: -8 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#2e2e2e"
          vertical={false}
        />
        <XAxis
          dataKey="displayDate"
          stroke="transparent"
          tick={{ fill: '#555555', fontSize: 10, fontFamily: "'DM Sans', sans-serif" }}
          tickLine={false}
          axisLine={false}
          interval={tickInterval}
        />
        <YAxis
          stroke="transparent"
          tick={{ fill: '#555555', fontSize: 10, fontFamily: "'DM Sans', sans-serif" }}
          tickLine={false}
          axisLine={false}
          domain={[yMin, yMax]}
          tickFormatter={(v) => `${v}`}
          width={36}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: '#3a3a3a', strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="weight"
          stroke="#c8f135"
          strokeWidth={2}
          dot={<CustomDot />}
          activeDot={{ r: 6, fill: '#c8f135', stroke: '#0f0f0f', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
