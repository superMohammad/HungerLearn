import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "@/lib/ai";
import { serverEnv } from "@/lib/env";
import { checkQuestionShape, repeatedExamFormats } from "@/lib/question-rules";
import { groupBySection } from "@/lib/procedures";
import { quoteInClause } from "@/lib/text";
import type {
  Clause,
  HlDocument,
  LessonPayload,
  PackageFlag,
  PackageStatus,
  Procedure,
  QuestionPayload,
  ResourceRequest,
} from "@/lib/types";
import { QUESTION_FORMATS } from "@/lib/types";

const PROMPT_VERSION = "training-generator-v3";

// ---------------------------------------------------------------- system prompt (single source of truth)

let generatorPrompt: Promise<string> | null = null;

/** The "SYSTEM PROMPT" section onward of hunger-learn-training-generator-prompt.md, read once per process. */
function loadGeneratorPrompt(): Promise<string> {
  if (generatorPrompt === null) {
    const file = serverEnv().trainingPromptPath;
    generatorPrompt = readFile(file, "utf8").then((text) => {
      const start = text.indexOf("## SYSTEM PROMPT");
      if (start < 0) throw new Error(`"## SYSTEM PROMPT" not found in ${file}`);
      return text.slice(start);
    });
  }
  return generatorPrompt;
}

function languageName(doc: HlDocument): string {
  return doc.language === "ar" ? "Arabic" : "English";
}

/** Short refs the model copies reliably ("C1", "C2", ...) mapped to docproc stable ids. */
function clauseRefs(clauses: Clause[]): { refs: Map<string, Clause>; refOf: Map<string, string> } {
  const refs = new Map(clauses.map((c, i) => [`C${i + 1}`, c]));
  return { refs, refOf: new Map([...refs].map(([ref, c]) => [c.stableId, ref])) };
}

// ---------------------------------------------------------------- stage 1.5: clauses → procedures → steps

const NamingSchema = z.object({
  procedures: z.array(z.object({ procedure_id: z.string(), title: z.string(), steps: z.array(z.string()) })),
});
export type ProcedureDraft = { title: string; steps: string[]; stableIds: string[] };

const NAMING_ATTEMPTS = 3;
const CLAUSE_ID_IN_TEXT = /\bC\d+\b|\bP\d+\b/;

/**
 * Extract (structured): clauses are grouped into procedures by the document's own section numbers
 * (procedures.ts, deterministic); the LLM only writes each procedure's short title and steps.
 */
export async function groupProcedures(doc: HlDocument, versionId: string, clauses: Clause[]): Promise<ProcedureDraft[]> {
  return nameGroups(doc, versionId, groupBySection(clauses));
}

/**
 * Names one procedure whose clauses are already known (a changed procedure on a new version), with the same
 * prompt, checks and attempts as groupProcedures. The prompt still asks for a title; a caller that keeps the
 * procedure's existing title (the v2 steps refresh) ignores it.
 */
export async function nameProcedure(doc: HlDocument, versionId: string, clauses: Clause[]): Promise<{ title: string; steps: string[] }> {
  const [named] = await nameGroups(doc, versionId, [clauses]);
  return { title: named.title, steps: named.steps };
}

/** The LLM writes a title and steps for each group of clauses; invalid answers are retried. */
async function nameGroups(doc: HlDocument, versionId: string, groups: Clause[][]): Promise<ProcedureDraft[]> {
  const input = groups.map((g, i) => ({ procedure_id: `P${i + 1}`, clauses: g.map((c) => c.quote) }));
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= NAMING_ATTEMPTS; attempt += 1) {
    const out = await generateStructured({
      purpose: "understand.name_procedures",
      promptVersion: PROMPT_VERSION,
      scope: { documentId: doc.documentId, versionId },
      schema: NamingSchema,
      system: `Each item is one procedure of a work document with its clause texts. For EVERY procedure_id return:
- title: 2 to 5 words in ${languageName(doc)} naming the concrete situation, no numbers. Arabic titles read like a
  professional Saudi operations manual written natively in Arabic (for example "تأخر تجهيز الطلب"، "تسليم المشروبات مغلقة"):
  never a word-by-word translation, never a vague label like "الإجراء المناسب".
- steps: 1 to 4 short imperative steps (max 10 words each) in ${languageName(doc)}, using only what the clauses say.
Never write ids like P3 or C3 in titles or steps.`,
      prompt: JSON.stringify({ document_title: doc.title, procedures: input, previous_attempt_error: lastError instanceof Error ? lastError.message : null }),
    });
    try {
      const byId = new Map(out.procedures.map((p) => [p.procedure_id, p]));
      return groups.map((g, i) => {
        const named = byId.get(`P${i + 1}`);
        if (named === undefined) throw new Error(`no title for P${i + 1}`);
        const leaked = [named.title, ...named.steps].find((t) => CLAUSE_ID_IN_TEXT.test(t));
        if (leaked !== undefined) throw new Error(`id written into learner text: "${leaked}"`);
        if (named.title.trim() === "" || named.steps.length === 0) throw new Error(`empty title or steps for P${i + 1}`);
        return { title: named.title.trim(), steps: named.steps.slice(0, 4), stableIds: g.map((c) => c.stableId) };
      });
    } catch (error) {
      lastError = error;
      console.warn("procedure naming invalid, retrying", { documentId: doc.documentId, attempt, error: String(error) });
    }
  }
  throw new Error(`Could not name the procedures of ${doc.documentId} after ${NAMING_ATTEMPTS} attempts`, { cause: lastError });
}

