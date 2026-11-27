import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/env";
import { readScoreboard, SCOREBOARD_FILES, type Scoreboard, type ScoreboardSources } from "@/lib/scoreboard";

/** A result file's text, or null when it does not exist yet. Any other read error is raised, not hidden. */
async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Reads the three result files from docproc's out/ folder (DOCPROC_DIR/out), where their commands write them. */
export async function loadScoreboard(): Promise<Scoreboard> {
  const dir = path.join(serverEnv().docprocDir, "out");
  const keys = Object.keys(SCOREBOARD_FILES) as (keyof typeof SCOREBOARD_FILES)[];
  const texts = await Promise.all(keys.map((k) => readIfPresent(path.join(dir, SCOREBOARD_FILES[k].file))));
  return readScoreboard(Object.fromEntries(keys.map((k, i) => [k, texts[i]])) as ScoreboardSources);
}
