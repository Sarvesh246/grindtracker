// XP required to advance from level n to n+1 = 500 * n
// Cumulative XP to reach level n = 500 * n * (n-1) / 2
export function getXpRequiredForLevel(level: number): number {
  return 500 * level
}

export function getLevel(xpTotal: number): number {
  return Math.floor((1 + Math.sqrt(1 + 8 * xpTotal / 500)) / 2)
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

export function getNextDayType(lastDayType: string | null): 'push' | 'pull' | 'legs' {
  if (!lastDayType) return 'push'
  const cycle: Record<string, 'push' | 'pull' | 'legs'> = {
    push: 'pull',
    pull: 'legs',
    legs: 'push',
  }
  return cycle[lastDayType] ?? 'push'
}
