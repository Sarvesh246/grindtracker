'use client'

import type { CoachActionProgressStep } from '@/lib/coach'

type Props = {
  steps: CoachActionProgressStep[]
  phase: 'running' | 'done' | 'error'
  message?: string
}

export default function CoachActionProgress({ steps, phase, message }: Props) {
  if (!steps.length && !message) return null

  return (
    <div className="coach-action__progress" aria-live="polite">
      {steps.length > 0 ? (
        <ol className="coach-action__steps">
          {steps.map(step => (
            <li
              key={`${step.index}-${step.label}`}
              className={`coach-action__step coach-action__step--${step.state}`}
            >
              <span className="coach-action__step-mark" aria-hidden>
                {step.state === 'done'
                  ? '✓'
                  : step.state === 'error'
                    ? '!'
                    : step.state === 'active'
                      ? '●'
                      : '○'}
              </span>
              <span className="coach-action__step-label">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {message ? (
        <p
          className={`coach-action__progress-msg${
            phase === 'error' ? ' coach-action__progress-msg--error' : ''
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
