export function getLevel(xpTotal: number): number {
  return Math.floor(xpTotal / 500) + 1
}

export function getXpInCurrentLevel(xpTotal: number): number {
  return xpTotal % 500
}

export function getXpToNextLevel(xpTotal: number): number {
  return 500 - (xpTotal % 500)
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
