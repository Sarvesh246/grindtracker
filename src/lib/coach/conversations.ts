/** Helpers for Coach saved chats. */

export type CoachConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export function titleFromMessage(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  return cleaned.length > 48 ? `${cleaned.slice(0, 47).trimEnd()}…` : cleaned
}
