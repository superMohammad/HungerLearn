"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { gradeAnswer, type AnswerResult } from "@/lib/learning";
import { recordQueued, runGeneration, runUploadPipeline } from "@/lib/pipeline";
import { AnswerSchema } from "@/lib/question-rules";
import { askReadiness, type AskResult } from "@/lib/readiness";
import { queueLessonVideo } from "@/lib/media";
import { getDocument, getItem, getLearner, getProcedure, hasRunningJob, nextVersionId, upsertDocument } from "@/lib/repo";
import { approveItem, approvePackage, editQuestion, publishApproved, rejectPackage } from "@/lib/review";
import { checkCredentials, createLearnerAccount, emailTaken, isAuthErrorKey, SignInSchema, SignUpSchema, type AuthErrorKey } from "@/lib/accounts";
import { endSession, getSession, requireAdmin, requireLearner, startSession } from "@/lib/session";
import { DEFAULT_LANGUAGE, isLanguage, LANG_COOKIE } from "@/lib/i18n";
import { LANGUAGES, ROLES, type Language } from "@/lib/types";

const ACCEPTED = new Set([".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------- accounts

/** Form state for sign-in / sign-up: field errors are shown next to their inputs, `form` above the button. */
export type AuthState = { fieldErrors: Partial<Record<string, AuthErrorKey>>; form: AuthErrorKey | null; values: Record<string, string> };

function formValues(formData: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));
}

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, AuthErrorKey>> {
  return Object.fromEntries(
    error.issues.map((i) => {
      if (!isAuthErrorKey(i.message)) throw new Error(`Validation issue without a dictionary key: ${JSON.stringify(i)}`);
      return [String(i.path[0]), i.message];
    }),
  );
}

/** The language the visitor is using (the proxy's cookie; root params are not available in actions). */
async function uiLanguage(): Promise<Language> {
  const value = (await cookies()).get(LANG_COOKIE)?.value ?? DEFAULT_LANGUAGE;
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

async function homeFor(): Promise<"/admin" | "/learn"> {
  const session = await getSession();
  if (session === null) throw new Error("Session missing right after sign-in");
  return session.kind === "admin" ? "/admin" : "/learn";
}

export async function signInAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const values = formValues(formData, ["email"]);
  const parsed = SignInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), form: null, values };
  const accountId = await checkCredentials(parsed.data);
  if (accountId === null) return { fieldErrors: {}, form: "badCredentials", values };
  await startSession(accountId);
  redirect(await homeFor());
}

export async function signUpAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const values = formValues(formData, ["name", "email", "role", "branch"]);
  const parsed = SignUpSchema.safeParse(Object.fromEntries(["name", "email", "password", "role", "branch"].map((k) => [k, formData.get(k)])));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), form: null, values };
  if (await emailTaken(parsed.data.email)) return { fieldErrors: { email: "emailTaken" }, form: null, values };
  await startSession(await createLearnerAccount(parsed.data, await uiLanguage()));
  redirect("/learn");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}

// ---------------------------------------------------------------- stage 1 / 6: upload