// ---------------------------------------------------------------- stage 2: training package

// The generator's output contract (section 7 of the prompt). Every field is present; fields that do not apply
// to a question format are null or [] so the JSON schema stays strict for structured output.
const GenOption = z.object({ text: z.string(), correct: z.boolean(), misconception: z.string().nullable() });
const GenQuestion = z.object({
  id: z.string(),
  format: z.enum(QUESTION_FORMATS),
  prompt: z.string(),
  scene: z.string().nullable(),
  time_limit_seconds: z.number().nullable(),
  options: z.array(GenOption),
  correct_order: z.array(z.string()),
  feedback: z.string(),
  clause_id: z.string(),
  quote: z.string(),
  confidence_tap: z.boolean(),
});
const GenShot = z.object({
  seconds: z.number(),
  visual: z.string(),
  on_screen_text: z.string(),
  narration: z.string().nullable(),
  source: z.string(),
  must_show: z.array(z.string()),
  must_not_show: z.array(z.string()),
  clause_id: z.string(),
  quote: z.string(),
});
const GeneratorOutputSchema = z.object({
  procedure_id: z.string(),
  role: z.string(),
  language: z.string(),
  status: z.enum(["ok", "needs_human", "skipped"]),
  skip_reason: z.string().nullable(),
  lesson: z.object({ title: z.string(), key_points: z.array(z.object({ text: z.string(), clause_id: z.string(), quote: z.string() })) }).nullable(),
  video: z.object({ total_seconds: z.number(), structure: z.enum(["do_dont", "steps"]), shots: z.array(GenShot) }).nullable(),
  practice: z.array(GenQuestion),
  exam: z.array(GenQuestion),
  flags: z.array(z.object({ type: z.string(), clause_id: z.string(), note: z.string() })),
  resource_requests: z.array(z.object({ need: z.string(), why: z.string(), fallback_used: z.string(), priority: z.string() })),
  ideas: z.array(z.string()),
});
type GeneratorOutput = z.infer<typeof GeneratorOutputSchema>;
type GenQuestionT = z.infer<typeof GenQuestion>;

/** What this deployment can actually do (section 6 of the prompt). There is no clip generator. */
function availableResources(doc: HlDocument): string[] {
  const tts = doc.language === "ar" ? ["tts_ar_najdi"] : [];
  return ["text_llm", ...tts, "overlays", "slides_video_assembly", "clip_library"];
}

const LibrarySchema = z.object({
  clips: z.array(z.object({ clip_id: z.string(), file: z.string(), orientation: z.string(), seconds: z.number(), tags: z.array(z.string()) })),
});
export type LibraryClip = { clip_id: string; tags: string[]; seconds: number; file: string };

/**
 * The role's clip library (media/clips/library.json). Clips are offered as soon as they are planned;
 * a lesson whose clip file is not there yet fails to render with the missing file names, and is
 * re-rendered once the human-made clip is dropped in (see media/clips/CLIP-REQUESTS.md).
 */
export async function loadClipLibrary(role: string): Promise<LibraryClip[]> {
  const dir = path.join(serverEnv().mediaDir, "clips");
  const library = LibrarySchema.parse(JSON.parse(await readFile(path.join(dir, "library.json"), "utf8")));
  return library.clips
    .filter((c) => c.tags.includes(role))
    .map((c) => ({ clip_id: c.clip_id, tags: c.tags, seconds: c.seconds, file: path.join(dir, c.file) }));
}

