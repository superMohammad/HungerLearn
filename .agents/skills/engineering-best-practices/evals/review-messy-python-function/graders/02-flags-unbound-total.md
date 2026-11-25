---
type: llm
focus: trace
weight: 1
---

The review identifies that `t` can be unbound or stale when an order is skipped, so `cache[o["id"]] = t` is wrong or crashes.
