'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getCached, isFresh, setCached, subscribe } from './appDataCache'

const emptySubscribe = () => () => {}

/**
 * SWR-style reader over `appDataCache`.
 *
 * Cached data is the render source of truth (`useSyncExternalStore` so a
 * remount after client navigation can paint it without a hydration mismatch).
 * A fetch only blocks the UI when there is nothing cached yet.
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): {
  data: T | undefined
  loading: boolean
  refreshing: boolean
  error: Error | null
  refetch: () => Promise<void>
} {
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const getSnapshot = useCallback(
    () => (key ? getCached<T>(key) : undefined),
    [key],
  )

  const data = useSyncExternalStore(
    key ? subscribe : emptySubscribe,
    getSnapshot,
    () => undefined,
  )

  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const inFlightKey = useRef<string | null>(null)

  const load = useCallback(async (force: boolean) => {
    if (!key) return
    if (!force && isFresh(key) && getCached<T>(key) !== undefined) return
    if (inFlightKey.current === key && !force) return
    inFlightKey.current = key
    setFetching(true)
    try {
      const next = await fetcherRef.current()
      if (inFlightKey.current !== key) return
      setCached(key, next)
      setError(null)
    } catch (err) {
      if (inFlightKey.current !== key) return
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (inFlightKey.current === key) {
        inFlightKey.current = null
        setFetching(false)
      }
    }
  }, [key])

  useEffect(() => {
    // Sync from the in-memory cache / network when the key changes — the
    // documented "external store" exception; cached data already painted via
    // useSyncExternalStore, this only kicks the revalidate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false)
  }, [load])

  useEffect(() => {
    if (!key) return
    return subscribe(() => {
      if (!isFresh(key)) void load(false)
    })
  }, [key, load])

  const refetch = useCallback(async () => {
    await load(true)
  }, [load])

  return {
    data,
    loading: key !== null && data === undefined && fetching,
    refreshing: data !== undefined && fetching,
    error,
    refetch,
  }
}
