'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  COACH_MAX_HISTORY_MESSAGES,
  COACH_MAX_MESSAGE_CHARS,
  type CoachConversationSummary,
} from '@/lib/coach'
import { titleFromMessage } from '@/lib/coach/conversations'
import { useUnit } from '@/lib/contexts/UnitContext'
import { localDateKey } from '@/lib/utils/formatting'

export type CoachDockId = 'br' | 'bl' | 'tr' | 'tl'
/** compact = quick sheet; page = full-screen Coach app */
export type CoachSheetSize = 'compact' | 'page'
export type CoachMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type CoachQuotaState = {
  dailyUsed: number
  dailyLimit: number
  dailyRemaining: number
  burstUsed: number
  burstLimit: number
  burstRemaining: number
  unlimited: boolean
  dailyResetsAt?: string | null
  burstResetsAt?: string | null
}

type CoachContextValue = {
  open: boolean
  size: CoachSheetSize
  dock: CoachDockId
  messages: CoachMessage[]
  streaming: boolean
  error: string | null
  quota: CoachQuotaState | null
  configured: boolean | null
  quotaLoaded: boolean
  conversations: CoachConversationSummary[]
  activeConversationId: string | null
  historyOpen: boolean
  fabRef: React.RefObject<HTMLButtonElement | null>
  setDock: (dock: CoachDockId) => void
  openCoach: () => void
  closeCoach: () => void
  expandToPage: () => void
  setSize: (size: CoachSheetSize) => void
  sendMessage: (text: string) => Promise<void>
  clearError: () => void
  newChat: () => void
  openHistory: () => void
  closeHistory: () => void
  loadConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  refreshConversations: () => Promise<void>
}

const DOCK_KEY = 'grind_coach_fab_dock'
const DOCK_EVENT = 'grind-coach-dock'
const DOCKS: CoachDockId[] = ['br', 'bl', 'tr', 'tl']

const CoachContext = createContext<CoachContextValue | null>(null)

function readStoredDock(): CoachDockId {
  if (typeof window === 'undefined') return 'br'
  try {
    const raw = window.localStorage.getItem(DOCK_KEY)
    if (raw && DOCKS.includes(raw as CoachDockId)) return raw as CoachDockId
  } catch {
    // private mode / blocked storage
  }
  return 'br'
}

function persistDock(dock: CoachDockId) {
  try {
    window.localStorage.setItem(DOCK_KEY, dock)
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DOCK_EVENT))
  }
}

