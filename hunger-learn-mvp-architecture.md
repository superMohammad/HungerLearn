# Hunger Learn · MVP Architecture

> **Source:** `hunger-learn-mvp.pdf`, a one-page architecture diagram, converted to structured text.
> **Product in one line:** Hunger Learn turns procedure documents into role-specific training. The system generates training once per document version, humans approve it, learners prove mastery, and supervisors see readiness.

---

## 1. Design Principles

These four principles appear as badges at the top of the diagram and apply to the whole system.

| Tag | Principle | Meaning |
|---|---|---|
| **SIMPLE** | 1 app · 1 database · 1 AI SDK | One Next.js app, one Supabase (Postgres) database, and the Vercel AI SDK for every AI call. |
| **COST** | AI runs per document, not per learner | AI generation happens once per document version. Learners are served content that already exists. |
| **ACCURACY** | Every item cites its clause | Every generated training item links to the exact source clause it came from. |
| **QUALITY** | Nothing published without a human | A trainer or partner manager must approve content before learners see it. |

---

## 2. End-to-End Flow (Overview)

```
[1 Understand the document] → [2 Generate training] → [3 Human approval] → [4 Learn & prove mastery] → [5 Monitor readiness]
                                       ↑                       │
                                       └────── reject ─────────┘

[6 Document changes (v2)] → only the changed clauses go back through stages 2–3
```

| Stage | Name | Who / what runs it | How often |
|---|---|---|---|
| 1 | Understand the document | AI, automatic | Once per document version |
| 2 | Generate training | AI | Once per document version, per role |
| 3 | Human approval | Trainer / partner manager | Per generated item |
| 4 | Learn & prove mastery | Learner | Per learner; uses **only approved content** |
| 5 | Monitor readiness | Trainer / partner manager | Ongoing |
| 6 | Document changes (v2) | AI + human | When a new version of a document is uploaded |

---

## 3. Stage Details

### Stage 1: Understand the document
*AI · automatic · once per version*

Steps run in order:

1. **Upload**
   - Uploaded by a partner manager or a HungerStation (HS) trainer.
   - Accepted formats: PDF, Word, image, scan.
   - Languages: Arabic or English.
2. **Read**
   - PDF / Word files that contain text → parser.
   - Scans and photos → vision LLM.
   - Output: clean text with page numbers.
3. **Extract (structured)**
   - Clauses → procedures → steps.
   - Rules, and who each rule applies to: **courier**, **employee**, or **partner**.
4. **Save clauses** (each clause stores):
   - Text, page, and position.
   - **Hash**, used later to detect changes.
   - **Embedding**, used to match meaning (e.g., to detect moved clauses).

**Tech stack:** `pdf-parse`, `mammoth` (Word), Vision LLM, Vercel AI SDK, Zod schemas, `pgvector`
**Property, ROBUST:** No templates, so it works on documents it has never seen.

---

### Stage 2: Generate training
*AI · once per version · per role*

1. **Build per role**
   - Short lessons and scenarios.
   - Question bank: 5–10 questions per procedure.
   - Each item stores the ID of its source clause.
2. **Verify (anti-hallucination)**, two checks:
   1. The exact quote must exist in the clause.
   2. An LLM judge checks whether the item is supported by the clause.
   - If either check fails, the item is marked ⚠ (flagged) for the human reviewer.
3. **Explainer video**
   - An LLM writes a short script → TTS narration (Arabic voice) → slides + audio → MP4.
   - Made **once per lesson** and reused by every learner.

**Tech stack:** LLM structured output, TTS (ar-SA), Remotion / ffmpeg, Supabase Storage
**Property, COST:** Generate once, serve to everyone.

---

### Stage 3: Human approval
*Trainer / partner manager*

1. **Review queue**
   - Each item is shown next to its source clause.
   - ⚠ flagged items appear first.
   - Actions: **approve**, **edit**, or **reject**. A **reject** sends the item back to Stage 2, "Build per role".
   - The reviewer can watch the explainer video.
2. **Item status** (lifecycle):
   ```
   draft → verified → approved → published → outdated
   ```
   Learners only ever see items with status **published**.
3. **Audit log** records:
   - Who, what, when.
   - Which clause version.

**Tech stack:** Next.js admin pages, Supabase Auth (roles), Row-level security
**Property, QUALITY:** Approval is mandatory and there is an audit trail.

---

