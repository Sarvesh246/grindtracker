'use client'

import dynamic from 'next/dynamic'

/**
 * Lazy Coach host — keeps Fab/Sheet out of the initial (app) shell chunk.
 * ssr:false: portal/FAB is client-only chrome.
 */
const CoachRoot = dynamic(() => import('./CoachRoot'), {
  ssr: false,
  loading: () => null,
})

export default function CoachRootLazy() {
  return <CoachRoot />
}
