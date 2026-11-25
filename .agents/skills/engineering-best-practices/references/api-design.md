# API Design Best Practices
## Principles
- **Contract first.** Write the OpenAPI 3.1 spec (or `.proto` / GraphQL schema) before the code and review it like code. Generate docs, clients, and request validation from it. In CI, lint it (Spectral) and diff it (oasdiff) so breaking changes fail the build.
- **Design for the consumer.** Model resources around what clients do, not around database tables. Internal schema changes must not leak into the contract.
- **Consistency beats cleverness.** Use one naming style, one error format, one pagination scheme, and one auth model across the whole API. Write them down in a style guide and enforce it with a linter.
- **Pick one style per surface:**

| Style | Choose it when |
|---|---|
| **REST over HTTP + JSON** | Default. Public APIs, CRUD-shaped domains, broad client support, HTTP caching. |
| **gRPC** | Internal service-to-service calls, low latency, streaming, strongly typed contracts. |
| **GraphQL** | Many clients need different shapes of one connected graph. Needs query cost limits and persisted queries. |

## Resources and URLs
- Use plural nouns in lowercase kebab-case: `/orders/{order_id}/line-items`. Nest no deeper than one level. Beyond that, use a top-level collection with a filter.
- For actions that are not CRUD, use a sub-resource verb: `POST /orders/{id}:cancel` (Google AIP-136) or `POST /orders/{id}/cancel`. Never put verbs in the path for CRUD (`/getOrder`).
- Pick one field case for JSON (`snake_case` or `camelCase`) and use it everywhere.
- IDs are opaque, stable strings (UUIDv7 / ULID). Don't expose sequential integers when enumeration is a risk.
- Timestamps are RFC 3339 in UTC (`2026-11-25T10:00:00Z`). Money is an integer in minor units plus an ISO 4217 currency code. Enums are strings, not numbers.

## HTTP methods (RFC 9110)
| Method | Use | Safe | Idempotent |
|---|---|---|---|
| `GET` | Read a resource or collection | Yes | Yes |
| `POST` | Create, or run a non-idempotent action | No | No (make it so with `Idempotency-Key`) |
| `PUT` | Replace a whole resource | No | Yes |
| `PATCH` | Partial update (JSON Merge Patch, RFC 7396) | No | Not guaranteed |
| `DELETE` | Remove a resource | No | Yes |

`GET` never changes state. Retries are only safe on idempotent methods.

## Status codes
| Code | When |
|---|---|
| `200` / `201` / `204` | Success. `201` returns a `Location` header. `204` has no body. |
| `202` | Accepted for async work. Return a URL of an operation resource to poll. |
| `400` | Malformed request (bad JSON, wrong type). |
| `401` / `403` | Not authenticated / authenticated but not allowed. |
| `404` | Not found, or hidden from this caller so its existence doesn't leak. |
| `409` / `412` | State conflict / `If-Match` ETag precondition failed. |
| `422` | Well-formed but fails validation or business rules. |
| `429` | Rate limited. Always send `Retry-After`. |
| `500` / `503` | Server fault / temporarily unavailable (with `Retry-After`). |

Never return `200` with an error in the body.

## Errors: Problem Details (RFC 9457)
Return `Content-Type: application/problem+json` with one shape for every error:
```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Request validation failed",
  "status": 422,
  "detail": "quantity must be between 1 and 100",
  "instance": "/orders/ord_01J9Z",
  "request_id": "req_7f3a",
  "errors": [{ "field": "line_items[0].quantity", "code": "out_of_range" }]
}
```
- `type` is a stable, documented identifier that clients branch on. Never make clients parse `detail`.
- Include a request or trace ID. Never leak stack traces, SQL, or internal hostnames.

## Pagination, filtering, sorting
- Use **cursor pagination** by default (`?limit=50&cursor=…` returning `next_cursor`). It stays stable under inserts and is fast at depth. Use offset only for small, static lists.
- Always enforce a default and a maximum page size.
- Filter with query parameters (`?status=paid&created_after=…`). Sort with `?sort=-created_at`.
- When payloads get large, offer field selection (`?fields=`) or expansion (`?expand=customer`) rather than new endpoints.

## Idempotency, concurrency, long-running work
- **Idempotency keys:** clients send an `Idempotency-Key` header on unsafe `POST`s (payments, orders). The server stores key → response for about 24 h and replays the stored response on retry. If the same key arrives with a different body, reject it with `422`.
- **Optimistic concurrency:** return an `ETag`. Clients update with `If-Match`, and a mismatch gets `412`. This prevents lost updates without locks.
- **Long-running work:** return `202` plus an operation resource (`GET /operations/{id}` → `status`, `result`, `error`), or deliver the result by webhook. Don't hold HTTP connections open for minutes.

## Versioning and evolution
- **Non-breaking:** new endpoints, new optional request fields, new response fields. Clients must ignore unknown fields (tolerant reader).
- **Breaking:** removing or renaming fields, changing types or meaning, making an input required, tightening validation, adding enum values that strict clients reject.
- Version only on breaking changes. A major version in the path (`/v1/`) is the simplest scheme. Date-based versions pinned per client (Stripe style) suit APIs that change often.
- To deprecate, announce a timeline, send `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers, track who still calls the old version, and then remove it.

## Security (OWASP API Security Top 10, 2023)
- **Authentication:** use OAuth 2.0 / OIDC for user-delegated access, with short-lived access tokens. Validate the signature, `iss`, `aud`, and `exp` on every JWT. API keys are only for server-to-server, are hashed at rest, and can be rotated. HTTPS only.
- **Object-level authorization on every request** (API1, BOLA). Check that *this* caller may access *this* ID, not just that they are logged in. This is the most common API vulnerability.
- **Property-level authorization** (API3). Allowlist the fields a caller may read and write. Never bind a request body straight onto a model (mass assignment).
- **Resource limits** (API4). Rate limit per client and per endpoint, cap body size, page size, and GraphQL query depth/cost, and set timeouts.
- **Validate all input** against the schema at the boundary. Never put secrets or tokens in URLs, because URLs get logged.
- **Inventory** (API9). Every endpoint is documented in the spec. Old versions and debug endpoints get retired, not forgotten.
- CORS uses an explicit allowlist of origins, never `*` together with credentials.

## Webhooks
- Sign each payload (HMAC over ID + timestamp + body) and reject old timestamps to stop replays (Standard Webhooks spec).
- Delivery is at least once with exponential backoff. Consumers dedupe by event ID and return `2xx` quickly, then do the work asynchronously.
- Send a thin event (type + ID) or a full snapshot, and document which. Keep event types versioned like the API.

## Observability and docs
- Propagate a request ID and W3C `traceparent`. Log one structured line per request (route, status, latency, client ID).
- Track RED metrics per endpoint: rate, errors, duration (p50/p95/p99).
- Docs are generated from the spec, with a runnable example request and response for every endpoint and every error `type`.
