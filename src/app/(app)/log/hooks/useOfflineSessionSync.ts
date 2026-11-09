'use client'

import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { flushQueuedOps, getQueuedOps } from '@/lib/utils/offlineQueue'
import { applyFlushResult, type LogMap } from '../sessionLogState'

/**
 * Replay queued set writes on mount and whenever the browser comes back online.
 * Exposes flushNow() so finish can await sync before complete_session.
 */
export function useOfflineSessionSync(
  sessionId: string | null,
  supabase: SupabaseClient,
  setLogs: Dispatch<SetStateAction<LogMap>>,
) {
  const applySynced = useCallback(
    (result: Awaited<ReturnType<typeof flushQueuedOps>>) => {
      if (result.synced.length === 0 && result.rejected.length === 0) return
      setLogs(prev => applyFlushResult(prev, result))
    },
    [setLogs],
  )

  useEffect(() => {
    if (!sessionId) return
    async function flush() {
      applySynced(await flushQueuedOps(sessionId!, supabase))
    }
    void flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [sessionId, supabase, applySynced])

  const flushNow = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return true
    applySynced(await flushQueuedOps(sessionId, supabase))
    return getQueuedOps(sessionId).length === 0
  }, [sessionId, supabase, applySynced])

  return { flushNow }
}
