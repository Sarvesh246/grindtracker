'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  COACH_MAX_HISTORY_MESSAGES,
  COACH_MAX_MESSAGE_CHARS,
  type CoachActionRunState,
  type CoachConversationSummary,
  type CoachProposalView,
} from '@/lib/coach'
import { parseCoachChatStreamLine, rehydrateCoachNdjson, shouldParseCoachNdjson, looksLikeCoachNdjson } from '@/lib/coach/actions'
import {
  bindOpenCoachWindowEvent,
  subscribeOpenCoach,
  type OpenCoachDetail,
} from '@/lib/coach/openCoachBus'
import type { CoachChipHints } from '@/lib/coach/starterChips'
import { titleFromMessage } from '@/lib/coach/conversations'
import { useUnit } from '@/lib/contexts/UnitContext'
import { localDateKey } from '@/lib/utils/formatting'
import { focusWithoutRing } from '@/lib/utils/haptics'
import { useRouter } from 'next/navigation'

export type CoachDockId = 'br' | 'bl' | 'tr' | 'tl'
/** compact = quick sheet; page = full-screen Coach app */
export type CoachSheetSize = 'compact' | 'page'
export type CoachMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  proposals?: CoachProposalView[]
  actionRuns?: Record<string, CoachActionRunState>
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
  /** Lightweight empty-state chip context from GET /api/coach/chat. */
  chipHints: CoachChipHints | null
  /** Mid-workout: FAB hidden; prefer compact sheet. */
  workoutSlim: boolean
  conversations: CoachConversationSummary[]
  activeConversationId: string | null
  historyOpen: boolean
  fabRef: React.RefObject<HTMLButtonElement | null>
  setDock: (dock: CoachDockId) => void
  openCoach: (detail?: OpenCoachDetail) => void
  closeCoach: () => void
  expandToPage: () => void
  setSize: (size: CoachSheetSize) => void
  sendMessage: (text: string) => Promise<void>
  decideProposal: (
    proposalId: string,
    decision: 'confirm' | 'cancel',
  ) => Promise<void>
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

