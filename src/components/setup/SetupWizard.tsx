'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import SetupProgress from '@/components/setup/SetupProgress'
import WelcomeStep from '@/components/setup/steps/WelcomeStep'
import IdentityStep, { type SetupProfile } from '@/components/setup/steps/IdentityStep'
import PreferencesStep from '@/components/setup/steps/PreferencesStep'
import BodyWeightStep from '@/components/setup/steps/BodyWeightStep'
import RestDaysStep from '@/components/setup/steps/RestDaysStep'
import WorkoutStep from '@/components/setup/steps/WorkoutStep'
import { haptic } from '@/lib/utils/haptics'

const STEP_COUNT = 6

export type SetupWizardInitial = {
  profile: SetupProfile | null
  latestWeightLbs: number | null
  restDays: number[]
  hasExistingProgram: boolean
}

export default function SetupWizard({
  supabase,
  user,
  initial,
}: {
  supabase: SupabaseClient
  user: User
  initial: SetupWizardInitial
}) {
  // Always start at Welcome so Replay Setup rewalks the full flow.
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [profile, setProfile] = useState<SetupProfile | null>(initial.profile)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const router = useRouter()

  const goTo = useCallback((next: number, dir: 'forward' | 'back') => {
    setDirection(dir)
    setStep(Math.min(Math.max(next, 0), STEP_COUNT - 1))
    setFinishError(null)
    if (dir === 'forward') haptic('light')
  }, [])

  const finishSetup = useCallback(async () => {
    setFinishing(true)
    setFinishError(null)
    try {
      const res = await fetch('/api/setup/complete', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || 'Could not finish setup.')
      }
      router.replace('/home')
      router.refresh()
    } catch (e) {
      setFinishError(e instanceof Error ? e.message : 'Could not finish setup.')
      setFinishing(false)
    }
  }, [router])

  const showBack = step > 0

  return (
    <div
      style={{
        minHeight: '100%',
        height: '100dvh',
        backgroundColor: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: "'DM Sans', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top chrome: back (steps 1–5) */}
      <div
        style={{
          flexShrink: 0,
          padding:
            'calc(12px + env(safe-area-inset-top, 0px)) 16px 8px',
          minHeight: showBack ? undefined : 'calc(12px + env(safe-area-inset-top, 0px))',
        }}
      >
        {showBack && (
          <button
            type="button"
            data-haptic="light"
            className="press"
            onClick={() => goTo(step - 1, 'back')}
            disabled={finishing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
              cursor: finishing ? 'default' : 'pointer',
              padding: '8px 4px',
              opacity: finishing ? 0.5 : 1,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
        )}
      </div>

      {/* Step content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 24px 0',
          maxWidth: '420px',
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          key={step}
          className={
            direction === 'forward'
              ? 'setup-step-enter-forward'
              : 'setup-step-enter-back'
          }
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {step === 0 && (
            <WelcomeStep onContinue={() => goTo(1, 'forward')} />
          )}
          {step === 1 && (
            <IdentityStep
              supabase={supabase}
              user={user}
              existingProfile={profile}
              onComplete={p => {
                setProfile(p)
                goTo(2, 'forward')
              }}
            />
          )}
          {step === 2 && (
            <PreferencesStep onContinue={() => goTo(3, 'forward')} />
          )}
          {step === 3 && profile && (
            <BodyWeightStep
              supabase={supabase}
              userId={user.id}
              initialWeightLbs={initial.latestWeightLbs}
              onContinue={() => goTo(4, 'forward')}
              onSkip={() => goTo(4, 'forward')}
            />
          )}
          {step === 4 && profile && (
            <RestDaysStep
              supabase={supabase}
              userId={user.id}
              initialRestDays={initial.restDays}
              onContinue={() => goTo(5, 'forward')}
            />
          )}
          {step === 5 && profile && (
            <WorkoutStep
              supabase={supabase}
              userId={user.id}
              hasExistingProgram={initial.hasExistingProgram}
              finishing={finishing}
              onFinish={finishSetup}
            />
          )}
        </div>

        {finishError && (
          <div
            role="alert"
            style={{
              marginTop: '12px',
              padding: '12px 14px',
              backgroundColor: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--danger)',
              borderRadius: '8px',
              color: 'var(--danger)',
              fontSize: '13px',
              flexShrink: 0,
            }}
          >
            {finishError}
          </div>
        )}
      </div>

      {/* Bottom progress (safe area) */}
      <div
        style={{
          flexShrink: 0,
          padding: '16px 24px calc(16px + env(safe-area-inset-bottom, 0px))',
          maxWidth: '420px',
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <SetupProgress stepIndex={step} />
      </div>
    </div>
  )
}
