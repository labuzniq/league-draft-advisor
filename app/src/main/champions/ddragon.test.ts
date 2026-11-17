import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadChampions, toChampionInfo } from "./ddragon";

const raw = {
  key: "266",
  name: "Aatrox",
  tags: ["Fighter", "Tank"],
  image: { full: "Aatrox.png" },
  passive: { name: "Deathbringer Stance", description: "Periodically, <b>Aatrox</b> empowers his next attack.<br>Heals." },
  spells: [
    { name: "The Darkin Blade", description: "Swings a <font color='#fff'>blade</font>." },
    { name: "Infernal Chains", description: "Throws chains." },
    { name: "Umbral Dash", description: "Dashes forward." },
    { name: "World Ender", description: "Transforms." },
  ],
};

const championFull = (version: string) => ({ version, data: { Aatrox: raw } });

const fakeFetch = (versions: string[], data: Record<string, unknown>): typeof fetch =>
  (async (input) => {
    const url = String(input);
    if (url.endsWith("/api/versions.json")) return new Response(JSON.stringify(versions));
    const version = url.split("/cdn/")[1]?.split("/")[0] ?? "";
    return data[version] ? new Response(JSON.stringify(data[version])) : new Response("Not Found", { status: 404 });
  }) as typeof fetch;

const failingFetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "lda-ddragon-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

test("toChampionInfo builds id, name, tags, image url and a five line kit", () => {
  const info = toChampionInfo(raw, "15.22.1");
  expect(info.id).toBe(266);
  expect(info.name).toBe("Aatrox");
  expect(info.tags).toEqual(["Fighter", "Tank"]);
  expect(info.imageUrl).toBe("https://ddragon.leagueoflegends.com/cdn/15.22.1/img/champion/Aatrox.png");
  const lines = info.kit.split("\n");
  expect(lines).toHaveLength(5);
  expect(lines[0]).toBe("Passive - Deathbringer Stance: Periodically, Aatrox empowers his next attack. Heals.");
  expect(lines[1]).toBe("Q - The Darkin Blade: Swings a blade.");
  expect(lines[4]).toBe("R - World Ender: Transforms.");
  expect(info.kit).not.toContain("<");
});

test("loadChampions returns a map keyed by numeric id and caches the file", async () => {
  const fetchFn = fakeFetch(["15.22.1", "15.21.1"], { "15.22.1": championFull("15.22.1") });
  const result = await loadChampions(cacheDir, fetchFn);
  expect(result.version).toBe("15.22.1");
  expect(result.champions.get(266)?.name).toBe("Aatrox");
  const offline = await loadChampions(cacheDir, failingFetch);
  expect(offline.version).toBe("15.22.1");
});

test("loadChampions uses the newest cached version when offline", async () => {
  await loadChampions(cacheDir, fakeFetch(["15.9.1"], { "15.9.1": championFull("15.9.1") }));
  await loadChampions(cacheDir, fakeFetch(["15.10.1"], { "15.10.1": championFull("15.10.1") }));
  const offline = await loadChampions(cacheDir, failingFetch);
  expect(offline.version).toBe("15.10.1");
});

test("loadChampions throws when the download fails and nothing is cached", async () => {
  await expect(loadChampions(cacheDir, failingFetch)).rejects.toThrow("Champion data is not available.");
});

const bodyFetch = (body: string): typeof fetch =>
  (async (input) =>
    String(input).endsWith("/api/versions.json")
      ? new Response(JSON.stringify(["15.23.1"]))
      : new Response(body)) as typeof fetch;

test.each([["not json"], [JSON.stringify({ version: "15.23.1" })]])(
  "loadChampions ignores a bad download body (%s) and does not cache it",
  async (body) => {
    await loadChampions(cacheDir, fakeFetch(["15.22.1"], { "15.22.1": championFull("15.22.1") }));
    const result = await loadChampions(cacheDir, bodyFetch(body));
    expect(result.version).toBe("15.22.1");
    expect(await readdir(cacheDir)).toEqual(["champions-15.22.1.json"]);
  },
);

test("loadChampions uses the cache when the champion file is not found", async () => {
  await loadChampions(cacheDir, fakeFetch(["15.22.1"], { "15.22.1": championFull("15.22.1") }));
  const result = await loadChampions(cacheDir, fakeFetch(["15.23.1"], {}));
  expect(result.version).toBe("15.22.1");
});

test("loadChampions throws when the only cached file is corrupt", async () => {
  await writeFile(join(cacheDir, "champions-15.22.1.json"), "not json");
  await expect(loadChampions(cacheDir, failingFetch)).rejects.toThrow("Champion data is not available.");
});
