# HungerLearn web (MVP)

Next.js 16 app for the six stages in `../hunger-learn-mvp-architecture.md`. Setup, commands, and runtime notes are in the root `CLAUDE.md` ("Running the MVP").

| Stage | Route | Code |
|---|---|---|
| 1 Understand · 6 Version update | `/trainer`, `/trainer/documents/[id]` | `src/lib/docproc.ts`, `src/lib/pipeline.ts` |
| 2 Generate + verify, explainer video | (background) | `src/lib/generation.ts`, `src/lib/media.ts` |
| 3 Human approval, audit log | `/trainer/review` | `src/lib/review.ts` |
| 4 Learn & prove mastery | `/learn`, `/learn/[id]` | `src/lib/compose.ts`, `src/lib/learning.ts` |
| 5 Readiness, ask in Arabic | `/trainer/readiness` | `src/lib/readiness.ts`, `src/lib/sql-guard.ts` |
