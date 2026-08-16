import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getExerciseRest,
  setExerciseRest,
  getSessionRest,
  setSessionRest,
  clearSessionRest,
  resolveRestSeconds,
  getDefaultRest,
  setDefaultRest,
  DEFAULT_REST,
} from '../restPref'

function mockLocalStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
}

describe('resolveRestSeconds', () => {
  beforeEach(() => {
    mockLocalStorage()
    setDefaultRest(120)
  })

  it('falls back to the global default', () => {
    assert.equal(getDefaultRest(), 120)
    assert.equal(resolveRestSeconds('ex-1'), DEFAULT_REST)
  })

  it('prefers a per-exercise override over the global default', () => {
    setExerciseRest('ex-1', 90)
    assert.equal(getExerciseRest('ex-1'), 90)
    assert.equal(resolveRestSeconds('ex-1'), 90)
    assert.equal(resolveRestSeconds('ex-2'), 120)
  })

  it('prefers a session override over the per-exercise default', () => {
    setExerciseRest('ex-1', 90)
    setSessionRest('sess-1', 60)
    assert.equal(getSessionRest('sess-1'), 60)
    assert.equal(resolveRestSeconds('ex-1', 'sess-1'), 60)
    assert.equal(resolveRestSeconds('ex-2', 'sess-1'), 60)
    assert.equal(resolveRestSeconds('ex-1', 'sess-other'), 90)
  })

  it('clears the session override so later starts use exercise/global again', () => {
    setExerciseRest('ex-1', 90)
    setSessionRest('sess-1', 180)
    clearSessionRest('sess-1')
    assert.equal(getSessionRest('sess-1'), null)
    assert.equal(resolveRestSeconds('ex-1', 'sess-1'), 90)
  })
})
