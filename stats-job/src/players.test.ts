import { describe, expect, test } from "vitest";
import { PLATFORM_HOST, QUEUE, RANKS } from "./config";
import { listPlayers } from "./players";
import type { RiotClient } from "./riot";

type Entry = { puuid?: string };

function fakeClient(respond: (path: string) => Entry[]) {
  const calls: { host: string; path: string }[] = [];
  const client = {
    get: async (host: string, path: string) => {
      calls.push({ host, path });
      return respond(path);
    },
  } as unknown as RiotClient;
  return { client, calls };
}

function uniqueEntries(path: string): Entry[] {
  return [{ puuid: `${path}#a` }, { puuid: `${path}#b` }];
}

function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe("listPlayers", () => {
  test("requests two different pages for each of the 11 ranks", async () => {
    const { client, calls } = fakeClient(uniqueEntries);
    await listPlayers(client, sequence(1));
    expect(calls).toHaveLength(22);
    for (const { tier, division } of RANKS) {
      const prefix = `/lol/league-exp/v4/entries/${QUEUE}/${tier}/${division}?page=`;
      const pages = calls
        .filter((c) => c.path.startsWith(prefix))
        .map((c) => Number(c.path.slice(prefix.length)));
      expect(pages).toHaveLength(2);
      expect(new Set(pages).size).toBe(2);
      for (const page of pages) {
        expect(page).toBeGreaterThanOrEqual(1);
        expect(page).toBeLessThanOrEqual(50);
      }
    }
    expect(calls.every((c) => c.host === PLATFORM_HOST)).toBe(true);
  });

  test("returns each player ID once", async () => {
    const { client } = fakeClient(() => [{ puuid: "same" }, { puuid: "same" }, { puuid: "other" }]);
    const players = await listPlayers(client, sequence(2));
    expect([...players].sort()).toEqual(["other", "same"]);
  });

  test("skips entries without a puuid", async () => {
    const { client } = fakeClient(() => [{ puuid: "p1" }, {}, { puuid: "" }]);
    expect(await listPlayers(client, sequence(3))).toEqual(["p1"]);
  });

  test("replaces an empty page with page 1", async () => {
    const { client, calls } = fakeClient((path) => (path.endsWith("page=1") ? [{ puuid: "first" }] : []));
    const players = await listPlayers(client, () => 0.5);
    expect(players).toEqual(["first"]);
    expect(calls.filter((c) => c.path.endsWith("page=1"))).toHaveLength(22);
  });

  test("does not replace an empty page 1 with page 1 again", async () => {
    const { client, calls } = fakeClient(() => []);
    expect(await listPlayers(client, () => 0)).toEqual([]);
    expect(calls.filter((c) => c.path.endsWith("page=1"))).toHaveLength(22);
    expect(calls.filter((c) => c.path.endsWith("page=2"))).toHaveLength(11);
  });

  test("gives the same order on every call with the same random", async () => {
    const { client } = fakeClient(uniqueEntries);
    const first = await listPlayers(client, sequence(4));
    const second = await listPlayers(client, sequence(4));
    expect(first).toEqual(second);
    expect(first).not.toEqual([...first].sort());
  });
});
