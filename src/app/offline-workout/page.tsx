import LogPage from '@/app/(app)/log/page'
import OfflineSyncAgent from '@/components/OfflineSyncAgent'
import { UnitProvider } from '@/lib/contexts/UnitContext'
import { DemoModeProvider } from '@/lib/contexts/DemoModeContext'
import { OnboardingProvider } from '@/lib/contexts/OnboardingContext'
import { ToastProvider } from '@/lib/contexts/ToastContext'

/** Credential-free HTML. The client opens only the current account's device data. */
export default function OfflineWorkoutPage() {
  return (
    <UnitProvider initialUnit="imperial">
      <DemoModeProvider initialDemoMode={false}>
        <OnboardingProvider userId="anon" initialState={{ toursSeen: [], tooltipsSeen: [], skipAll: true, tooltipsSkipped: true }}>
          <ToastProvider>
            <OfflineSyncAgent />
            <div className="app-shell">
              <main className="app-main"><LogPage /></main>
            </div>
          </ToastProvider>
        </OnboardingProvider>
      </DemoModeProvider>
    </UnitProvider>
  )
}
