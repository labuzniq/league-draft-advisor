import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StatsFile } from "@lda/shared";
import { RiotClient, RiotError } from "./riot";
import { runOnce } from "./run";

const DEFAULT_STATS_DIR = "./stats-out";
const DEFAULT_RUN_MINUTES = 330;

interface Deps {
  runOnce: typeof runOnce;
  createClient: (apiKey: string) => RiotClient;
  now: () => number;
  log: (line: string) => void;
}

async function readStats(dir: string, name: string): Promise<StatsFile | undefined> {
  let text: string;
  try {
    text = await readFile(join(dir, name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as StatsFile;
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

export async function main(env: NodeJS.ProcessEnv, deps: Partial<Deps> = {}): Promise<void> {
  const run = deps.runOnce ?? runOnce;
  const createClient = deps.createClient ?? ((apiKey: string) => new RiotClient({ apiKey }));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.log;

  const apiKey = env.RIOT_API_KEY;
  if (!apiKey) throw new Error("RIOT_API_KEY is not set.");
  const minutes = env.RUN_MINUTES === undefined ? DEFAULT_RUN_MINUTES : Number(env.RUN_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("RUN_MINUTES must be a positive number.");

  const dir = env.STATS_DIR || DEFAULT_STATS_DIR;
  const current = await readStats(dir, "current.json");
  const previous = await readStats(dir, "previous.json");

  const startMs = now();
  const result = await run({
    client: createClient(apiKey),
    current,
    previous,
    nowS: Math.floor(startMs / 1000),
    deadlineMs: startMs + minutes * 60_000,
    nowMs: now,
    log,
  });

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "current.json"), JSON.stringify(result.current));
  if (result.previous) await writeFile(join(dir, "previous.json"), JSON.stringify(result.previous));
  log(
    `Patch ${result.current.patch}: ${result.current.matches} matches in the file, ${result.counted} counted this run, ${result.skipped} skipped.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.env).catch((error: unknown) => {
    console.error(
      error instanceof RiotError
        ? `Riot API error (status ${error.status}).`
        : error instanceof Error
          ? error.message
          : "The job failed.",
    );
    process.exit(1);
  });
}
