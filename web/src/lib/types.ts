import { z } from "zod";

export const ROLES = ["courier", "employee", "partner"] as const;
export type Role = (typeof ROLES)[number];
export type PartnerType = "restaurant" | "cafe";

export const LANGUAGES = ["ar", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const ITEM_STATUSES = ["draft", "verified", "approved", "published", "outdated", "rejected"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemKind = "lesson" | "practice" | "exam";
export type PackageStatus = "ok" | "needs_human" | "skipped";
export type MasteryState = "not_started" | "in_progress" | "mastered" | "needs_refresh";
export type ClauseStatus = "unchanged" | "moved" | "changed" | "added" | "removed" | "needs_review";
export type Confidence = "sure" | "unsure";

/** One clause of one document version, as stored by docproc in `clause_versions`. */
export type Clause = {
  recordId: string;
  stableId: string;
  ordinal: number;
  quote: string;
  statement: string;
  heading: string | null;
  clauseNumber: string | null;
  page: number | null;
};

type ReportSide = { quote: string; heading: string | null };
type ReportClause = {
  status: ClauseStatus;
  stable_id: string | null;
  old: ReportSide | null;
  new: ReportSide | null;
  change_reasons: string[];
};
/** docproc's v1→v2 comparison, as stored in `comparisons.report`. */
export type ComparisonReport = {
  old_version_id: string | null;
  new_version_id: string;
  complete: boolean;
  summary: Record<ClauseStatus, number>;
  clauses: ReportClause[];
};

export type Procedure = {
  id: string;
  documentId: string;
  versionId: string;
  procedureKey: string;
  ordinal: number;
  title: string;
  steps: string[];
  stableIds: string[];
};

// ---------------------------------------------------------------- stored item payloads
// Same shapes as the generator's output, with clause refs resolved to docproc stable ids.

export const QUESTION_FORMATS = ["mcq", "timed_decision", "spot_the_mistake", "order_steps", "checklist"] as const;
export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

export const OptionSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  misconception: z.string().nullable(),
});
export type QuestionOption = z.infer<typeof OptionSchema>;

export const QuestionPayloadSchema = z.object({
  format: z.enum(QUESTION_FORMATS),
  prompt: z.string().min(1),
  scene: z.string().nullable(),
  time_limit_seconds: z.number().int().min(5).max(60).nullable(),
  options: z.array(OptionSchema),
  correct_order: z.array(z.string().min(1)),
  feedback: z.string().min(1),
  confidence_tap: z.boolean(),
});
export type QuestionPayload = z.infer<typeof QuestionPayloadSchema>;

export const ShotSchema = z.object({
  seconds: z.number().min(2).max(8),
  visual: z.string().min(5),
  on_screen_text: z.string().min(1),
  narration: z.string().nullable(),
  source: z.string(),
  /** Library clip (media/clips) shown in this shot, or null for a branded slide. */
  clip_id: z.string().nullable(),
  must_show: z.array(z.string()),
  must_not_show: z.array(z.string()),
  stable_id: z.string().min(1),
  quote: z.string().min(1),
});
export type Shot = z.infer<typeof ShotSchema>;

export const LessonPayloadSchema = z.object({
  title: z.string().min(1),
  key_points: z.array(z.object({ text: z.string().min(1), stable_id: z.string().min(1), quote: z.string().min(1) })).min(1),
  video: z
    .object({ total_seconds: z.number(), structure: z.enum(["do_dont", "steps"]), shots: z.array(ShotSchema).min(1).max(4) })
    .nullable(),
});
export type LessonPayload = z.infer<typeof LessonPayloadSchema>;

type ItemBase = {
  id: string;
  packageId: string;
  documentId: string;
  versionId: string;
  procedureKey: string;
  role: Role;
  ordinal: number;
  stableId: string;
  quote: string;
  status: ItemStatus;
  flags: string[];
  judgeReason: string;
  updatedAt: Date;
};
export type LessonItem = ItemBase & { kind: "lesson"; payload: LessonPayload };
export type QuestionItem = ItemBase & { kind: "practice" | "exam"; payload: QuestionPayload };
export type TrainingItem = LessonItem | QuestionItem;

export type PackageFlag = { type: string; clause_id: string; note: string };
export type ResourceRequest = { need: string; why: string; fallback_used: string; priority: string };

export type TrainingPackage = {
  id: string;
  procedureId: string;
  procedureKey: string;
  documentId: string;
  versionId: string;
  status: PackageStatus;
  skipReason: string | null;
  flags: PackageFlag[];
  resourceRequests: ResourceRequest[];
  ideas: string[];
  createdAt: Date;
};

export type HlDocument = {
  documentId: string;
  title: string;
  role: Role;
  partnerType: PartnerType | null;
  language: Language;
  currentVersionId: string | null;
};

export type Learner = {
  learnerId: string;
  name: string;
  role: Role;
  branch: string;
  language: Language;
  device: "phone" | "laptop" | "tablet";
};

export type VideoStatus = "queued" | "rendering" | "ready" | "failed";
export type LessonVideo = { itemId: string; status: VideoStatus; videoPath: string | null; error: string; secondsSinceUpdate: number };

export const DEVICE_FOR_ROLE: Record<Role, Learner["device"]> = { courier: "phone", employee: "laptop", partner: "tablet" };
/** Branches a learner can belong to (demo network in Riyadh), stored as these Arabic names. */
export const BRANCHES = ["فرع حي الملقا", "فرع حي النرجس", "فرع حي الياسمين", "فرع حي الصحافة", "مركز العمليات – العليا"] as const;
