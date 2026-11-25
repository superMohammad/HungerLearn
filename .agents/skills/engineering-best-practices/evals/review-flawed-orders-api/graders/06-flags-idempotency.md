---
type: llm
focus: trace
weight: 1
---

The review flags that POST /createPayment has no idempotency protection, so a client retry after a timeout can charge the card twice, and recommends an Idempotency-Key header (or equivalent).
