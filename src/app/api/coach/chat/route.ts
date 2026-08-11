import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, type ModelMessage } from 'ai'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import {
  COACH_DEFAULT_MODEL,
  COACH_MAX_HISTORY_MESSAGES,
  COACH_MAX_MESSAGE_CHARS,
  COACH_SYSTEM_PROMPT,
  buildCoachContext,
  getCoachQuota,
  mapCoachRateLimitError,
  type CoachUnitPreference,
} from '@/lib/coach'

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

  const quota = await getCoachQuota(supabase, user.id)
  if (!quota) {
    return NextResponse.json(
      {
        error:
          'Coach storage is not ready. Apply docs/sql/33-coach.sql in the Supabase SQL editor.',
      },
      { status: 503 },
    )
  }
  if (quota.dailyRemaining <= 0) {
    return NextResponse.json(
      {
        error: `Daily coach limit reached (${quota.dailyLimit} messages per day). Try again tomorrow.`,
        code: 'daily',
        quota,
      },
      { status: 429 },
    )
  }
  if (quota.burstRemaining <= 0) {
    return NextResponse.json(
      {
        error: `Too many messages too quickly. Max ${quota.burstLimit} per 10 minutes.`,
        code: 'burst',
        quota,
      },
      { status: 429 },
    )
  }

  // Persist user turn first — trigger is authoritative if racing.
  const { error: insertUserErr } = await supabase.from('coach_messages').insert({
    user_id: user.id,
    role: 'user',
    content: message,
  })
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

  const cookieStore = await cookies()
  const unit = parseUnit(body.unit, cookieStore.get('grind_unit_pref')?.value)

  let contextJson: string
  try {
    const context = await buildCoachContext(supabase, user.id, unit)
    contextJson = JSON.stringify(context)
  } catch (err) {
    console.error('[grind] coach context', err)
    return NextResponse.json(
      { error: 'Failed to load your training data' },
      { status: 500 },
    )
  }

  const history = sanitizeHistory(body.history)
  const modelId =
    process.env.GEMINI_MODEL?.trim() || COACH_DEFAULT_MODEL

  const google = createGoogleGenerativeAI({ apiKey })
  const system = `${COACH_SYSTEM_PROMPT}

USER_DATA (JSON; personal facts only — trust this over memory):
${contextJson}`

  try {
    const result = streamText({
      model: google(modelId),
      system,
      messages: [...history, { role: 'user', content: message }],
      maxOutputTokens: 1024,
      temperature: 0.4,
      // gemini-2.5-* models can spend the whole maxOutputTokens budget on
      // hidden "thinking" tokens and return empty visible text — this coach
      // doesn't need chain-of-thought, so turn it off explicitly rather than
      // relying on the provider's current default.
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
      onError: ({ error }) => {
        // streamText() returns before the model call actually runs, so this
        // is the ONLY place upstream failures (bad key, quota, model
        // rename, safety block, network) surface — the outer try/catch below
        // never sees them, since they happen while the stream is consumed,
        // not while streamText() itself is called.
        console.error('[grind] coach stream error', error)
      },
    })

    // Build the response by hand instead of result.toTextStreamResponse():
    // that helper silently drops 'error' parts of the stream, so an upstream
    // failure used to produce a 200 response with an empty body and no
    // indication anything went wrong. Consuming fullStream lets us turn a
    // failure into a visible message instead of dead air.
    const encoder = new TextEncoder()
    let full = ''
    let sawError = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              full += part.text
              controller.enqueue(encoder.encode(part.text))
            } else if (part.type === 'error') {
              sawError = true
              console.error('[grind] coach stream error', part.error)
            }
          }
        } catch (err) {
          sawError = true
          console.error('[grind] coach stream error', err)
        } finally {
          if (sawError && !full.trim()) {
            full = 'Sorry, I hit an error generating a reply. Try again in a moment.'
            controller.enqueue(encoder.encode(full))
          }
          controller.close()
          const reply = full.trim()
          if (reply) {
            const { error } = await supabase.from('coach_messages').insert({
              user_id: user.id,
              role: 'assistant',
              content: reply.slice(0, 4000),
            })
            if (error) console.error('[grind] coach insert assistant', error)
          }
        }
      },
    })

    const response = new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
    // Expose remaining quota after this turn for a future UI.
    response.headers.set(
      'X-Coach-Daily-Remaining',
      String(Math.max(0, quota.dailyRemaining - 1)),
    )
    response.headers.set('X-Coach-Daily-Limit', String(quota.dailyLimit))
    response.headers.set('X-Coach-Model', modelId)
    return response
  } catch (err) {
    console.error('[grind] coach generate', err)
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

  const quota = await getCoachQuota(supabase, user.id)
  if (!quota) {
    return NextResponse.json(
      {
        error:
          'Coach storage is not ready. Apply docs/sql/33-coach.sql in the Supabase SQL editor.',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({
    quota,
    model: process.env.GEMINI_MODEL?.trim() || COACH_DEFAULT_MODEL,
    configured: !!(
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    ),
  })
}
