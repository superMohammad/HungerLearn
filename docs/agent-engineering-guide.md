# HungerLearn agent engineering guide

Use this guide when implementing or reviewing HungerLearn’s document processing, AI generation, assessment, or SOP-update workflow. The [dataset README](data/synthetic_sops/README.md) and checked-in source documents define fixture behavior. Confirm the active application repository and its conventions before changing code. This workspace includes data and standalone demos. The production design below is a build guide, and its proposed nodes and interfaces still need implementation and evaluation.

Source review: Maarten Grootendorst and Jay Alammar, *An Illustrated Guide to AI Agents*. Reviewed the publisher’s public chapter previews and all ten official TinyAgent chapter notebooks, with six additional notebooks on context, retrieval, tools, and planning. The publisher’s complete prose requires access. The design decisions here are HungerLearn-specific applications of those concepts. [Publisher contents](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/) · [Official companion repository](https://github.com/HandsOnLLM/An-Illustrated-Guide-To-AI-Agents)

## Product requirements

- Turn Arabic and English SOPs into short, cited lessons, scenarios, and assessments for couriers, company employees, and restaurant or store partners. Respect role, organization, branch, language, and access scope from the application and the SOP.
- Show the trainer each claim beside its exact document-version quote and locator. Trainers can approve, edit and revalidate, or reject drafts. Learners receive published content. Support Arabic RTL and keep the original source visible when training is translated.
- Score practice against approved answer keys. Route wrong answers to practice for the rules they violate. Readiness reports show progress by person, role, branch, and procedure, including pending reassessment.
- When a new SOP version arrives, identify changed rules, update the dependent training, and assign reassessment only where applicable. Retain the history of approvals, assignments, and attempts.
- Keep approved training available during authoring, model outages, and revision review. Prioritize reproducible results, low cost per processed document, and a provider configuration that can move from a competition setup to company-managed hosting.

## Reading map and what to implement

| Chapter | Idea to carry forward | HungerLearn application |
| --- | --- | --- |
| [1 · Agents](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch01.html) | A model can observe and act through a harness that supplies context, tools, and control. | Specify the interfaces and the state transitions first. A typed extraction or verification node may be a function with one model call. |
| [2 · LLMs](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch02.html) | Separate the model interface from inference engines and keep an execution trajectory. | Normalize model outputs and usage across local and hosted providers. Record structured run events. Evaluate Arabic fidelity, validated output rate, cost, and latency on actual tasks. |
| [3 · Reasoning](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch03.html) | Extra inference and multiple candidates can help when there is a verifier. | Use ordinary structured generation first. Try stronger reasoning on ambiguous rules only when a gold-set comparison justifies the overhead. Require cited evidence and verification for the selected result. |
| [4 · Memory](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch04.html) | Context, retrieval, and trajectory serve different purposes. Trimming and summaries can control context size. | Keep task state, authoritative SOP records, learner records, and run logs distinct. Retrieve specific scoped clauses. Preserve exact rules and quotes outside any summary. |
| [5 · Tools](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch05.html) | Tool use has a schema, selection, execution, and a result. MCP standardizes external tools. Skills load instructions on demand. | Use typed tools with server-side permission checks and explicit error outcomes. Add MCP for a concrete integration. Keep reviewer instructions available to coding agents in this file. |
| [6 · Planning and reflection](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch06.html) | Decompose work, inspect results, and revise with feedback. A loop needs stop conditions. | Use explicit graph edges and bounded correction. Give regeneration the failed checks and source evidence. Escalate uncertainty to trainers and record why processing stopped. |
| [7 · Evaluation](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch07.html) | Evaluate outcomes, intermediate steps, and repeated-run reliability. Combine exact, programmatic, and rubric checks. | Score OCR, retrieval, grounding, review, and routing individually. Run the same path end to end. Keep gold labels out of model input and record failures by stage. |
| [8 · Multi-agent systems](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch08.html) | An orchestrator can call specialists through narrow interfaces. Coordination adds overhead. | Start with one graph and typed nodes. Introduce a subgraph when it needs a distinct lifecycle, independently measured performance, or separate permissions. |
| [9 · Multimodal understanding](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch09.html) | Image inputs let a model reason over content that a text prompt cannot represent directly. | Send image-only pages to OCR. Preserve the page image and the location of its extracted text. Test Arabic tables and mixed numeral scripts with the scan fixtures. |
| [10 · Coding agents](https://www.oreilly.com/library/view/an-illustrated-guide/9798341662681/ch10.html) | File and execution tools create useful feedback loops and need deliberate permission boundaries. | Give coding tools a small task spec, relevant fixtures, and acceptance tests. Keep runtime content tools scoped to the training app and publication behind human approval. |

Read Chapters **4, 5, 6, 7, and 9** first for the MVP. Chapter 2 helps when integrating providers, Chapter 3 when testing stronger reasoning, and Chapter 8 when an actual workflow warrants specialization. Follow the official companion notebooks for code exercises. The examples illustrate the concepts and can inform implementation choices.

## Proposed architecture and authority

Use the planned **Next.js UI, Python document service, LangGraph, and Postgres with pgvector** where compatible with the active codebase. Evaluate **BGE-M3** for bilingual retrieval and the **configured OvisOCR checkpoint** for scanned pages. Make the generation, embedding, and OCR providers configurable. Pin model and prompt versions when reporting a result. Compare local and hosted configurations with the same evaluation. Model references: [BGE-M3](https://huggingface.co/BAAI/bge-m3) · [OvisOCR model family example](https://huggingface.co/ATH-MaaS/OvisOCR) · [pgvector](https://github.com/pgvector/pgvector).

| Data | Purpose and authority |
| --- | --- |
| Source uploads and parsed blocks | Immutable source bytes plus page, section, table row, or other verified locator. Preserve source quotes and raw OCR. Record parser and OCR versions. |
| SOP revisions, stable rules, clause occurrences | Postgres records the document family, version, scope, active revision, and unique occurrence of a rule in a particular source. References from draft and published items point to occurrences. |
| Review, publishing, assessment, and mastery | Postgres is authoritative for review decisions, publication, approved keys, attempts, assignments, and audit history. Use application permissions for writes and visibility. |
| Retrieval index | Rebuildable projection for finding candidate clauses. Apply source scope and requested revision when selecting candidates. Reload cited evidence by ID from the source records. |
| Graph checkpoints and execution events | Checkpoints store what a particular run needs to resume. Execution events record nodes, attempts, outcome, elapsed time, model version, token usage when available, and evidence IDs. Keep private prompts or reasoning traces out of routine telemetry. |

The product knows the stages in advance. Use LangGraph for branching, retries, and resuming a paused job. Narrow model calls can extract facts, draft scenarios, flag ambiguity, and suggest matches. Application logic resolves permissions and source scope, applies rubric and version rules, and performs publication or reassignment.

### Ingestion and retrieval

1. Authorize an upload and store the original with a content hash. Parse selectable PDF, DOCX and UTF-8 TXT using format-aware extraction. Send image-only PDF pages and PNGs to OCR. Keep page or section boundaries and table relationships. Capture confidence or review flags where available. A failed or unreadable page remains visible to the trainer and can be retried.
2. Extract source-backed rule occurrences with structured output. Preserve exact quotes and locators. Store normalized trigger, action, actor, threshold comparator, value, unit, timer origin, prohibition, exception, and step order wherever the source specifies them. Use null or a review flag for missing or ambiguous information.
3. Index clauses with their scope and occurrence IDs. Begin with BGE-M3 dense retrieval and scoped exact-code or lexical matching if it helps. Add fusion or reranking only when measured against the labeled queries. Record the embedding version and normalize search text separately from display text. Use original script and digits for quotations.
4. Derive authorization and the current eligible revision from the application. Apply role, organization, branch applicability, family and version constraints as appropriate to the task. Handle explicitly historical requests with a version filter and permissions. If approved evidence is missing, surface that state or send it for review.

Use IDs as pointers to verified text. A translation, OCR cleanup for search, or a generated summary can support discovery, while citations display the original checked quote. Match printed digits exactly in a quote and compare normalized numeric values separately. For a scanned Arabic table, verify logical order and the connection between a condition and its action.

### Draft, verify, review, publish

Upload → parse or OCR → extract and verify → index scoped clauses → draft artifacts → validate → trainer review → publish approved revision and assignments.

- Build typed draft output with artifact type, audience, locale, cited occurrence IDs, individual claims, and an approved-key candidate for assessment items. Capture the exact violated rules for each distractor so the application can route remedial practice. Bind the source revision and draft revision to the review record.
- Validate the actual quote at the actual locator, scope, source revision, required output shape, and material rule values. Assess whether each answer or instruction follows from its evidence. Include boundaries such as greater than versus greater than or equal, prohibitions, dispatch authority, and ambiguous alternatives. A schema-valid response still needs evidence checks.
- For a repairable draft, pass failed checks and source excerpts into a bounded regeneration. Once its budget is exhausted or evidence is ambiguous, route the flagged draft to a trainer. A judge model can flag weak explanations or plausibility. Deterministic violations block publication regardless of the judge result.
- Pause review on persisted state and resume with the authenticated reviewer’s action. Revalidate edits and check that the decision applies to the current draft and expected source revision. Keep the act of approval separate from the transaction that publishes training. Show the review state in the UI.
- Make persistence safe across duplicate uploads, worker restarts, and repeated resumes. Use stable run IDs, operation-specific idempotency keys, and transactional upserts. An interrupt node may run again from its start. Place writes after approval or in separately replay-safe work. Guard the active-version transition against a concurrent publication.

Reference APIs: [LangGraph workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents) · [Persistence and checkpoints](https://docs.langchain.com/oss/python/langgraph/persistence) · [Interrupts and replay rules](https://docs.langchain.com/oss/python/langgraph/interrupts). Verify the actual dependency versions in the implementation repo.

### SOP update and targeted reassessment

1. Ingest the incoming version as a draft. Within the same family and applicable scope, match identical normalized text using hashes, locations and document structure. Use lexical and embedding similarity to propose matches for edits or moves. Confirm against structured rule facts, and send weak or conflicting matches for trainer review. Never rely on a similarity score as evidence that a rule is unchanged.
2. Compare material fields and classify cases. An unchanged or moved rule can retain training with a fresh current-version reference. A wording-only update can refresh text or citations. A material change to a threshold, comparator, timer origin, actor, action, condition, exception, prohibition, required modality, or order invalidates the affected draft content. Added rules need initial review. Removed rules retire dependent content under the app’s update policy.
3. Follow artifact-to-occurrence dependencies across lessons, quiz items, case feedback, and any relevant translations or media. For an artifact with several sources, inspect every dependency before carrying it forward. Route affected material through the same checks and approval as new training. Keep before-and-after evidence and preserve previous attempts against their original version.
4. At the approved cutover, activate current items and update the applicable assignments in a replay-safe transaction or durable follow-up. For already-mastered learners assigned to the replaced SOP, reassess affected rules only. In-progress learners receive the updated assignment. Keep out-of-scope or unassigned learners’ existing progress. Match the corpus rules for each routing category and surface update status to supervisors.

Concrete check: the courier fixture’s **CW-02** threshold changes from printed Arabic-Indic **١٥** in v1 to printed **10** in v2. At 10 minutes the updated rule applies. Show why A-C1 needs reapproval and what remains valid for the same learner. Use [version diffs](data/synthetic_sops/dev/gold/version_diffs.json), [learners](data/synthetic_sops/dev/gold/learners.json), and [assessments](data/synthetic_sops/dev/gold/assessments.json) as expected outputs. Gold IDs are evaluation labels. Assign production identities from source occurrences and match them in the scorer.

## Evaluation and regression checks

Run the product path from upload to visible training. Test each boundary directly as well. Keep configuration and data split fixed while comparing model, prompt, parser, embedding, or quantization variants. Make separate runs where nondeterministic outputs could affect a conclusion.

| Stage | Fixture and acceptance signal |
| --- | --- |
| Parsing and OCR | [Dev transcriptions](data/synthetic_sops/dev/gold/transcriptions). Score character or word error plus exact digits, page coverage, and Arabic table reading order. Review critical values even if the aggregate score is high. |
| Extraction | [Dev extraction gold](data/synthetic_sops/dev/gold/extraction.json). Score procedure and occurrence matching, quote fidelity, locator accuracy, and typed fact correctness. Explicitly score actor, comparator, timer origin, negation, and exceptions. |
| Retrieval | [Dev retrieval gold](data/synthetic_sops/dev/gold/retrieval.json). Record Recall@k and first-correct rank. Break out Arabic, English, cross-language, and wrong-scope or stale-version matches. Deduplicate scan copies by canonical source occurrence when scoring. |
| Generation and publication | [Publication gates](data/synthetic_sops/dev/gold/publication_gates.json) and [flagged draft](data/synthetic_sops/dev/gold/flagged_draft.json). Assert expected accept or block results, including unsupported refund claims, wrong or exclusive thresholds, stale source citations, and digit fidelity. Human-review scenario realism and Arabic quality. |
| Change and learner routing | [Change pairs](data/synthetic_sops/dev/gold/change_pairs.json), [diff gold](data/synthetic_sops/dev/gold/version_diffs.json) and [learner gold](data/synthetic_sops/dev/gold/learners.json). Check materiality, match confidence, affected artifact and learner sets, preserved progress, and before-and-after evidence. |
| Assessment and reliability | [Assessment gold](data/synthetic_sops/dev/gold/assessments.json). Verify approved answers, targeted remediation, no role leakage, and no duplicate publication or assignment after interrupted or repeated work. Score only the behavior the system actually exercised. |

- Use deterministic checks wherever gold defines correctness. Use an independently reviewed rubric for qualitative scoring. Calibrate any model judge against bilingual human examples and adjudicate disagreements. Record outcome quality and trajectory correctness, including source versions actually retrieved and whether the graph bypassed any required state.
- Develop against **12 dev uploads** and their gold data. Freeze configuration before evaluating the **three held-out document families** on a fresh index built from their uploads. Held-out labels belong in the scorer. Reserve the held-out employee complaint-escalation PDF for the live judge upload.
- The fixture validator can be run from the workspace root with `python data/synthetic_sops/validate.py` once dependencies in the README are available. Its result measures corpus consistency. Run the actual OCR, retrieval, and integrated application for model or end-to-end scores. Use the [dataset README](data/synthetic_sops/README.md) for the current baseline status.
- Report per-stage latency, model usage, retries, publication-block reasons, and cost per document alongside quality. Cache parse, OCR, and embeddings by source content and component version where safe. Scope content reuse correctly between organizations. Run expensive authoring asynchronously, serve published training separately, and keep approved results readable while provider calls fail.

## Build order for AI coding tools

1. Confirm the active app and trace its upload and learner entry points. Reuse existing contracts and keep the frozen dataset untouched during implementation. Use synthetic content for hosted provider tests until the deployment’s data-handling setup is agreed.
2. Ship a vertical slice with one dev text SOP: ingest → locate a real clause → draft one scenario and question → validate → approve → publish → answer → show a supervisor result. Include one expected rejection.
3. Add scope isolation, bilingual checks, and OCR through the same paths. Add the courier v1-to-v2 flow with expected reassignment and persisted review.
4. Run dev regressions, restart and replay checks, then freeze and evaluate. Compare provider configurations against the same tests before changing model or deployment defaults. Add separate agents, broader tool integrations, or generated media if a product use case and measured benefit justify them.

For a coding session, start with this brief: “Read `AGENTS.md` and `data/synthetic_sops/README.md`. Inspect the current implementation and relevant dev fixtures. Implement the requested HungerLearn feature through its normal entry point, preserve source citations and approval boundaries, and report what actually passed.”
