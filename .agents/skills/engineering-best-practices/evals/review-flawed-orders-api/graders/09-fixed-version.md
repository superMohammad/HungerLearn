---
type: llm
focus: trace
weight: 1
---

orders_api_fixed.py uses plural noun resource paths, checks ownership on every order read and write, accepts only an allowlist of updatable fields (e.g. a typed request model), takes credentials from a header, returns specific status codes with a consistent error body (ideally RFC 9457 Problem Details), enforces a maximum page size, and accepts an Idempotency-Key on the payment POST.
