import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import {
  encodeNdjson,
  executeConfirmedPayload,
  executeCorrectWeights,
  formatCorrectWeightsMessage,
  getCoachProposal,
  isProposalExpired,
  updateCoachProposalStatus,
  type CoachActionPayload,
} from '@/lib/coach/actions'
import { invalidateCoachContextCache } from '@/lib/coach/contextCache'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Confirm or cancel a Coach action proposal.
 * Long multi-session weight corrections stream NDJSON progress events.
 */
export async function POST(request: Request) {
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

  const proposalId =
    typeof body.proposalId === 'string' ? body.proposalId.trim() : ''
  const decision = body.decision === 'cancel' ? 'cancel' : body.decision === 'confirm' ? 'confirm' : null

  if (!proposalId || !decision) {
    return NextResponse.json(
      { error: 'proposalId and decision (confirm|cancel) are required' },
      { status: 400 },
    )
  }

  const row = await getCoachProposal(supabase, user.id, proposalId)
  if (!row) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }

  if (row.status !== 'pending') {
    return NextResponse.json(
      {
        error: `Proposal is already ${row.status}`,
        status: row.status,
        result: row.result,
      },
      { status: 409 },
    )
  }

  if (isProposalExpired(row.expires_at)) {
    await updateCoachProposalStatus(supabase, {
      userId: user.id,
      proposalId,
      status: 'failed',
      result: { message: 'Proposal expired. Ask Coach again.' },
    })
    return NextResponse.json(
      { error: 'Proposal expired. Ask Coach to propose the change again.' },
      { status: 410 },
    )
  }

  if (decision === 'cancel') {
    await updateCoachProposalStatus(supabase, {
      userId: user.id,
      proposalId,
      status: 'cancelled',
      result: { message: 'Cancelled' },
    })
    return NextResponse.json({
      ok: true,
      status: 'cancelled',
      message: 'Cancelled.',
    })
  }

  const payload = row.payload as CoachActionPayload
  const claimed = await updateCoachProposalStatus(supabase, {
    userId: user.id,
    proposalId,
    status: 'confirmed',
    expectedStatus: 'pending',
  })
  if (!claimed) {
    return NextResponse.json(
      { error: 'Proposal is already confirmed or cancelled', status: 'conflict' },
      { status: 409 },
    )
  }

  // Every status write from here on claims a mutation really happened
  // (executed) or really failed (failed) — the per-user client's RLS policy
  // only allows pending -> confirmed/cancelled/failed, so these use the
  // service role (bypasses RLS) rather than the per-user client. This is
  // what stops a user from PATCHing their own proposal straight to
  // status='executed' with a fabricated result, without the underlying
  // mutation RPC ever running (see docs/sql/46). The mutation RPCs
  // themselves (executeCorrectWeights etc.) still use the per-user
  // `supabase` client below — they rely on auth.uid() to scope the write,
  // which the service-role connection has no JWT to supply.
  const serviceSupabase = createServiceClient()

  // Multi-session weight fixes stream progress; everything else is JSON.
  const longRunning =
    payload.kind === 'correct_weights' && payload.execute.sessions.length > 1

  if (longRunning) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: object) => {
          controller.enqueue(encoder.encode(encodeNdjson(event)))
        }
        try {
          const total = payload.execute.sessions.length
          for (let i = 0; i < total; i++) {
            emit({
              type: 'step',
              index: i,
              total,
              label: payload.card.steps?.[i] ?? `Session ${i + 1}`,
              state: 'active',
            })
          }

          // One session failing doesn't stop the rest from being attempted —
          // each is an independent correction — so report every step's own
          // outcome (done/error) as it finishes, rather than assuming
          // whatever ran before the current step must have succeeded.
          const result = await executeCorrectWeights(
            supabase,
            payload.execute,
            async (index, totalSteps, label, state) => {
              emit({
                type: 'step',
                index,
                total: totalSteps,
                label,
                state,
              })
            },
          )

          if (!result.ok) {
            await updateCoachProposalStatus(serviceSupabase, {
              userId: user.id,
              proposalId,
              status: 'failed',
              result: { message: result.message },
            })
            emit({
              type: 'result',
              ok: false,
              message: result.message,
              status: 'failed',
            })
          } else {
            // ok:true means at least one session was actually corrected —
            // still true (and worth invalidating caches for) even if some
            // sessions in this batch didn't match and are listed in
            // result.failed. The message says so honestly instead of
            // reporting a clean "Updated N sessions" that hides partial
            // failure, or a blanket "failed" that hides the real progress.
            const message = formatCorrectWeightsMessage(result.updated, result.failed)
            await updateCoachProposalStatus(serviceSupabase, {
              userId: user.id,
              proposalId,
              status: 'executed',
              result: { message, updated: result.updated, failed: result.failed },
            })
            invalidateCoachContextCache(user.id)
            emit({
              type: 'result',
              ok: true,
              message,
              status: 'executed',
            })
          }
        } catch (err) {
          console.error('[grind] coach action stream', err)
          await updateCoachProposalStatus(serviceSupabase, {
            userId: user.id,
            proposalId,
            status: 'failed',
            result: { message: 'Unexpected error' },
          })
          emit({
            type: 'error',
            error: 'Action failed unexpectedly.',
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Coach-Action-Stream': 'ndjson',
      },
    })
  }

  try {
    const executed = await executeConfirmedPayload(supabase, user.id, payload)
    if (!executed.ok) {
      await updateCoachProposalStatus(serviceSupabase, {
        userId: user.id,
        proposalId,
        status: 'failed',
        result: { message: executed.message },
      })
      return NextResponse.json(
        { ok: false, status: 'failed', message: executed.message },
        { status: 500 },
      )
    }
    const message = executed.message
    const href = executed.href
    const details = executed.details

    await updateCoachProposalStatus(serviceSupabase, {
      userId: user.id,
      proposalId,
      status: 'executed',
      result: { message, ...details, href },
    })
    invalidateCoachContextCache(user.id)

    return NextResponse.json({
      ok: true,
      status: 'executed',
      message,
      href,
      details,
    })
  } catch (err) {
    console.error('[grind] coach action execute', err)
    await updateCoachProposalStatus(serviceSupabase, {
      userId: user.id,
      proposalId,
      status: 'failed',
      result: { message: 'Unexpected error' },
    })
    return NextResponse.json(
      { ok: false, status: 'failed', message: 'Action failed unexpectedly.' },
      { status: 500 },
    )
  }
}
