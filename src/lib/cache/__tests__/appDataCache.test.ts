import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  CACHE_KEYS,
  consumeRouteRefresh,
  getCached,
  getGeneration,
  getUiState,
  isFresh,
  markAppDataStale,
  resetAppDataCache,
  setCached,
  setUiState,
  subscribe,
} from '../appDataCache'

describe('appDataCache', () => {
  beforeEach(() => {
    resetAppDataCache()
  })

  it('stores and returns payloads', () => {
    setCached(CACHE_KEYS.exercises, [{ id: 'a' }])
    assert.deepEqual(getCached(CACHE_KEYS.exercises), [{ id: 'a' }])
    assert.equal(isFresh(CACHE_KEYS.exercises), true)
  })

  it('keeps stale payloads after markAppDataStale for instant paint', () => {
    setCached('progress:logs:1', [1, 2, 3])
    markAppDataStale()
    assert.deepEqual(getCached('progress:logs:1'), [1, 2, 3])
    assert.equal(isFresh('progress:logs:1'), false)
    assert.equal(getGeneration(), 1)
  })

  it('setCached after invalidation is fresh at the new generation', () => {
    setCached('k', 'old')
    markAppDataStale()
    setCached('k', 'new')
    assert.equal(getCached('k'), 'new')
    assert.equal(isFresh('k'), true)
  })

  it('ui state is not tied to generation', () => {
    setUiState(CACHE_KEYS.progressSelection, { selectedId: 'ex-1' })
    markAppDataStale()
    assert.deepEqual(getUiState(CACHE_KEYS.progressSelection), { selectedId: 'ex-1' })
  })

  it('notifies subscribers on write and invalidation', () => {
    let n = 0
    const unsub = subscribe(() => { n += 1 })
    setCached('k', 1)
    markAppDataStale()
    unsub()
    setCached('k', 2)
    assert.equal(n, 2)
  })

  it('consumeRouteRefresh is false on first visit, true after a later generation', () => {
    assert.equal(consumeRouteRefresh('/home'), false)
    assert.equal(consumeRouteRefresh('/home'), false)
    markAppDataStale()
    assert.equal(consumeRouteRefresh('/progress'), false)
    assert.equal(consumeRouteRefresh('/home'), true)
    assert.equal(consumeRouteRefresh('/home'), false)
  })

  it('freshPath skips a second refresh of the page that already updated', () => {
    consumeRouteRefresh('/home')
    markAppDataStale('/home')
    assert.equal(consumeRouteRefresh('/home'), false)
    assert.equal(consumeRouteRefresh('/profile'), false)
    consumeRouteRefresh('/profile')
    markAppDataStale()
    assert.equal(consumeRouteRefresh('/profile'), true)
  })
})
