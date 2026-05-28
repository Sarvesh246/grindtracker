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
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
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
