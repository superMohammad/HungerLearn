---
type: llm
focus: trace
weight: 1
---

The review flags that GET /getOrder/{order_id} returns any order without checking that the caller owns it (broken object-level authorization / IDOR, OWASP API1).
