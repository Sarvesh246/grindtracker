/**
 * Canonical lb<->kg conversion factor. Single source of truth — server code
 * (Coach actions) and `UnitContext` (client display/input boundary) must
 * both import this rather than hardcoding the constant, which previously
 * drifted to a truncated 2.2046 in two of three Coach call sites.
 */
export const LBS_PER_KG = 2.20462
