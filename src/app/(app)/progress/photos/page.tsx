'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useProgressPhotos,
  type ProgressPhotoGroupWithPhotos,
} from '@/lib/hooks/useProgressPhotos'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Button from '@/components/ui/Button'
import PhotoGroupGrid from './PhotoGroupGrid'
import PhotoLightbox, { type LightboxItem } from './PhotoLightbox'
import AddPhotoSheet from './AddPhotoSheet'
import ComparePhotosView from './ComparePhotosView'
import { localDateKey } from '@/lib/utils/formatting'

const PAGE_SIZE = 20
const MAX_THUMBS_PER_GROUP = 4

type LightboxState = { items: LightboxItem[]; index: number; showTimeline: boolean } | null

function groupToLightboxItems(group: ProgressPhotoGroupWithPhotos): LightboxItem[] {
  return group.photos.map(p => ({
    id: p.id,
    storage_path: p.storage_path,
    taken_date: group.taken_date,
    day_type: group.day_type,
  }))
}

export default function ProgressPhotosPage() {
  const router = useRouter()
  const {
    fetchGroupsPage,
    fetchTimelinePhotos,
    signPaths,
    resignPath,
    deletePhoto,
    deleteGroup,
    getUserDayTypes,
    getSuggestedDayTypes,
  } = useProgressPhotos()

  const [groups, setGroups] = useState<ProgressPhotoGroupWithPhotos[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  const [addOpen, setAddOpen] = useState(false)
  const [lightbox, setLightbox] = useState<LightboxState>(null)
  const [timelineLoading, setTimelineLoading] = useState(false)

  const [compareMode, setCompareMode] = useState(false)
  const [compareSelected, setCompareSelected] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ProgressPhotoGroupWithPhotos | null>(null)
  const [deletingGroup, setDeletingGroup] = useState(false)

  // Prefetched as soon as the feed loads (not when the sheet opens) so the
  // Add sheet's workout-tag buttons and default selection render instantly
  // instead of popping in a beat after the sheet itself.
  const [dayTypeOptions, setDayTypeOptions] = useState<string[]>([])
  const [todaySuggestedDayType, setTodaySuggestedDayType] = useState<string | null>(null)

  useEffect(() => {
    loadInitial()
    const todayKey = localDateKey()
    getUserDayTypes().then(setDayTypeOptions)
    getSuggestedDayTypes(todayKey).then(sugg => setTodaySuggestedDayType(sugg[0] ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signThumbnails(list: ProgressPhotoGroupWithPhotos[]) {
    const paths = list.flatMap(g => g.photos.slice(0, MAX_THUMBS_PER_GROUP).map(p => p.storage_path))
    if (paths.length === 0) return
    try {
      const map = await signPaths(paths)
      setSignedUrls(prev => ({ ...prev, ...map }))
    } catch {
      // thumbnails simply stay in their shimmer placeholder state
    }
  }

  async function loadInitial() {
    setLoading(true)
    try {
      const { groups: page, nextCursor: cursor } = await fetchGroupsPage(null, PAGE_SIZE)
      setGroups(page)
      setNextCursor(cursor)
      await signThumbnails(page)
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const { groups: page, nextCursor: cursor } = await fetchGroupsPage(nextCursor, PAGE_SIZE)
      setGroups(prev => [...prev, ...page])
      setNextCursor(cursor)
      await signThumbnails(page)
    } finally {
      setLoadingMore(false)
    }
  }

  function handleImageError(path: string) {
    resignPath(path).then(url => {
      if (url) setSignedUrls(prev => ({ ...prev, [path]: url }))
    })
  }

  function openDayLightbox(group: ProgressPhotoGroupWithPhotos, index: number) {
    setLightbox({ items: groupToLightboxItems(group), index, showTimeline: false })
  }

  async function openTimeline() {
    setTimelineLoading(true)
    try {
      const entries = await fetchTimelinePhotos()
      if (entries.length === 0) return
      setLightbox({
        items: entries.map(e => ({ id: e.id, storage_path: e.storage_path, taken_date: e.taken_date, day_type: e.day_type })),
        index: entries.length - 1,
        showTimeline: true,
      })
    } finally {
      setTimelineLoading(false)
    }
  }

  async function handleDeleteLightboxItem(item: LightboxItem) {
    await deletePhoto({ id: item.id, storage_path: item.storage_path })
    setGroups(prev =>
      prev
        .map(g => (g.taken_date === item.taken_date ? { ...g, photos: g.photos.filter(p => p.id !== item.id) } : g))
        .filter(g => g.photos.length > 0)
    )
  }

  function requestDeleteGroup(group: ProgressPhotoGroupWithPhotos) {
    setDeleteTarget(group)
  }

  async function confirmDeleteGroup() {
    if (!deleteTarget) return
    setDeletingGroup(true)
    try {
      await deleteGroup(deleteTarget, deleteTarget.photos)
      setGroups(prev => prev.filter(g => g.id !== deleteTarget.id))
      setDeleteTarget(null)
    } finally {
      setDeletingGroup(false)
    }
  }

  function toggleCompareMode() {
    setCompareMode(v => !v)
    setCompareSelected([])
  }

  function toggleCompareSelect(groupId: string) {
    setCompareSelected(prev => {
      if (prev.includes(groupId)) return prev.filter(id => id !== groupId)
      if (prev.length < 2) return [...prev, groupId]
      return [prev[1], groupId] // cap at 2 — selecting a 3rd replaces the oldest
    })
  }

  const compareGroups = useMemo((): [ProgressPhotoGroupWithPhotos, ProgressPhotoGroupWithPhotos] | null => {
    if (compareSelected.length !== 2) return null
    const a = groups.find(g => g.id === compareSelected[0])
    const b = groups.find(g => g.id === compareSelected[1])
    return a && b ? [a, b] : null
  }, [compareSelected, groups])

  return (
    <div className="page page--narrow" style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '48px' }}>
      <div style={{ padding: '24px 16px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          style={{ background: 'none', border: 'none', cursor: 'pointer', width: '44px', height: '44px', color: 'var(--text-secondary)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px', color: 'var(--text-primary)', letterSpacing: '1px', margin: 0, flex: 1 }}>
          PROGRESS PHOTOS
        </h1>
      </div>

      <div style={{ display: 'flex', gap: '8px', padding: '0 16px 16px', flexWrap: 'wrap' }}>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          + Add
        </Button>
        <Button variant="secondary" size="sm" onClick={openTimeline} disabled={timelineLoading || groups.length === 0}>
          {timelineLoading ? 'Loading…' : 'View All'}
        </Button>
        <Button variant={compareMode ? 'primary' : 'secondary'} size="sm" onClick={toggleCompareMode} disabled={groups.length < 2}>
          {compareMode ? 'Cancel Compare' : 'Compare'}
        </Button>
      </div>

      {compareMode && (
        <div style={{ padding: '0 16px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Select 2 entries to compare {compareSelected.length > 0 && `(${compareSelected.length}/2)`}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px', padding: '48px 24px' }}>
          <span style={{
            width: '76px', height: '76px', borderRadius: '9999px', backgroundColor: 'var(--accent-wash)',
            color: 'var(--accent-text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
            </svg>
          </span>
          <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '24px', color: 'var(--text-primary)', letterSpacing: '1px', margin: 0 }}>
            NO PHOTOS YET
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '300px', lineHeight: 1.5, margin: 0 }}>
            Log a photo on any day to start tracking your progress visually over time.
          </p>
          <Button variant="primary" onClick={() => setAddOpen(true)}>Add your first photo</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 16px' }}>
          {groups.map(group => (
            <PhotoGroupGrid
              key={group.id}
              group={group}
              signedUrls={signedUrls}
              onImageError={handleImageError}
              onOpenLightbox={index => openDayLightbox(group, index)}
              onDeleteGroup={() => requestDeleteGroup(group)}
              compareMode={compareMode}
              compareSelected={compareSelected.includes(group.id)}
              onToggleCompareSelect={() => toggleCompareSelect(group.id)}
            />
          ))}

          {nextCursor && (
            <Button variant="secondary" onClick={loadMore} disabled={loadingMore} style={{ marginTop: '4px' }}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}

      {compareMode && compareGroups && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'max(20px, env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', zIndex: 50 }}>
          <Button variant="primary" onClick={() => setCompareOpen(true)} style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
            Compare Selected
          </Button>
        </div>
      )}

      {addOpen && (
        <AddPhotoSheet
          dayTypeOptions={dayTypeOptions}
          initialDayType={todaySuggestedDayType}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); loadInitial() }}
        />
      )}

      {lightbox && (
        <PhotoLightbox
          items={lightbox.items}
          initialIndex={lightbox.index}
          showTimeline={lightbox.showTimeline}
          onClose={() => setLightbox(null)}
          onDeleteItem={handleDeleteLightboxItem}
        />
      )}

      {compareOpen && compareGroups && (
        <ComparePhotosView
          groups={compareGroups}
          onClose={() => { setCompareOpen(false); toggleCompareMode() }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this entry?"
        message="This removes every photo logged for this day. This can't be undone."
        confirmLabel="Delete"
        busy={deletingGroup}
        onConfirm={confirmDeleteGroup}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
