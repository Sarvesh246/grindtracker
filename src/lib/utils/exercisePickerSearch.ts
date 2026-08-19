/**
 * What the search field's Go/Enter key should do. Exact catalog hits add
 * immediately; anything new opens the create form. Never auto-picks a
 * fuzzy single match ("ben" must not silently become "Bench Press").
 */
export function resolveSearchSubmit(
  query: string,
  availableNames: readonly { id: string; name: string }[],
  canCreate: boolean,
): { type: 'pick'; id: string } | { type: 'create' } | { type: 'none' } {
  const q = query.trim().toLowerCase()
  if (!q) return { type: 'none' }
  const exact = availableNames.find(ex => ex.name.trim().toLowerCase() === q)
  if (exact) return { type: 'pick', id: exact.id }
  if (canCreate) return { type: 'create' }
  return { type: 'none' }
}
