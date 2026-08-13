import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
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
  COACH_MAX_MESSAGE_CHARS,
  COACH_SYSTEM_PROMPT,
  buildCoachContext,
  buildCoachTurnReminder,
  getCoachQuota,
  inferCoachIntent,
  mapCoachRateLimitError,
  type CoachUnitPreference,
} from '@/lib/coach'
import {
  buildCoachProposalTools,
  encodeNdjson,
  type CoachProposalView,
  type CoachToolContext,
} from '@/lib/coach/actions'
import { titleFromMessage } from '@/lib/coach/conversations'
import { loadCoachChipHints } from '@/lib/coach/chipHints'
import {
  coachContextCacheKey,
  getCachedCoachContext,
  setCachedCoachContext,
} from '@/lib/coach/contextCache'

export const runtime = 'nodejs'
export const maxDuration = 60

type HistoryItem = { role: 'user' | 'assistant'; content: string }

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

function sanitizeHistory(raw: unknown): ModelMessage[] {
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
  return items.slice(-COACH_MAX_HISTORY_MESSAGES).map(m => ({
    role: m.role,
    content: m.content,
  }))
}

export async function POST(request: Request) {
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
      return NextResponse.json(
        { error: mapped.error, code: mapped.code, quota },
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
      contextJson = JSON.stringify(context)
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
  const modelId =
    process.env.GEMINI_MODEL?.trim() || COACH_DEFAULT_MODEL

  // Adapt depth budget + reminder from THIS ask so different intents cannot
  // collapse into one template sprawl (token ceiling + intent-calibrated nudge).
  const priorUser = [...history]
    .reverse()
    .find(m => m.role === 'user' && typeof m.content === 'string')
  const priorUserText =
    typeof priorUser?.content === 'string' ? priorUser.content : null
  const intentProfile = inferCoachIntent(message, priorUserText)
  const turnReminder = buildCoachTurnReminder(intentProfile)

  const google = createGoogleGenerativeAI({ apiKey })
  // Same base system prompt for every turn (starter chips and free-typed
  // questions share this route). Intent-specific reminder sits after
  // USER_DATA so depth/personalization stay salient for THIS ask.
  const system = `${COACH_SYSTEM_PROMPT}

USER_DATA (JSON; personal facts only — trust this over memory):
${contextJson}

Remember: intent before formatting — Understand intent → assess complexity → determine relevance → choose depth → choose format → answer → verify. ${turnReminder}`

  const toolCtx: CoachToolContext = {
    supabase,
    userId: user.id,
    conversationId,
    unit: unit === 'kg' ? 'kg' : 'lb',
    proposals: [] as CoachProposalView[],
  }
  const tools = buildCoachProposalTools(toolCtx)

  try {
    const result = streamText({
      model: google(modelId),
      system,
      messages: [...history, { role: 'user', content: message }],
      maxOutputTokens: intentProfile.maxOutputTokens,
      temperature: 0.4,
      tools,
      stopWhen: stepCountIs(3),
      // Keep thinking minimal / off. Do NOT hardcode thinkingBudget: 0 —
      // Gemini 3.x Flash-Lite (incl. gemini-3.5-flash-lite and
      // gemini-flash-lite-latest) rejects thinkingBudget with
      // INVALID_ARGUMENT and wants thinkingLevel instead.
      // `reasoning: 'none'` lets @ai-sdk/google map per family:
      //   2.5 → thinkingBudget: 0
      //   3.x / -latest → thinkingLevel: 'minimal'
      reasoning: 'none',
      onError: ({ error }) => {
        // streamText() returns before the model call actually runs, so this
        // is the ONLY place upstream failures (bad key, quota, model
        // rename, safety block, network) surface — the outer try/catch below
        // never sees them, since they happen while the stream is consumed,
        // not while streamText() itself is called.
        console.error('[grind] coach stream error', error)
      },
    })

    // NDJSON stream: text-delta / proposal / error / done — so the client can
    // attach Confirm/Cancel cards without parsing markdown.
    const encoder = new TextEncoder()
    let full = ''
    let sawError = false
    const emittedProposalIds = new Set<string>()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: object) => {
          controller.enqueue(encoder.encode(encodeNdjson(event)))
        }
        try {
          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              full += part.text
              emit({ type: 'text-delta', text: part.text })
            } else if (part.type === 'tool-result') {
              // Flush any proposals created by tool execute handlers.
              for (const p of toolCtx.proposals) {
                if (emittedProposalIds.has(p.id)) continue
                emittedProposalIds.add(p.id)
                emit({ type: 'proposal', proposal: p })
              }
            } else if (part.type === 'error') {
              sawError = true
              console.error('[grind] coach stream error', part.error)
            }
          }
          // Safety net if tool-result parts were skipped by the provider.
          for (const p of toolCtx.proposals) {
            if (emittedProposalIds.has(p.id)) continue
            emittedProposalIds.add(p.id)
            emit({ type: 'proposal', proposal: p })
          }
        } catch (err) {
          sawError = true
          console.error('[grind] coach stream error', err)
        } finally {
          const gotReply = full.trim().length > 0 || emittedProposalIds.size > 0
          if (sawError && !gotReply) {
            full =
              'Sorry, I hit an error generating a reply. Try again in a moment.'
            emit({ type: 'text-delta', text: full })
          }
          if (sawError && gotReply) {
            emit({
              type: 'error',
              error: 'Something went wrong mid-reply. Partial answer shown.',
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
    configured: !!(
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    ),
    chipHints,
  })
}
