import { CSSProperties, forwardRef, InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, style, ...rest },
  ref,
) {
  const base: CSSProperties = {
    backgroundColor: 'var(--surface-elevated)',
    border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '16px', // 16px prevents iOS zoom on focus
    padding: '10px 12px',
    boxSizing: 'border-box',
    transition: 'border-color 150ms ease',
  }
  return <input ref={ref} style={{ ...base, ...style }} {...rest} />
})

export default Input
