'use client'

import { useEffect, useState } from 'react'

type Props = {
  text: string
  /** Align with user (end) vs assistant (start) bubbles. */
  align?: 'start' | 'end'
}

export default function CoachCopyButton({ text, align = 'start' }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(id)
  }, [copied])

  if (!text.trim()) return null

  return (
    <div
      className={`coach-bubble__copy-row coach-bubble__copy-row--${align}`}
      data-no-sheet-drag
    >
      <button
        type="button"
        className="coach-bubble__copy press"
        data-haptic="light"
        aria-label={copied ? 'Copied' : 'Copy message'}
        onClick={async e => {
          e.stopPropagation()
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
          } catch {
            // Fallback for older WebViews / denied permission.
            try {
              const ta = document.createElement('textarea')
              ta.value = text
              ta.setAttribute('readonly', '')
              ta.style.position = 'fixed'
              ta.style.opacity = '0'
              document.body.appendChild(ta)
              ta.select()
              document.execCommand('copy')
              document.body.removeChild(ta)
              setCopied(true)
            } catch {
              // ignore
            }
          }
        }}
      >
        {copied ? (
          'Copied'
        ) : (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  )
}
