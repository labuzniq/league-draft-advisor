import type { StatsFile } from "@lda/shared";
import { describe, expect, test } from "vitest";
import type { MatchDto } from "./aggregate";
import { FIRST_WINDOW_S, SAFETY_GAP_S, runOnce } from "./run";
import { RiotError, type RiotClient } from "./riot";

const NOW_S = 1_800_000_000;
const PLAYER_IDS = ["secret-puuid-1", "secret-puuid-2", "secret-puuid-3"];

function match(version: string, championId = 1): MatchDto {
  return {
    info: {
      gameVersion: `${version}.123.4567`,
      gameDuration: 1800,
      queueId: 420,
      participants: [{ championId, teamPosition: "TOP", win: true }],
      teams: [{ bans: [] }],
    },
  };
}

function file(patch: string, windowEnd = 1000): StatsFile {
  return { patch, updatedAt: "", windowEnd, matches: 0, champions: {} };
}

interface World {
  players?: string[];
  lists?: Record<string, string[] | number>;
  matches?: Record<string, MatchDto | number>;
  leagueError?: number;
}

function fakeClient(world: World) {
  const paths: string[] = [];
  const players = world.players ?? [];
  const client = {
    get: async (_host: string, path: string) => {
      paths.push(path);
      if (path.startsWith("/lol/league-exp/")) {
        if (world.leagueError) throw new RiotError(world.leagueError, path);
        return path.endsWith("page=1") ? players.map((puuid) => ({ puuid })) : [];
      }
      if (path.includes("/by-puuid/")) {
        const puuid = path.split("/by-puuid/")[1].split("/")[0];
        const value = world.lists?.[puuid] ?? [];
        if (typeof value === "number") throw new RiotError(value, path);
        return value;
      }
      const value = world.matches?.[path.split("/matches/")[1]];
      if (value === undefined || typeof value === "number") {
        throw new RiotError(value ?? 404, path);
      }
      return value;
    },
  } as unknown as RiotClient;
  return { client, paths };
}

const idRequests = (paths: string[]) => paths.filter((p) => p.includes("/by-puuid/"));
const matchRequests = (paths: string[]) => paths.filter((p) => /\/matches\/[^/?]+$/.test(p));

function singlePlayer(matches: World["matches"], ids: string[]) {
  return fakeClient({ players: ["p1"], lists: { p1: ids }, matches });
}

const base = { nowS: NOW_S, deadlineMs: Number.MAX_SAFE_INTEGER };

