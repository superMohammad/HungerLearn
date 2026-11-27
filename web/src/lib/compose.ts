import { z } from "zod";
import { shuffledSteps } from "@/lib/question-rules";
import { QUESTION_FORMATS, type LessonPayload, type QuestionFormat, type QuestionPayload } from "@/lib/types";

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
  }),
]);
export type ScreenSpec = z.infer<typeof ScreenSpecSchema>;
export type QuestionScreen = Extract<ScreenSpec, { kind: "question" }>;

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
  };
  const parsed = ScreenSpecSchema.safeParse(candidate);
  if (!parsed.success) return fallback;
  const s = parsed.data;
  if (s.kind === "question" && s.format === "order_steps" && s.steps.length < 2) return fallback;
  if (s.kind === "question" && s.format !== "order_steps" && s.options.length < 2) return fallback;
  return s;
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
