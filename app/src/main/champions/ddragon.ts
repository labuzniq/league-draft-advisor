import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChampionInfo {
  id: number;
  name: string;
  tags: string[];
  kit: string;
  imageUrl: string;
}

interface RawAbility {
  name: string;
  description: string;
}

interface RawChampion {
  key: string;
  name: string;
  tags: string[];
  image: { full: string };
  passive: RawAbility;
  spells: RawAbility[];
}

interface ChampionFile {
  data: Record<string, unknown>;
}

const DDRAGON_URL = "https://ddragon.leagueoflegends.com";
const SPELL_KEYS = ["Q", "W", "E", "R"];
const CACHE_NAME = /^champions-(.+)\.json$/;

const plainText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const kitLine = (label: string, ability: RawAbility): string =>
  `${label} - ${ability.name}: ${plainText(ability.description)}`;

export function toChampionInfo(raw: unknown, version: string): ChampionInfo {
  const champion = raw as RawChampion;
  const lines = [
    kitLine("Passive", champion.passive),
    ...champion.spells.map((spell, index) => kitLine(SPELL_KEYS[index] ?? String(index), spell)),
  ];
  return {
    id: Number(champion.key),
    name: champion.name,
    tags: champion.tags,
    kit: lines.join("\n"),
    imageUrl: `${DDRAGON_URL}/cdn/${version}/img/champion/${champion.image.full}`,
  };
}

const compareVersions = (a: string, b: string): number => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const cacheFile = (cacheDir: string, version: string): string => join(cacheDir, `champions-${version}.json`);

async function download(cacheDir: string, fetchFn: typeof fetch): Promise<{ version: string; text: string } | undefined> {
  try {
    const versionsResponse = await fetchFn(`${DDRAGON_URL}/api/versions.json`);
    if (!versionsResponse.ok) return undefined;
    const [version] = (await versionsResponse.json()) as string[];
    if (!version) return undefined;
    const response = await fetchFn(`${DDRAGON_URL}/cdn/${version}/data/en_US/championFull.json`);
    if (!response.ok) return undefined;
    const text = await response.text();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile(cacheDir, version), text);
    return { version, text };
  } catch {
    return undefined;
  }
}

async function readNewestCached(cacheDir: string): Promise<{ version: string; text: string } | undefined> {
  try {
    const versions = (await readdir(cacheDir))
      .map((name) => CACHE_NAME.exec(name)?.[1])
      .filter((version): version is string => version !== undefined)
      .sort(compareVersions);
    const version = versions.at(-1);
    if (!version) return undefined;
    return { version, text: await readFile(cacheFile(cacheDir, version), "utf8") };
  } catch {
    return undefined;
  }
}

export async function loadChampions(
  cacheDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ version: string; champions: Map<number, ChampionInfo> }> {
  const source = (await download(cacheDir, fetchFn)) ?? (await readNewestCached(cacheDir));
  if (!source) throw new Error("Champion data is not available.");
  const { data } = JSON.parse(source.text) as ChampionFile;
  const champions = new Map<number, ChampionInfo>();
  for (const raw of Object.values(data)) {
    const info = toChampionInfo(raw, source.version);
    champions.set(info.id, info);
  }
  return { version: source.version, champions };
}
