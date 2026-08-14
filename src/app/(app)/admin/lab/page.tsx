import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/utils/admin'
import CardLab from './CardLab'

export default async function AdminCardLabPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // 404 rather than a redirect: a non-admin shouldn't learn this route exists.
  if (!isAdminEmail(user.email)) notFound()

  return <CardLab />
}
