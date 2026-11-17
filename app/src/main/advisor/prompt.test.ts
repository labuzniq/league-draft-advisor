import type { StatsFile } from "@lda/shared";
import { expect, test } from "vitest";
import fixture from "../../../test/fixtures/stats.json";
import { makeSession } from "../../../test/helpers/session";
import type { ChampionInfo } from "../champions/ddragon";
import { selectCandidates, type Candidate } from "../draft/candidates";
import { toDraftState } from "../draft/state";
import { buildContext, buildUserMessage, keepValidPicks, parsePartialAdvice, type PromptData } from "./prompt";

const stats = fixture as StatsFile;

const champion = (id: number, name: string, tags: string[]): ChampionInfo => ({
  id,
  name,
  tags,
  kit: `Passive - ${name} passive.\nR - ${name} ultimate.`,
  imageUrl: `https://example.test/${name}.png`,
});

const champions = new Map(
  [
    champion(3, "Galio", ["Tank", "Mage"]),
    champion(59, "Jarvan IV", ["Tank", "Fighter"]),
    champion(61, "Orianna", ["Mage", "Support"]),
    champion(89, "Leona", ["Tank", "Support"]),
    champion(103, "Ahri", ["Mage", "Assassin"]),
    champion(222, "Jinx", ["Marksman"]),
  ].map((c) => [c.id, c]),
);

const data: PromptData = { champions, stats };

const state = toDraftState(makeSession({ myRole: "middle", allyPicks: [{ championId: 59, role: "jungle" }], enemyPicks: [103], bans: [222], localPicking: true }));
const candidates = selectCandidates({ state, role: "middle", stats, owned: [], showAll: true });
const input = { role: "middle" as const, state, candidates };

const candidate = (championId: number): Candidate => ({ championId, games: 0, winRate: 0, pickRate: 0, masteryPoints: 0, score: 0 });

test("context is stable for the same input", () => {
  expect(buildContext(input, data).system).toBe(buildContext(input, data).system);
});

test("context lists champions sorted by ID and includes candidate numbers", () => {
  const { system, championIds } = buildContext(input, data);
  expect(system.indexOf("Galio")).toBeGreaterThan(-1);
  expect(system.indexOf("Galio")).toBeLessThan(system.indexOf("Jarvan IV"));
  expect(system.indexOf("Jarvan IV")).toBeLessThan(system.indexOf("Orianna"));
  expect(system.indexOf("Orianna")).toBeLessThan(system.indexOf("Ahri"));
  expect(system).toContain("52.0%");
  expect([...championIds].sort((a, b) => a - b)).toEqual([3, 59, 61, 103]);
});

test("context without statistics has no statistics lines", () => {
  const { system } = buildContext(input, { champions });
  expect(system).not.toContain("%");
  expect(system).toContain("Statistics are not available");
});

test("user message names open candidates and guesses enemy roles", () => {
  const context = buildContext(input, data);
  const msg = buildUserMessage({ context, ...input }, data);
  expect(msg).toContain("Your role: middle");
  expect(msg).toContain("Open candidates: Galio (ID 3), Orianna (ID 61)");
  expect(msg).toContain("Jarvan IV (ID 59), jungle");
  expect(msg).toContain("Ahri (ID 103), likely middle");
  expect(msg).toContain("Bans: Jinx (ID 222)");
});

test("user message carries data for a newly picked champion that is not in the context", () => {
  const context = buildContext(input, data);
  const later = { ...state, allies: [...state.allies, { championId: 89, role: "utility" as const }] };
  const msg = buildUserMessage({ context, role: "middle", state: later, candidates }, data);
  expect(msg).toContain("Leona");
  expect(msg).toContain("Leona ultimate.");
  expect(msg).not.toContain("Ahri ultimate.");
});

test("user message carries data for a new candidate that is not in the context", () => {
  const context = buildContext(input, data);
  const leona: Candidate = { championId: 89, games: 520, winRate: 0.5, pickRate: 0.026, masteryPoints: 0, score: 0 };
  const msg = buildUserMessage({ context, role: "middle", state, candidates: [...candidates, leona] }, data);
  expect(msg).toContain("Leona ultimate.");
  expect(msg).toContain("middle: win rate 50.0%, pick rate 2.6%, ban rate 2.0%, 520 games");
  expect(msg).not.toContain("Orianna ultimate.");
});

test("unknown champion does not throw", () => {
  const context = buildContext(input, data);
  const later = { ...state, enemies: [...state.enemies, { championId: 9999 }] };
  const msg = buildUserMessage({ context, role: "middle", state: later, candidates }, data);
  expect(msg).toContain("Unknown champion (ID 9999)");
});

test("parsePartialAdvice returns finished parts only", () => {
  expect(parsePartialAdvice('{"teamRead":"No frontline","picks":[{"championId":61,"reason":"Combo."},{"championId":3,"rea')).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo." }] });
  expect(parsePartialAdvice('{"teamRead":"No fr')).toEqual({});
});

test("parsePartialAdvice handles quotes and braces inside strings", () => {
  expect(parsePartialAdvice('{"teamRead":"Say \\"go\\" {now}","picks":[{"championId":61,"reason":"Use } and \\" here."}')).toEqual({
    teamRead: 'Say "go" {now}',
    picks: [{ championId: 61, reason: 'Use } and " here.' }],
  });
});

test("keepValidPicks drops champions that are not candidates", () => {
  const advice = { teamRead: "Read.", picks: [{ championId: 61, reason: "A." }, { championId: 103, reason: "B." }] };
  const result = keepValidPicks(advice, [candidate(61)]);
  expect(result.picks.map((p) => p.championId)).toEqual([61]);
});

test("keepValidPicks drops repeated champions and keeps at most 5", () => {
  const ids = [1, 1, 2, 3, 4, 5, 6];
  const advice = { teamRead: "Read.", picks: ids.map((championId) => ({ championId, reason: "R." })) };
  const result = keepValidPicks(advice, ids.map(candidate));
  expect(result.picks.map((p) => p.championId)).toEqual([1, 2, 3, 4, 5]);
});
