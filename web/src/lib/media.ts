import "server-only";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { sql } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { loadClipLibrary } from "@/lib/generation";
import type { HlDocument, LessonPayload } from "@/lib/types";

const run = promisify(execFile);
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;

/** Input contract of `hlmedia render` (see media/src/hlmedia/spec.py). */
type RenderSpec = {
  orientation: "portrait" | "landscape";
  language: "ar" | "en";
  brand_logo: string;
  shots: { seconds: number; clip_file: string | null; on_screen_text: string; narration: string | null }[];
};

const RenderResultSchema = z.object({ video: z.string(), duration_s: z.number() });

const globalForMedia = globalThis as unknown as { hlMediaQueue: Promise<void> | undefined };

/** One GPU: renders are chained on a process-wide queue. */
function enqueue(task: () => Promise<void>): void {
  const previous = globalForMedia.hlMediaQueue ?? Promise.resolve();
  globalForMedia.hlMediaQueue = previous.then(task, task);
}

/** Courier videos are vertical (phone); partner videos are horizontal (tablet). */
async function buildSpec(doc: HlDocument, lesson: LessonPayload, logo: string): Promise<RenderSpec> {
  if (lesson.video === null) throw new Error(`Lesson "${lesson.title}" has no video plan`);
  const library = new Map((await loadClipLibrary(doc.role)).map((c) => [c.clip_id, c.file]));
  return {
    orientation: doc.role === "courier" ? "portrait" : "landscape",
    language: doc.language,
    brand_logo: logo,
    shots: lesson.video.shots.map((s) => ({
      seconds: s.seconds,
      clip_file: s.clip_id === null ? null : (library.get(s.clip_id) ?? null),
      on_screen_text: s.on_screen_text,
      narration: doc.language === "ar" ? s.narration : null,
    })),
  };
}

/** Library clip files this lesson needs that are not in media/clips yet. */
async function missingClips(lesson: LessonPayload, doc: HlDocument): Promise<string[]> {
  const library = new Map((await loadClipLibrary(doc.role)).map((c) => [c.clip_id, c.file]));
  const files = (lesson.video?.shots ?? []).flatMap((s) => (s.clip_id === null ? [] : [library.get(s.clip_id) ?? s.clip_id]));
  const present = await Promise.all(files.map((f) => access(f).then(() => true, () => false)));
  return files.filter((_, i) => !present[i]).map((f) => path.basename(f));
}

async function renderNow(itemId: string, doc: HlDocument, lesson: LessonPayload): Promise<void> {
  const env = serverEnv();
  const workDir = path.join(env.mediaOutDir, itemId);
  try {
    await mkdir(workDir, { recursive: true });
    const missing = await missingClips(lesson, doc);
    if (missing.length > 0) {
      await sql()`
        UPDATE lesson_videos SET status = 'failed', updated_at = now(),
               error = ${`بانتظار المقاطع في media/clips (انظر CLIP-REQUESTS.md): ${missing.join("، ")}`}
        WHERE item_id = ${itemId}`;
      return;
    }
    const specPath = path.join(workDir, "spec.json");
    const resultPath = path.join(workDir, "result.json");
    const spec = await buildSpec(doc, lesson, path.join(env.mediaDir, "assets", "hungerlearn-logo.png"));
    await writeFile(specPath, JSON.stringify(spec), "utf8");
    await sql()`UPDATE lesson_videos SET status = 'rendering', updated_at = now() WHERE item_id = ${itemId}`;
    await run(env.mediaBin, ["render", "--spec", specPath, "--out-dir", workDir, "--result", resultPath], {
      cwd: env.mediaDir,
      timeout: RENDER_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const result = RenderResultSchema.parse(JSON.parse(await readFile(resultPath, "utf8")));
    await sql()`
      UPDATE lesson_videos SET status = 'ready', video_path = ${result.video}, error = '', updated_at = now()
      WHERE item_id = ${itemId}`;
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    const message = `${error instanceof Error ? error.message : String(error)} ${stderr.slice(-1200)}`;
    console.error("lesson video render failed", { itemId, documentId: doc.documentId, error: message });
    await sql()`UPDATE lesson_videos SET status = 'failed', error = ${message}, updated_at = now() WHERE item_id = ${itemId}`;
  }
}

/**
 * Lesson video, made once per lesson and reused by every learner: human-made library clips
 * (media/clips) or branded slides, Najdi narration from NAMAA-Saudi-TTS-V2 (tashkeel is added
 * inside the TTS step only), the HungerLearn logo top-right and the on-screen text on top.
 */
export async function queueLessonVideo(itemId: string, doc: HlDocument, lesson: LessonPayload): Promise<void> {
  if (lesson.video === null) return;
  await sql()`
    INSERT INTO lesson_videos (item_id, status) VALUES (${itemId}, 'queued')
    ON CONFLICT (item_id) DO UPDATE SET status = 'queued', error = '', updated_at = now()`;
  enqueue(() => renderNow(itemId, doc, lesson));
}

/** Reuses an existing rendered video for a lesson carried over unchanged to a new version. */
export async function copyLessonVideo(fromItemId: string, toItemId: string): Promise<void> {
  await sql()`
    INSERT INTO lesson_videos (item_id, status, video_path, error)
    SELECT ${toItemId}, status, video_path, error FROM lesson_videos WHERE item_id = ${fromItemId}
    ON CONFLICT (item_id) DO NOTHING`;
}
