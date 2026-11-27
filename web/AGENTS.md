<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Hunger Learn web rules

The root `AGENTS.md` (workflow, risk tiers, `node scripts/check.mjs`) applies too. Commands: `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (`node:test` files in `src/lib/*.test.ts`), `pnpm test:db` (`db/tests/*.test.ts`: migrations and AI-call logging against Postgres; needs `TEST_DATABASE_URL`, a superuser URL, and creates and drops its own database per run; CI runs it in `web-e2e`), `pnpm db:migrate`, `pnpm db:seed`. User-visible features and how to prove them: `docs/feature-map.md`.

- The app tables live in `web/db/migrations/`; docproc creates its own tables. `readiness_v` plus the `hl_readonly` role (SELECT on that view only) is the only surface the text-to-SQL feature can read.
- Long work (docproc, generation, video) runs after the response via `after()`; progress is in `pipeline_jobs` and `lesson_videos`. Renders are serialized on one GPU queue.
- Stage 2 is per procedure (the admin clicks "توليد التدريب" / "إعادة التوليد"); courier, employee and partner are all trained. Publishing a new package retires the procedure's previously published items (`outdated`). A lesson whose library clip is not in `media/clips/` yet fails to render with the missing file names; re-render it from the review page after adding the clip.
- Accounts (`accounts`, `sessions` tables; `src/lib/session.ts`, `src/lib/accounts.ts`) stand in for Supabase Auth: scrypt password hashes, an httpOnly random token cookie whose SHA-256 is stored server-side. Two account kinds: `admin` (uploads, reviews, publishes, readiness; seeded only, never self sign-up) and `learner` (self sign-up picks role and branch). Every server action re-checks the session.
- The UI is bilingual (Arabic default, English). Every page lives under `src/app/[lang]/`; `src/proxy.ts` rewrites clean URLs to `/<hl_lang cookie>/…`, and `/en/…` or `/ar/…` sets the cookie and redirects back (the header toggle uses this). UI strings live only in `src/lib/i18n/ar.ts` and `en.ts` (same shape, enforced by a test): Server Components call `getDict()` (`next/root-params`), Client Components `useDict()`. Server actions return dictionary keys, not text. Training content stays in its document's language and is rendered with `dir="auto"`. The logo stays top-right in both languages.
- Arabic UI copy is professional Saudi Arabic written natively (English copy likewise native), never word-by-word translation; procedure titles name the concrete situation. Optional landing/auth photos go in `web/public/brand/photos/` (see `IMAGE-REQUESTS.md` there).
- `.uploads/` and `media/out/` hold uploaded files and rendered videos; both are gitignored.
