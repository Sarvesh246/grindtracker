import { createServiceClient } from '@/lib/supabase/admin'

/**
 * Give back the allowance for a turn the model never answered. Runs with the
 * service client because the refund function is not callable with a user's JWT
 * (docs/sql/74) — otherwise a client could refund itself after every message.
 * Failure is logged, never thrown: a missed refund costs one slot, a thrown
 * error here would mask the real failure the caller is already reporting.
 */
export async function refundCoachTurn(userId: string, messageId: string): Promise<void> {
  try {
    const { error } = await createServiceClient().rpc('grind_coach_refund_usage', {
      p_user_id: userId,
      p_message_id: messageId,
    })
    if (error) console.error('[grind] coach refund failed', error)
  } catch (err) {
    console.error('[grind] coach refund failed', err)
  }
}
