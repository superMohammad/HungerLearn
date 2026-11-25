---
type: llm
focus: trace
weight: 1
---

The review flags that errors come back with HTTP 200 (e.g. {"error": "not found"}, {"ok": false}) instead of specific status codes (404, 403, 422...), and that create_payment leaks raw exception text through a catch-all handler.