async function draftPackage(doc: HlDocument, procedure: Procedure, clauses: Clause[], library: LibraryClip[], reviewerFeedback: string): Promise<GeneratorOutput> {
  const { refOf } = clauseRefs(clauses);
  const input = {
    procedure: { id: procedure.procedureKey, title: procedure.title, steps: procedure.steps },
    clauses: clauses.map((c) => ({ clause_id: refOf.get(c.stableId), text: c.quote, page: c.page ?? 0, applies_to: [doc.role] })),
    role: doc.role,
    partner_type: doc.partnerType,
    language: doc.language,
    available_resources: availableResources(doc),
    clip_library: library.map((c) => ({ clip_id: c.clip_id, tags: c.tags, seconds: c.seconds })),
  };
  const notes = [
    "Deployment notes: include every field of the schema. When a field does not apply to a question format,",
    "use null (scene, time_limit_seconds) or [] (options, correct_order).",
    "There is no clip generator. Use a library clip whose tags match (source \"library:<clip_id>\"); otherwise source \"slide\".",
    doc.language === "en" ? "There is no English TTS: set every shot's narration to null." : "Narration is spoken by a Saudi Najdi voice.",
    reviewerFeedback === "" ? "" : `A human reviewer rejected the previous package: "${reviewerFeedback}". Fix that.`,
  ].filter((l) => l !== "").join("\n");
  return generateStructured({
    purpose: "generate.package",
    promptVersion: PROMPT_VERSION,
    scope: { documentId: procedure.documentId, versionId: procedure.versionId },
    schema: GeneratorOutputSchema,
    system: await loadGeneratorPrompt(),
    prompt: `${JSON.stringify(input)}\n\n${notes}`,
  });
}

// ---------------------------------------------------------------- verification (anti-hallucination)

const JudgeSchema = z.object({ supported: z.boolean(), reason: z.string() });

async function judge(doc: HlDocument, versionId: string, claim: string, sourceText: string): Promise<z.infer<typeof JudgeSchema>> {
  return generateStructured({
    purpose: "verify.judge",
    promptVersion: PROMPT_VERSION,
    scope: { documentId: doc.documentId, versionId },
    schema: JudgeSchema,
    system: `You are a strict fact checker for training content. Check only the RULES the item teaches: actions,
conditions, numbers, times, and who must act. supported=false only if the item adds a rule, number or condition
that the source clauses do not state, changes one, or contradicts one.
These are NOT problems: covering only part of a clause; training mechanics (timers, ordering or ticking exercises, confidence taps); on-screen text and narration existing; a line marked
❌ that describes the WRONG behaviour on purpose. Give a one-sentence reason in ${languageName(doc)}.`,
    prompt: JSON.stringify({ source_clauses: sourceText, training_item: claim }),
  });
}

export type ResolvedItem = {
  kind: "lesson" | "practice" | "exam";
  ordinal: number;
  stableId: string;
  quote: string;
  payload: LessonPayload | QuestionPayload;
  flags: string[];
  judgeReason: string;
};

function resolveQuestion(q: GenQuestionT, refs: ReadonlyMap<string, Clause>): { payload: QuestionPayload; flags: string[]; clause: Clause | undefined } {
  const clause = refs.get(q.clause_id);
  const flags: string[] = [];
  if (clause === undefined) flags.push("unknown_clause_ref");
  else if (!quoteInClause(q.quote, clause.quote)) flags.push("quote_not_found");
  const payload: QuestionPayload = {
    format: q.format,
    prompt: q.prompt,
    scene: q.scene,
    time_limit_seconds: q.time_limit_seconds === null ? null : Math.min(60, Math.max(5, Math.round(q.time_limit_seconds))),
    options: q.options,
    correct_order: q.correct_order,
    feedback: q.feedback,
    confidence_tap: true,
  };
  return { payload, flags: [...new Set([...flags, ...checkQuestionShape(payload)])], clause };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "" && !/^[✅❌✓✗✔✖]$/u.test(w)).length;
}

async function verifyLesson(doc: HlDocument, versionId: string, out: GeneratorOutput, clauses: Clause[], refs: ReadonlyMap<string, Clause>, library: LibraryClip[]): Promise<ResolvedItem | null> {
  if (out.lesson === null) return null;
  const flags = new Set<string>();
  const cite = (ref: string, quote: string): string => {
    const clause = refs.get(ref);
    if (clause === undefined) {
      flags.add("unknown_clause_ref");
      return "unknown";
    }
    if (!quoteInClause(quote, clause.quote)) flags.add("quote_not_found");
    return clause.stableId;
  };
  const clipOf = (source: string): string | null => {
    if (!source.startsWith("library:")) return null;
    const id = source.slice("library:".length);
    if (!library.some((c) => c.clip_id === id)) {
      flags.add("unknown_clip");
      return null;
    }
    return id;
  };
  const keyPoints = out.lesson.key_points.map((k) => ({ text: k.text, stable_id: cite(k.clause_id, k.quote), quote: k.quote }));
  const shots = (out.video?.shots ?? []).map((s) => ({
    seconds: Math.min(8, Math.max(2, s.seconds)),
    visual: s.visual,
    on_screen_text: s.on_screen_text,
    narration: doc.language === "ar" ? s.narration : null,
    source: s.source,
    clip_id: clipOf(s.source),
    must_show: s.must_show,
    must_not_show: s.must_not_show,
    stable_id: cite(s.clause_id, s.quote),
    quote: s.quote,
  }));
  if (shots.some((s) => wordCount(s.on_screen_text) > 8)) flags.add("on_screen_text_too_long");
  if (shots.length > 0 && (shots.length < 2 || shots.length > 4)) flags.add("video_shot_count");
  if (shots.length === 0) flags.add("no_video");
  const verdict = await judge(
    doc,
    versionId,
    JSON.stringify({ key_points: keyPoints.map((k) => k.text), on_screen_text: shots.map((s) => s.on_screen_text), narration: shots.map((s) => s.narration) }),
    clauses.map((c) => c.quote).join("\n"),
  );
  if (!verdict.supported) flags.add("judge_unsupported");
  const first = keyPoints.find((k) => k.stable_id !== "unknown");
  return {
    kind: "lesson",
    ordinal: 0,
    stableId: first?.stable_id ?? clauses[0].stableId,
    quote: first?.quote ?? clauses[0].quote,
    payload: {
      title: out.lesson.title,
      key_points: keyPoints,
      video: out.video === null || shots.length === 0 ? null : { total_seconds: out.video.total_seconds, structure: out.video.structure, shots: shots.slice(0, 4) },
    },
    flags: [...flags],
    judgeReason: verdict.reason,
  };
}

