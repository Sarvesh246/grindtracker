'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Feedback, FeedbackCategory } from '@/lib/types'

type Filter = 'all' | 'unread' | 'starred'
type Sort = 'newest' | 'oldest' | 'unread-first'
type CategoryFilter = FeedbackCategory | 'all'

const CATEGORY_META: Record<FeedbackCategory, { label: string; color: string }> = {
  bug: { label: 'Bug', color: '#ef4444' },
  feature: { label: 'Feature', color: '#c8f135' },
  improvement: { label: 'Improvement', color: '#4aa3f0' },
  other: { label: 'Other', color: '#888888' },
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'starred', label: 'Starred' },
]

const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'unread-first', label: 'Unread first' },
]

/** Compact age for list rows: 4m / 3h / 6d / then an absolute date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function StarIcon({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'var(--accent)' : 'none'}
      stroke={filled ? 'var(--accent)' : 'currentColor'}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function CategoryChip({ category }: { category: FeedbackCategory }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.other
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px',
      textTransform: 'uppercase', fontFamily: 'var(--font-sans)',
      color: 'var(--text-secondary)',
      backgroundColor: 'var(--surface-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      padding: '3px 8px', flexShrink: 0, whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '9999px',
        backgroundColor: meta.color, flexShrink: 0,
      }} />
      {meta.label}
    </span>
  )
}

export default function FeedbackInbox({
  initialRows,
  signedUrls,
  loadError,
  totalCount,
}: {
  initialRows: Feedback[]
  signedUrls: Record<string, string>
  loadError: string | null
  /** Total rows in the table; `initialRows` is capped to the newest page. */
  totalCount: number
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [rows, setRows] = useState<Feedback[]>(initialRows)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  // The server re-renders on Refresh/navigation and hands down a new array;
  // adopt it during render (React's "adjust state when a prop changes"
  // pattern) rather than in an effect, which would cost a second pass.
  const [syncedFrom, setSyncedFrom] = useState(initialRows)
  if (initialRows !== syncedFrom) {
    setSyncedFrom(initialRows)
    setRows(initialRows)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const unreadCount = rows.filter(r => !r.is_read).length
  const selected = rows.find(r => r.id === selectedId) ?? null

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = rows.filter(r => {
      if (filter === 'unread' && r.is_read) return false
      if (filter === 'starred' && !r.is_starred) return false
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false
      if (!q) return true
      // Anonymous senders stay searchable by identity — the hiding is a display
      // choice for the inbox, not a promise the data is gone.
      return (
        r.message.toLowerCase().includes(q) ||
        (r.username ?? '').toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q)
      )
    })
    return out.sort((a, b) => {
      if (sort === 'unread-first' && a.is_read !== b.is_read) return a.is_read ? 1 : -1
      const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return sort === 'oldest' ? -delta : delta
    })
  }, [rows, query, filter, categoryFilter, sort])

  /** Optimistic patch; reverts and surfaces the message if the write fails. */
  async function patch(id: string, changes: Partial<Feedback>) {
    const before = rows.find(r => r.id === id)
    if (!before) return
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...changes } : r)))
    const { error } = await supabase.from('feedback').update(changes).eq('id', id)
    if (error) {
      setRows(prev => prev.map(r => (r.id === id ? before : r)))
      setToast(`Couldn't save: ${error.message}`)
    }
  }

  function openRow(row: Feedback) {
    setSelectedId(row.id)
    setConfirmDeleteId(null)
    if (!row.is_read) patch(row.id, { is_read: true })
  }

  async function remove(id: string) {
    const before = rows
    const wasSelected = selectedId === id
    setRows(prev => prev.filter(r => r.id !== id))
    if (wasSelected) setSelectedId(null)
    setConfirmDeleteId(null)
    const { error } = await supabase.from('feedback').delete().eq('id', id)
    if (error) {
      setRows(before)
      setToast(`Couldn't delete: ${error.message}`)
    }
  }

  async function markAllRead() {
    const targets = visible.filter(r => !r.is_read).map(r => r.id)
    if (targets.length === 0) return
    const before = rows
    setRows(prev => prev.map(r => (targets.includes(r.id) ? { ...r, is_read: true } : r)))
    const { error } = await supabase.from('feedback').update({ is_read: true }).in('id', targets)
    if (error) {
      setRows(before)
      setToast(`Couldn't mark as read: ${error.message}`)
    }
  }

  function senderLabel(row: Feedback): string {
    if (row.is_anonymous && !revealed.has(row.id)) return 'Anonymous'
    return row.username ?? row.email ?? 'Unknown user'
  }

  const selectStyle = {
    height: '34px',
    backgroundColor: 'var(--surface-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    padding: '0 8px',
    cursor: 'pointer',
    outline: 'none',
  } as const

  return (
    <div className="page page--wide" style={{ fontFamily: "'DM Sans', sans-serif", paddingBottom: '24px' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: '12px', marginBottom: '4px',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-display-md)',
            color: 'var(--text-primary)', letterSpacing: '1px', lineHeight: 1,
          }}>
            FEEDBACK
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            {rows.length} total
            {unreadCount > 0 && (
              <> · <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>{unreadCount} unread</span></>
            )}
          </div>
        </div>
        <button
          onClick={() => router.refresh()}
          aria-label="Refresh"
          style={{
            height: '34px', padding: '0 12px', display: 'inline-flex',
            alignItems: 'center', gap: '7px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
            fontSize: '13px', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Refresh
        </button>
      </div>

      {loadError && (
        <div style={{
          fontSize: '12px', color: 'var(--danger)',
          backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger-bg-hover)',
          borderRadius: 'var(--radius-sm)', padding: '10px 12px', margin: '12px 0',
        }}>
          Failed to load feedback: {loadError}
        </div>
      )}

      {totalCount > initialRows.length && (
        <div style={{
          fontSize: '12px', color: 'var(--text-secondary)',
          backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '10px 12px', margin: '12px 0',
        }}>
          Showing the newest {initialRows.length} of {totalCount.toLocaleString()} messages.
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div style={{ margin: '16px 0 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ position: 'relative' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search messages and senders"
            style={{
              width: '100%', height: '40px', boxSizing: 'border-box',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
              fontSize: '16px', // ≥16px prevents iOS auto-zoom on focus
              padding: '0 12px 0 34px', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {/* Read-state filter */}
          <div style={{
            display: 'flex', backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '3px',
          }}>
            {FILTERS.map(f => {
              const active = filter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  style={{
                    height: '28px', padding: '0 13px',
                    borderRadius: 'var(--radius-pill)', border: 'none',
                    backgroundColor: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-sans)', fontSize: '12px',
                    fontWeight: active ? 700 : 500, cursor: 'pointer',
                    transition: 'background-color 150ms ease',
                  }}
                >
                  {f.label}
                  {f.key === 'unread' && unreadCount > 0 && ` (${unreadCount})`}
                </button>
              )
            })}
          </div>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as CategoryFilter)}
            aria-label="Filter by type"
            style={selectStyle}
          >
            <option value="all">All types</option>
            <option value="bug">Bugs</option>
            <option value="feature">Features</option>
            <option value="improvement">Improvements</option>
            <option value="other">Other</option>
          </select>

          <select
            value={sort}
            onChange={e => setSort(e.target.value as Sort)}
            aria-label="Sort"
            style={selectStyle}
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>

          <button
            onClick={markAllRead}
            disabled={visible.every(r => r.is_read)}
            style={{
              ...selectStyle,
              marginLeft: 'auto',
              color: visible.every(r => r.is_read) ? 'var(--text-disabled)' : 'var(--text-secondary)',
              cursor: visible.every(r => r.is_read) ? 'not-allowed' : 'pointer',
            }}
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* ── List + detail ──────────────────────────────────────────────── */}
      <div className="inbox-layout" data-detail-open={selected ? 'true' : 'false'}>
        {/* List pane */}
        <div className="inbox-list" style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--card-shadow)',
          overflow: 'hidden',
        }}>
          {visible.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {rows.length === 0
                  ? 'No feedback yet. Once people start sending notes, they land here.'
                  : 'Nothing matches those filters.'}
              </div>
            </div>
          ) : visible.map((row, i) => {
            const active = row.id === selectedId
            return (
              <div
                key={row.id}
                onClick={() => openRow(row)}
                style={{
                  display: 'flex', gap: '10px', padding: '12px 14px',
                  cursor: 'pointer',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  backgroundColor: active ? 'var(--surface-elevated)' : 'transparent',
                  borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  transition: 'background-color 150ms ease',
                }}
              >
                {/* Unread dot */}
                <div style={{
                  width: '7px', height: '7px', borderRadius: '9999px', flexShrink: 0,
                  marginTop: '6px',
                  backgroundColor: row.is_read ? 'transparent' : 'var(--accent)',
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px',
                  }}>
                    <span style={{
                      fontSize: '13px',
                      fontWeight: row.is_read ? 500 : 700,
                      color: row.is_read ? 'var(--text-secondary)' : 'var(--text-primary)',
                      fontFamily: 'var(--font-sans)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {senderLabel(row)}
                    </span>
                    <span style={{
                      marginLeft: 'auto', flexShrink: 0,
                      fontFamily: 'var(--font-mono)', fontSize: '10px',
                      color: 'var(--text-disabled)',
                    }}>
                      {relativeTime(row.created_at)}
                    </span>
                  </div>

                  <div style={{
                    fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.45,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', marginBottom: '7px',
                  }}>
                    {row.message}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <CategoryChip category={row.category} />
                    {(row.image_paths?.length ?? 0) > 0 && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                        fontSize: '10px', color: 'var(--text-disabled)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        {row.image_paths.length}
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); patch(row.id, { is_starred: !row.is_starred }) }}
                      aria-label={row.is_starred ? 'Unstar' : 'Star'}
                      style={{
                        marginLeft: 'auto', background: 'transparent', border: 'none',
                        padding: '2px', cursor: 'pointer', lineHeight: 0,
                        color: 'var(--text-disabled)',
                      }}
                    >
                      <StarIcon filled={row.is_starred} size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail pane */}
        <div className="inbox-detail" style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--card-shadow)',
          padding: selected ? '16px' : '0',
          minHeight: selected ? undefined : '220px',
          display: selected ? 'block' : 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {!selected ? (
            <div style={{ fontSize: '13px', color: 'var(--text-disabled)', padding: '20px', textAlign: 'center' }}>
              Select a message to read it.
            </div>
          ) : (
            <>
              <button
                className="inbox-back"
                onClick={() => setSelectedId(null)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  background: 'transparent', border: 'none', padding: '0 0 12px',
                  color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
                  fontSize: '13px', cursor: 'pointer',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                All feedback
              </button>

              {/* Sender */}
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                flexWrap: 'wrap', marginBottom: '10px',
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                    marginBottom: '3px',
                  }}>
                    <span style={{
                      fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)',
                      fontFamily: 'var(--font-sans)',
                    }}>
                      {senderLabel(selected)}
                    </span>
                    <CategoryChip category={selected.category} />
                  </div>

                  {selected.is_anonymous && !revealed.has(selected.id) ? (
                    <button
                      onClick={() => setRevealed(prev => new Set(prev).add(selected.id))}
                      style={{
                        background: 'transparent', border: 'none', padding: 0,
                        fontSize: '11px', color: 'var(--text-disabled)',
                        fontFamily: 'var(--font-sans)', cursor: 'pointer',
                        textDecoration: 'underline', textUnderlineOffset: '2px',
                      }}
                    >
                      Sent anonymously — reveal sender
                    </button>
                  ) : (
                    <div style={{
                      fontSize: '11px', color: 'var(--text-disabled)',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {selected.email ?? 'no email on record'}
                      {selected.is_anonymous && ' · marked anonymous'}
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: 'var(--text-disabled)', marginTop: '3px' }}>
                    {fullTime(selected.created_at)}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '8px',
                paddingBottom: '14px', marginBottom: '14px',
                borderBottom: '1px solid var(--border)',
              }}>
                <button
                  onClick={() => patch(selected.id, { is_starred: !selected.is_starred })}
                  style={{
                    ...selectStyle,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    color: selected.is_starred ? 'var(--accent-text)' : 'var(--text-secondary)',
                  }}
                >
                  <StarIcon filled={selected.is_starred} size={14} />
                  {selected.is_starred ? 'Starred' : 'Star'}
                </button>

                <button
                  onClick={() => patch(selected.id, { is_read: !selected.is_read })}
                  style={{ ...selectStyle, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16v16H4z" />
                    <polyline points="4 6 12 13 20 6" />
                  </svg>
                  Mark {selected.is_read ? 'unread' : 'read'}
                </button>

                {confirmDeleteId === selected.id ? (
                  <span style={{ display: 'inline-flex', gap: '8px', marginLeft: 'auto' }}>
                    <button
                      onClick={() => remove(selected.id)}
                      style={{
                        ...selectStyle,
                        backgroundColor: 'var(--danger-bg)',
                        borderColor: 'var(--danger-bg-hover)',
                        color: 'var(--danger)', fontWeight: 700,
                      }}
                    >
                      Delete for good
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} style={selectStyle}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(selected.id)}
                    style={{
                      ...selectStyle,
                      marginLeft: 'auto',
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      color: 'var(--danger)',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                    Delete
                  </button>
                )}
              </div>

              {/* Message */}
              <div style={{
                fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                marginBottom: (selected.image_paths?.length ?? 0) > 0 ? '18px' : 0,
              }}>
                {selected.message}
              </div>

              {/* Attachments */}
              {(selected.image_paths?.length ?? 0) > 0 && (
                <>
                  <div style={{
                    fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-label)', marginBottom: '9px',
                  }}>
                    ATTACHMENTS ({selected.image_paths.length})
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: '10px',
                  }}>
                    {selected.image_paths.map(path => {
                      const url = signedUrls[path]
                      if (!url) {
                        return (
                          <div key={path} style={{
                            padding: '14px', borderRadius: 'var(--radius-sm)',
                            border: '1px dashed var(--border-strong)',
                            fontSize: '11px', color: 'var(--text-disabled)', textAlign: 'center',
                          }}>
                            Image unavailable
                          </div>
                        )
                      }
                      return (
                        <a
                          key={path}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'block', borderRadius: 'var(--radius-sm)',
                            overflow: 'hidden', border: '1px solid var(--border)',
                            backgroundColor: 'var(--surface-elevated)',
                          }}
                        >
                          {/* Signed Supabase URLs are short-lived and not a
                              configured next/image remote host — plain img. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="Feedback attachment"
                            style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }}
                          />
                        </a>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 16px)',
          zIndex: 300, maxWidth: 'min(440px, calc(100vw - 32px))',
          backgroundColor: 'var(--surface-elevated)',
          border: '1px solid var(--danger-bg-hover)',
          borderRadius: 'var(--radius-md)',
          padding: '11px 14px',
          fontSize: '12px', color: 'var(--danger)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
