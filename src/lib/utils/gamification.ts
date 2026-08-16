// XP required to advance from level n to n+1 = 500 * n
// Cumulative XP to reach level n = 500 * n * (n-1) / 2
export function getXpRequiredForLevel(level: number): number {
  return 500 * level
}

export function getLevel(xpTotal: number): number {
  // Mirrors grind_level_for_xp's greatest() clamps (docs/sql/11-server-side-xp.sql) —
  // change one, change both.
  const xp = Math.max(xpTotal, 0)
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * xp / 500)) / 2))
}

export function getXpInCurrentLevel(xpTotal: number): number {
  const level = getLevel(xpTotal)
  const levelStart = 500 * (level - 1) * level / 2
  return xpTotal - levelStart
}

export function getXpToNextLevel(xpTotal: number): number {
  const level = getLevel(xpTotal)
  return getXpRequiredForLevel(level) - getXpInCurrentLevel(xpTotal)
}
