import { z } from "zod";
import type { ClauseChange } from "@/lib/carry-over";
import { shuffledSteps } from "@/lib/question-rules";
import { QUESTION_FORMATS, type Learner, type LessonPayload, type QuestionFormat, type QuestionPayload, type Role } from "@/lib/types";

/**
 * Stage 4 role/device layouts. Each one only arranges approved content: courier on a phone sees the
 * lesson video with one question, employee on a laptop a scenario question, partner on a tablet a
 * checklist. Every other pair, or a question without the content a layout needs, is "standard".
 */
export const LAYOUTS = ["standard", "video_question", "scenario", "checklist"] as const;
export type Layout = (typeof LAYOUTS)[number];
export type Device = Learner["device"];

const VideoSchema = z.object({ url: z.string().min(1), orientation: z.enum(["portrait", "landscape"]) });
export type LayoutVideo = z.infer<typeof VideoSchema>;

/** What the client may see: never the answer key. */
export const ScreenSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lesson"),
    title: z.string().min(1),
    keyPoints: z.array(z.string().min(1)).min(1),
    videoUrl: z.string().min(1).nullable(),
    orientation: z.enum(["portrait", "landscape"]),
  }),
  z.object({
    kind: z.literal("question"),
    phase: z.enum(["practice", "exam"]),
    itemId: z.string().uuid(),
    format: z.enum(QUESTION_FORMATS),
    prompt: z.string().min(1),
    scene: z.string().nullable(),
    timeLimitSeconds: z.number().int().min(5).max(60).nullable(),
    options: z.array(z.string().min(1)),
    steps: z.array(z.string().min(1)),
    layout: z.enum(LAYOUTS),
    video: VideoSchema.nullable(),
  }),
  z.object({
    kind: z.literal("what_changed"),
    title: z.string().min(1),
    /** App upload ids (v1, v2, …): the version the learner learned and the current one. */
    fromVersionId: z.string().min(1),
    toVersionId: z.string().min(1),
    changes: z
      .array(
        z.object({
          stableId: z.string().min(1),
          change: z.enum(["changed", "added", "removed", "review"]),
          before: z.string().min(1).nullable(),
          after: z.string().min(1).nullable(),
          /** docproc change-reason codes, labelled in the UI language by reasonLabel. */
          reasons: z.array(z.string().min(1)),
        }),
      )
      .min(1),
  }),
]);
export type ScreenSpec = z.infer<typeof ScreenSpecSchema>;
export type QuestionScreen = Extract<ScreenSpec, { kind: "question" }>;
export type WhatChangedScreen = Extract<ScreenSpec, { kind: "what_changed" }>;

/** The "What changed" lesson (B7): only report quotes and reason codes. Null when nothing changed for the learner. */
export function whatChangedScreen(title: string, fromVersionId: string, toVersionId: string, changes: readonly ClauseChange[]): WhatChangedScreen | null {
  if (changes.length === 0) return null;
  return ScreenSpecSchema.parse({ kind: "what_changed", title, fromVersionId, toVersionId, changes }) as WhatChangedScreen;
}

export function lessonScreen(lesson: LessonPayload, videoUrl: string | null, portrait: boolean): ScreenSpec {
  return { kind: "lesson", title: lesson.title, keyPoints: lesson.key_points.map((k) => k.text), videoUrl, orientation: portrait ? "portrait" : "landscape" };
}

/**
 * Rules turn an approved question into a screen spec. No new content is written: the spec only
 * arranges approved content. An invalid spec (e.g. an order question without steps) falls back
 * to the safe default, the lesson screen.
 */
export function composeQuestion(itemId: string, phase: "practice" | "exam", q: QuestionPayload, fallback: ScreenSpec): ScreenSpec {
  const candidate = {
    kind: "question",
    phase,
    itemId,
    format: q.format,
    prompt: q.prompt,
    scene: q.scene,
    timeLimitSeconds: q.format === "timed_decision" ? q.time_limit_seconds : null,
    options: q.format === "order_steps" ? [] : q.options.map((o) => o.text),
    steps: q.format === "order_steps" ? shuffledSteps(q.correct_order, itemId) : [],
    layout: "standard",
    video: null,
  };
  const parsed = ScreenSpecSchema.safeParse(candidate);
  if (!parsed.success) return fallback;
  const s = parsed.data;
  if (s.kind === "question" && s.format === "order_steps" && s.steps.length < 2) return fallback;
  if (s.kind === "question" && s.format !== "order_steps" && s.options.length < 2) return fallback;
  return s;
}

const PREFERRED: Partial<Record<`${Role}/${Device}`, Layout>> = {
  "courier/phone": "video_question",
  "employee/laptop": "scenario",
  "partner/tablet": "checklist",
};

export function preferredLayout(role: Role, device: Device): Layout {
  return PREFERRED[`${role}/${device}`] ?? "standard";
}

/** Whether an approved question (and the lesson video, if ready) has what the layout needs. */
export function fitsLayout(layout: Layout, q: Pick<QuestionPayload, "format" | "scene">, video: LayoutVideo | null): boolean {
  switch (layout) {
    case "video_question": return video !== null;
    case "scenario": return q.scene !== null && q.scene.trim() !== "";
    case "checklist": return q.format === "checklist";
    case "standard": return true;
  }
}

