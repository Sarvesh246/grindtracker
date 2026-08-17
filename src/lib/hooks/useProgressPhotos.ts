'use client'
import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressForUpload } from '@/lib/utils/imageCompression'
import type { ProgressPhoto, ProgressPhotoGroup } from '@/lib/types'
import { markAppDataStale } from '@/lib/cache/appDataCache'

const BUCKET = 'progress-photos'
const MAX_BYTES = 8 * 1024 * 1024 // mirrors the bucket's file_size_limit
const SIGNED_URL_TTL = 60 * 60 * 2 // 2hr — longer than the admin inbox's 1hr,
// since this is a PWA a user may leave backgrounded while browsing photos.

/** Group ids per `.in()` batch — keeps each GET URL inside the request-line limit. */
const GROUP_ID_CHUNK = 200

// Mirrors the DAY_ORDER map in progress/page.tsx.
const DAY_ORDER: Record<string, number> = { push: 0, pull: 1, legs: 2 }

export interface ProgressPhotoGroupWithPhotos extends ProgressPhotoGroup {
  photos: ProgressPhoto[]
}

/** Flat chronological entry used by the "View All" timeline lightbox. */
export interface TimelinePhotoEntry {
  id: string
  group_id: string
  storage_path: string
  taken_date: string
  day_type: string | null
}

function extensionFor(): string {
  // compressForUpload always outputs JPEG (or the original file when
  // compression can't run) — normalize the object key either way.
  return 'jpg'
}

/**
 * Data layer for progress photos: paginated group fetch, timeline fetch,
 * signed URLs, group upsert, compress+upload+insert, and delete. Every
 * function throws on failure — callers own how to surface that (toast, inline
 * error, etc.), matching the rest of this app's client components.
 */