async function verifyPackage(doc: HlDocument, versionId: string, out: GeneratorOutput, clauses: Clause[], library: LibraryClip[]): Promise<ResolvedItem[]> {
  const { refs } = clauseRefs(clauses);
  const lesson = await verifyLesson(doc, versionId, out, clauses, refs, library);
  const items: ResolvedItem[] = lesson === null ? [] : [lesson];
  const repeated = repeatedExamFormats(out.practice.map((q) => q.format), out.exam.map((q) => q.format));
  const groups: ["practice" | "exam", GenQuestionT[]][] = [["practice", out.practice], ["exam", out.exam]];
  for (const [kind, questions] of groups) {
    for (const [i, q] of questions.entries()) {
      const { payload, flags, clause } = resolveQuestion(q, refs);
      if (kind === "exam" && repeated.includes(q.format)) flags.push("exam_format_repeats_practice");
      const correct = payload.options.filter((o) => o.correct).map((o) => o.text);
      const verdict = await judge(
        doc,
        versionId,
        JSON.stringify({ question: payload.prompt, scene: payload.scene, correct: correct.length > 0 ? correct : payload.correct_order, feedback: payload.feedback }),
        clause?.quote ?? clauses.map((c) => c.quote).join("\n"),
      );
      if (!verdict.supported) flags.push("judge_unsupported");
      items.push({ kind, ordinal: i, stableId: clause?.stableId ?? clauses[0].stableId, quote: q.quote, payload, flags, judgeReason: verdict.reason });
    }
  }
  return items;
}

export type GeneratedPackage = {
  status: PackageStatus;
  skipReason: string | null;
  flags: PackageFlag[];
  resourceRequests: ResourceRequest[];
  ideas: string[];
  items: ResolvedItem[];
};

/** Builds and verifies one training package for a procedure (courier, employee or partner). */
export async function buildPackage(doc: HlDocument, procedure: Procedure, clauses: Clause[], reviewerFeedback: string): Promise<GeneratedPackage> {
  const procClauses = clauses.filter((c) => procedure.stableIds.includes(c.stableId));
  if (procClauses.length === 0) throw new Error(`Procedure ${procedure.procedureKey} has no clauses in ${doc.documentId} ${procedure.versionId}`);
  const library = await loadClipLibrary(doc.role);
  const out = await draftPackage(doc, procedure, procClauses, library, reviewerFeedback);
  return {
    status: out.status,
    skipReason: out.skip_reason,
    flags: out.flags,
    resourceRequests: out.resource_requests,
    ideas: out.ideas.slice(0, 2),
    items: out.status === "skipped" ? [] : await verifyPackage(doc, procedure.versionId, out, procClauses, library),
  };
}

/** Re-runs the gate on a human-edited question: quote check, shape rules, and the judge. */
export async function verifyEditedQuestion(doc: HlDocument, versionId: string, payload: QuestionPayload, quote: string, clause: Clause): Promise<{ flags: string[]; judgeReason: string }> {
  const flags = [...checkQuestionShape(payload)];
  if (!quoteInClause(quote, clause.quote)) flags.push("quote_not_found");
  const correct = payload.options.filter((o) => o.correct).map((o) => o.text);
  const verdict = await judge(
    doc,
    versionId,
    JSON.stringify({ question: payload.prompt, scene: payload.scene, correct: correct.length > 0 ? correct : payload.correct_order, feedback: payload.feedback }),
    clause.quote,
  );
  if (!verdict.supported) flags.push("judge_unsupported");
  return { flags, judgeReason: verdict.reason };
}