/**
 * Stable reorder within one phase: items that fit the learner's layout come first. Only the order of
 * presentation changes; which items are due and when the learner is mastered stay with nextStep.
 */
export function orderForLayout<T>(items: readonly T[], fits: (item: T) => boolean): T[] {
  return [...items.filter(fits), ...items.filter((i) => !fits(i))];
}

export type ComposeInput = {
  role: Role;
  device: Device;
  itemId: string;
  phase: "practice" | "exam";
  question: QuestionPayload;
  /** The procedure's ready lesson video, or null. */
  video: LayoutVideo | null;
  fallback: ScreenSpec;
};

/**
 * The learner's question screen: the layout preferred for their stored role and device when the
 * approved content supports it, else "standard". The whole spec is validated with Zod; an invalid one
 * falls back to the safe default (the lesson screen), exactly as composeQuestion does.
 */
export function composeScreen(input: ComposeInput): ScreenSpec {
  const base = composeQuestion(input.itemId, input.phase, input.question, input.fallback);
  if (base.kind !== "question") return input.fallback;
  const preferred = preferredLayout(input.role, input.device);
  const layout = fitsLayout(preferred, input.question, input.video) ? preferred : "standard";
  const parsed = ScreenSpecSchema.safeParse({ ...base, layout, video: layout === "video_question" ? input.video : null });
  return parsed.success ? parsed.data : input.fallback;
}

export type Level = "beginner" | "certified" | "expert";

/** Beginner → Certified (≥1 procedure mastered) → Expert (every procedure for the role mastered). */
export function levelFor(masteredCount: number, totalForRole: number): Level {
  if (masteredCount === 0) return "beginner";
  return masteredCount >= totalForRole && totalForRole >= 2 ? "expert" : "certified";
}

export type AttemptLite = { itemId: string; correct: boolean; at: number };
export type StepItem = { id: string; format: QuestionFormat };

/**
 * Which item comes next. Practice items each need one attempt; then exam items. A wrong exam answer
 * sends the learner back through practice before the failed exam items are retried. Right after a
 * wrong exam answer ("Not yet") the next item is the first due one (practice, then exam) in a different
 * format, when a due published item offers one; otherwise, e.g. with a single format, the order above
 * is kept. Already-passed exam items are not re-asked.
 * Mastered = the latest attempt of every exam item is correct.
 */
export function nextStep(practice: readonly StepItem[], exam: readonly StepItem[], attempts: readonly AttemptLite[]):
  { kind: "practice" | "exam"; itemId: string } | { kind: "mastered" } {
  const known = new Set([...practice, ...exam].map((i) => i.id));
  const ordered = attempts.filter((a) => known.has(a.itemId)).sort((x, y) => x.at - y.at);
  const latest = new Map<string, AttemptLite>();
  for (const a of ordered) latest.set(a.itemId, a);
  const failedExam = exam.filter((i) => latest.get(i.id)?.correct === false);
  const lastFailAt = Math.max(-1, ...failedExam.map((i) => (latest.get(i.id) as AttemptLite).at));
  const due = [
    ...practice.filter((i) => (latest.get(i.id)?.at ?? -2) <= lastFailAt).map((i) => ({ kind: "practice" as const, item: i })),
    ...exam.filter((i) => latest.get(i.id)?.correct !== true).map((i) => ({ kind: "exam" as const, item: i })),
  ];
  if (due.length === 0) return { kind: "mastered" };
  const last = ordered.at(-1);
  const justFailed = last !== undefined && !last.correct ? exam.find((i) => i.id === last.itemId) : undefined;
  const pick = (justFailed === undefined ? undefined : due.find((d) => d.item.format !== justFailed.format)) ?? due[0];
  return { kind: pick.kind, itemId: pick.item.id };
}

export type LayoutStepItem = StepItem & { scene: string | null };

/**
 * The next item for a learner's layout. Within each phase, items that fit the layout come first; then
 * nextStep decides. So B5's retry rule takes priority: after "Not yet" the next item is still due and in
 * a different format, and the layout preference only breaks ties among those. If the picked item does
 * not fit the layout, composeScreen shows it in the standard layout.
 */
export function nextStepForLayout(
  layout: Layout, video: LayoutVideo | null,
  practice: readonly LayoutStepItem[], exam: readonly LayoutStepItem[], attempts: readonly AttemptLite[],
): ReturnType<typeof nextStep> {
  const fits = (i: LayoutStepItem) => fitsLayout(layout, i, video);
  return nextStep(orderForLayout(practice, fits), orderForLayout(exam, fits), attempts);
}

/**
 * In "auto" mode the separate lesson screen comes first, except for the courier-on-a-phone layout when
 * the lesson video is ready and there are questions: the video is then on every question screen.
 */
export function skipsLessonInAuto(layout: Layout, video: LayoutVideo | null, questionCount: number): boolean {
  return layout === "video_question" && video !== null && questionCount > 0;
}
