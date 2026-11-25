/** Pure rules for training questions: shape checks, format rules, and grading against the answer key. */
import { z } from "zod";
import type { QuestionFormat, QuestionPayload } from "@/lib/types";

const SINGLE_CHOICE: ReadonlySet<QuestionFormat> = new Set(["mcq", "timed_decision", "spot_the_mistake"]);

/** Structural problems that make a question unusable or break the generator's hard rules. */
export function checkQuestionShape(q: QuestionPayload): string[] {
  const flags: string[] = [];
  const correct = q.options.filter((o) => o.correct).length;
  if (SINGLE_CHOICE.has(q.format) && (q.options.length < 2 || correct !== 1)) flags.push("needs_exactly_one_correct_option");
  if (q.format === "checklist" && (q.options.length < 2 || correct < 1)) flags.push("checklist_needs_required_items");
  if (q.format === "order_steps" && q.correct_order.length < 2) flags.push("order_steps_needs_two_steps");
  if (q.format === "timed_decision" && q.time_limit_seconds === null) flags.push("timed_decision_needs_time_limit");
  if (q.options.some((o) => !o.correct && (o.misconception === null || o.misconception.trim() === ""))) flags.push("missing_misconception");
  return flags;
}

/** Rule 7: the exam must test with different formats than practice. */
export function repeatedExamFormats(practice: QuestionFormat[], exam: QuestionFormat[]): QuestionFormat[] {
  return exam.filter((f) => practice.includes(f));
}

export const AnswerSchema = z.discriminatedUnion("format", [
  z.object({ format: z.enum(["mcq", "timed_decision", "spot_the_mistake"]), choice: z.number().int().min(-1) }),
  z.object({ format: z.literal("checklist"), selected: z.array(z.number().int().min(0)) }),
  z.object({ format: z.literal("order_steps"), order: z.array(z.string()) }),
]);
export type Answer = z.infer<typeof AnswerSchema>;

/** Grades an answer against the approved key. A timed-out decision is choice -1 (wrong). */
export function gradeAgainstKey(q: QuestionPayload, answer: Answer): boolean {
  if (answer.format !== q.format) throw new Error(`answer format ${answer.format} does not match question format ${q.format}`);
  switch (answer.format) {
    case "mcq":
    case "timed_decision":
    case "spot_the_mistake":
      return answer.choice >= 0 && answer.choice < q.options.length && q.options[answer.choice].correct;
    case "checklist": {
      const required = q.options.flatMap((o, i) => (o.correct ? [i] : []));
      const chosen = [...new Set(answer.selected)].sort((a, b) => a - b);
      return chosen.length === required.length && chosen.every((v, i) => v === required[i]);
    }
    case "order_steps":
      return answer.order.length === q.correct_order.length && answer.order.every((s, i) => s === q.correct_order[i]);
  }
}

/** Deterministic shuffle (by item id) so the learner never sees the steps already in order. */
export function shuffledSteps(steps: string[], seed: string): string[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...steps];
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((s, i) => s === steps[i])) out.push(out.shift() as string);
  return out;
}
