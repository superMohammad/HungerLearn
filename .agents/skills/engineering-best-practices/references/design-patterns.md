# Design Patterns

Contents: Classic GoF · Architectural & enterprise · Pythonic · Agentic AI

## Classic GoF patterns (with modern relevance)
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

## Architectural & enterprise patterns
- **Layered / Hexagonal / Clean Architecture.** The domain sits at the center and I/O at the edges, with dependencies pointing inward.
- **Repository + Unit of Work.** Abstract persistence and handle transactions as a unit.
- **Dependency Injection.** Pass collaborators in explicitly instead of importing globals.
- **CQRS & Event Sourcing.** Separate read and write models, and store events instead of current state (use only where needed).
- **Microservice patterns:** API Gateway, Saga (distributed transactions), Outbox (reliable events), Strangler Fig (incremental migration).
- **Resilience patterns:** Circuit Breaker, Retry with exponential backoff and jitter, Bulkhead, Timeout, Idempotency key.

## Pythonic design patterns
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

## Agentic AI design patterns

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
