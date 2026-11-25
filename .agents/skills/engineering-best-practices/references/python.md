# Python Best Practices
## Modern toolchain (2026 consensus)
| Concern | Tool |
|---|---|
| Python versions, venvs, deps, lockfile, scripts | **uv** (`uv init`, `uv add`, `uv run`, `uv.lock`) |
| Lint + format | **Ruff**. v0.16 enables 413 rules by default; strict projects use `select = ["ALL"]` with explicit ignores. |
| Type checking | **mypy --strict**, **pyright**, or **ty** (Astral, newer) |
| Testing | **pytest** + `pytest-cov`, **Hypothesis** for property tests |
| Pre-commit | `pre-commit` running ruff and the type checker |
| Config | Everything in **`pyproject.toml`**. No `setup.py` or `requirements.txt` sprawl. |

## Project layout
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

## Typing
- Type hints on **every** function signature and on non-obvious variables.
- Use modern syntax: `list[str]`, `X | None`, `type Alias = ...` (3.12+), `Self`, `TypedDict`, `Literal`, `Final`.
- Avoid `Any`. Use `Protocol` for structural interfaces and `TypeVar` / PEP 695 generics where a generic is really needed.
- Validate data at boundaries with **Pydantic** (external input) and use **dataclasses** (`frozen=True, slots=True`) for internal value objects.

## Pythonic idioms
- EAFP ("easier to ask forgiveness than permission") for races. Don't use it to hide errors.
- Context managers (`with`) for every resource: files, locks, DB sessions.
- Comprehensions and generators instead of manual loops that build lists. Use generators for large or streaming data.
- `enumerate`, `zip(strict=True)`, unpacking, and `pathlib` over `os.path`.
- `match`/`case` for structural dispatch on data shapes.
- f-strings for formatting, but **structured logging** (`structlog` or `logging` with `extra=`) for logs.
- `enum.Enum` / `StrEnum` instead of string constants.
- Never use mutable default arguments (`def f(x=[])`).

## Errors, logging, config
- Define a small domain exception hierarchy (`class PaymentError(Exception)`). Catch narrow types.
- Chain exceptions with `raise NewError(...) from err` to keep the root cause.
- Load config from environment variables via `pydantic-settings`, and validate it at startup.
- For external calls, retry with backoff (`tenacity`), log a warning on each retry, then re-raise.

## Performance & concurrency
- Profile before optimizing (`cProfile`, `py-spy`, `scalene`).
- `asyncio` for I/O-bound work, `multiprocessing` / `ProcessPoolExecutor` for CPU-bound work. Free-threaded 3.13+ builds are still experimental.
- Reach for vectorized libraries (NumPy, Polars) before writing hand-written loops.
