# Feature map

One row per user-visible feature of the `web/` app. Agents and humans use it to name features
precisely, to plan verification (plan-change skill) and to prove a change works at runtime
(verify-app skill). Every route exists under `/ar/…` and `/en/…`; clean URLs redirect by the
`hl_lang` cookie. Seeded logins come from `pnpm db:seed` (password = `DEMO_PASSWORD`).

Update the row in the same PR when a feature's route, steps or expected proof changes. Never change
"Proof" to match broken behaviour.

| ID | Feature | Role | Route | Steps | Proof |
|---|---|---|---|---|---|
| F01 | Landing page and language toggle | anonymous | `/` | Open `/ar`, then use the header toggle to switch to English and back | Arabic renders RTL, English LTR; the `hl_lang` cookie follows the toggle; logo stays top-right in both |
| F02 | Sign-up, sign-in, sign-out | learner, admin | `/signup`, `/signin` | Sign up a new learner (pick role and branch); sign out; sign in as the seeded admin | Session cookie set; learner lands on `/learn`, admin on `/admin`; learners cannot open `/admin/*`; after sign-out protected pages redirect to sign-in |
| F03 | Upload a document → procedures | admin | `/admin` → `/admin/documents/[id]` | Upload a file from `data/synthetic_sops/dev/` with a learner role; on the GPU machine (`DOCPROC_OCR=ovis`) also a scan (`*-scan-ar.pdf` or `*-scan-en.png`); with docproc's OCR off (`DOCPROC_OCR=null`) upload a scan once more | `pipeline_jobs` reaches done; the document header reads «الرفع رقم 1 من 1» / "Upload 1 of 1" (the app's upload count, never the version printed in the file) and each pipeline step is tagged «الرفع رقم 1» / "Upload 1"; the document page lists procedures grouped by section number with LLM titles naming the concrete situation; a scan without a live OCR engine fails with a raw technical job error (LTR, English, like every pipeline error) naming the pages and `DOCPROC_OCR=ovis` |
| F04 | Generate, review, approve, publish training | admin | `/admin/documents/[id]`, `/admin/review` | Click "توليد التدريب" on a procedure; review items (edit a question, approve/reject the package); publish | Package passes verification (quote check, judge, format rules); publish marks the procedure's previously published items `outdated`; lesson video renders on the GPU machine (owner only) |
| F05 | Learner flow | learner | `/learn` → `/learn/[doc]/[proc]` | Open a published procedure; watch the lesson; do practice; take the exam with a confidence tap | Each format (mcq, timed_decision, spot_the_mistake, order_steps, checklist) renders and accepts an answer; the score and confidence are recorded |
| F06 | Readiness and Arabic text-to-SQL | admin | `/admin/readiness` | Read the readiness table; ask an Arabic question; ask for something outside `readiness_v` | Readiness incl. confident-and-wrong shows; the question gets an answer; the forbidden query is refused (only `hl_readonly` on `readiness_v`) |
| F07 | v2 upload → carry-over | admin | `/admin/documents/[id]` | Upload v2 of a family from `data/synthetic_sops/dev/` | The header reads «الرفع رقم 2 من 2» / "Upload 2 of 2"; unchanged procedures keep their training; changed ones are flagged for regeneration per procedure |

Non-UI stages already have CLI drivers that serve as verification tools: `docproc demo`,
`docproc report`, `hlmedia` (GPU machine, owner only).
