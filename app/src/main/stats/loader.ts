import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StatsFile } from "@lda/shared";

export const STATS_BASE_URL = "https://github.com/labuzniq/league-draft-advisor/releases/download/stats";
export const MIN_MATCHES = 10_000;

export function chooseStats(current?: StatsFile, previous?: StatsFile): StatsFile | undefined {
  if (current && current.matches >= MIN_MATCHES) return current;
  return previous ?? current;
}

async function download(name: string, cacheDir: string, fetchFn: typeof fetch): Promise<StatsFile | undefined> {
  try {
    const response = await fetchFn(`${STATS_BASE_URL}/${name}`);
    if (!response.ok) return undefined;
    const text = await response.text();
    const file = JSON.parse(text) as StatsFile;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, name), text);
    return file;
  } catch {
    return undefined;
  }
}

async function readCached(name: string, cacheDir: string): Promise<StatsFile | undefined> {
  try {
    return JSON.parse(await readFile(join(cacheDir, name), "utf8")) as StatsFile;
  } catch {
    return undefined;
  }
}

async function loadFile(name: string, cacheDir: string, fetchFn: typeof fetch): Promise<StatsFile | undefined> {
  return (await download(name, cacheDir, fetchFn)) ?? (await readCached(name, cacheDir));
}

export async function loadStats(cacheDir: string, fetchFn: typeof fetch = fetch): Promise<StatsFile | undefined> {
  const [current, previous] = await Promise.all([
    loadFile("current.json", cacheDir, fetchFn),
    loadFile("previous.json", cacheDir, fetchFn),
  ]);
  return chooseStats(current, previous);
}
