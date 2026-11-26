---
name: verify-app
description: Use after changing anything a user sees or a flow in the Hunger Learn web app, before opening a PR. Runs the touched docs/feature-map.md rows in a real browser in Arabic and English and saves evidence to .verify/<branch>/. Not for pure library, docproc-only or docs changes.
---
# Verify the app at runtime

First, record that this skill is in use: `node scripts/skill-log.mjs verify-app` (Claude Code also logs it
automatically). The PR gate reads this log: `gh pr create` and the `pr-policy` check need the skills of
the change's tier (AGENTS.md → Workflow).

1. Read `docs/feature-map.md` and pick the rows your change touches. If your change adds or changes a
   user-visible feature, update its row in the same PR.
2. Make sure the app runs: Postgres up (`docker compose up -d`), database migrated and seeded
   (`cd web && pnpm db:migrate && pnpm db:seed`), `cd web && pnpm dev` (http://localhost:3000).
3. Scripted rows (F01 landing + language, F02 auth + guards, F06 readiness page): run
   `node scripts/verify-app.mjs F01 F02` from the repo root. It walks each row in `/ar/…` and `/en/…` with
   Playwright (`web/e2e/feature-map.spec.ts`) and saves screenshots, traces and an HTML report to
   `.verify/<branch>/`. If you change one of these flows, extend its spec in the same PR.
4. Rows that need the LLM (F03 upload, F04 generation and video, F05 learner flow with generated
   items, F06 text-to-SQL, F07 v2): if the LLM endpoint is unreachable, say so and verify the non-LLM parts only;
   never add a fallback to get around it. Walk them with the Playwright browser tools (MCP in both tools).
   Never ask for `DEMO_PASSWORD` and never read `.env*` files (`scripts/verify-app.mjs` reads `DEMO_PASSWORD`
   itself for the scripted rows).
   - Admin: in the Playwright browser, use its admin session, or tap the seeded admin's quick-fill chip on
     `/signin` and sign in (the page fills the password field; never read that field's value or the page source).
     Only if no chip is shown, ask the engineer to sign in there themselves; never ask them to type the password in
     the chat.
   - Learner: sign up one verify learner per branch through the app (F02): email
     `verify-<slug>@verify.hungerlearn.test` (`<slug>` = the branch name lower-cased, with every character outside
     `[a-z0-9-]` replaced by `-`; this domain stays out of the sign-in page's demo quick-fill), name starting `verify-`, and the
     fixed throwaway password `verify-learner-local` (a local test account, not a secret). If it already exists,
     sign in with that password. For F05 pick the role and branch of the training you published in F04, or `/learn`
     is empty. These learners stay in the local database (and in F06 readiness) until the database is reset
     (`pnpm db:seed` does not remove them).

   Save one screenshot per row and language (`.verify/<branch>/F03-ar.png`). Video renders work only on
   the project owner's GPU machine; elsewhere, say video was not verified.
5. Look at the screenshots, not only the pass/fail: a green test whose screenshot shows a spinner or an
   error proves nothing. Check RTL/LTR direction and that no UI string is hard-coded in one language.
6. Report per row: pass/fail, what you saw, evidence paths. If something fails, report it. Never edit the
   feature map's expected result to match broken behaviour.
