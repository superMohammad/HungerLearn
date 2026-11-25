# Clean Code
## Naming
- A name should reveal intent. If a name needs a comment, rename it.
- Variables and classes are **nouns** (`invoice`, `PaymentGateway`). Functions are **verbs** (`calculate_total`).
- Booleans read as yes/no questions: `is_active`, `has_permission`, `can_retry`.
- Use one word per concept. Don't mix `fetch`, `get`, and `retrieve` for the same idea.
- Avoid noise words (`data`, `info`, `manager`, `helper`), abbreviations, and type encodings.

## Functions
- **Do one thing.** A function works at a single level of abstraction.
- Keep them small, but don't take it to extremes: the "2–4 lines" rule is contested because splitting code too finely has its own readability cost.
- **Few arguments** (0–2 ideal, 3 maximum). Group related arguments into a data object.
- **No flag arguments.** `render(is_admin=True)` is really two functions in one.
- **Command–query separation.** A function either changes state or returns a value, not both.
- **Prefer pure functions.** Same input gives the same output, with no hidden side effects.
- Return early with guard clauses instead of deep nesting.

## Comments & formatting
- Code explains *what*. Comments explain *why* (intent, trade-offs, constraints).
- Delete commented-out code. Git remembers it.
- Use an automatic formatter and stop debating style.

## Error handling
- Raise specific exceptions. Never swallow errors silently.
- Don't return `None` or magic values to signal failure. Raise an error or return a typed result.
- Include context in error messages: inputs, IDs, status codes.
- Fail fast at boundaries by validating input where it enters the system.

## Core principles
| Principle | Summary |
|---|---|
| **SOLID** | **S**ingle Responsibility · **O**pen/Closed · **L**iskov Substitution · **I**nterface Segregation · **D**ependency Inversion |
| **DRY** | Every piece of *knowledge* has one source of truth. Duplicate code is fine when it represents different knowledge. |
| **KISS** | The simplest solution that works. |
| **YAGNI** | Don't build for hypothetical future requirements. |
| **Law of Demeter** | Talk only to your immediate collaborators (`a.b().c().d()` is a smell). |
| **Composition over inheritance** | Combine small behaviors instead of building deep class trees. |
| **Boy Scout Rule** | Leave the code a little cleaner than you found it. |

## Common code smells → refactorings
| Smell | Refactoring |
|---|---|
| Long function | Extract Function |
| Long parameter list | Introduce Parameter Object |
| Primitive obsession | Replace Primitive with Value Object |
| Feature envy | Move Function |
| Switch on type everywhere | Replace Conditional with Polymorphism / dispatch table |
| Shotgun surgery | Move related code into one module |
| Magic numbers | Named constants / Enums |
