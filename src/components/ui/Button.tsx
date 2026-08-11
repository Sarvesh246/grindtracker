import { ButtonHTMLAttributes, CSSProperties, forwardRef, ReactNode } from 'react'
import type { HapticIntensity } from '@/lib/utils/haptics'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const HEIGHT: Record<Size, string> = {
  sm: 'var(--btn-sm)',
  md: 'var(--btn-md)',
  lg: 'var(--btn-lg)',
}

const FONT_SIZE: Record<Size, string> = {
  sm: '13px',
  md: '14px',
  lg: '15px',
}

function variantStyle(variant: Variant, disabled: boolean): CSSProperties {
  if (disabled) {
    return {
      backgroundColor: 'var(--surface-elevated)',
      color: 'var(--text-disabled)',
      border: '1px solid var(--border)',
      cursor: 'not-allowed',
    }
  }
  switch (variant) {
    case 'primary':
      return {
        backgroundColor: 'var(--accent)',
        color: 'var(--on-accent)',
        border: '1px solid var(--accent)',
        fontWeight: 700,
      }
    case 'secondary':
      return {
        backgroundColor: 'var(--surface-elevated)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        fontWeight: 500,
      }
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
        border: '1px solid transparent',
        fontWeight: 500,
      }
    case 'danger':
      return {
        backgroundColor: 'var(--danger-bg)',
        color: 'var(--danger)',
        border: '1px solid var(--danger-bg-hover)',
        fontWeight: 600,
      }
  }
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  /** Opt-in: stamps `data-haptic` only — no default buzz on every Button. */
  haptic?: HapticIntensity
  children: ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    disabled = false,
    haptic: hapticIntensity,
    style,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      // `press` adds the shared tap-dip; a caller's own className still wins
      // for anything it sets, it just can't drop the press feedback.
      className={className ? `press ${className}` : 'press'}
      data-haptic={hapticIntensity}
      style={{
        height: HEIGHT[size],
        padding: `0 ${size === 'lg' ? '20px' : size === 'md' ? '16px' : '12px'}`,
        borderRadius: 'var(--radius-md)',
        fontSize: FONT_SIZE[size],
        fontFamily: 'var(--font-sans)',
        letterSpacing: '0.5px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        ...variantStyle(variant, disabled),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
})

export default Button
