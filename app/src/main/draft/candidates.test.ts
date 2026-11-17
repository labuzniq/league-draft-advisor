import type { StatsFile } from "@lda/shared";
import { expect, test } from "vitest";
import fixture from "../../../test/fixtures/stats.json";
import type { DraftState } from "../../shared/types";
import { CANDIDATE_LIMIT, selectCandidates, selectCandidatesWithoutStats } from "./candidates";

const stats = fixture as StatsFile;

function draft(overrides: Partial<DraftState> = {}): DraftState {
  return { phase: "pick", role: "middle", allies: [], enemies: [], bans: [], localPlayerLocked: false, myTurn: true, ...overrides };
}

const owned = (...entries: [number, number?][]) => entries.map(([championId, masteryPoints = 0]) => ({ championId, masteryPoints }));
const idsOf = (candidates: { championId: number }[]) => candidates.map((c) => c.championId);

test("keeps owned champions of the role", () => {
  const ids = idsOf(selectCandidates({ state: draft(), role: "middle", stats, owned: owned([61], [3]), showAll: false }));
  expect(ids).toEqual(expect.arrayContaining([61, 3]));
  expect(ids).not.toContain(103);
});

test("drops picked and banned champions", () => {
  const state = draft({ enemies: [{ championId: 103 }], bans: [3] });
  const ids = idsOf(selectCandidates({ state, role: "middle", stats, owned: owned([61], [3], [103]), showAll: false }));
  expect(ids).toEqual([61]);
});

test("showAll ignores ownership", () => {
  const ids = idsOf(selectCandidates({ state: draft(), role: "middle", stats, owned: [], showAll: true }));
  expect(ids).toContain(103);
});

test("drops champions rarely played in the role", () => {
  const ids = idsOf(selectCandidates({ state: draft(), role: "middle", stats, owned: owned([89], [61]), showAll: true }));
  expect(ids).not.toContain(89);
});

test("mastery lifts a champion over a slightly stronger one", () => {
  const custom: StatsFile = {
    ...stats,
    champions: {
      "1": { bans: 0, roles: { middle: { games: 1000, wins: 520 } } },
      "2": { bans: 0, roles: { middle: { games: 1000, wins: 515 } } },
    },
  };
  const weakerButPlayed = 2;
  const ids = idsOf(selectCandidates({ state: draft(), role: "middle", stats: custom, owned: owned([1, 0], [2, 100_000]), showAll: false }));
  expect(ids[0]).toBe(weakerButPlayed);
});

test("at most CANDIDATE_LIMIT", () => {
  const champions: StatsFile["champions"] = {};
  for (let id = 1; id <= 40; id++) champions[String(id)] = { bans: 0, roles: { middle: { games: 1000, wins: 500 } } };
  const result = selectCandidates({ state: draft(), role: "middle", stats: { ...stats, champions }, owned: [], showAll: true });
  expect(result).toHaveLength(CANDIDATE_LIMIT);
});

test("champion missing from stats is skipped without error", () => {
  const ids = idsOf(selectCandidates({ state: draft(), role: "middle", stats, owned: owned([61], [9999]), showAll: false }));
  expect(ids).not.toContain(9999);
});

test("without stats: most-played owned champions that are still open", () => {
  const state = draft({ bans: [103] });
  const result = selectCandidatesWithoutStats({ state, owned: owned([61, 50_000], [3, 90_000], [103, 10_000]) });
  expect(idsOf(result)).toEqual([3, 61]);
  expect(result[0]).toMatchObject({ games: 0, winRate: 0, pickRate: 0, score: 0, masteryPoints: 90_000 });
});
