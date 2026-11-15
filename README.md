# GRIND

A gym tracker you can actually stand to use mid-workout. Log sets fast (even
with no signal), watch your streak and XP climb, chase PRs, and see how you
stack up against friends. It's an installable PWA built on Next.js and Supabase.

Think of it as a training notebook that does its own bookkeeping: the app
records what you lifted, and the database works out your XP, level, streak and
personal records.

## Quick start

You need Node 22+ and a Supabase project.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Create `.env.local` with two values from your Supabase project (Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

That's enough to run the app. The Coach (`GEMINI_API_KEY`) and push
notifications (VAPID keys) are optional; see [docs/COACH.md](docs/COACH.md) and
[docs/PUSH.md](docs/PUSH.md).

### Gotchas

- **The database is not created for you.** Schema changes are SQL files in
  [docs/sql/](docs/sql/), pasted by hand into the Supabase SQL editor, in order,
  starting with `00-migration-tracking.sql`. Read [docs/SQL.md](docs/SQL.md)
  first. Apply SQL *before* deploying code that needs it.
- **`npm run build` needs the two Supabase variables set**, even placeholders,
  because client pages are prerendered.
- **This is Next.js 16**, which differs from older versions. Check
  `node_modules/next/dist/docs/` before writing Next-specific code.
- Sign-in is Google OAuth only, so a real login needs the Google provider
  configured in your Supabase project.

## Everyday commands

```bash
npm test               # unit tests
npm run typecheck
npm run lint
npm run test:e2e       # Playwright (needs `npx playwright install chromium` once)
npm run test:sql-parity  # SQL vs TypeScript rule check; needs a throwaway Postgres
npm run migrations:check # which docs/sql files has production not recorded?
```

CI runs all of this on every push; see [docs/CI.md](docs/CI.md).

## Where to read next

- [CLAUDE.md](CLAUDE.md) — conventions and the rules that are easy to break
  (it's written for coding agents but reads fine for people).
- [docs/](docs/) — one file per subsystem: gamification, rest days, offline
  sync, Coach, security, design system.
- [docs/MONETIZATION.md](docs/MONETIZATION.md) — a proposal for a paid tier.
  Nothing in it is built.

Deployed on Vercel.
