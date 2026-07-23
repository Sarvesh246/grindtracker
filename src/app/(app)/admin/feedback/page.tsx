import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/utils/admin'
import type { Feedback } from '@/lib/types'
import FeedbackInbox from './FeedbackInbox'

// Always render fresh — an inbox showing a cached copy of itself is useless.
export const dynamic = 'force-dynamic'

const SIGNED_URL_TTL = 60 * 60 // 1h; the page is re-rendered on every visit

// Cap the inbox page.
//
// This used to `select('*')` with no limit and then mint a signed URL for every
// referenced image in one call. At three users that is a handful of rows; at ten
// thousand it is an unbounded fetch plus a `createSignedUrls` call with tens of
// thousands of paths, which will time out and take the whole route with it.
// Newest 100 covers the actual triage workflow — anything older is reachable by
// date once pagination lands.
const INBOX_PAGE_SIZE = 100

export default async function AdminFeedbackPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // 404 rather than a redirect: a non-admin shouldn't learn this route exists.
  // RLS (`is_grind_admin()`) is the actual gate — this just avoids an empty page.
  if (!isAdminEmail(user.email)) notFound()

  const { data, error, count } = await supabase
    .from('feedback')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(INBOX_PAGE_SIZE)

  const rows = (data ?? []) as Feedback[]
  const totalCount = count ?? rows.length

  // Attachments live in a private bucket, so mint short-lived signed URLs for
  // every referenced object in one round trip.
  const paths = rows.flatMap(r => r.image_paths ?? [])
  const signedUrls: Record<string, string> = {}
  if (paths.length > 0) {
    const { data: signed } = await supabase
      .storage
      .from('feedback-images')
      .createSignedUrls(paths, SIGNED_URL_TTL)
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedUrls[entry.path] = entry.signedUrl
    }
  }

  return (
    <FeedbackInbox
      initialRows={rows}
      signedUrls={signedUrls}
      loadError={error?.message ?? null}
      totalCount={totalCount}
    />
  )
}
