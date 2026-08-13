'use client'

import { Component, type ReactNode } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useMotionPref } from '@/lib/contexts/MotionContext'
import { reportError } from '@/lib/utils/reportError'

export interface BodyWeightPoint {
  date: string
  canonical: number
  displayDate: string
  longDate: string
  weight: number
}

interface WeightDotProps {
  cx?: number
  cy?: number
  payload?: BodyWeightPoint
  peeked?: string | null
  selectedDate?: string
  chartPoints?: BodyWeightPoint[]
  onDotClick?: (point: BodyWeightPoint) => void
  fmt?: (canonicalLbs: number) => string
  unitLabel?: string
}

function WeightDot({
  cx,
  cy,
  payload,
  peeked,
  selectedDate,
  chartPoints = [],
  onDotClick,
  fmt,
  unitLabel,
}: WeightDotProps) {
  if (cx == null || cy == null || !payload?.date) return null
  const isPeeked = payload.date === peeked
  const active = payload.date === selectedDate || isPeeked
  const point = chartPoints.find(p => p.date === payload.date)
  const isFirst = point === chartPoints[0]
  const isLast = point === chartPoints[chartPoints.length - 1]
  const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
  const label = point && fmt ? `${fmt(point.canonical)} ${unitLabel ?? ''}` : ''
  const labelBelow = cy < 24
  const pillWidth = label.length * 6.5 + 16
  const pillX = anchor === 'start' ? cx : anchor === 'end' ? cx - pillWidth : cx - pillWidth / 2
  const pillY = labelBelow ? cy + 10 : cy - 30
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={e => {
        e.stopPropagation()
        if (point) onDotClick?.(point)
      }}
    >
      <circle cx={cx} cy={cy} r={14} fill="transparent" />
      {active && <circle cx={cx} cy={cy} r={9} fill="var(--chart-mark)" opacity={0.22} />}
      <circle
        cx={cx}
        cy={cy}
        r={active ? 5 : 4}
        fill="var(--chart-mark)"
        stroke="var(--surface)"
        strokeWidth={2}
      />
      {isPeeked && (
        <g pointerEvents="none">
          <rect
            x={pillX}
            y={pillY}
            width={pillWidth}
            height={18}
            rx={5}
            fill="var(--surface-elevated)"
            stroke="var(--border)"
          />
          <text
            x={anchor === 'start' ? pillX + 8 : anchor === 'end' ? pillX + pillWidth - 8 : cx}
            y={pillY + 13}
            textAnchor={anchor === 'middle' ? 'middle' : anchor}
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--text-primary)"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  )
}

class ChartGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    reportError(error, { operation: 'body-weight-chart' })
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px 0' }}>
          Could not render the weight chart. Use History below to view or edit entries.
        </div>
      )
    }
    return this.props.children
  }
}

export default function BodyWeightChart({
  chartPoints,
  peeked,
  selectedDate,
  onDotClick,
  fmt,
  unitLabel,
}: {
  chartPoints: BodyWeightPoint[]
  peeked: string | null
  selectedDate?: string
  onDotClick: (point: BodyWeightPoint) => void
  fmt: (canonicalLbs: number) => string
  unitLabel: string
}) {
  const { reduceMotion } = useMotionPref()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleChartClick(state: any) {
    const raw = state?.activeIndex ?? state?.activeTooltipIndex
    const idx = typeof raw === 'string' ? Number(raw) : raw
    if (idx == null || !Number.isFinite(idx)) return
    const point = chartPoints[idx as number]
    if (point) onDotClick(point)
  }

  return (
    <div style={{ height: '120px', width: '100%', minWidth: 0 }} aria-hidden="true">
      <ChartGuard>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartPoints}
            margin={{ top: 4, right: 20, bottom: 0, left: 4 }}
            onClick={handleChartClick}
            style={{ cursor: 'pointer' }}
          >
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
              width={40}
              domain={['dataMin - 2', 'dataMax + 2']}
              tickFormatter={(v: number) => String(Math.round(v))}
            />
            <Tooltip
              trigger="hover"
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
              wrapperStyle={{ pointerEvents: 'none', outline: 'none' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const point = payload[0]?.payload as BodyWeightPoint | undefined
                if (!point) return null
                return (
                  <div
                    style={{
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontFamily: 'var(--font-sans)',
                      boxShadow: 'var(--card-shadow)',
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      {point.displayDate}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '14px',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {fmt(point.canonical)} {unitLabel}
                    </div>
                  </div>
                )
              }}
            />
            <Line
              type="monotone"
              dataKey="weight"
              stroke="var(--chart-mark)"
              strokeWidth={2}
              dot={
                <WeightDot
                  peeked={peeked}
                  selectedDate={selectedDate}
                  chartPoints={chartPoints}
                  onDotClick={onDotClick}
                  fmt={fmt}
                  unitLabel={unitLabel}
                />
              }
              activeDot={false}
              isAnimationActive={!reduceMotion}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartGuard>
    </div>
  )
}
