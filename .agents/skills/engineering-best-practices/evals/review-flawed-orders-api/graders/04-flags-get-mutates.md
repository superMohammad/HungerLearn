---
type: llm
focus: trace
weight: 1
---

The review flags that GET /orders/{order_id}/cancel changes state, which breaks GET's safe semantics (crawlers, prefetch, and retries can cancel orders), and recommends a POST action.
