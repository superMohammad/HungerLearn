---
type: llm
focus: trace
weight: 1
---

The review flags that PATCH /orders/{order_id} copies every request body key onto the order, so a caller can overwrite protected fields such as owner_id, status, or totals (mass assignment / property-level authorization, OWASP API3).
