import { ButtonHTMLAttributes, CSSProperties, forwardRef, ReactNode } from 'react'

type Size = 'sm' | 'md' | 'lg'

const PX: Record<Size, number> = { sm: 36, md: 44, lg: 48 }

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  children: ReactNode
  size?: Size
  variant?: 'ghost' | 'surface' | 'danger'
}

function variantStyle(variant: NonNullable<IconButtonProps['variant']>): CSSProperties {
  switch (variant) {
    case 'surface':
      return {
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)',
      }
    case 'danger':
      return {
        backgroundColor: 'var(--danger-bg)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        color: 'var(--danger)',
      }
    case 'ghost':
    default:
      return {
        backgroundColor: 'transparent',
        border: '1px solid transparent',
        color: 'var(--text-secondary)',
      }
  }
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', children, style, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{
        width: `${PX[size]}px`,
        height: `${PX[size]}px`,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background-color 150ms ease, opacity 150ms ease',
        opacity: disabled ? 0.4 : 1,
        ...variantStyle(variant),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
})

export default IconButton
