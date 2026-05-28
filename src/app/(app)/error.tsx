'use client'
import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div style={{
      minHeight: '60dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: "'DM Sans', sans-serif",
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: '28px', color: '#f0f0f0',
        letterSpacing: '1px', marginBottom: '8px',
      }}>
        SOMETHING WENT WRONG
      </div>
      <div style={{ fontSize: '14px', color: '#555555', marginBottom: '32px', lineHeight: 1.5 }}>
        An unexpected error occurred.<br />Try again or refresh the page.
      </div>
      <button
        onClick={reset}
        style={{
          height: '48px',
          padding: '0 32px',
          backgroundColor: '#c8f135',
          color: '#0f0f0f',
          border: 'none',
          borderRadius: '12px',
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '18px',
          letterSpacing: '1px',
          cursor: 'pointer',
        }}
      >
        TRY AGAIN
      </button>
    </div>
  )
}
