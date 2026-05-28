import { CSSProperties, ReactNode } from 'react'

type Padding = 'sm' | 'md' | 'lg' | 'none'

const PAD: Record<Padding, string> = {
  none: '0',
  sm: 'var(--card-sm)',
  md: 'var(--card-md)',
  lg: 'var(--card-lg)',
}

export default function Card({
  children,
  padding = 'md',
  elevated = false,
  style,
  className,
  onClick,
  as: As = 'div',
}: {
  children: ReactNode
  padding?: Padding
  elevated?: boolean
  style?: CSSProperties
  className?: string
  onClick?: () => void
  as?: 'div' | 'section' | 'article'
}) {
  return (
    <As
      onClick={onClick}
      className={className}
      style={{
        backgroundColor: elevated ? 'var(--surface-elevated)' : 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: PAD[padding],
        ...style,
      }}
    >
      {children}
    </As>
  )
}
