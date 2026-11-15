# GRIND security model

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Security model
- **RLS is the boundary, never the UI.** Route guards (`isAdminEmail`) only pick
  404-vs-render; `is_grind_admin()` in Postgres is the real gate.
- **`security definer` functions bypass RLS**, so each one must authorize its own
  caller and pin `set search_path`. `get_leaderboard` intersects the requested
  ids with the caller's accepted friendships — it previously trusted the client's
  array, which let any user read any other user's stats by uuid (fixed in `10`).
- **Never trust a client-supplied number that feeds a leaderboard.** Derive it.
- **A single `FOR ALL` policy is rarely right for a table two parties share.**
  `friendships` had one, testing only "am I involved in this row" — which let a
  requester accept their own request and let anyone insert a pre-accepted
  friendship naming someone else as requester (fixed in `12`). Split by command
  and assert what each one actually means: who may create, who may approve.
- Security headers (CSP, HSTS, `frame-ancestors 'none'`) live in `next.config.ts`.
- `src/proxy.ts` uses `getClaims()` (local JWKS verification) rather than
  `getUser()` (a network round trip per request), and caches the "profile exists"
  check in the `grind_profile_ok` cookie instead of querying on every navigation.
