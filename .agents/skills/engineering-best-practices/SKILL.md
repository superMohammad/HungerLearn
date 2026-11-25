---
name: engineering-best-practices
description: Opinionated, research-backed engineering standards for writing, reviewing, refactoring, and designing software — covering software engineering process (CI/CD, testing, DORA, Twelve-Factor, architecture), API design (REST/HTTP, gRPC, GraphQL, errors, pagination, versioning, idempotency, API security, webhooks), clean code (naming, functions, SOLID, code smells), modern Python (uv, Ruff, strict typing, pyproject, idioms), agentic AI systems (context engineering, tool design, evals, guardrails), and design patterns (GoF, architectural, Pythonic, and agentic patterns like prompt chaining, routing, orchestrator-workers, ReAct). Use this skill whenever the user asks to write or review production-quality code, refactor messy code, set up a new Python project, design or review an API or endpoint, pick a design pattern or architecture, design or debug an LLM agent / tool-calling / multi-agent system, write a PR checklist, or asks "what's the best practice for X" — even if they don't say "best practices" explicitly.
---

# Engineering Best Practices

A distilled reference of software engineering, clean code, Python, agentic AI, and design-pattern best practices. The detail lives in `references/`; this file tells you how to apply it.

## Precedence

Repo conventions and the user's `CLAUDE.md` / `AGENTS.md` instructions override this skill. Consistency within a codebase is worth more than any generic rule. Use this skill to fill gaps, to justify recommendations, and as a review lens. Don't use it to rewrite working code into a different style the user didn't ask for.

## How to use

1. **Work out which domains the task touches**, then read only the matching reference file(s):

   | Task involves… | Read |
   |---|---|
   | Process, CI/CD, testing strategy, deployment, architecture, metrics | `references/software-engineering.md` |
   | Readability, naming, function design, refactoring, code smells, SOLID | `references/clean-code.md` |
   | API design: REST/HTTP, status codes, errors, pagination, versioning, idempotency, auth, webhooks | `references/api-design.md` |
| Python tooling, project setup, typing, idioms, errors/logging, performance | `references/python.md` |
   | LLM agents, prompts and context, tool design, evals, agent safety | `references/agentic-ai.md` |
   | Choosing or explaining a pattern (GoF, hexagonal, CQRS, Pythonic, agentic workflows) | `references/design-patterns.md` |
   | Citing where a recommendation comes from | `references/sources.md` |

2. **Apply the practices to the actual code or design.** Generic advice is cheap. The value comes from pointing at the specific function, file, or design decision and showing the concrete improvement.

3. **Prioritize.** When reviewing, order findings by impact: correctness and security → design and coupling → readability → style. Don't bury one real bug under ten naming nits.

4. **Explain the why briefly.** One line of reasoning per recommendation (for example, "flag argument → two behaviors in one function → split into `render_admin` / `render_user`"). This lets the user judge trade-offs instead of following rules blindly.

5. **Prefer the simplest thing that works.** Many patterns are overkill. In Python a function often replaces Strategy or Factory classes, and in agentic systems a single LLM call or a fixed workflow often beats an autonomous agent. Recommend added complexity only when it pays for itself.

## Cross-cutting principles

These hold across every domain. Use them as tie-breakers:

1. **Simplicity first:** KISS, YAGNI, "start with a single LLM call".
2. **Explicit over implicit:** types, schemas, dependencies, errors.
3. **Small, composable units:** pure functions, single-purpose tools, focused agents.
4. **Fast feedback loops:** tests, CI, evals, observability.
5. **Fail loudly, with context:** specific errors, no silent fallbacks.
6. **Least privilege and defense in depth:** for services and agents alike.
7. **Measure, then optimize:** profile code, run evals on agents, track DORA metrics.

## Checklists

Use these as the final pass before handing back code or a design.

### PR / code review
- [ ] Names reveal intent. Each function does one thing at one level of abstraction.
- [ ] No flag arguments. Few parameters, with related ones grouped into a data object.
- [ ] Types on all signatures, no `Any`.
- [ ] Errors are specific, contextual, and never swallowed. Input is validated at boundaries.
- [ ] Tests cover new behavior and edge cases, and test behavior rather than implementation.
- [ ] Lint, format, type check, and tests pass.
- [ ] No secrets, no commented-out code, no dead code.

### API endpoint
- [ ] Defined in the OpenAPI/proto spec first, linted, and diffed for breaking changes in CI.
- [ ] Plural-noun resource paths, correct method semantics, specific status codes (never `200` with an error).
- [ ] Errors use RFC 9457 Problem Details with a stable `type` and a request ID.
- [ ] Collections use cursor pagination with a maximum page size.
- [ ] Object- and property-level authorization on every request. Input validated against the schema. Rate limited.
- [ ] Unsafe `POST`s accept an `Idempotency-Key`. Updates use `ETag` / `If-Match`.
- [ ] Changes are additive. A breaking change gets a new version and a deprecation timeline.

### New Python project
- [ ] `uv init` with a `src/` layout. All config in `pyproject.toml`, and `uv.lock` committed.
- [ ] Ruff (strict) + mypy/pyright/ty in strict mode + pytest + pre-commit.
- [ ] Pydantic for boundary data, frozen dataclasses for internal value objects.
- [ ] Structured logging. Config loaded from the environment and validated at startup.

### Shipping an agent
- [ ] Could a fixed workflow or a single call solve this instead?
- [ ] Minimal, distinct, well-documented tools with actionable error messages.
- [ ] Eval suite covering trajectories, cost, latency, and long sessions.
- [ ] Iteration, token, and cost budgets plus timeouts.
- [ ] Human approval for irreversible actions. Tool output treated as data, not instructions.
- [ ] Every step traced and logged.

## Output guidance

- **Code review:** list findings grouped by severity, each with location → problem → fix (show a short snippet when the fix isn't obvious).
- **Writing new code:** just write good code that follows the practices. Don't lecture. Mention a practice only when you made a non-obvious choice.
- **"Which pattern / architecture?":** give one recommendation with its trade-off and the simpler alternative you rejected (and why), rather than a survey of every option.
