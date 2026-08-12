'use client'

import { useState } from 'react'
import { useCoach } from './CoachProvider'

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Compact history drawer for the full-page Coach experience. */
export default function CoachHistory() {
  const {
    historyOpen,
    conversations,
    activeConversationId,
    streaming,
    closeHistory,
    loadConversation,
    deleteConversation,
    newChat,
  } = useCoach()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (!historyOpen) return null

  return (
    <div className="coach-history" role="dialog" aria-label="Chat history">
      <div className="coach-history__bar">
        <button
          type="button"
          className="coach-history__back press"
          data-haptic="light"
          onClick={closeHistory}
        >
          Done
        </button>
        <span className="coach-history__title">Chats</span>
        <button
          type="button"
          className="coach-history__new press"
          data-haptic="light"
          disabled={streaming}
          onClick={() => {
            newChat()
            closeHistory()
          }}
        >
          New
        </button>
      </div>

      {conversations.filter(c => c.id !== 'pending').length === 0 ? (
        <p className="coach-history__empty">No saved chats yet.</p>
      ) : (
        <ul className="coach-history__list">
          {conversations
            .filter(c => c.id !== 'pending')
            .map(c => {
              const active = c.id === activeConversationId
              const confirming = confirmId === c.id
              return (
                <li
                  key={c.id}
                  className={`coach-history__row${
                    active ? ' coach-history__row--active' : ''
                  }`}
                >
                  {confirming ? (
                    <div className="coach-history__confirm">
                      <span>Delete this chat?</span>
                      <div className="coach-history__confirm-actions">
                        <button
                          type="button"
                          className="press"
                          data-haptic="light"
                          onClick={() => setConfirmId(null)}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          className="coach-history__delete-confirm press"
                          data-haptic="medium"
                          onClick={() => {
                            void deleteConversation(c.id)
                            setConfirmId(null)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="coach-history__item press"
                        data-haptic="light"
                        disabled={streaming}
                        onClick={() => void loadConversation(c.id)}
                      >
                        <span className="coach-history__item-title">
                          {c.title}
                        </span>
                        <span className="coach-history__item-meta">
                          {formatRelative(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="coach-history__trash press"
                        data-haptic="light"
                        aria-label={`Delete ${c.title}`}
                        disabled={streaming}
                        onClick={() => setConfirmId(c.id)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </>
                  )}
                </li>
              )
            })}
        </ul>
      )}
    </div>
  )
}