export function useProgressPhotos() {
  const supabase = useMemo(() => createClient(), [])

  async function requireUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Your session expired — please sign in again.')
    return user
  }

  async function fetchGroupsPage(
    beforeDate: string | null,
    pageSize = 20
  ): Promise<{ groups: ProgressPhotoGroupWithPhotos[]; nextCursor: string | null }> {
    const user = await requireUser()

    let query = supabase
      .from('progress_photo_groups')
      .select('*')
      .eq('user_id', user.id)
      .order('taken_date', { ascending: false })
      .limit(pageSize)
    if (beforeDate) query = query.lt('taken_date', beforeDate)

    const { data: groups, error } = await query
    if (error) throw error
    const groupRows = (groups ?? []) as ProgressPhotoGroup[]
    if (groupRows.length === 0) return { groups: [], nextCursor: null }

    const { data: photos, error: photosError } = await supabase
      .from('progress_photos')
      .select('*')
      .in('group_id', groupRows.map(g => g.id))
      .order('sort_order', { ascending: true })
    if (photosError) throw photosError

    const byGroup = new Map<string, ProgressPhoto[]>()
    for (const p of (photos ?? []) as ProgressPhoto[]) {
      const list = byGroup.get(p.group_id) ?? []
      list.push(p)
      byGroup.set(p.group_id, list)
    }

    const withPhotos = groupRows.map(g => ({ ...g, photos: byGroup.get(g.id) ?? [] }))
    const nextCursor = groupRows.length === pageSize ? groupRows[groupRows.length - 1].taken_date : null
    return { groups: withPhotos, nextCursor }
  }

  async function fetchTimelinePhotos(): Promise<TimelinePhotoEntry[]> {
    const user = await requireUser()
    const { data: groups, error } = await supabase
      .from('progress_photo_groups')
      .select('id, taken_date, day_type')
      .eq('user_id', user.id)
      .order('taken_date', { ascending: true })
    if (error) throw error
    const groupRows = (groups ?? []) as Pick<ProgressPhotoGroup, 'id' | 'taken_date' | 'day_type'>[]
    if (groupRows.length === 0) return []

    // Chunked: unlike fetchGroupsPage (capped at pageSize) this covers EVERY
    // group the user has, and a single `.in()` over hundreds of uuids builds a
    // GET URL long enough to be rejected — which threw and left the timeline
    // lightbox empty for exactly the users with the most photos.
    const photos: ProgressPhoto[] = []
    for (let i = 0; i < groupRows.length; i += GROUP_ID_CHUNK) {
      const { data: chunk, error: photosError } = await supabase
        .from('progress_photos')
        .select('id, group_id, storage_path, sort_order')
        .in('group_id', groupRows.slice(i, i + GROUP_ID_CHUNK).map(g => g.id))
        .order('sort_order', { ascending: true })
      if (photosError) throw photosError
      photos.push(...((chunk ?? []) as ProgressPhoto[]))
    }

    const meta = new Map(groupRows.map(g => [g.id, g]))
    return photos
      .map(p => {
        const g = meta.get(p.group_id)
        return g ? { id: p.id, group_id: p.group_id, storage_path: p.storage_path, taken_date: g.taken_date, day_type: g.day_type } : null
      })
      .filter((e): e is TimelinePhotoEntry => e !== null)
      .sort((a, b) => a.taken_date.localeCompare(b.taken_date))
  }

  async function signPaths(paths: string[], ttlSeconds = SIGNED_URL_TTL): Promise<Record<string, string>> {
    const unique = Array.from(new Set(paths))
    if (unique.length === 0) return {}
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, ttlSeconds)
    if (error) throw error
    const map: Record<string, string> = {}
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) map[entry.path] = entry.signedUrl
    }
    return map
  }

  async function resignPath(path: string): Promise<string | null> {
    const map = await signPaths([path])
    return map[path] ?? null
  }

  async function getGroupForDate(
    takenDate: string
  ): Promise<{ group: ProgressPhotoGroup; photos: ProgressPhoto[] } | null> {
    const user = await requireUser()
    const { data: group, error } = await supabase
      .from('progress_photo_groups')
      .select('*')
      .eq('user_id', user.id)
      .eq('taken_date', takenDate)
      .maybeSingle()
    if (error) throw error
    if (!group) return null

    const { data: photos, error: photosError } = await supabase
      .from('progress_photos')
      .select('*')
      .eq('group_id', (group as ProgressPhotoGroup).id)
      .order('sort_order', { ascending: true })
    if (photosError) throw photosError

    return { group: group as ProgressPhotoGroup, photos: (photos ?? []) as ProgressPhoto[] }
  }

  // Mirrors progress/page.tsx's dayTypes ordering exactly (push/pull/legs
  // first, any custom days after in first-seen order) so the tag buttons
  // here match the day pills the user already sees everywhere else.
  async function getUserDayTypes(): Promise<string[]> {
    const user = await requireUser()
    const { data, error } = await supabase
      .from('exercises')
      .select('day_type')
      .eq('user_id', user.id)
      .order('day_type', { ascending: true })
    if (error) throw error
    const distinct = Array.from(new Set(((data ?? []) as { day_type: string }[]).map(r => r.day_type)))
    return distinct.sort((a, b) => (DAY_ORDER[a] ?? 9) - (DAY_ORDER[b] ?? 9))
  }

  async function getSuggestedDayTypes(takenDate: string): Promise<string[]> {
    const user = await requireUser()
    const { data, error } = await supabase
      .from('sessions')
      .select('day_type')
      .eq('user_id', user.id)
      .eq('local_date', takenDate)
      .not('completed_at', 'is', null)
    if (error) throw error
    const seen = new Set<string>()
    for (const row of (data ?? []) as { day_type: string }[]) seen.add(row.day_type)
    return Array.from(seen)
  }

  async function upsertGroup(input: {
    taken_date: string
    day_type: string | null
    note: string | null
  }): Promise<ProgressPhotoGroup> {
    const user = await requireUser()
    const { data, error } = await supabase
      .from('progress_photo_groups')
      .upsert(
        { user_id: user.id, taken_date: input.taken_date, day_type: input.day_type, note: input.note },
        { onConflict: 'user_id,taken_date' }
      )
      .select()
      .single()
    if (error) throw error
    return data as ProgressPhotoGroup
  }

  /**
   * Compresses and uploads each file sequentially, then bulk-inserts the
   * resulting rows. On any upload failure, best-effort removes everything
   * already uploaded this call before surfacing the error — mirrors
   * FeedbackModal's cleanupUploads so a failed add never orphans objects.
   */
  async function addPhotos(
    groupId: string,
    files: File[],
    onProgress?: (done: number, total: number) => void
  ): Promise<ProgressPhoto[]> {
    const user = await requireUser()

    const { data: existing, error: maxError } = await supabase
      .from('progress_photos')
      .select('sort_order')
      .eq('group_id', groupId)
      .order('sort_order', { ascending: false })
      .limit(1)
    if (maxError) throw maxError
    let nextSort = ((existing?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1

    const uploadedPaths: string[] = []
    async function cleanup() {
      if (uploadedPaths.length === 0) return
      try {
        await supabase.storage.from(BUCKET).remove(uploadedPaths)
      } catch {
        // best-effort; owner-folder delete is permitted, this is just cleanup
      }
    }

    const rows: { group_id: string; storage_path: string; sort_order: number }[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const blob = await compressForUpload(file, MAX_BYTES)
      if (!blob) {
        await cleanup()
        throw new Error(`"${file.name}" couldn't be processed — try a smaller image.`)
      }
      const path = `${user.id}/${groupId}/${crypto.randomUUID()}.${extensionFor()}`
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) {
        await cleanup()
        throw new Error(`Couldn't upload "${file.name}". ${uploadError.message}`)
      }
      uploadedPaths.push(path)
      rows.push({ group_id: groupId, storage_path: path, sort_order: nextSort })
      nextSort += 1
      onProgress?.(i + 1, files.length)
    }

    const { data: inserted, error: insertError } = await supabase
      .from('progress_photos')
      .insert(rows)
      .select()
    if (insertError) {
      await cleanup()
      throw insertError
    }
    markAppDataStale()
    return (inserted ?? []) as ProgressPhoto[]
  }

  async function deletePhoto(photo: Pick<ProgressPhoto, 'id' | 'storage_path'>): Promise<void> {
    try {
      await supabase.storage.from(BUCKET).remove([photo.storage_path])
    } catch {
      // best-effort — a failed storage delete shouldn't block the row delete
    }
    const { error } = await supabase.from('progress_photos').delete().eq('id', photo.id)
    if (error) throw error
    markAppDataStale()
  }

  async function deleteGroup(group: ProgressPhotoGroup, photos: ProgressPhoto[]): Promise<void> {
    const paths = photos.map(p => p.storage_path)
    if (paths.length > 0) {
      try {
        await supabase.storage.from(BUCKET).remove(paths)
      } catch {
        // best-effort — a failed storage delete shouldn't block the row delete
      }
    }
    const { error } = await supabase.from('progress_photo_groups').delete().eq('id', group.id)
    if (error) throw error
    markAppDataStale()
  }

  return {
    fetchGroupsPage,
    fetchTimelinePhotos,
    signPaths,
    resignPath,
    getGroupForDate,
    getUserDayTypes,
    getSuggestedDayTypes,
    upsertGroup,
    addPhotos,
    deletePhoto,
    deleteGroup,
  }
}
