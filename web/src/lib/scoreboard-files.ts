import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/env";
import { readScoreboard, SCOREBOARD_FILES, type Scoreboard, type ScoreboardSources } from "@/lib/scoreboard";

/** Runs a file read, or gives null when the file does not exist yet. Any other error is raised, not hidden. */
async function ifPresent<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Reads the three result files from docproc's out/ folder (DOCPROC_DIR/out), where their commands write them. */
export async function loadScoreboard(): Promise<Scoreboard> {
  const dir = path.join(serverEnv().docprocDir, "out");
  const keys = Object.keys(SCOREBOARD_FILES) as (keyof typeof SCOREBOARD_FILES)[];
  const fileOf = (k: keyof typeof SCOREBOARD_FILES): string => path.join(dir, SCOREBOARD_FILES[k].file);
  const [texts, extractionStat] = await Promise.all([
    Promise.all(keys.map((k) => ifPresent(() => readFile(fileOf(k), "utf8")))),
    ifPresent(() => stat(fileOf("extraction"))),
  ]);
  return readScoreboard(Object.fromEntries(keys.map((k, i) => [k, texts[i]])) as ScoreboardSources, {
    extractionModified: extractionStat?.mtime.toISOString() ?? null,
  });
}
