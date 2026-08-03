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
import { useMotionPref } from '@/lib/contexts/MotionContext'

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
  // Recharts' line-draw is a JS (react-smooth) animation, not CSS — the
  // `html.reduce-motion` class in globals.css can't reach it, so it has to be
  // gated explicitly or it keeps playing with the setting on.
  const { reduceMotion } = useMotionPref()
  const values = data.map(d => d.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const padding = Math.max((maxV - minV) * 0.2, 5)
  // Never let the Y-axis go negative — weights and volumes are always ≥ 0.
  const yMin = Math.max(0, Math.floor(minV - padding))
  const yMax = Math.ceil(maxV + padding)

  const showAllLabels = data.length <= 6
  const tickInterval = showAllLabels ? 0 : Math.floor(data.length / 5)

  // Size the y-axis gutter from the widest tick label so 4–5 digit values don't clip.
  const maxTickLen = Math.max(String(yMin).length, String(yMax).length)
  const yAxisWidth = Math.max(36, maxTickLen * 9 + 8)

  return (
    // width/minWidth pin this to the parent's full width: the card that renders
    // the chart is a flex container, and without them this wrapper shrink-wraps
    // to the table's content width, squeezing the chart into a narrow column.
    <div style={{ width: '100%', minWidth: 0 }}>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={216}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 32, bottom: 4, left: 4 }}
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
              height={36}
              tickMargin={12}
            />
            <YAxis
              stroke="transparent"
              tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: "'DM Sans', sans-serif" }}
              tickLine={false}
              axisLine={false}
              domain={[yMin, yMax]}
              tickFormatter={(v) => v === 0 ? 'BW' : String(v)}
              width={yAxisWidth}
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
              isAnimationActive={!reduceMotion}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table
        style={{
          width: '100%',
          tableLayout: 'fixed',
          borderCollapse: 'collapse',
          fontSize: '12px',
          marginTop: '12px',
        }}
      >
        <caption style={{
          position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
        }}>
          Progress data points
        </caption>
        {/* Fixed layout + explicit widths: the value column carries the longest
            text ("3,040 lbs · vol"), so content-sized columns crowd the date
            against it and starve the PR column. */}
        <colgroup>
          <col style={{ width: '28%' }} />
          <col style={{ width: 'auto' }} />
          <col style={{ width: '18%' }} />
        </colgroup>
        <thead>
          <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
            <th scope="col" style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>Date</th>
            <th scope="col" style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>Value</th>
            <th scope="col" style={{ padding: '4px 0', fontWeight: 500, textAlign: 'right' }}>PR</th>
          </tr>
        </thead>
        <tbody>
          {[...data].reverse().slice(0, 12).map((p, i) => (
            <tr key={`${p.date}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 8px 8px 0', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {p.displayDate}
              </td>
              <td style={{
                padding: '8px 8px 8px 0',
                color: 'var(--text-primary)',
                fontFamily: "'JetBrains Mono', monospace",
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {p.label}
              </td>
              <td style={{
                padding: '8px 0',
                color: p.isPR ? 'var(--accent-text)' : 'var(--text-muted)',
                textAlign: 'right',
              }}>
                {p.isPR ? 'Yes' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
