'use client'

import { useMemo } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import SetupWizard, { type SetupWizardInitial } from '@/components/setup/SetupWizard'

/**
 * Client bridge: server page loads initial data; wizard needs the browser
 * Supabase client for mid-flow writes (profile, weights, rest days, templates).
 */
export default function SetupClient({
  user,
  initial,
}: {
  user: User
  initial: SetupWizardInitial
}) {
  const supabase = useMemo(() => createClient(), [])
  return <SetupWizard supabase={supabase} user={user} initial={initial} />
}
