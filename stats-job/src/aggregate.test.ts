import { describe, expect, test } from "vitest";
import { addMatch, comparePatch, emptyStats, patchOf, type MatchDto } from "./aggregate";

const GALIO = 3;
const ORIANNA = 61;
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function makeMatch(overrides: {
  gameVersion?: string;
  gameDuration?: number;
  queueId?: number;
  participants?: Partial<MatchDto["info"]["participants"][number]>[];
  bans?: number[][];
} = {}): MatchDto {
  const participants = Array.from({ length: 10 }, (_, i) => ({
    championId: 100 + i,
    teamPosition: POSITIONS[i % 5],
    win: i < 5,
  }));
  overrides.participants?.forEach((p, i) => Object.assign(participants[i], p));
  return {
    info: {
      gameVersion: overrides.gameVersion ?? "15.22.701.1234",
      gameDuration: overrides.gameDuration ?? 1800,
      queueId: overrides.queueId ?? 420,
      participants,
      teams: (overrides.bans ?? [[], []]).map((bans) => ({
        bans: bans.map((championId) => ({ championId })),
      })),
    },
  };
}

describe("patches", () => {
  test("patchOf", () => {
    expect(patchOf("15.22.701.1234")).toBe("15.22");
  });

  test("comparePatch compares numbers", () => {
    expect(comparePatch("15.9", "15.10")).toBeLessThan(0);
    expect(comparePatch("16.1", "15.24")).toBeGreaterThan(0);
    expect(comparePatch("15.22", "15.22")).toBe(0);
  });
});

describe("addMatch", () => {
  test("counts games, wins and roles", () => {
    const file = emptyStats("15.22", 0);
    const match = makeMatch({ participants: [{}, {}, { championId: ORIANNA, teamPosition: "MIDDLE", win: true }] });
    expect(addMatch(file, match)).toBe(true);
    expect(file.matches).toBe(1);
    expect(file.champions[String(ORIANNA)].roles.middle).toEqual({ games: 1, wins: 1 });
  });

  test("a loss counts a game but not a win", () => {
    const file = emptyStats("15.22", 0);
    addMatch(file, makeMatch({ participants: [{ championId: ORIANNA, teamPosition: "MIDDLE", win: false }] }));
    expect(file.champions[String(ORIANNA)].roles.middle).toEqual({ games: 1, wins: 0 });
  });

  test("a champion banned by both teams counts once", () => {
    const file = emptyStats("15.22", 0);
    addMatch(file, makeMatch({ bans: [[GALIO], [GALIO]] }));
    expect(file.champions[String(GALIO)].bans).toBe(1);
  });

  test("a banned champion nobody played gets an entry", () => {
    const file = emptyStats("15.22", 0);
    addMatch(file, makeMatch({ bans: [[GALIO], []] }));
    expect(file.champions[String(GALIO)]).toEqual({ bans: 1, roles: {} });
  });

  test("no-ban entries are ignored", () => {
    const file = emptyStats("15.22", 0);
    addMatch(file, makeMatch({ bans: [[-1, 0], [-1]] }));
    expect(file.champions["-1"]).toBeUndefined();
    expect(file.champions["0"]).toBeUndefined();
  });

  test("remakes, other queues and other patches are not counted", () => {
    const file = emptyStats("15.22", 0);
    expect(addMatch(file, makeMatch({ gameDuration: 299 }))).toBe(false);
    expect(addMatch(file, makeMatch({ queueId: 440 }))).toBe(false);
    expect(addMatch(file, makeMatch({ gameVersion: "15.23.1.1" }))).toBe(false);
    expect(file.matches).toBe(0);
    expect(file.champions).toEqual({});
  });

  test("participants without a position are skipped", () => {
    const file = emptyStats("15.22", 0);
    addMatch(file, makeMatch({ participants: [{ championId: ORIANNA, teamPosition: "" }] }));
    expect(file.matches).toBe(1);
    expect(file.champions[String(ORIANNA)]).toBeUndefined();
  });
});
