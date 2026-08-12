import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  encodeNdjson,
  executeCorrectWeights,
  executeCreateDay,
  executeStartWorkout,
  getCoachProposal,
  isProposalExpired,
  updateCoachProposalStatus,
  type CoachActionPayload,
} from '@/lib/coach/actions'

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

          const result = await executeCorrectWeights(
            supabase,
            payload.execute,
            async (index, totalSteps, label) => {
              emit({
                type: 'step',
                index,
                total: totalSteps,
                label,
                state: 'active',
              })
              if (index > 0) {
                emit({
                  type: 'step',
                  index: index - 1,
                  total: totalSteps,
                  label: payload.card.steps?.[index - 1] ?? `Session ${index}`,
                  state: 'done',
                })
              }
            },
          )

          if (!result.ok) {
            await updateCoachProposalStatus(supabase, {
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
            const message = `Updated ${result.updated} session${result.updated === 1 ? '' : 's'}. XP and PRs recomputed.`
            await updateCoachProposalStatus(supabase, {
              userId: user.id,
              proposalId,
              status: 'executed',
              result: { message, updated: result.updated },
            })
            // Mark final step done
            emit({
              type: 'step',
              index: total - 1,
              total,
              label: payload.card.steps?.[total - 1] ?? `Session ${total}`,
              state: 'done',
            })
            emit({
              type: 'result',
              ok: true,
              message,
              status: 'executed',
            })
          }
        } catch (err) {
          console.error('[grind] coach action stream', err)
          await updateCoachProposalStatus(supabase, {
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
    let message = ''
    let href: string | undefined
    let details: Record<string, unknown> = {}

    if (payload.kind === 'correct_weights') {
      const result = await executeCorrectWeights(supabase, payload.execute)
      if (!result.ok) {
        await updateCoachProposalStatus(supabase, {
          userId: user.id,
          proposalId,
          status: 'failed',
          result: { message: result.message },
        })
        return NextResponse.json(
          { ok: false, status: 'failed', message: result.message },
          { status: 500 },
        )
      }
      message = `Updated ${result.updated} session${result.updated === 1 ? '' : 's'}. XP and PRs recomputed.`
      details = { updated: result.updated }
    } else if (payload.kind === 'start_workout') {
      const result = await executeStartWorkout(
        supabase,
        payload.execute.dayType,
      )
      if (!result.ok) {
        await updateCoachProposalStatus(supabase, {
          userId: user.id,
          proposalId,
          status: 'failed',
          result: { message: result.message },
        })
        return NextResponse.json(
          { ok: false, status: 'failed', message: result.message },
          { status: 500 },
        )
      }
      message = result.resumed
        ? `Resuming ${payload.execute.dayType}.`
        : `Starting ${payload.execute.dayType}.`
      href = result.href
      details = { resumed: result.resumed, dayType: payload.execute.dayType }
    } else {
      const result = await executeCreateDay(supabase, {
        userId: user.id,
        dayKey: payload.execute.dayKey,
        category: payload.execute.category,
        exercises: payload.execute.exercises,
      })
      if (!result.ok) {
        await updateCoachProposalStatus(supabase, {
          userId: user.id,
          proposalId,
          status: 'failed',
          result: { message: result.message },
        })
        return NextResponse.json(
          { ok: false, status: 'failed', message: result.message },
          { status: 500 },
        )
      }
      message = `Created “${payload.execute.dayKey}” with ${result.inserted} exercise${result.inserted === 1 ? '' : 's'}. Pick it from Log when you want to train — it won’t start automatically.`
      details = {
        inserted: result.inserted,
        dayKey: payload.execute.dayKey,
      }
      // Day select only — never /log?day=… (that opens ActiveWorkout).
      // Starting requires an explicit propose_start_workout confirm.
      href = '/log'
    }

    await updateCoachProposalStatus(supabase, {
      userId: user.id,
      proposalId,
      status: 'executed',
      result: { message, ...details, href },
    })

    return NextResponse.json({
      ok: true,
      status: 'executed',
      message,
      href,
      details,
    })
  } catch (err) {
    console.error('[grind] coach action execute', err)
    await updateCoachProposalStatus(supabase, {
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
