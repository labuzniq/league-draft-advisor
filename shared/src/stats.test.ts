import { expect, test } from "vitest";
import { banRate, mainRole, pickRate, roleStats, winRate, type StatsFile } from "./stats";

const file: StatsFile = {
  patch: "15.22",
  updatedAt: "2026-11-17T00:00:00Z",
  windowEnd: 0,
  matches: 1000,
  champions: { "61": { bans: 50, roles: { middle: { games: 100, wins: 52 }, utility: { games: 10, wins: 4 } } } },
};

test("winRate", () => {
  expect(winRate({ games: 100, wins: 52 })).toBe(0.52);
  expect(winRate({ games: 0, wins: 0 })).toBe(0);
});

test("pickRate and banRate", () => {
  expect(pickRate(file, 61, "middle")).toBe(0.1);
  expect(banRate(file, 61)).toBe(0.05);
});

test("mainRole", () => {
  expect(mainRole(file, 61)).toBe("middle");
  expect(mainRole(file, 999)).toBeUndefined();
});

test("missing champion gives zeros", () => {
  expect(roleStats(file, 999, "top")).toEqual({ games: 0, wins: 0 });
  expect(pickRate(file, 999, "top")).toBe(0);
});
