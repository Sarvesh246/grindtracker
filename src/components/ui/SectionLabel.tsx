import { CSSProperties, ReactNode } from 'react'

export default function SectionLabel({
  children,
  as: As = 'h2',
  style,
}: {
  children: ReactNode
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'div'
  style?: CSSProperties
}) {
  return (
    <As
      style={{
        fontSize: '11px',
        letterSpacing: 'var(--tracking-label)',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      {children}
    </As>
  )
}
