import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { serverEnv } from "@/lib/env";
import { getItem, getLessonVideo } from "@/lib/repo";
import { getSession } from "@/lib/session";

/** Streams a lesson's MP4 with HTTP Range support. Learners only get published lessons. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[itemId]">): Promise<Response> {
  const { itemId } = await ctx.params;
  const session = await getSession();
  if (session === null) return new Response("Sign in first", { status: 401 });
  const [item, video] = await Promise.all([getItem(itemId), getLessonVideo(itemId)]);
  if (session.kind === "learner" && item.status !== "published") return new Response("Not published", { status: 403 });
  if (video === null || video.status !== "ready" || video.videoPath === null) return new Response("Video not ready", { status: 404 });

  const file = path.resolve(video.videoPath);
  if (!file.startsWith(path.resolve(serverEnv().mediaOutDir) + path.sep)) {
    throw new Error(`Refusing to serve ${file}: outside MEDIA_OUT_DIR`);
  }
  const { size } = await stat(file);
  const range = request.headers.get("range");
  const match = range === null ? null : /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match === null) {
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, { headers: { "content-type": "video/mp4", "content-length": String(size), "accept-ranges": "bytes" } });
  }
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] !== "" && match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
    },
  });
}
