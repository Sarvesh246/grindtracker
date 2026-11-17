import type { SupabaseClient } from '@supabase/supabase-js'

/** Remove only the authenticated owner's two private prefixes via Storage API.
 * Restarting is safe: each iteration lists the remaining objects from offset 0.
 */
export async function clearPrivateAccountFiles(
  client: Pick<SupabaseClient, 'storage'>,
  userId: string
) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid owner')
  let operations = 0
  for (const bucket of ['progress-photos', 'feedback-images']) {
    const storage = client.storage.from(bucket)
    async function clear(prefix: string, depth: number): Promise<void> {
      if (depth > 8) throw new Error('Storage nesting limit')
      for (;;) {
        if (++operations > 100) throw new Error('Storage cleanup limit; retry to continue')
        const result = await storage.list(prefix, {
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        })
        if (result.error) throw new Error('Could not list private files')
        if (!result.data.length) return
        const files: string[] = []
        for (const item of result.data) {
          if (item.name.includes('/') || item.name === '.' || item.name === '..')
            throw new Error('Invalid storage object name')
          const path = `${prefix}/${item.name}`
          if (item.id) files.push(path)
          else await clear(path, depth + 1)
        }
        if (files.length) {
          const removed = await storage.remove(files)
          if (removed.error) throw new Error('Could not remove private files')
        }
      }
    }
    await clear(userId, 0)
  }
}
