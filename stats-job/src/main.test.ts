import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatsFile } from "@lda/shared";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { main } from "./main";
import type { RunResult, runOnce as realRunOnce } from "./run";

const START_MS = 1_800_000_000_000;

function file(patch: string, matches = 0): StatsFile {
  return { patch, updatedAt: "", windowEnd: 5, matches, champions: { "1": { bans: 2, roles: {} } } };
}

let dir: string;
let runOnce: Mock<typeof realRunOnce>;
let log: Mock<(line: string) => void>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "stats-main-"));
  runOnce = vi.fn<typeof realRunOnce>(async (): Promise<RunResult> => ({ current: file("15.22", 40), counted: 12, skipped: 3 }));
  log = vi.fn<(line: string) => void>();
});

function run(env: Record<string, string | undefined>) {
  return main(
    { RIOT_API_KEY: "test-key", STATS_DIR: dir, ...env },
    { runOnce, createClient: () => ({}) as never, now: () => START_MS, log },
  );
}

describe("main", () => {
  test("rejects when the key is missing and does nothing", async () => {
    await expect(run({ RIOT_API_KEY: undefined })).rejects.toThrow("RIOT_API_KEY is not set.");
    expect(runOnce).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  test.each(["0", "-5", "abc", ""])("rejects RUN_MINUTES %j", async (value) => {
    await expect(run({ RUN_MINUTES: value })).rejects.toThrow("RUN_MINUTES must be a positive number.");
    expect(runOnce).not.toHaveBeenCalled();
  });

  test("first run passes no files and writes current.json", async () => {
    await run({});
    const input = runOnce.mock.calls[0]![0];
    expect(input.current).toBeUndefined();
    expect(input.previous).toBeUndefined();
    expect(JSON.parse(await readFile(join(dir, "current.json"), "utf8"))).toEqual(file("15.22", 40));
    expect(await readdir(dir)).toEqual(["current.json"]);
  });

  test("reads existing files and passes them on", async () => {
    await writeFile(join(dir, "current.json"), JSON.stringify(file("15.22", 7)));
    await writeFile(join(dir, "previous.json"), JSON.stringify(file("15.21", 9)));
    await run({});
    const input = runOnce.mock.calls[0]![0];
    expect(input.current).toEqual(file("15.22", 7));
    expect(input.previous).toEqual(file("15.21", 9));
  });

  test("writes both result files without extra white space", async () => {
    runOnce.mockResolvedValue({ current: file("15.23", 3), previous: file("15.22", 40), counted: 1, skipped: 0 });
    await run({});
    expect(await readFile(join(dir, "current.json"), "utf8")).toBe(JSON.stringify(file("15.23", 3)));
    expect(await readFile(join(dir, "previous.json"), "utf8")).toBe(JSON.stringify(file("15.22", 40)));
  });

  test("rejects a file that is not valid JSON", async () => {
    await writeFile(join(dir, "current.json"), "{oops");
    await expect(run({})).rejects.toThrow("current.json is not valid JSON.");
    expect(runOnce).not.toHaveBeenCalled();
  });

  test("deadline is the start time plus RUN_MINUTES", async () => {
    await run({ RUN_MINUTES: "5" });
    const input = runOnce.mock.calls[0]![0];
    expect(input.deadlineMs).toBe(START_MS + 5 * 60_000);
    expect(input.nowS).toBe(START_MS / 1000);
  });

  test("defaults to 330 minutes", async () => {
    await run({});
    expect(runOnce.mock.calls[0]![0].deadlineMs).toBe(START_MS + 330 * 60_000);
  });

  test("logs a summary line with only patch, matches, counted and skipped", async () => {
    await run({});
    expect(log).toHaveBeenLastCalledWith("Patch 15.22: 40 matches in the file, 12 counted this run, 3 skipped.");
  });
});
