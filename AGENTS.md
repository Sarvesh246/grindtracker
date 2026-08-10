<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Do not commit `.cursor/hooks/state/continual-learning.json`; it is Cursor hook internal state, not app code.

## Learned Workspace Facts

- Production site: https://grindtrack.vercel.app/ (Vercel auto-deploys from `main`).
- GitHub repo: https://github.com/Sarvesh246/grindtracker.git (`main` branch).
- Last Workout panel must list exercises in the order they were logged (`session_logs.created_at`), not by set number.
- Workout discard requires Supabase delete RLS policies from `docs/sql/04-session-delete-rls.sql` to be applied.
- Production hardening (security/data-integrity RPCs, working-set completion gate, session write guards) lives in `docs/sql/20-production-hardening.sql`; past workout save/edit must use `upsert_past_session`, not client delete-then-insert of `session_logs`.
- Badge catalog objects must stay RSC-serializable: never put functions on `ALL_BADGES` (or pass them server→client); weight-threshold copy uses plain `weightLbs`/`weightKind` with `formatBadgeDescription()` at the call site.
