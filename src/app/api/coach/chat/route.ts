import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { stepCountIs, streamText } from 'ai'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/utils/admin'
import {
  localDateKeyInTimeZone,
  parseClientLocalDate,
} from '@/lib/utils/formatting'
import {
  COACH_DEFAULT_MODEL,
  COACH_MAX_HISTORY_MESSAGES,
  COACH_MAX_HISTORY_CHARS,
  COACH_MAX_MESSAGE_CHARS,
  buildCoachContext,
  formatRecentActions,
  getCoachQuota,
  loadRecentCoachActions,
  localizeCoachContext,
  mapCoachRateLimitError,
  planCoachTurn,
  trimToLastSentence,
  type CoachUnitPreference,
} from '@/lib/coach'
import {
  buildCoachProposalTools,
  encodeNdjson,
  type CoachProposalView,
  type CoachToolContext,
} from '@/lib/coach/actions'
import { titleFromMessage } from '@/lib/coach/conversations'
import {
  COACH_MODELS,
  coachModelSettings,
  resolveCoachModelChain,
} from '@/lib/coach/models'
import { type CoachTurn } from '@/lib/coach/history'
import { loadCoachChipHints } from '@/lib/coach/chipHints'
import {
  coachContextCacheKey,
  getCachedCoachContext,
  setCachedCoachContext,
} from '@/lib/coach/contextCache'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Wall-clock budget for the whole model exchange. A function killed at
 * maxDuration just ends the stream (no error, no `done`), which the client
 * used to report as an empty reply — so the empty-reply retry below only
 * starts while there's realistically time left for it to finish.
 */
const RETRY_DEADLINE_MS = 35_000
/**
 * Hard stop for model streaming, a few seconds inside maxDuration, so a slow
 * reply ends with our own fallback/partial notice, `done`, and a quota refund
 * instead of Vercel killing the function mid-stream.
 */
const MODEL_DEADLINE_MS = 52_000
/**
 * Silence budget per model attempt: no text, tool call or thinking within
 * this long and the attempt is abandoned for the next model in the chain.
 */
const FIRST_PART_MS = 15_000

type HistoryItem = CoachTurn

/** Model steps per turn (tool call → result → reply). */
const MAX_STEPS = 3

function parseUnit(
  bodyUnit: unknown,
  cookieValue: string | undefined,
): CoachUnitPreference {
  if (bodyUnit === 'kg' || bodyUnit === 'metric') return 'kg'
  if (bodyUnit === 'lbs' || bodyUnit === 'lb' || bodyUnit === 'imperial') return 'lbs'
  if (cookieValue === 'metric') return 'kg'
  return 'lbs'
}

/** Prefer client localDate; else derive from IANA tz; never use server TZ. */
function resolveAsOfLocalDate(body: Record<string, unknown>): {
  localDate: string
  timeZone: string | null
} {
  const rawTz =
    typeof body.timeZone === 'string' ? body.timeZone.trim() : ''
  const timeZone = rawTz && rawTz.length <= 64 ? rawTz : null
  const fromClient = parseClientLocalDate(body.localDate)
  if (fromClient) return { localDate: fromClient, timeZone }
  if (timeZone) {
    const fromTz = localDateKeyInTimeZone(timeZone)
    if (fromTz) return { localDate: fromTz, timeZone }
  }
  // Last resort: UTC calendar day (still better than server "local" elsewhere).
  const now = new Date()
  const utc = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  return { localDate: utc, timeZone }
}

function sanitizeHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return []
  const items: HistoryItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const role = (entry as HistoryItem).role
    const content = (entry as HistoryItem).content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    const trimmed = content.trim()
    if (!trimmed || trimmed.length > COACH_MAX_MESSAGE_CHARS) continue
    items.push({ role, content: trimmed })
  }
  // Keep the tail only — client shouldn't ship whole archives.
  const tail = items.slice(-COACH_MAX_HISTORY_MESSAGES)
  // ...and cap the combined size: drop the oldest turns until it fits.
  let total = tail.reduce((sum, m) => sum + m.content.length, 0)
  while (tail.length > 0 && total > COACH_MAX_HISTORY_CHARS) {
    total -= tail.shift()!.content.length
  }
  return tail
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now()
  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Coach is not configured (missing GEMINI_API_KEY)' },
      { status: 503 },
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const message =
    typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }
  if (message.length > COACH_MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message must be at most ${COACH_MAX_MESSAGE_CHARS} characters` },
      { status: 400 },
    )
  }

  const isAdmin = isAdminEmail(user.email)
  const quota = await getCoachQuota(supabase, user.id, isAdmin)
  if (!quota) {
    return NextResponse.json(
      {
        error:
          'Coach storage is not ready. Apply docs/sql/33-coach.sql in the Supabase SQL editor.',
      },
      { status: 503 },
    )
  }
  if (!quota.unlimited && quota.dailyRemaining <= 0) {
    return NextResponse.json(
      {
        error: `Daily coach limit reached (${quota.dailyLimit} messages in the rolling 24-hour window).`,
        code: 'daily',
        quota,
      },
      { status: 429 },
    )
  }
  if (!quota.unlimited && quota.burstRemaining <= 0) {
    return NextResponse.json(
      {
        error: `Too many messages too quickly. Max ${quota.burstLimit} per 10 minutes.`,
        code: 'burst',
        quota,
      },
      { status: 429 },
    )
  }

  // Resolve / create a conversation thread (migration 35). Falls back to
  // legacy inserts without conversation_id if the table isn't applied yet.
  let conversationId: string | null =
    typeof body.conversationId === 'string' && body.conversationId
      ? body.conversationId
      : null
  let conversationCreated = false

  if (conversationId) {
    const { data: owned } = await supabase
      .from('coach_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!owned) conversationId = null
  }

  if (!conversationId) {
    const { data: created, error: createErr } = await supabase
      .from('coach_conversations')
      .insert({
        user_id: user.id,
        title: titleFromMessage(message),
      })
      .select('id')
      .single()
    if (createErr || !created) {
      // Pre-35 schema: continue without threads.
      if (
        !(
          createErr?.message?.includes('coach_conversations') ||
          createErr?.code === '42P01'
        )
      ) {
        console.error('[grind] coach conversation create', createErr)
      }
      conversationId = null
    } else {
      conversationId = created.id as string
      conversationCreated = true
    }
  }

  // Persist user turn first — trigger is authoritative if racing. Its id is
  // kept so a total model-call failure below can refund this turn instead of
  // silently burning the user's daily/burst allowance for a reply they never
  // got (see grind_coach_refund_message, docs/sql/34-coach-quota-fixes.sql).
  const userInsert: Record<string, unknown> = {
    user_id: user.id,
    role: 'user',
    content: message,
  }
  if (conversationId) userInsert.conversation_id = conversationId

  const { data: insertedMessage, error: insertUserErr } = await supabase
    .from('coach_messages')
    .insert(userInsert)
    .select('id')
    .single()
  if (insertUserErr) {
    const mapped = mapCoachRateLimitError(insertUserErr.message)
    if (mapped) {
      // Dev-unlimited passed the app-side pre-check but the DB trigger still
      // capped us: the bypass is missing from enforce_coach_rate_limit().
      const triggerDrift = quota.unlimited
        ? ' Dev unlimited is on, but the database trigger still enforces the cap — apply docs/sql/55-coach-dev-unlimited-restore.sql.'
        : ''
      return NextResponse.json(
        { error: `${mapped.error}${triggerDrift}`, code: mapped.code, quota },
        { status: mapped.status },
      )
    }
    console.error('[grind] coach insert user', insertUserErr)
    return NextResponse.json(
      {
        error:
          insertUserErr.message?.includes('coach_messages') ||
          insertUserErr.code === '42P01'
            ? 'Coach storage is not ready. Apply docs/sql/33-coach.sql in the Supabase SQL editor.'
            : 'Failed to record message',
      },
      { status: 503 },
    )
  }

  if (conversationId && !conversationCreated) {
    void supabase
      .from('coach_conversations')
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('user_id', user.id)
  }

  const cookieStore = await cookies()
  const unit = parseUnit(body.unit, cookieStore.get('grind_unit_pref')?.value)
  const { localDate, timeZone } = resolveAsOfLocalDate(body)

  // Fingerprint open session + working-set count so finishing (or logging more
  // sets) cannot reuse a stale USER_DATA payload for ~60s. Two cheap queries;
  // cache still wins on multi-turn chats within an unchanged session state.
  let sessionFp = 'none'
  try {
    const { data: openRow } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (openRow?.id) {
      const { count } = await supabase
        .from('session_logs')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', openRow.id)
        .eq('is_skipped', false)
        .eq('is_warmup', false)
        .not('weight', 'is', null)
      sessionFp = `${openRow.id}:${count ?? 0}`
    }
  } catch (err) {
    console.error('[grind] coach context fingerprint', err)
  }

  const contextKey = coachContextCacheKey(user.id, localDate, unit, sessionFp)
  let contextJson = getCachedCoachContext(contextKey)
  if (!contextJson) {
    try {
      const context = await buildCoachContext(supabase, user.id, unit, {
        asOfLocalDate: localDate,
        timeZone,
      })
      // Weights go to the model in the user's own unit (exact conversion
      // here instead of arithmetic in the prompt).
      contextJson = JSON.stringify(localizeCoachContext(context, unit))
      setCachedCoachContext(contextKey, contextJson)
    } catch (err) {
      console.error('[grind] coach context', err)
      const { error: refundErr } = await supabase.rpc('grind_coach_refund_message', {
        p_message_id: insertedMessage.id,
      })
      if (refundErr) console.error('[grind] coach refund failed', refundErr)
      return NextResponse.json(
        { error: 'Failed to load your training data' },
        { status: 500 },
      )
    }
  }

  const history = sanitizeHistory(body.history)
  // Requested model first (dropdown), then the rest of the list: free-tier
  // quotas are per model, so a 429 on one usually isn't a 429 on the next.
  const modelChain = resolveCoachModelChain(
    body.model,
    process.env.GEMINI_MODEL?.trim() || COACH_DEFAULT_MODEL,
  )
  let modelId = modelChain[0]

  // What happened to the cards proposed earlier in this chat — read fresh each
  // turn (the cached USER_DATA can be a minute stale) so follow-ups like
  // "make that 4 sets" or "never mind" have something concrete to refer to.
  let recentActions: string | null = null
  try {
    recentActions = formatRecentActions(
      await loadRecentCoachActions(supabase, user.id, conversationId),
    )
  } catch (err) {
    console.error('[grind] coach recent actions', err)
  }

  // One planner decides intent, depth budget, thinking, tools and prompt
  // sections — shared with the eval harness so they cannot drift.
  const plan = planCoachTurn({
    message,
    history,
    userDataJson: contextJson,
    recentActions,
  })
  const intentProfile = plan.profile
  const { system, messages, maxOutputTokens } = plan

  const google = createGoogleGenerativeAI({ apiKey })

  const toolCtx: CoachToolContext = {
    supabase,
    userId: user.id,
    conversationId,
    unit: unit === 'kg' ? 'kg' : 'lb',
    localDate,
    timeZone,
    proposals: [] as CoachProposalView[],
    userText: plan.userText,
    pendingDayKeys: [],
  }
  const tools = buildCoachProposalTools(toolCtx)

  // Shared streamText settings. `reasoning: 'none'` keeps thinking minimal /
  // off: do NOT hardcode thinkingBudget: 0 — Gemini 3.x Flash-Lite (incl.
  // gemini-3.5-flash-lite and gemini-flash-lite-latest) rejects thinkingBudget
  // with INVALID_ARGUMENT and wants thinkingLevel instead. `reasoning: 'none'`
  // lets @ai-sdk/google map per family:
  //   2.5 → thinkingBudget: 0
  //   3.x / -latest → thinkingLevel: 'minimal'
  const baseCall = (id: string, reasoning: typeof plan.reasoning) => {
    // Gemini 3 keeps the 1.0 default temperature (lower values loop); Gemma
    // has no thinking config at all — see coachModelSettings.
    const settings = coachModelSettings(id)
    return {
      model: google(id),
      system,
      messages,
      ...(settings.temperature != null ? { temperature: settings.temperature } : {}),
      // Minimal thinking for chat and plain tool calls; advice that has to
      // stay self-consistent gets 'low' — see THINKING in intent.ts.
      ...(settings.supportsReasoning ? { reasoning } : {}),
      // No same-model retries: a 429 won't clear in seconds, and the chain
      // below moves to a model with its own quota instead.
      maxRetries: 0,
      onError: baseOnError,
    }
  }
  const baseOnError = ({ error }: { error: unknown }) => {
      // streamText() returns before the model call actually runs, so this
      // is the ONLY place upstream failures (bad key, quota, model
      // rename, safety block, network) surface — the outer try/catch below
      // never sees them, since they happen while the stream is consumed,
      // not while streamText() itself is called.
      console.error('[grind] coach stream error', error)
  }

  try {
    // First attempt: full tool set + intent budget. A second, text-only
    // attempt runs only if this one ends with no text, no proposal and no
    // error — Gemini does that silently (finishReason MALFORMED_FUNCTION_CALL
    // / SAFETY / OTHER, minimal thinking eating a small budget → 'length',
    // or every step spent on tool calls), and the client used to show
    // "Coach returned an empty reply" with nothing in the logs.
    const startedAt = Date.now()
    const abortSignal = AbortSignal.timeout(
      Math.max(5_000, MODEL_DEADLINE_MS - (startedAt - requestStartedAt)),
    )
    const startAttempt = (
      withTools: boolean,
      id: string,
      signal: AbortSignal,
    ) =>
      withTools && plan.toolsEnabled
        ? streamText({
            ...baseCall(id, plan.reasoning),
            abortSignal: signal,
            maxOutputTokens,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            // The last allowed step can't call a tool, or a model that keeps
            // retrying a rejected proposal spends every step on tool calls
            // and never writes a word.
            prepareStep: ({ stepNumber }) =>
              stepNumber >= MAX_STEPS - 1
                ? { toolChoice: 'none' as const }
                : undefined,
          })
        : streamText({
            // Headroom for whatever ate the first budget (thinking, a
            // half-built tool call). The retry never thinks.
            ...baseCall(id, 'none'),
            abortSignal: signal,
            maxOutputTokens: Math.max(maxOutputTokens * 2, 2048),
          })

    // NDJSON stream: text-delta / proposal / error / done — so the client can
    // attach Confirm/Cancel cards without parsing markdown.
    const encoder = new TextEncoder()
    let full = ''
    let sawError = false
    let retried = false
    let truncated = false
    const fellBackFrom: string[] = []
    const emittedProposalIds = new Set<string>()
    // Per-turn telemetry, logged as one JSON line so a bad reply can be traced
    // (which intent, which tools with what arguments, why it stopped).
    const turnLog = {
      toolCalls: [] as { name: string; input: unknown; ok?: boolean }[],
      steps: 0,
      usage: undefined as unknown,
    }
    const clip = (v: unknown) => {
      const s = JSON.stringify(v) ?? ''
      return s.length > 1200 ? `${s.slice(0, 1200)}…` : s
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: object) => {
          controller.enqueue(encoder.encode(encodeNdjson(event)))
        }
        const flushProposals = () => {
          for (const p of toolCtx.proposals) {
            if (emittedProposalIds.has(p.id)) continue
            emittedProposalIds.add(p.id)
            emit({ type: 'proposal', proposal: p })
          }
        }
        const consume = async (withTools: boolean) => {
          // A model can accept the request and then send nothing at all
          // (seen on overloaded Flash models). Give up on it after
          // FIRST_PART_MS of silence so the chain can try the next one,
          // instead of the user staring at "…" until the hard deadline.
          const stall = new AbortController()
          const stallTimer = setTimeout(() => stall.abort(), FIRST_PART_MS)
          const result = startAttempt(
            withTools,
            modelId,
            AbortSignal.any([abortSignal, stall.signal]),
          )
          let finishReason: string | undefined
          let rawFinishReason: string | undefined
          for await (const part of result.fullStream) {
            if (
              part.type === 'text-delta' ||
              part.type === 'tool-call' ||
              part.type === 'reasoning-delta' ||
              part.type === 'finish'
            ) {
              clearTimeout(stallTimer)
            }
            if (part.type === 'text-delta') {
              full += part.text
              emit({ type: 'text-delta', text: part.text })
            } else if (part.type === 'tool-call') {
              turnLog.toolCalls.push({ name: part.toolName, input: part.input })
            } else if (part.type === 'tool-result') {
              const call = [...turnLog.toolCalls]
                .reverse()
                .find(c => c.name === part.toolName && c.ok === undefined)
              if (call) {
                call.ok = (part.output as { ok?: boolean } | undefined)?.ok
              }
              // Flush any proposals created by tool execute handlers.
              flushProposals()
            } else if (part.type === 'tool-error') {
              console.error('[grind] coach tool error', part.toolName, part.error)
            } else if (part.type === 'finish-step') {
              turnLog.steps += 1
            } else if (part.type === 'finish') {
              finishReason = part.finishReason
              rawFinishReason = part.rawFinishReason
              turnLog.usage = (part as { totalUsage?: unknown }).totalUsage
            } else if (part.type === 'abort') {
              sawError = true
              console.error('[grind] coach stream aborted (deadline)')
            } else if (part.type === 'error') {
              sawError = true
              console.error('[grind] coach stream error', part.error)
            }
          }
          clearTimeout(stallTimer)
          if (stall.signal.aborted) {
            console.warn('[grind] coach model stalled', { model: modelId })
          }
          // Safety net if tool-result parts were skipped by the provider.
          flushProposals()
          return { finishReason, rawFinishReason }
        }
        let lastFinish: Awaited<ReturnType<typeof consume>> | undefined
        // Walk the model chain while a model fails before producing anything
        // (429 quota, 503 overloaded, 404 retired). Anything streamed —
        // text or a card — ends the walk: it can't be unsent.
        for (let i = 0; i < modelChain.length; i++) {
          if (i > 0) {
            if (abortSignal.aborted || Date.now() - startedAt >= RETRY_DEADLINE_MS) break
            console.warn('[grind] coach model failed, falling back', {
              from: modelId,
              to: modelChain[i],
            })
            fellBackFrom.push(modelId)
            emit({ type: 'model', model: modelChain[i], from: modelChain[0] })
            modelId = modelChain[i]
            sawError = false
          }
          try {
            lastFinish = await consume(true)
          } catch (err) {
            sawError = true
            console.error('[grind] coach stream error', err)
          }
          const producedNothing = !full.trim() && emittedProposalIds.size === 0
          if (!(sawError && producedNothing)) break
        }
        // Nothing usable came back — no text, no proposal. Covers transient
        // upstream errors (overloaded / 5xx mid-stream) as well as the silent
        // finishes noted above. One text-only retry, if there's time.
        const empty = !full.trim() && emittedProposalIds.size === 0
        if (
          empty &&
          !abortSignal.aborted &&
          Date.now() - startedAt < RETRY_DEADLINE_MS
        ) {
          console.warn('[grind] coach empty reply, retrying without tools', {
            model: modelId,
            intent: intentProfile.intent,
            sawError,
            ...lastFinish,
          })
          sawError = false
          retried = true
          full = ''
          try {
            lastFinish = await consume(false)
          } catch (err) {
            sawError = true
            console.error('[grind] coach stream error (retry)', err)
          }
        }
        try {
          if (!full.trim() && emittedProposalIds.size === 0) {
            console.error('[grind] coach empty reply', lastFinish)
            sawError = true
          }
          // The retry has no tools, so for a change request whatever text it
          // produced is prose standing in for an action. Say so plainly
          // instead of leaving the user to wonder why no card appeared.
          if (
            retried &&
            full.trim() &&
            emittedProposalIds.size === 0 &&
            (intentProfile.intent === 'actionable' ||
              intentProfile.intent === 'plan_install')
          ) {
            const notice =
              "\n\nI couldn't prepare that as an action card this time, so nothing was changed. Send it again and I'll retry."
            full += notice
            emit({ type: 'text-delta', text: notice })
          }
          // Ran into the token ceiling mid-sentence: keep what's saved tidy and
          // tell the user it was cut short (the streamed text can't be unsent).
          if (lastFinish?.finishReason === 'length' && full.trim()) {
            truncated = true
            full = trimToLastSentence(full)
            console.warn('[grind] coach reply hit the token ceiling', {
              intent: intentProfile.intent,
              maxOutputTokens,
            })
          }
        } finally {
          console.info(
            '[grind] coach turn',
            JSON.stringify({
              model: modelId,
              fellBackFrom,
              intent: intentProfile.intent,
              thinking: plan.reasoning,
              tools: plan.toolsEnabled,
              chars: message.length,
              maxOutputTokens,
              steps: turnLog.steps,
              retried,
              truncated,
              finish: lastFinish?.finishReason,
              rawFinish: lastFinish?.rawFinishReason,
              usage: turnLog.usage,
              proposals: emittedProposalIds.size,
              toolCalls: turnLog.toolCalls.map(c => ({
                name: c.name,
                ok: c.ok,
                input: clip(c.input),
              })),
              ms: Date.now() - requestStartedAt,
            }),
          )
          const gotReply = full.trim().length > 0 || emittedProposalIds.size > 0
          if (sawError && !gotReply) {
            // Not persisted (gotReply stays false) and the turn is refunded.
            const fallback =
              lastFinish?.finishReason === 'content-filter'
                ? "I couldn't answer that one — Gemini's safety filter blocked the reply. Try rephrasing it."
                : 'Sorry, I hit an error generating a reply. Try again in a moment.'
            emit({ type: 'text-delta', text: fallback })
          }
          if (sawError && gotReply) {
            emit({
              type: 'error',
              error: 'Something went wrong mid-reply. Partial answer shown.',
            })
          } else if (truncated) {
            emit({
              type: 'error',
              error: 'That reply was cut short. Ask me to continue for the rest.',
            })
          }
          emit({ type: 'done' })
          controller.close()
          if (gotReply) {
            const assistantText =
              full.trim() ||
              (emittedProposalIds.size
                ? 'I prepared an action for you — confirm or cancel below.'
                : '')
            if (assistantText) {
              const { error } = await supabase.rpc('grind_insert_coach_assistant', {
                p_content: assistantText.slice(0, 4000),
                p_conversation_id: conversationId,
              })
              if (error) console.error('[grind] coach insert assistant', error)
            }
            if (conversationId) {
              void supabase
                .from('coach_conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', conversationId)
                .eq('user_id', user.id)
            }
          } else {
            // The model never actually produced anything — refund the slot
            // enforce_coach_rate_limit() charged when the user turn was
            // inserted, so a broken/unavailable model doesn't cost quota.
            const { error } = await supabase.rpc('grind_coach_refund_message', {
              p_message_id: insertedMessage.id,
            })
            if (error) console.error('[grind] coach refund failed', error)
          }
        }
      },
    })

    const response = new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        // Ensure browser JS can read these (some proxies hide non-simple headers).
        'Access-Control-Expose-Headers':
          'X-Coach-Stream, X-Coach-Model, X-Coach-Conversation-Id',
      },
    })
    response.headers.set('X-Coach-Model', modelId)
    response.headers.set('X-Coach-Stream', 'ndjson')
    if (conversationId) {
      response.headers.set('X-Coach-Conversation-Id', conversationId)
    }
    return response
  } catch (err) {
    console.error('[grind] coach generate', err)
    const { error: refundErr } = await supabase.rpc('grind_coach_refund_message', {
      p_message_id: insertedMessage.id,
    })
    if (refundErr) console.error('[grind] coach refund failed', refundErr)
    return NextResponse.json(
      { error: 'Coach failed to respond. Try again in a moment.' },
      { status: 502 },
    )
  }
}

/** Optional: remaining quota without sending a message (for UI later). */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const quota = await getCoachQuota(supabase, user.id, isAdminEmail(user.email))
  if (!quota) {
    return NextResponse.json(
      {
        error:
          'Coach storage is not ready. Apply docs/sql/33-coach.sql in the Supabase SQL editor.',
      },
      { status: 503 },
    )
  }

  let chipHints: {
    has_active_session: boolean
    next_day: string | null
    last_pr_exercise: string | null
  } | null = null
  try {
    const hints = await loadCoachChipHints(supabase, user.id)
    chipHints = {
      has_active_session: hints.hasActiveSession,
      next_day: hints.nextDay,
      last_pr_exercise: hints.lastPrExercise,
    }
  } catch (err) {
    console.error('[grind] coach chip hints', err)
  }

  return NextResponse.json({
    quota,
    model: process.env.GEMINI_MODEL?.trim() || COACH_DEFAULT_MODEL,
    models: COACH_MODELS,
    configured: !!(
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    ),
    chipHints,
  })
}
