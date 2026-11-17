import { it } from 'node:test'
import assert from 'node:assert/strict'
import { clearPrivateAccountFiles } from '../storageCleanup'

const owner = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
it('cleans only the caller prefix, recursively, through Storage API', async () => {
  const removed: string[] = []
  const files = new Set([`${owner}/group/one.jpg`, `${owner}/two.jpg`, 'other-user/private.jpg'])
  const storage = {
    from: (_bucket: string) => ({
      list: async (prefix: string) => {
        const names = new Map<string, { name: string; id: string | null }>()
        for (const file of files)
          if (file.startsWith(prefix + '/')) {
            const relative = file.slice(prefix.length + 1),
              name = relative.split('/')[0]
            names.set(name, { name, id: relative.includes('/') ? null : name })
          }
        return { data: [...names.values()], error: null }
      },
      remove: async (paths: string[]) => {
        for (const path of paths) {
          removed.push(path)
          files.delete(path)
        }
        return { error: null }
      }
    })
  }
  await clearPrivateAccountFiles({ storage } as never, owner)
  assert.deepEqual(removed.sort(), [`${owner}/group/one.jpg`, `${owner}/two.jpg`].sort())
  assert.equal(files.has('other-user/private.jpg'), true)
})
it('stops on failed storage removal so callers cannot report completed deletion', async () => {
  const storage = {
    from: () => ({
      list: async () => ({ data: [{ id: 'file', name: 'a.jpg' }], error: null }),
      remove: async () => ({ error: { message: 'offline' } })
    })
  }
  await assert.rejects(clearPrivateAccountFiles({ storage } as never, owner), /Could not remove/)
})
it('bounds cleanup of a provider that returns an unchanging page', async () => {
  const storage = {
    from: () => ({
      list: async () => ({ data: [{ id: 'file', name: 'a.jpg' }], error: null }),
      remove: async () => ({ error: null })
    })
  }
  await assert.rejects(clearPrivateAccountFiles({ storage } as never, owner), /cleanup limit/)
})