export function CoachProvider({
  children,
  workoutSlim = false,
}: {
  children: ReactNode
  /** Active workout route — hide FAB chrome; still host the sheet. */
  workoutSlim?: boolean
}) {
  const { unitLabel } = useUnit()
  const router = useRouter()
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
  const [chipHints, setChipHints] = useState<CoachChipHints | null>(null)
  const [conversations, setConversations] = useState<CoachConversationSummary[]>(
    [],
  )
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const fabRef = useRef<HTMLButtonElement | null>(null)
  const openedOnce = useRef(false)
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {})

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
        chipHints?: {
          has_active_session?: boolean
          next_day?: string | null
          last_pr_exercise?: string | null
        }
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
      if (data.chipHints) {
        setChipHints({
          hasActiveSession: !!data.chipHints.has_active_session,
          nextDay: data.chipHints.next_day ?? null,
          lastPrExercise: data.chipHints.last_pr_exercise ?? null,
        })
      }
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

  const openCoach = useCallback(
    (detail: OpenCoachDetail = {}) => {
      setOpen(true)
      // Mid-workout Ask Coach always lands compact; callers may still request page.
      setSize(
        detail.size === 'page' && !workoutSlim ? 'page' : 'compact',
      )
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
      const msg = detail.message?.trim()
      if (msg) {
        queueMicrotask(() => {
          void sendMessageRef.current(msg)
        })
      }
    },
    [quotaLoaded, refreshQuota, refreshConversations, workoutSlim],
  )

  useEffect(() => {
    const unbind = bindOpenCoachWindowEvent()
    const unsub = subscribeOpenCoach(detail => {
      openCoach(detail)
    })
    return () => {
      unbind()
      unsub()
    }
  }, [openCoach])

  const openCoachRef = useRef(openCoach)
  openCoachRef.current = openCoach
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {})

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
      // Return focus for a11y, but never paint :focus-visible — that global
      // ring also forces --radius-sm, which turns the G orb into a rounded
      // square/hex until the next blur (e.g. switching tabs).
      if (fabRef.current) focusWithoutRing(fabRef.current)
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
        let buffer = ''
        let textAcc = ''
        let rawAcc = ''
        const proposals: CoachProposalView[] = []
        // Don't trust the custom header alone — Vercel/fetch can hide it.
        // Decide from Content-Type, header, or body sniff (may flip after first chunk).
        let mode: 'unknown' | 'ndjson' | 'plain' = shouldParseCoachNdjson({
          contentType: res.headers.get('Content-Type'),
          streamHeader: res.headers.get('X-Coach-Stream'),
        })
          ? 'ndjson'
          : 'unknown'

        let pendingContent = ''
        let pendingProposals: CoachProposalView[] | undefined
        let flushRaf: number | null = null
        const commitAssistant = (
          content: string,
          nextProposals?: CoachProposalView[],
        ) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content,
                    proposals:
                      nextProposals && nextProposals.length
                        ? nextProposals
                        : m.proposals,
                  }
                : m,
            ),
          )
        }
        const flushAssistant = (
          content: string,
          nextProposals?: CoachProposalView[],
          sync = false,
        ) => {
          pendingContent = content
          if (nextProposals && nextProposals.length) {
            pendingProposals = nextProposals
          }
          if (sync) {
            if (flushRaf != null) {
              window.cancelAnimationFrame(flushRaf)
              flushRaf = null
            }
            commitAssistant(pendingContent, pendingProposals)
            return
          }
          if (flushRaf != null) return
          flushRaf = window.requestAnimationFrame(() => {
            flushRaf = null
            commitAssistant(pendingContent, pendingProposals)
          })
        }

        const applyNdjsonLine = (line: string) => {
          const event = parseCoachChatStreamLine(line)
          if (!event) return
          if (event.type === 'text-delta') {
            textAcc += event.text
            flushAssistant(textAcc, proposals)
          } else if (event.type === 'proposal') {
            if (!proposals.some(p => p.id === event.proposal.id)) {
              proposals.push(event.proposal)
            }
            flushAssistant(textAcc, [...proposals])
          } else if (event.type === 'error') {
            setError(event.error)
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          rawAcc += chunk

          if (mode === 'unknown') {
            const trimmed = rawAcc.trimStart()
            if (looksLikeCoachNdjson(rawAcc) || trimmed.startsWith('{')) {
              // Coach streams NDJSON; treat `{...` as NDJSON even mid-line.
              mode = 'ndjson'
            } else if (trimmed.length > 0) {
              mode = 'plain'
            }
          }

          if (mode === 'plain') {
            textAcc += chunk
            flushAssistant(textAcc)
            continue
          }

          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) applyNdjsonLine(line)
        }

        rawAcc += decoder.decode()
        if (mode === 'unknown') {
          mode = looksLikeCoachNdjson(rawAcc) ? 'ndjson' : 'plain'
        }

        if (mode === 'ndjson') {
          if (buffer.trim()) applyNdjsonLine(buffer)
          // If we somehow accumulated raw envelopes into textAcc, rehydrate.
          if (looksLikeCoachNdjson(textAcc) || looksLikeCoachNdjson(rawAcc)) {
            const recovered = rehydrateCoachNdjson(
              looksLikeCoachNdjson(textAcc) ? textAcc : rawAcc,
            )
            textAcc = recovered.text
            for (const p of recovered.proposals) {
              if (!proposals.some(x => x.id === p.id)) proposals.push(p)
            }
            if (recovered.error) setError(recovered.error)
          }
        } else if (looksLikeCoachNdjson(rawAcc)) {
          // Plain mode was wrong — recover from the full raw stream.
          const recovered = rehydrateCoachNdjson(rawAcc)
          textAcc = recovered.text
          for (const p of recovered.proposals) {
            if (!proposals.some(x => x.id === p.id)) proposals.push(p)
          }
          if (recovered.error) setError(recovered.error)
        }

        const finalText = textAcc.trim()
        flushAssistant(
          finalText ||
            (proposals.length
              ? 'I prepared an action for you — confirm or cancel below.'
              : ''),
          proposals,
          true,
        )
        if (!finalText && proposals.length === 0) {
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
  sendMessageRef.current = sendMessage

  const decideProposal = useCallback(
    async (proposalId: string, decision: 'confirm' | 'cancel') => {
      if (!proposalId || streaming) return

      const patchProposal = (
        id: string,
        patch: Partial<CoachProposalView>,
        runPatch?: CoachActionRunState | null,
      ) => {
        setMessages(prev =>
          prev.map(m => {
            if (!m.proposals?.some(p => p.id === id)) return m
            return {
              ...m,
              proposals: m.proposals.map(p =>
                p.id === id ? { ...p, ...patch } : p,
              ),
              actionRuns:
                runPatch === undefined
                  ? m.actionRuns
                  : {
                      ...(m.actionRuns ?? {}),
                      ...(runPatch ? { [id]: runPatch } : {}),
                    },
            }
          }),
        )
      }

      if (decision === 'cancel') {
        patchProposal(proposalId, { status: 'cancelled' })
      } else {
        patchProposal(proposalId, { status: 'confirmed' }, {
          proposalId,
          phase: 'running',
          steps: [],
          message: 'Working…',
        })
      }

      try {
        const res = await fetch('/api/coach/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId, decision }),
        })

        const streamHeader = res.headers.get('X-Coach-Action-Stream')
        if (decision === 'confirm' && streamHeader === 'ndjson' && res.body) {
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let steps: CoachActionRunState['steps'] = []
          let finalMessage = ''
          let ok = true
          let href: string | undefined

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('{')) continue
              try {
                const event = JSON.parse(trimmed) as {
                  type: string
                  index?: number
                  total?: number
                  label?: string
                  state?: CoachActionRunState['steps'][number]['state']
                  ok?: boolean
                  message?: string
                  href?: string
                  error?: string
                }
                if (event.type === 'step' && event.index != null && event.total != null) {
                  const next = [...steps]
                  next[event.index] = {
                    index: event.index,
                    total: event.total,
                    label: event.label ?? `Step ${event.index + 1}`,
                    state: event.state ?? 'active',
                  }
                  // Fill pending placeholders
                  for (let i = 0; i < event.total; i++) {
                    if (!next[i]) {
                      next[i] = {
                        index: i,
                        total: event.total,
                        label: `Step ${i + 1}`,
                        state: 'pending',
                      }
                    }
                  }
                  steps = next
                  patchProposal(proposalId, { status: 'confirmed' }, {
                    proposalId,
                    phase: 'running',
                    steps,
                  })
                } else if (event.type === 'result') {
                  ok = Boolean(event.ok)
                  finalMessage = event.message ?? ''
                  href = event.href
                } else if (event.type === 'error') {
                  ok = false
                  finalMessage = event.error ?? 'Action failed.'
                }
              } catch {
                // ignore bad lines
              }
            }
          }

          patchProposal(
            proposalId,
            { status: ok ? 'executed' : 'failed' },
            {
              proposalId,
              phase: ok ? 'done' : 'error',
              steps: steps.map(s =>
                s.state === 'active' ? { ...s, state: ok ? 'done' : 'error' } : s,
              ),
              message: finalMessage,
            },
          )
          if (finalMessage) {
            setMessages(prev => [
              ...prev,
              {
                id: uid(),
                role: 'assistant',
                content: finalMessage,
              },
            ])
          }
          if (ok && href) {
            window.setTimeout(() => router.push(href!), 450)
          }
          return
        }

        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          status?: string
          message?: string
          href?: string
          error?: string
        }

        if (!res.ok) {
          const msg = body.error ?? body.message ?? 'Action failed.'
          patchProposal(proposalId, { status: 'failed' }, {
            proposalId,
            phase: 'error',
            steps: [],
            message: msg,
          })
          setError(msg)
          return
        }

        if (decision === 'cancel') {
          patchProposal(proposalId, { status: 'cancelled' }, {
            proposalId,
            phase: 'done',
            steps: [],
            message: 'Cancelled.',
          })
          setMessages(prev => [
            ...prev,
            { id: uid(), role: 'assistant', content: 'Cancelled.' },
          ])
          return
        }

        const message = body.message ?? 'Done.'
        patchProposal(proposalId, { status: 'executed' }, {
          proposalId,
          phase: 'done',
          steps: [],
          message,
        })
        setMessages(prev => [
          ...prev,
          { id: uid(), role: 'assistant', content: message },
        ])
        if (body.href) {
          window.setTimeout(() => router.push(body.href!), 450)
        }
      } catch {
        if (decision === 'cancel') {
          // Optimistic cancel failed — restore pending so the user can retry.
          patchProposal(proposalId, { status: 'pending' })
        } else {
          patchProposal(proposalId, { status: 'failed' }, {
            proposalId,
            phase: 'error',
            steps: [],
            message: 'Could not reach the action endpoint.',
          })
        }
        setError('Could not complete that action. Check your connection.')
      }
    },
    [streaming, router],
  )

  sendMessageRef.current = sendMessage

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
      chipHints,
      workoutSlim,
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
      decideProposal,
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
      chipHints,
      workoutSlim,
      conversations,
      activeConversationId,
      historyOpen,
      setDock,
      openCoach,
      closeCoach,
      expandToPage,
      sendMessage,
      decideProposal,
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