### Stage 4: Learn & prove mastery
*Per learner · picks from approved content only*

1. **Learner profile:** role, device, language.
2. **Compose the screen**
   - Rules pick a UI component → output as a JSON spec.
   - The spec is validated with Zod; if invalid, a safe default is used.
   - **No new content is written here.** The screen only arranges already-approved content.
3. **Role-specific formats:**

   | Role | Device | Format |
   |---|---|---|
   | Courier | Phone | Video + 1 question |
   | Employee | Laptop | Scenario question |
   | Partner | Tablet | Checklist |

4. **Mastery check**
   - Graded against the approved answer key.
   - **Mastered** → badge and level up.
   - **Not yet** → retry in another format (loops back to "Compose the screen").

**Tech stack:** Next.js + Tailwind, shadcn/ui (RTL), Zod, mastery table
**Property, EVAL:** Mastery means answering correctly on realistic situations.

---

### Stage 5: Monitor readiness
*Trainer · partner manager*

1. **Readiness dashboard**
   - Filter by person, role, branch.
   - % mastered per procedure.
   - Who needs retraining.
2. **Ask in plain Arabic**
   - Example question: «من لم يتقن إجراء التخزين الجديد؟» ("Who hasn't mastered the new storage procedure?")
   - LLM → SQL on **read-only** views → answer + list of names.
3. **Levels & badges**
   - Levels: Beginner → Certified → Expert.
   - One badge per mastered procedure.
   - Branch readiness %.

**Tech stack:** Postgres SQL views, LLM text-to-SQL (read-only)
**Property, ROBUST:** Read-only, so the AI cannot change data.

---

### Stage 6: When a document changes (v2), only what changed is redone

```
v2 uploaded → Compare clauses ─┬─ unchanged ─────────────→ Keep (zero AI cost)
                               └─ changed / new / removed → Regenerate → verify → re-approve → Notify affected learners
```

1. **v2 uploaded:** same document, new version.
2. **Compare clauses:**
   - Hash identical? → the clause is unchanged.
   - Embedding matches a clause at a different position? → the clause was moved.
3. **Unchanged → keep:** zero AI cost.
4. **Changed · new · removed:** regenerate → verify → re-approve (stages 2–3 again, for these clauses only).
5. **Notify affected learners:** a "what changed" lesson, and their badges are re-checked.

---

## 4. Tech Stack (MVP)

Four layers, each communicating with the next (bidirectional):

```
Any browser  ⇄  Next.js (App Router)  ⇄  Supabase  ⇄  AI via Vercel AI SDK
```

| Layer | Details |
|---|---|
| **Any browser** | Phone, tablet, desktop |
| **Next.js (App Router)** | Hosted on Vercel · Tailwind · shadcn/ui · Arabic-first RTL |
| **Supabase** | Postgres + pgvector · Auth · Storage · RLS (row-level security) · Edge Functions |
| **AI via Vercel AI SDK** | LLM · Vision · Embeddings · TTS. Every call is logged (cost, prompt version). |

---

## 5. Evaluate Before the Demo
*Tag: EVAL, numbers for the judges*

```
Golden test set → Run pipeline → Metrics
```

1. **Golden test set:** 15 synthetic documents (Arabic + English, including scans) with hand-checked answers.
2. **Run pipeline:** uses the same code as the app.
3. **Metrics:**

| Metric | Definition / target |
|---|---|
| Extraction recall | Rules found ÷ rules that exist |
| Citation accuracy | Share of items that match their cited clause |
| Hallucinations | Target: **0 published** |
| Cost per document | $ and tokens |
| Time per document | From upload to ready-to-approve |

---

## 6. Glossary

- **Clause:** a unit of text extracted from the source document; the atomic source of truth that every training item cites.
- **Procedure:** a group of steps extracted from clauses (e.g., "new storage procedure").
- **Role:** the learner type a rule applies to: courier, employee, or partner.
- **Item:** a generated training unit (lesson, scenario, or question).
- **HS:** HungerStation.
- **RLS:** Row-level security (Postgres/Supabase access control per row).
- **TTS:** Text-to-speech; `ar-SA` = Saudi Arabic voice.
- **Hash:** fingerprint of a clause's text; a different hash means the text changed.
- **Embedding:** vector representation of a clause's meaning, stored in pgvector; used to find moved or similar clauses.
- **Zod:** TypeScript schema validation library, used to validate LLM outputs and UI specs.