describe("runOnce", () => {
  test("counts each match once even when two players share it", async () => {
    const { client, paths } = fakeClient({
      players: ["p1", "p2"],
      lists: { p1: ["M1"], p2: ["M1"] },
      matches: { M1: match("15.22") },
    });
    const result = await runOnce({ ...base, client, current: file("15.22") });
    expect(result.counted).toBe(1);
    expect(result.current.matches).toBe(1);
    expect(matchRequests(paths)).toHaveLength(1);
  });

  test("uses the window from the last run", async () => {
    const { client, paths } = singlePlayer({}, []);
    await runOnce({ ...base, client, current: file("15.22", 5000) });
    const request = idRequests(paths)[0];
    expect(request).toContain(`startTime=5000&endTime=${NOW_S - SAFETY_GAP_S}`);
    expect(request).toContain("queue=420");
    expect(request).toContain("start=0&count=100");
  });

  test("first run uses a 24 hour window and starts an empty file", async () => {
    const { client, paths } = singlePlayer({ M1: match("15.22") }, ["M1"]);
    const result = await runOnce({ ...base, client });
    expect(idRequests(paths)[0]).toContain(
      `startTime=${NOW_S - FIRST_WINDOW_S}&endTime=${NOW_S - SAFETY_GAP_S}`,
    );
    expect(result.current.patch).toBe("15.22");
    expect(result.current.matches).toBe(1);
    expect(result.previous).toBeUndefined();
  });

  test("a newer patch moves current to previous and starts fresh", async () => {
    const { client } = singlePlayer({ M1: match("15.23") }, ["M1"]);
    const result = await runOnce({ ...base, client, current: file("15.22") });
    expect(result.previous?.patch).toBe("15.22");
    expect(result.current.patch).toBe("15.23");
    expect(result.current.matches).toBe(1);
  });

  test("an older patch match is not counted", async () => {
    const { client } = singlePlayer({ M1: match("15.21") }, ["M1"]);
    const result = await runOnce({ ...base, client, current: file("15.22") });
    expect(result.counted).toBe(0);
    expect(result.current.matches).toBe(0);
    expect(result.previous).toBeUndefined();
  });

  test("a remake on a newer patch does not change the files", async () => {
    const remake = match("15.23");
    remake.info.gameDuration = 200;
    const { client } = singlePlayer({ M1: remake }, ["M1"]);
    const result = await runOnce({ ...base, client, current: file("15.22") });
    expect(result.current.patch).toBe("15.22");
    expect(result.previous).toBeUndefined();
    expect(result.counted).toBe(0);
  });

  test("a remake does not start the first file", async () => {
    const remake = match("15.22");
    remake.info.gameDuration = 200;
    const { client } = singlePlayer({ M1: remake }, ["M1"]);
    await expect(runOnce({ ...base, client })).rejects.toThrow(
      "No matches were found, so no statistics file was started.",
    );
  });

  test("a match that fails with 404 is skipped and the run goes on", async () => {
    const { client } = singlePlayer({ M2: match("15.22") }, ["M1", "M2"]);
    const result = await runOnce({ ...base, client, current: file("15.22") });
    expect(result.skipped).toBe(1);
    expect(result.counted).toBe(1);
  });

  test("a failed match list for one player is skipped", async () => {
    const { client } = fakeClient({
      players: ["p1", "p2"],
      lists: { p1: 500, p2: ["M1"] },
      matches: { M1: match("15.22") },
    });
    const result = await runOnce({ ...base, client, current: file("15.22") });
    expect(result.skipped).toBe(1);
    expect(result.counted).toBe(1);
  });

  test("a bad key stops the run", async () => {
    const { client } = singlePlayer({ M1: 403 }, ["M1"]);
    await expect(runOnce({ ...base, client, current: file("15.22") })).rejects.toThrow(
      "Riot refused the API key (status 403).",
    );
  });

  test("a failed player list stops the run", async () => {
    const { client } = fakeClient({ leagueError: 500 });
    await expect(runOnce({ ...base, client, current: file("15.22") })).rejects.toThrow(
      "The player list could not be fetched (status 500).",
    );
  });

  test("stops at the deadline and still returns the totals", async () => {
    const { client, paths } = fakeClient({
      players: ["p1", "p2"],
      lists: { p1: ["M1"], p2: ["M2"] },
      matches: { M1: match("15.22"), M2: match("15.22") },
    });
    let calls = 0;
    const nowMs = () => (calls++ === 0 ? 0 : 10_000);
    const result = await runOnce({
      ...base,
      client,
      current: file("15.22"),
      deadlineMs: 5_000,
      nowMs,
    });
    expect(result.counted).toBe(1);
    expect(idRequests(paths)).toHaveLength(1);
    expect(result.current.windowEnd).toBe(NOW_S - SAFETY_GAP_S);
  });

  test("windowEnd and updatedAt are set at the end", async () => {
    const { client } = singlePlayer({}, []);
    const result = await runOnce({
      ...base,
      client,
      current: file("15.22"),
      nowMs: () => Date.parse("2026-11-17T03:00:00Z"),
    });
    expect(result.current.windowEnd).toBe(NOW_S - SAFETY_GAP_S);
    expect(result.current.updatedAt).toBe("2026-11-17T03:00:00.000Z");
  });

  test("no current file and no matches throws", async () => {
    const { client } = singlePlayer({}, []);
    await expect(runOnce({ ...base, client })).rejects.toThrow(
      "No matches were found, so no statistics file was started.",
    );
  });

  test("the input files are not mutated", async () => {
    const { client } = singlePlayer({ M1: match("15.23") }, ["M1"]);
    const current = file("15.22");
    const previous = file("15.21");
    await runOnce({ ...base, client, current, previous });
    expect(current).toEqual(file("15.22"));
    expect(previous).toEqual(file("15.21"));
  });

  test("log lines and errors never contain a player ID", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const failing = fakeClient({
      players: PLAYER_IDS,
      lists: { [PLAYER_IDS[0]]: 500, [PLAYER_IDS[1]]: ["M1"], [PLAYER_IDS[2]]: 429 },
      matches: { M1: 404 },
    });
    await runOnce({ ...base, client: failing.client, current: file("15.22"), log });
    const keyError = fakeClient({ players: PLAYER_IDS, lists: { [PLAYER_IDS[0]]: 401 } });
    const error = await runOnce({
      ...base,
      client: keyError.client,
      current: file("15.22"),
      log,
    }).catch((e: Error) => e);
    const listError = await runOnce({
      ...base,
      client: fakeClient({ leagueError: 500 }).client,
      log,
    }).catch((e: Error) => e);
    const text = [...lines, (error as Error).message, (listError as Error).message].join("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const id of PLAYER_IDS) expect(text).not.toContain(id);
    expect(text).not.toContain("/lol/");
  });
});
