import type { SupabaseClient } from '@supabase/supabase-js'
import { LBS_PER_KG } from '@/lib/utils/units'
import {
  COACH_PROPOSAL_TTL_MS,
  type CoachActionKind,
  type CoachActionPayload,
  type CoachActionStatus,
  type CoachProposalView,
} from './types'

type ProposalRow = {
  id: string
  kind: CoachActionKind
  payload: CoachActionPayload
  status: CoachActionStatus
  expires_at: string
  result: unknown
}

export async function insertCoachProposal(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    payload: CoachActionPayload
  },
): Promise<CoachProposalView | null> {
  const expiresAt = new Date(Date.now() + COACH_PROPOSAL_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from('coach_action_proposals')
    .insert({
      user_id: args.userId,
      conversation_id: args.conversationId,
      kind: args.payload.kind,
      payload: args.payload,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('id, kind, payload, status, expires_at')
    .single()

  if (error || !data) {
    console.error('[grind] coach proposal insert', error)
    return null
  }

  return toProposalView(data as ProposalRow)
}

export async function getCoachProposal(
  supabase: SupabaseClient,
  userId: string,
  proposalId: string,
): Promise<(ProposalRow & { user_id: string }) | null> {
  const { data, error } = await supabase
    .from('coach_action_proposals')
    .select('id, user_id, kind, payload, status, expires_at, result')
    .eq('id', proposalId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null
  return data as ProposalRow & { user_id: string }
}

export async function updateCoachProposalStatus(
  supabase: SupabaseClient,
  args: {
    userId: string
    proposalId: string
    status: CoachActionStatus
    result?: Record<string, unknown> | null
    /** When set, the update only applies if the row is still this status. */
    expectedStatus?: CoachActionStatus
  },
): Promise<boolean> {
  const patch: Record<string, unknown> = { status: args.status }
  if (args.result !== undefined) patch.result = args.result
  let query = supabase
    .from('coach_action_proposals')
    .update(patch)
    .eq('id', args.proposalId)
    .eq('user_id', args.userId)
  if (args.expectedStatus) query = query.eq('status', args.expectedStatus)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) {
    console.error('[grind] coach proposal update', error)
    return false
  }
  return data != null
}

export function toProposalView(row: {
  id: string
  kind: CoachActionKind
  payload: CoachActionPayload | unknown
  status: CoachActionStatus
  expires_at: string
}): CoachProposalView {
  const payload = row.payload as CoachActionPayload
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    card: payload.card,
    expiresAt: row.expires_at,
  }
}

export function isProposalExpired(expiresAt: string, now = Date.now()): boolean {
  const t = Date.parse(expiresAt)
  return !Number.isFinite(t) || t <= now
}

export function fmtWeightForUnit(
  lbs: number,
  unitLabel: 'lb' | 'kg',
): string {
  if (unitLabel === 'kg') {
    const kg = lbs / LBS_PER_KG
    const rounded = Math.round(kg * 10) / 10
    return `${stripTrailingZero(rounded)} kg`
  }
  const rounded = Math.round(lbs * 10) / 10
  return `${stripTrailingZero(rounded)} lb`
}

function stripTrailingZero(n: number): string {
  return String(n).replace(/\.0$/, '')
}

/** Treat near-equal stored weights as a match (float noise). */
export function weightsMatch(a: number, b: number, eps = 0.051): boolean {
  return Math.abs(a - b) <= eps
}
