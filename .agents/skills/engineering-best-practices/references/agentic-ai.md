# Agentic AI Best Practices
## Guiding principles
1. **Start simple.** A single LLM call with good retrieval and examples often beats an agent. Add agentic complexity only when it measurably helps.
2. **Workflows vs. agents.** *Workflows* run LLMs along predefined code paths and are predictable. *Agents* direct their own process and tool use, which makes them flexible but less predictable. Prefer workflows when the steps are known in advance.
3. **Transparency.** Show the agent's plan and steps, and log full trajectories.
4. **Invest in the agent–computer interface (ACI).** Tool design matters as much as prompt design.

## Context engineering
Context engineering means curating the smallest set of high-signal tokens that leads to the desired behavior.
- Start with a **minimal prompt on the strongest model**, then add instructions and examples in response to failures you observe.
- Write system prompts at the "right altitude": specific heuristics, not brittle if/else rules and not vague platitudes.
- **Just-in-time retrieval.** Give the agent identifiers (file paths, IDs, queries) and let it load content on demand instead of stuffing everything into the context up front.
- **Long-horizon techniques:** compaction (summarizing history), structured note-taking or external memory, and sub-agents with clean context windows that return condensed results.
- Keep errors in context so the agent learns from its mistakes within the session.
- Put static content (system prompt, tool schemas) first so it benefits from prompt caching.

## Tool design
- **Few, distinct, well-named tools.** If a human engineer can't tell which tool applies, the model can't either.
- Narrow, task-specific tools with clear input and output schemas are better than broad wrappers like "execute arbitrary SQL".
- Return **meaningful, token-efficient** output (names instead of UUIDs, pagination, truncation with hints).
- Write error messages that tell the agent how to fix the call.
- Standardize integrations with **MCP (Model Context Protocol)**.
- Load tools dynamically or mask them when the catalog is large.

## Evaluation
- Build an **eval set early** from real tasks, and include edge cases and failure cases.
- Combine code-based checks, LLM-as-judge (calibrated against human labels), and human review for ambiguous cases.
- Evaluate **trajectories**, not just final answers: tool choice, number of steps, cost, and latency.
- Test long sessions. Context degradation often hides in short evals. Use recall probes.
- Treat prompts and tools like code: versioned, reviewed, and regression-tested in CI.

## Safety, guardrails & operations
- **Least privilege.** Use permission tiers, sandboxed execution, and scoped credentials.
- **Human-in-the-loop** for irreversible or high-stakes actions (payments, deletions, outbound messages).
- Guard against **prompt injection**. Treat tool output and retrieved content as data, never as instructions.
- **Execution controls:** max iterations, token and cost budgets, timeouts, and loop detection.
- Validate structured outputs against schemas. Retry with the error message fed back to the model.
- Use **checkpoints and resumability** for long-running plans.
- Use observability tools (OpenTelemetry GenAI conventions, LangSmith, MLflow, and similar) to trace every call.
