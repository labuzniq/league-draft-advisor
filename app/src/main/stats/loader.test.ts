import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatsFile } from "@lda/shared";
import { afterEach, beforeEach, expect, test } from "vitest";
import fixture from "../../../test/fixtures/stats.json";
import { chooseStats, loadStats, MIN_MATCHES, STATS_BASE_URL } from "./loader";

const withMatches = (matches: number, patch: string): StatsFile => ({ ...(fixture as StatsFile), matches, patch });
const enough = withMatches(MIN_MATCHES, "15.22");
const thin = withMatches(MIN_MATCHES - 1, "15.22");
const old = withMatches(50_000, "15.21");

test("chooseStats uses current when it has enough matches", () => {
  expect(chooseStats(enough, old)).toBe(enough);
});

test("chooseStats uses previous when current has too few matches", () => {
  expect(chooseStats(thin, old)).toBe(old);
});

test("chooseStats uses current when previous is missing", () => {
  expect(chooseStats(thin, undefined)).toBe(thin);
});

test("chooseStats gives undefined when both are missing", () => {
  expect(chooseStats(undefined, undefined)).toBeUndefined();
});

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "lda-stats-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

const fakeFetch = (files: Record<string, StatsFile | undefined>): typeof fetch =>
  (async (input) => {
    const name = String(input).slice(STATS_BASE_URL.length + 1);
    const file = files[name];
    return file ? new Response(JSON.stringify(file)) : new Response("Not Found", { status: 404 });
  }) as typeof fetch;

const failingFetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

test("loadStats downloads both files and saves them in the cache", async () => {
  const result = await loadStats(cacheDir, fakeFetch({ "current.json": enough, "previous.json": old }));
  expect(result).toEqual(enough);
  expect(JSON.parse(await readFile(join(cacheDir, "current.json"), "utf8"))).toEqual(enough);
  expect(JSON.parse(await readFile(join(cacheDir, "previous.json"), "utf8"))).toEqual(old);
});

test("loadStats returns the cached copy when the download fails", async () => {
  await writeFile(join(cacheDir, "current.json"), JSON.stringify(enough));
  expect(await loadStats(cacheDir, failingFetch)).toEqual(enough);
});

test("loadStats gives undefined when the download fails and the cache is empty", async () => {
  expect(await loadStats(cacheDir, failingFetch)).toBeUndefined();
});

test("loadStats uses current when previous.json is a 404", async () => {
  expect(await loadStats(cacheDir, fakeFetch({ "current.json": thin }))).toEqual(thin);
});

test("loadStats uses the cached copy when the body is not valid JSON", async () => {
  await writeFile(join(cacheDir, "current.json"), JSON.stringify(enough));
  const badFetch = (async () => new Response("<html>oops</html>")) as typeof fetch;
  expect(await loadStats(cacheDir, badFetch)).toEqual(enough);
});