async function saveUpload(file: File, documentId: string, versionId: string): Promise<string> {
  const ext = path.extname(file.name).toLowerCase();
  if (!ACCEPTED.has(ext)) throw new Error(`Unsupported file type "${ext}" (accepted: ${[...ACCEPTED].join(", ")})`);
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) throw new Error(`File size ${file.size} bytes is outside 1 B – 20 MB`);
  const dir = path.join(serverEnv().uploadDir, documentId);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${versionId}${ext}`);
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return target;
}

const NewDocumentSchema = z.object({
  documentId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/, "Use lowercase letters, digits, and dashes"),
  title: z.string().min(3).max(200),
  role: z.enum(ROLES),
  language: z.enum(LANGUAGES),
  partnerType: z.enum(["restaurant", "cafe"]).nullable(),
});

async function startPipeline(documentId: string, versionId: string, filePath: string): Promise<void> {
  const queuedJobId = await recordQueued(documentId, versionId);
  after(async () => {
    try {
      await runUploadPipeline(documentId, versionId, filePath, queuedJobId);
    } catch (error) {
      console.error("upload pipeline failed", { documentId, versionId, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export async function uploadNewDocument(formData: FormData): Promise<void> {
  await requireAdmin();
  const fields = NewDocumentSchema.parse({
    documentId: formData.get("documentId"),
    title: formData.get("title"),
    role: formData.get("role"),
    language: formData.get("language"),
    partnerType: formData.get("role") === "partner" ? formData.get("partnerType") : null,
  });
  const file = z.instanceof(File).parse(formData.get("file"));
  await upsertDocument(fields);
  const versionId = await nextVersionId(fields.documentId);
  const filePath = await saveUpload(file, fields.documentId, versionId);
  await startPipeline(fields.documentId, versionId, filePath);
  redirect(`/admin/documents/${fields.documentId}`);
}

export async function uploadNewVersion(documentId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const doc = await getDocument(documentId);
  if (await hasRunningJob(doc.documentId)) throw new Error(`Document ${documentId} is still processing; wait for it to finish`);
  const file = z.instanceof(File).parse(formData.get("file"));
  const versionId = await nextVersionId(doc.documentId);
  const filePath = await saveUpload(file, doc.documentId, versionId);
  await startPipeline(doc.documentId, versionId, filePath);
  revalidatePath(`/admin/documents/${documentId}`);
}

// ---------------------------------------------------------------- stage 3: review

export async function approveAction(itemId: string): Promise<void> {
  const { actor } = await requireAdmin();
  await approveItem(itemId, actor);
  revalidatePath("/admin/review");
}

export async function approvePackageAction(packageId: string): Promise<void> {
  const { actor } = await requireAdmin();
  await approvePackage(packageId, actor);
  revalidatePath("/admin/review");
}

export async function rejectPackageAction(packageId: string, formData: FormData): Promise<void> {
  const { actor } = await requireAdmin();
  const reason = z.string().max(500).parse(formData.get("reason") ?? "");
  after(async () => {
    try {
      await rejectPackage(packageId, actor, reason);
    } catch (error) {
      console.error("package regeneration failed", { packageId, error: error instanceof Error ? error.message : String(error) });
    }
  });
  redirect("/admin/review");
}

export async function editQuestionAction(itemId: string, formData: FormData): Promise<void> {
  const { actor } = await requireAdmin();
  const optionTexts = formData.getAll("option").map((v) => z.string().min(1).parse(v));
  await editQuestion(itemId, actor, {
    prompt: z.string().min(1).parse(formData.get("prompt")),
    feedback: z.string().min(1).parse(formData.get("feedback")),
    optionTexts,
  });
  revalidatePath("/admin/review");
}

export async function generateProcedureAction(procedureId: string): Promise<void> {
  await requireAdmin();
  const procedure = await getProcedure(procedureId);
  after(async () => {
    try {
      await runGeneration(procedureId, "");
    } catch (error) {
      console.error("package generation failed", { procedureId, error: error instanceof Error ? error.message : String(error) });
    }
  });
  revalidatePath(`/admin/documents/${procedure.documentId}`);
}

export async function rerenderVideoAction(itemId: string): Promise<void> {
  await requireAdmin();
  const item = await getItem(itemId);
  if (item.kind !== "lesson") throw new Error(`Item ${itemId} is a ${item.kind}; only lessons have videos`);
  await queueLessonVideo(item.id, await getDocument(item.documentId), item.payload);
  revalidatePath("/admin/review");
}

export async function publishAction(documentId: string, versionId: string): Promise<void> {
  const { actor } = await requireAdmin();
  await publishApproved(documentId, versionId, actor);
  revalidatePath(`/admin/documents/${documentId}`);
  revalidatePath("/admin/review");
}

// ---------------------------------------------------------------- stage 4: learn

const ConfidenceSchema = z.enum(["sure", "unsure"]);

export async function answerAction(input: { itemId: string; answer: unknown; confidence: string }): Promise<AnswerResult> {
  const { learnerId } = await requireLearner();
  const learner = await getLearner(learnerId);
  return gradeAnswer(learner, z.string().uuid().parse(input.itemId), AnswerSchema.parse(input.answer), ConfidenceSchema.parse(input.confidence));
}

// ---------------------------------------------------------------- stage 5: ask

export type AskState = { kind: "idle" } | { kind: "ok"; result: AskResult } | { kind: "error"; message: string };

export async function askAction(_previous: AskState, formData: FormData): Promise<AskState> {
  await requireAdmin();
  const question = z.string().min(3).max(300).parse(formData.get("question"));
  try {
    return { kind: "ok", result: await askReadiness(question) };
  } catch (error) {
    // Shown to the admin verbatim: the rejected SQL or the database error is the useful detail.
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
