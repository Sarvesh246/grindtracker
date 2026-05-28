import { CSSProperties, ReactNode } from 'react'

export default function StatTile({
  label,
  value,
  sub,
  style,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        flex: 1,
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--card-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        ...style,
      }}
    >
      <span
        style={{
          fontSize: '10px',
          letterSpacing: 'var(--tracking-label)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-display-md)',
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}