function subscribeDock(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(DOCK_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(DOCK_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function CoachProvider({ children }: { children: ReactNode }) {
  const { unitLabel } = useUnit()
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState<CoachSheetSize>('compact')
  const dock = useSyncExternalStore(
    subscribeDock,
    readStoredDock,
    () => 'br' as CoachDockId,
  )
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quota, setQuota] = useState<CoachQuotaState | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [quotaLoaded, setQuotaLoaded] = useState(false)
  const [conversations, setConversations] = useState<CoachConversationSummary[]>(
    [],
  )
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const fabRef = useRef<HTMLButtonElement | null>(null)
  const openedOnce = useRef(false)

  const setDock = useCallback((next: CoachDockId) => {
    persistDock(next)
  }, [])

  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/chat')
      const data = (await res.json().catch(() => ({}))) as {
        quota?: CoachQuotaState
        configured?: boolean
        error?: string
      }
      if (!res.ok) {
        if (res.status === 503) {
          setConfigured(false)
          setError(
            data.error ??
              "Coach isn't ready yet. Apply the coach SQL migration and set GEMINI_API_KEY.",
          )
        }
        setQuotaLoaded(true)
        return
      }
      if (data.quota) setQuota(data.quota)
      setConfigured(data.configured ?? true)
      setQuotaLoaded(true)
    } catch {
      setQuotaLoaded(true)
      setError('Could not load coach status. Check your connection.')
    }
  }, [])

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/conversations')
      if (!res.ok) return
      const data = (await res.json()) as {
        conversations?: CoachConversationSummary[]
      }
      setConversations(data.conversations ?? [])
    } catch {
      // History is optional until migration 35 is applied.
    }
  }, [])

  const openCoach = useCallback(() => {
    setOpen(true)
    setSize('compact')
    setHistoryOpen(false)
    setError(null)
    if (!openedOnce.current) {
      openedOnce.current = true
      void refreshQuota()
      void refreshConversations()
    } else {
      if (!quotaLoaded) void refreshQuota()
      void refreshConversations()
    }
  }, [quotaLoaded, refreshQuota, refreshConversations])

  const closeCoach = useCallback(() => {
    // Blur the composer before unmount so iOS doesn't leave the layout
    // viewport panned after the focused field disappears (standalone PWA).
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()

    setOpen(false)
    setSize('compact')
    setHistoryOpen(false)

    // Same-position scrollTo is a no-op for the page but forces WebKit to
    // clamp a leftover visual-viewport pan and re-anchor fixed layers — the
    // same heal used after keyboard dismiss in ActiveWorkout.
    const reanchor = () => {
      try {
        window.scrollTo(window.scrollX, window.scrollY)
      } catch {
        // ignore
      }
    }
    // theme-color stays on app --bg (Coach no longer pushes --surface).
    // CoachSheet still force-heals chrome on page close for iOS PWA stickiness.
    reanchor()
    requestAnimationFrame(() => {
      reanchor()
      fabRef.current?.focus()
    })
    window.setTimeout(reanchor, 250)
    window.setTimeout(reanchor, 520)
  }, [])

  const expandToPage = useCallback(() => {
    setSize('page')
    setHistoryOpen(false)
    void refreshConversations()
  }, [refreshConversations])

  const clearError = useCallback(() => setError(null), [])

  const newChat = useCallback(() => {
    if (streaming) return
    setMessages([])
    setActiveConversationId(null)
    setHistoryOpen(false)
    setError(null)
  }, [streaming])

  const openHistory = useCallback(() => {
    setHistoryOpen(true)
    void refreshConversations()
  }, [refreshConversations])

  const closeHistory = useCallback(() => setHistoryOpen(false), [])

  const loadConversation = useCallback(
    async (id: string) => {
      if (streaming || !id || id === 'pending') return
      setError(null)
      // Already viewing this thread — just dismiss the history panel.
      if (id === activeConversationId) {
        setHistoryOpen(false)
        return
      }
      try {
        const res = await fetch(`/api/coach/conversations/${id}`)
        if (!res.ok) {
          setError('Could not open that chat.')
          return
        }
        const data = (await res.json()) as {
          messages?: CoachMessage[]
          conversation?: CoachConversationSummary
        }
        setActiveConversationId(id)
        setMessages(data.messages ?? [])
        setHistoryOpen(false)
        setSize('page')
      } catch {
        setError('Could not open that chat.')
      }
    },
    [streaming, activeConversationId],
  )

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/coach/conversations/${id}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          setError('Could not delete that chat.')
          return
        }
        setConversations(prev => prev.filter(c => c.id !== id))
        if (activeConversationId === id) {
          setActiveConversationId(null)
          setMessages([])
        }
      } catch {
        setError('Could not delete that chat.')
      }
    },
    [activeConversationId],
  )

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || streaming) return
      if (text.length > COACH_MAX_MESSAGE_CHARS) {
        setError(`Message must be at most ${COACH_MAX_MESSAGE_CHARS} characters.`)
        return
      }
      if (quota && !quota.unlimited && quota.dailyRemaining <= 0) {
        const when = quota.dailyResetsAt
          ? (() => {
              const at = new Date(quota.dailyResetsAt)
              if (Number.isNaN(at.getTime())) return null
              const ms = at.getTime() - Date.now()
              if (ms <= 0) return 'soon'
              const mins = Math.max(1, Math.ceil(ms / 60_000))
              if (mins < 60) return `in ${mins}m`
              const h = Math.floor(mins / 60)
              const m = mins % 60
              return m ? `in ${h}h ${m}m` : `in ${h}h`
            })()
          : null
        setError(
          when
            ? `Daily coach limit reached (${quota.dailyLimit} messages). Try again ${when}.`
            : `Daily coach limit reached (${quota.dailyLimit} messages per day). Try again after the 24-hour window resets.`,
        )
        return
      }

      setError(null)
      const userMsg: CoachMessage = { id: uid(), role: 'user', content: text }
      const history = messages
        .filter(m => m.content.trim())
        .slice(-COACH_MAX_HISTORY_MESSAGES)
        .map(m => ({ role: m.role, content: m.content }))

      const assistantId = uid()
      const wasEmpty = messages.length === 0
      setMessages(prev => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '' },
      ])
      setStreaming(true)

      // Optimistic title bump for a brand-new thread.
      if (!activeConversationId && wasEmpty) {
        setConversations(prev => [
          {
            id: 'pending',
            title: titleFromMessage(text),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...prev.filter(c => c.id !== 'pending'),
        ])
      }

      try {
        let timeZone: string | undefined
        try {
          timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch {
          timeZone = undefined
        }
        const res = await fetch('/api/coach/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history,
            unit: unitLabel,
            conversationId: activeConversationId,
            localDate: localDateKey(),
            timeZone,
          }),
        })

        const convHeader = res.headers.get('X-Coach-Conversation-Id')
        if (convHeader) {
          setActiveConversationId(convHeader)
          setConversations(prev => {
            const existing = prev.find(c => c.id === convHeader)
            const without = prev.filter(
              c => c.id !== 'pending' && c.id !== convHeader,
            )
            return [
              {
                id: convHeader,
                title: existing?.title ?? titleFromMessage(text),
                createdAt: existing?.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...without,
            ]
          })
        } else {
          // Migration 35 missing / create failed — drop the optimistic stub so
          // history doesn't show a disabled "pending" row that can't be opened.
          setConversations(prev => prev.filter(c => c.id !== 'pending'))
        }

        if (!res.ok) {
          let errText = 'Coach failed to respond. Try again in a moment.'
          try {
            const body = (await res.json()) as {
              error?: string
              code?: string
              quota?: CoachQuotaState
            }
            if (body.quota) setQuota(body.quota)
            if (body.error) errText = body.error
            if (body.code === 'daily' && body.quota?.dailyResetsAt) {
              const at = new Date(body.quota.dailyResetsAt)
              if (!Number.isNaN(at.getTime())) {
                const ms = at.getTime() - Date.now()
                const mins = Math.max(1, Math.ceil(ms / 60_000))
                const when =
                  ms <= 0
                    ? 'soon'
                    : mins < 60
                      ? `in ${mins}m`
                      : (() => {
                          const h = Math.floor(mins / 60)
                          const m = mins % 60
                          return m ? `in ${h}h ${m}m` : `in ${h}h`
                        })()
                const clock = at.toLocaleString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })
                errText = `Daily coach limit reached (${body.quota.dailyLimit} messages). Chat again ${when} (around ${clock}).`
              }
            } else if (body.code === 'burst' && body.quota?.burstResetsAt) {
              const at = new Date(body.quota.burstResetsAt)
              if (!Number.isNaN(at.getTime())) {
                const mins = Math.max(
                  1,
                  Math.ceil((at.getTime() - Date.now()) / 60_000),
                )
                errText = `Too many messages too quickly. Try again in ${mins}m.`
              }
            }
          } catch {
            if (res.status === 503) {
              errText = "Coach isn't ready yet."
            } else if (res.status === 429) {
              errText = 'Rate limit reached. Try again later.'
            }
          }
          setMessages(prev =>
            prev.filter(m => !(m.id === assistantId && !m.content)),
          )
          setError(errText)
          if (res.status === 503) setConfigured(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          setMessages(prev =>
            prev.filter(m => !(m.id === assistantId && !m.content)),
          )
          setError('Coach failed to respond. Try again in a moment.')
          return
        }

        const decoder = new TextDecoder()
        let acc = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          const snapshot = acc
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, content: snapshot } : m,
            ),
          )
        }
        acc += decoder.decode()
        const finalText = acc.trim()
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: finalText || m.content }
              : m,
          ),
        )
        if (!finalText) {
          setMessages(prev => prev.filter(m => m.id !== assistantId))
          setError('Coach returned an empty reply. Try again.')
        }
      } catch {
        setMessages(prev =>
          prev.filter(m => !(m.id === assistantId && !m.content)),
        )
        setConversations(prev => prev.filter(c => c.id !== 'pending'))
        setError('Could not reach Coach. Check your connection.')
      } finally {
        setStreaming(false)
        void refreshQuota()
        void refreshConversations()
      }
    },
    [
      messages,
      quota,
      streaming,
      unitLabel,
      refreshQuota,
      refreshConversations,
      activeConversationId,
    ],
  )

  const value = useMemo<CoachContextValue>(
    () => ({
      open,
      size,
      dock,
      messages,
      streaming,
      error,
      quota,
      configured,
      quotaLoaded,
      conversations,
      activeConversationId,
      historyOpen,
      fabRef,
      setDock,
      openCoach,
      closeCoach,
      expandToPage,
      setSize,
      sendMessage,
      clearError,
      newChat,
      openHistory,
      closeHistory,
      loadConversation,
      deleteConversation,
      refreshConversations,
    }),
    [
      open,
      size,
      dock,
      messages,
      streaming,
      error,
      quota,
      configured,
      quotaLoaded,
      conversations,
      activeConversationId,
      historyOpen,
      setDock,
      openCoach,
      closeCoach,
      expandToPage,
      sendMessage,
      clearError,
      newChat,
      openHistory,
      closeHistory,
      loadConversation,
      deleteConversation,
      refreshConversations,
    ],
  )

  return (
    <CoachContext.Provider value={value}>{children}</CoachContext.Provider>
  )
}

export function useCoach() {
  const ctx = useContext(CoachContext)
  if (!ctx) throw new Error('useCoach must be used within CoachProvider')
  return ctx
}
