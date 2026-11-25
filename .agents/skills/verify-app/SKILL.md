---
name: verify-app
description: Use after changing anything a user sees or a flow in the Hunger Learn web app, before opening a PR. Drives the real app in a browser through the touched docs/feature-map.md rows in Arabic and English and saves evidence to .verify/<branch>/. Not for pure library, docproc-only or docs changes.
---
# Verify the app at runtime

1. Read `docs/feature-map.md` and pick the rows your change touches. If your change adds or changes a
   user-visible feature, update its row in the same PR.
2. Make sure the app runs: Postgres up (`docker compose up -d`), `cd web && pnpm dev`
   (http://localhost:3000). LLM steps need the GPU host; if Ollama is unreachable, say so and verify the
   non-LLM parts only. Never add a fallback to get around it. Video renders are verified on the GPU host
   staging app (`http://<GPU_HOST>:3000`).
3. Sign in with the seeded demo accounts (`pnpm db:seed`; password from `DEMO_PASSWORD`, which the user
   gives you; never read `.env*` files).
4. Walk each row's steps with the Playwright browser tools (MCP in both tools), first under `/ar/…`, then
   `/en/…`. Check RTL/LTR direction, that no UI string is hard-coded in one language, and the row's
   "Proof" column.
5. Save evidence to `.verify/<branch>/` (gitignored): one screenshot per row and language
   (`F03-ar.png`), browser console errors, and the relevant `pnpm dev` server log lines.
6. Report per row: pass/fail, what you saw, evidence paths. If something fails, report it. Never edit the
   feature map's expected result to match broken behaviour.
