# verify-app: sign in without asking for DEMO_PASSWORD

**Tier:** High-risk: the change edits `.agents/skills/verify-app/SKILL.md`, which the High-risk list covers. The change is text only, with no behaviour change in code.
**Approved:** Mohammad Almalke (`@superMohammad`), 2026-11-26, in the Claude Code session: "Don't ask me for it" (the demo password) and "ok approve you to do all remaining tasks".

## Why
The skill still says "the user gives you `DEMO_PASSWORD`". Mohammad decided agents never ask for it.

## Change
- **LLM rows (verify-app step 4), admin:** the Playwright browser's admin session, or the seeded admin's quick-fill chip on `/signin`, where the server fills the password. If there is no chip, the engineer signs in there themselves, never through the chat.
- **LLM rows, learner:** one reused verify learner per branch, signed up through the app.
  - Its email is `verify-<slug>@verify.hungerlearn.test`: zod accepts it, and the demo quick-fill's `LIKE '%@hungerlearn.test'` does not match it.
  - Its password is the fixed throwaway `verify-learner-local`, so a later session can sign in again.
  - For F05 it uses the role and branch of the published training.
- **Scripted rows:** `scripts/verify-app.mjs` keeps reading `DEMO_PASSWORD` itself.
- **Master plan:** its PR C line is updated to match.

## Threat model
- **No secret moves:** no password passes through the agent or the chat.
- **Risk: an agent goes looking for the password.** Mitigated by the explicit fallback, where the engineer signs in in the browser.
- **Risk: verify learners pollute readiness and the sign-in quick-fill.** Mitigated by:
  - one recognisable learner per branch, documented as staying until the database is reset;
  - a domain outside the quick-fill match.
- **The fixed learner password is not a secret.** It only opens a local learner account with no admin rights.

## Criteria → checks
- **No ask left:** no skill or plan tells an agent to ask for `DEMO_PASSWORD`. Check: `rg -n "gives you .DEMO_PASSWORD|DEMO_PASSWORD you give" .agents docs -g '!*verify-app-no-demo-password.md'` returns nothing, and `rg -n DEMO_PASSWORD .agents` shows only the "never ask" line.
- **Checks pass:** `node scripts/check.mjs scripts` passes, since the tests cover the skills tree.

## Rollback
Revert the PR.
