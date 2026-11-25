# Software Engineering Best Practices
## The highest-leverage habits
Version control, automated testing, and code review deliver more value than almost every other practice put together. Start with these.

| Practice | What it means in practice |
|---|---|
| **Version control** | Everything in Git, including code, infrastructure as code, config, and migrations. Small, atomic commits with meaningful messages. |
| **Trunk-based development** | Short-lived branches merged to `main` at least daily. Feature flags hide unfinished work. |
| **Code review** | Small PRs (under about 400 lines). Review for correctness, design, and readability. Automate style checks so humans don't argue about formatting. |
| **CI/CD** | Every push runs lint, type check, tests, and a security scan. Deployment is automated and repeatable. |
| **Shift-left testing & security** | Find defects as early as possible, because a bug costs less the earlier it's found. Covers SAST, dependency scanning, and secret scanning in CI (DevSecOps). |
| **Infrastructure as Code** | Terraform, Pulumi, or similar. Environments can be reproduced and are reviewed like code. |
| **Observability** | Structured logs, metrics, and traces (OpenTelemetry). Alert on symptoms that users feel. |

## Testing strategy: the test pyramid
```
        /  E2E  \        few, slow, brittle: critical user journeys only
       / Integr. \       DB, APIs, queues: real boundaries
      /   Unit    \      many, fast, isolated: pure logic
```
- Test behavior, not implementation details.
- Tests must be deterministic. Quarantine flaky tests and fix them; don't ignore them.
- Use contract tests between services and property-based tests (Hypothesis) for logic that is heavy on invariants.
- Coverage is a signal, not a goal. Around 80% on core logic is a common bar.

## Measuring delivery: DORA metrics
| Metric | Elite target |
|---|---|
| Deployment frequency | On demand (multiple per day) |
| Lead time for changes | Under 1 day |
| Change failure rate | 0–15% |
| Time to restore service | Under 1 hour |

DORA's research shows the practices that drive these numbers are trunk-based development, test automation, deployment automation, loosely coupled architecture, and monitoring.

## Twelve-Factor App (cloud-native baseline)
1. One codebase, many deploys. 2. Explicitly declared dependencies. 3. Config in the environment. 4. Backing services as attached resources. 5. Strict build/release/run separation. 6. Stateless processes. 7. Port binding. 8. Scale by adding processes (concurrency). 9. Disposability: fast startup and graceful shutdown. 10. Dev/prod parity. 11. Logs as event streams. 12. Admin tasks as one-off processes.

## Architecture principles
- **Separation of concerns.** Keep domain logic independent of frameworks, I/O, and the UI (Hexagonal / Clean / Onion architecture).
- **High cohesion, low coupling.** Modules change for one reason and know little about each other.
- **Start with a modular monolith.** Extract microservices only when team or scaling boundaries require it.
- **Design for failure.** Use timeouts, retries with backoff, circuit breakers, and idempotency keys.
- **Record decisions** in ADRs (Architecture Decision Records).
- Follow the **ISO/IEC/IEEE 12207:2026** software lifecycle standard where formal process compliance matters.
