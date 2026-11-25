# Engineering Best Practices & Design Patterns

A consolidated reference covering software engineering, clean code, Python, and agentic AI, each with its design patterns.
Compiled 2026-11-21 from web research plus established references (GoF, *Clean Code*, Twelve-Factor, DORA). Sources are listed at the end.

---

## Table of Contents

1. [Software Engineering Best Practices](#1-software-engineering-best-practices)
2. [Clean Code](#2-clean-code)
3. [Python Best Practices](#3-python-best-practices)
4. [Agentic AI Best Practices](#4-agentic-ai-best-practices)
5. [Design Patterns](#5-design-patterns)
6. [Cross-Cutting Principles](#6-cross-cutting-principles)
7. [Checklists](#7-checklists)
8. [Sources](#8-sources)

---

## 1. Software Engineering Best Practices

### 1.1 The highest-leverage habits
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

### 1.2 Testing strategy: the test pyramid
```
        /  E2E  \        few, slow, brittle: critical user journeys only
       / Integr. \       DB, APIs, queues: real boundaries
      /   Unit    \      many, fast, isolated: pure logic
```
- Test behavior, not implementation details.
- Tests must be deterministic. Quarantine flaky tests and fix them; don't ignore them.
- Use contract tests between services and property-based tests (Hypothesis) for logic that is heavy on invariants.
- Coverage is a signal, not a goal. Around 80% on core logic is a common bar.

### 1.3 Measuring delivery: DORA metrics
| Metric | Elite target |
|---|---|
| Deployment frequency | On demand (multiple per day) |
| Lead time for changes | Under 1 day |
| Change failure rate | 0–15% |
| Time to restore service | Under 1 hour |

DORA's research shows the practices that drive these numbers are trunk-based development, test automation, deployment automation, loosely coupled architecture, and monitoring.

### 1.4 Twelve-Factor App (cloud-native baseline)
1. One codebase, many deploys. 2. Explicitly declared dependencies. 3. Config in the environment. 4. Backing services as attached resources. 5. Strict build/release/run separation. 6. Stateless processes. 7. Port binding. 8. Scale by adding processes (concurrency). 9. Disposability: fast startup and graceful shutdown. 10. Dev/prod parity. 11. Logs as event streams. 12. Admin tasks as one-off processes.

### 1.5 Architecture principles
- **Separation of concerns.** Keep domain logic independent of frameworks, I/O, and the UI (Hexagonal / Clean / Onion architecture).
- **High cohesion, low coupling.** Modules change for one reason and know little about each other.
- **Start with a modular monolith.** Extract microservices only when team or scaling boundaries require it.
- **Design for failure.** Use timeouts, retries with backoff, circuit breakers, and idempotency keys.
- **Record decisions** in ADRs (Architecture Decision Records).
- Follow the **ISO/IEC/IEEE 12207:2026** software lifecycle standard where formal process compliance matters.

---

## 2. Clean Code

### 2.1 Naming
- A name should reveal intent. If a name needs a comment, rename it.
- Variables and classes are **nouns** (`invoice`, `PaymentGateway`). Functions are **verbs** (`calculate_total`).
- Booleans read as yes/no questions: `is_active`, `has_permission`, `can_retry`.
- Use one word per concept. Don't mix `fetch`, `get`, and `retrieve` for the same idea.
- Avoid noise words (`data`, `info`, `manager`, `helper`), abbreviations, and type encodings.

### 2.2 Functions
- **Do one thing.** A function works at a single level of abstraction.
- Keep them small, but don't take it to extremes: the "2–4 lines" rule is contested because splitting code too finely has its own readability cost.
- **Few arguments** (0–2 ideal, 3 maximum). Group related arguments into a data object.
- **No flag arguments.** `render(is_admin=True)` is really two functions in one.
- **Command–query separation.** A function either changes state or returns a value, not both.
- **Prefer pure functions.** Same input gives the same output, with no hidden side effects.
- Return early with guard clauses instead of deep nesting.

### 2.3 Comments & formatting
- Code explains *what*. Comments explain *why* (intent, trade-offs, constraints).
- Delete commented-out code. Git remembers it.
- Use an automatic formatter and stop debating style.

### 2.4 Error handling
- Raise specific exceptions. Never swallow errors silently.
- Don't return `None` or magic values to signal failure. Raise an error or return a typed result.
- Include context in error messages: inputs, IDs, status codes.
- Fail fast at boundaries by validating input where it enters the system.

### 2.5 Core principles
| Principle | Summary |
|---|---|
| **SOLID** | **S**ingle Responsibility · **O**pen/Closed · **L**iskov Substitution · **I**nterface Segregation · **D**ependency Inversion |
| **DRY** | Every piece of *knowledge* has one source of truth. Duplicate code is fine when it represents different knowledge. |
| **KISS** | The simplest solution that works. |
| **YAGNI** | Don't build for hypothetical future requirements. |
| **Law of Demeter** | Talk only to your immediate collaborators (`a.b().c().d()` is a smell). |
| **Composition over inheritance** | Combine small behaviors instead of building deep class trees. |
| **Boy Scout Rule** | Leave the code a little cleaner than you found it. |

### 2.6 Common code smells → refactorings
| Smell | Refactoring |
|---|---|
| Long function | Extract Function |
| Long parameter list | Introduce Parameter Object |
| Primitive obsession | Replace Primitive with Value Object |
| Feature envy | Move Function |
| Switch on type everywhere | Replace Conditional with Polymorphism / dispatch table |
| Shotgun surgery | Move related code into one module |
| Magic numbers | Named constants / Enums |

---

## 3. Python Best Practices

### 3.1 Modern toolchain (2026 consensus)
| Concern | Tool |
|---|---|
| Python versions, venvs, deps, lockfile, scripts | **uv** (`uv init`, `uv add`, `uv run`, `uv.lock`) |
| Lint + format | **Ruff**. v0.16 enables 413 rules by default; strict projects use `select = ["ALL"]` with explicit ignores. |
| Type checking | **mypy --strict**, **pyright**, or **ty** (Astral, newer) |
| Testing | **pytest** + `pytest-cov`, **Hypothesis** for property tests |
| Pre-commit | `pre-commit` running ruff and the type checker |
| Config | Everything in **`pyproject.toml`**. No `setup.py` or `requirements.txt` sprawl. |

### 3.2 Project layout
```
project/
├── pyproject.toml
├── uv.lock
├── src/
│   └── package_name/
│       ├── __init__.py
│       ├── domain/        # pure logic, models
│       ├── services/      # use cases
│       └── adapters/      # DB, HTTP, external APIs
└── tests/
```
- Use the `src/` layout so tests run against the installed package and not the working directory.
- Set `requires-python >= "3.11"` at minimum.

### 3.3 Typing
- Type hints on **every** function signature and on non-obvious variables.
- Use modern syntax: `list[str]`, `X | None`, `type Alias = ...` (3.12+), `Self`, `TypedDict`, `Literal`, `Final`.
- Avoid `Any`. Use `Protocol` for structural interfaces and `TypeVar` / PEP 695 generics where a generic is really needed.
- Validate data at boundaries with **Pydantic** (external input) and use **dataclasses** (`frozen=True, slots=True`) for internal value objects.

### 3.4 Pythonic idioms
- EAFP ("easier to ask forgiveness than permission") for races. Don't use it to hide errors.
- Context managers (`with`) for every resource: files, locks, DB sessions.
- Comprehensions and generators instead of manual loops that build lists. Use generators for large or streaming data.
- `enumerate`, `zip(strict=True)`, unpacking, and `pathlib` over `os.path`.
- `match`/`case` for structural dispatch on data shapes.
- f-strings for formatting, but **structured logging** (`structlog` or `logging` with `extra=`) for logs.
- `enum.Enum` / `StrEnum` instead of string constants.
- Never use mutable default arguments (`def f(x=[])`).

### 3.5 Errors, logging, config
- Define a small domain exception hierarchy (`class PaymentError(Exception)`). Catch narrow types.
- Chain exceptions with `raise NewError(...) from err` to keep the root cause.
- Load config from environment variables via `pydantic-settings`, and validate it at startup.
- For external calls, retry with backoff (`tenacity`), log a warning on each retry, then re-raise.

### 3.6 Performance & concurrency
- Profile before optimizing (`cProfile`, `py-spy`, `scalene`).
- `asyncio` for I/O-bound work, `multiprocessing` / `ProcessPoolExecutor` for CPU-bound work. Free-threaded 3.13+ builds are still experimental.
- Reach for vectorized libraries (NumPy, Polars) before writing hand-written loops.

---

## 4. Agentic AI Best Practices

### 4.1 Guiding principles
1. **Start simple.** A single LLM call with good retrieval and examples often beats an agent. Add agentic complexity only when it measurably helps.
2. **Workflows vs. agents.** *Workflows* run LLMs along predefined code paths and are predictable. *Agents* direct their own process and tool use, which makes them flexible but less predictable. Prefer workflows when the steps are known in advance.
3. **Transparency.** Show the agent's plan and steps, and log full trajectories.
4. **Invest in the agent–computer interface (ACI).** Tool design matters as much as prompt design.

### 4.2 Context engineering
Context engineering means curating the smallest set of high-signal tokens that leads to the desired behavior.
- Start with a **minimal prompt on the strongest model**, then add instructions and examples in response to failures you observe.
- Write system prompts at the "right altitude": specific heuristics, not brittle if/else rules and not vague platitudes.
- **Just-in-time retrieval.** Give the agent identifiers (file paths, IDs, queries) and let it load content on demand instead of stuffing everything into the context up front.
- **Long-horizon techniques:** compaction (summarizing history), structured note-taking or external memory, and sub-agents with clean context windows that return condensed results.
- Keep errors in context so the agent learns from its mistakes within the session.
- Put static content (system prompt, tool schemas) first so it benefits from prompt caching.

### 4.3 Tool design
- **Few, distinct, well-named tools.** If a human engineer can't tell which tool applies, the model can't either.
- Narrow, task-specific tools with clear input and output schemas are better than broad wrappers like "execute arbitrary SQL".
- Return **meaningful, token-efficient** output (names instead of UUIDs, pagination, truncation with hints).
- Write error messages that tell the agent how to fix the call.
- Standardize integrations with **MCP (Model Context Protocol)**.
- Load tools dynamically or mask them when the catalog is large.

### 4.4 Evaluation
- Build an **eval set early** from real tasks, and include edge cases and failure cases.
- Combine code-based checks, LLM-as-judge (calibrated against human labels), and human review for ambiguous cases.
- Evaluate **trajectories**, not just final answers: tool choice, number of steps, cost, and latency.
- Test long sessions. Context degradation often hides in short evals. Use recall probes.
- Treat prompts and tools like code: versioned, reviewed, and regression-tested in CI.

### 4.5 Safety, guardrails & operations
- **Least privilege.** Use permission tiers, sandboxed execution, and scoped credentials.
- **Human-in-the-loop** for irreversible or high-stakes actions (payments, deletions, outbound messages).
- Guard against **prompt injection**. Treat tool output and retrieved content as data, never as instructions.
- **Execution controls:** max iterations, token and cost budgets, timeouts, and loop detection.
- Validate structured outputs against schemas. Retry with the error message fed back to the model.
- Use **checkpoints and resumability** for long-running plans.
- Use observability tools (OpenTelemetry GenAI conventions, LangSmith, MLflow, and similar) to trace every call.

---

## 5. Design Patterns

### 5.1 Classic GoF patterns (with modern relevance)
| Category | Pattern | Use when | Modern note |
|---|---|---|---|
| Creational | **Factory Method** | Creation logic varies by type | In Python, usually just a function or dict registry |
| | **Abstract Factory** | Families of related objects | Rare outside UI and cross-platform code |
| | **Builder** | Complex objects built step by step | Dataclass + keyword args often suffices |
| | **Singleton** | Exactly one instance | Often an anti-pattern. Prefer DI; in Python a module *is* a singleton |
| | **Prototype** | Cloning configured objects | `copy.deepcopy`, `dataclasses.replace` |
| Structural | **Adapter** | Wrap an incompatible interface | Core of hexagonal "ports & adapters" |
| | **Facade** | Simplify a complex subsystem | SDK clients, service layers |
| | **Decorator** | Add behavior without subclassing | Native in Python (`@decorator`) |
| | **Proxy** | Control access (lazy, cache, auth) | Caching layers, remote stubs |
| | **Composite** | Tree structures treated uniformly | ASTs, UI trees |
| | **Bridge** | Decouple abstraction from implementation | Drivers, renderers |
| Behavioral | **Strategy** | Swap algorithms at runtime | Pass a function or `Callable` |
| | **Observer** | Notify subscribers of events | Event buses, signals, pub/sub |
| | **Command** | Encapsulate an action (undo, queue) | Task queues, CQRS commands |
| | **Chain of Responsibility** | Pipeline of handlers | Middleware |
| | **State** | Behavior depends on state | Explicit state machines |
| | **Template Method** | Fixed skeleton, variable steps | Prefer passing hook functions |
| | **Iterator** | Sequential access | Python generators |
| | **Mediator** | Centralize object interaction | Orchestrators |

### 5.2 Architectural & enterprise patterns
- **Layered / Hexagonal / Clean Architecture.** The domain sits at the center and I/O at the edges, with dependencies pointing inward.
- **Repository + Unit of Work.** Abstract persistence and handle transactions as a unit.
- **Dependency Injection.** Pass collaborators in explicitly instead of importing globals.
- **CQRS & Event Sourcing.** Separate read and write models, and store events instead of current state (use only where needed).
- **Microservice patterns:** API Gateway, Saga (distributed transactions), Outbox (reliable events), Strangler Fig (incremental migration).
- **Resilience patterns:** Circuit Breaker, Retry with exponential backoff and jitter, Bulkhead, Timeout, Idempotency key.

### 5.3 Pythonic design patterns
Python's first-class functions, duck typing, and modules make many GoF patterns trivial:
| Pattern | Pythonic implementation |
|---|---|
| Strategy | Pass a function: `sort(items, key=by_price)` |
| Factory / Registry | `HANDLERS: dict[str, Callable[..., Handler]]` + decorator registration |
| Interface | `typing.Protocol` (structural typing, no inheritance needed) |
| Value Object | `@dataclass(frozen=True, slots=True)` |
| Singleton | Module-level instance |
| Decorator | `functools.wraps`-based function decorators |
| Iterator / Pipeline | Generators and `itertools` |
| Resource management | Context managers (`contextlib.contextmanager`) |
| Dispatch on type | `functools.singledispatch` or `match`/`case` |
| Plugin system | `importlib.metadata.entry_points` |

Remember the distinction: *idioms* are small constructs a few lines long, while *patterns* shape larger structures.

### 5.4 Agentic AI design patterns

**Building blocks and workflows** (from Anthropic's *Building Effective Agents*):
| Pattern | How it works | Use when |
|---|---|---|
| **Augmented LLM** | LLM + retrieval + tools + memory | The base unit of every system |
| **Prompt Chaining** | Sequential steps, each consuming the previous output, with programmatic "gates" between them | The task decomposes into fixed subtasks |
| **Routing** | A classifier sends the input to a specialized prompt or model (e.g., easy → cheap model) | Inputs fall into distinct categories |
| **Parallelization** | *Sectioning* (independent subtasks) or *Voting* (the same task several times for consensus) | Speed matters, or you need confidence through diversity |
| **Orchestrator–Workers** | A central LLM breaks the task down dynamically, delegates to workers, and synthesizes the results | Subtasks can't be predicted in advance (e.g., multi-file code changes) |
| **Evaluator–Optimizer** | A generator drafts and an evaluator critiques, in a loop | Clear evaluation criteria exist and iteration measurably helps |
| **Autonomous Agent** | An LLM uses tools in a loop based on environment feedback until done | Open-ended problems in a trusted, sandboxed environment |

**Agent reasoning patterns** (Andrew Ng's four, plus common extensions):
| Pattern | Description | Production maturity |
|---|---|---|
| **Tool Use** | The model calls functions and APIs (via MCP or function calling) | Most mature, and the foundation for the rest |
| **Reflection** | Generate → critique against criteria → revise. Cap the number of iterations | Works when criteria are concrete |
| **Planning** | Decompose the goal into steps (plan-and-execute) | Fragile without validation and checkpoints |
| **Multi-Agent Collaboration** | Specialized agents (researcher, coder, reviewer) coordinate | Start single-agent; add agents only when the benefit outweighs coordination overhead |
| **ReAct** | Interleave Reason → Act → Observe | Standard agent loop |
| **RAG / Agentic RAG** | Retrieve grounding data, with the agent deciding what to retrieve and when | Knowledge-heavy tasks |
| **Memory** | Short-term (context), long-term (vector or structured store), episodic | Long-horizon and personalized agents |
| **Human-in-the-Loop** | Approval gates on risky actions | Any irreversible action |
| **Guardrails** | Input and output validation, policy checks, schema enforcement | Always |

**Agentic anti-patterns:** building a multi-agent system for a single-prompt task, bloated toolsets, unbounded loops, trusting tool output as instructions, evaluating only the final answer, and no cost or latency budgets.

---

## 6. Cross-Cutting Principles
These apply across all four domains:
1. **Simplicity first** (KISS / YAGNI / "start with a single LLM call").
2. **Explicit over implicit**: types, schemas, dependencies, errors.
3. **Small, composable units**: pure functions, single-purpose tools, focused agents.
4. **Fast feedback loops**: tests, CI, evals, observability.
5. **Fail loudly, with context**: no silent fallbacks.
6. **Least privilege & defense in depth**: for services and agents alike.
7. **Measure, then optimize**: profile code, eval agents, track DORA metrics.

---

## 7. Checklists

### PR checklist
- [ ] Names reveal intent. Functions do one thing.
- [ ] Types on all signatures, no `Any`.
- [ ] Errors are specific, contextual, and never swallowed.
- [ ] Tests cover new behavior and edge cases.
- [ ] Lint, format, type check, and tests pass in CI.
- [ ] No secrets, no commented-out code, no dead code.

### New Python project
- [ ] `uv init` with `src/` layout and `pyproject.toml`.
- [ ] Ruff (strict) + mypy/pyright/ty strict + pytest + pre-commit.
- [ ] Pydantic for boundary data, dataclasses for internal models.
- [ ] Structured logging and config validated at startup.

### Shipping an agent
- [ ] Could a workflow or a single call solve this instead?
- [ ] Minimal, distinct, well-documented tools with clear error messages.
- [ ] Eval suite covering trajectories, cost, latency, and long sessions.
- [ ] Iteration, token, and cost budgets plus timeouts.
- [ ] Human approval for irreversible actions. Prompt-injection defenses.
- [ ] Full tracing and logging of every step.

---

## 8. Sources
**Software engineering**
- [Gartner – 2026 Planning Guide for Software Engineering](https://www.gartner.com/en/software-engineering/insights/2026-planning-guide-for-software-engineering)
- [IEEE Computer Society – Secure Software](https://computer.org/publications/tech-news/trends/secure-software)
- [Tekrevol – 2026 Software Development Checklist](https://www.tekrevol.com/blogs/software-development-best-practices/)
- [Zencoder – Software Engineering Best Practices 2026](https://zencoder.ai/blog/software-engineering-best-practices)
- [Netguru – 11 Best Practices 2026](https://www.netguru.com/blog/best-software-development-practices)
- [Google Cloud – DORA DevOps capabilities](https://docs.cloud.google.com/architecture/devops/process) · [DORA Core Model](https://DORA.dev/core/dora-core-model-v1.2.2.pdf) · [Splunk – DORA Metrics](https://www.splunk.com/en_us/blog/learn/devops-metrics)

**Clean code**
- [Clean Code (Wikipedia)](https://www.wikipedia.com/wiki/Clean_Code) · [freeCodeCamp – Clean Coding](https://www.freecodecamp.org/news/clean-coding-for-beginners/)
- [Scrimba – Clean Code Principles 2026](https://scrimba.com/articles/clean-code-principles-for-beginners-2026/) · [LMU – Clean Code notes](https://cs.lmu.edu/~ray/notes/cleancode/) · [Codacy – How to Write Clean Code](https://blog.codacy.com/how-to-write-clean-code)

**Python**
- [KDnuggets – Python Project Setup 2026: uv + Ruff + Ty](https://www.kdnuggets.com/python-project-setup-2026-uv-ruff-ty-polars)
- [Trail of Bits – Modern Python](https://trailofbits.com/skills/modern-python/)
- [Python Developer Tooling Handbook – Ruff 0.16](https://buttondown.com/pydevtools/archive/ruff-0160-enables-413-rules-by-default-plus/)
- [Toptal – Python Design Patterns](https://www.toptal.com/python/python-design-patterns) · [KDnuggets – Advanced Python Design Patterns](https://www.kdnuggets.com/7-advanced-python-design-patterns-for-data-scientists)

**Agentic AI**
- [Anthropic – Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic – Effective Context Engineering for AI Agents](https://anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Cloudflare – Agentic Patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/)
- [Augment Code – Agentic Design Patterns](https://www.augmentcode.com/guides/agentic-design-patterns) · [SitePoint – Definitive Guide 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/)
- [DZone – Agentic Systems Design Patterns](https://dzone.com/articles/agentic-systems-design-patterns) · [MachineLearningMastery – 7 Agentic Patterns](https://machinelearningmastery.com/7-must-know-agentic-ai-design-patterns/)
- [MLflow – Best Practices for AI Tools](https://mlflow.org/articles/tags/best-practices-for-ai-tools/) · [Splunk – Context Engineering in Production](https://www.splunk.com/en_us/blog/artificial-intelligence/context-engineering-production-agents.html)
- [arXiv – AI Agents Do Not Fail Alone: The Context Fails First](https://arxiv.org/pdf/2607.14275)
