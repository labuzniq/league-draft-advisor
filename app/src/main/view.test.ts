import type { StatsFile } from "@lda/shared";
import { expect, test } from "vitest";
import statsFile from "../../test/fixtures/stats.json";
import type { DraftState } from "../shared/types";
import type { AdviceView } from "./advisor/controller";
import type { ChampionInfo } from "./champions/ddragon";
import type { Candidate } from "./draft/candidates";
import { buildDraftView } from "./view";

const stats = statsFile as StatsFile;
const ORIANNA = 61;
const champion = (id: number, name: string): ChampionInfo => ({ id, name, tags: [], kit: "", imageUrl: `${name}.png` });
const champions = new Map([champion(59, "Jarvan IV"), champion(103, "Ahri"), champion(ORIANNA, "Orianna")].map((c) => [c.id, c]));

const draft: DraftState = {
  phase: "pick",
  role: "middle",
  allies: [{ championId: 59, role: "jungle" }],
  enemies: [{ championId: 103 }],
  bans: [],
  localPlayerLocked: false,
  myTurn: true,
};

const candidate = (championId: number): Candidate => ({ championId, games: 0, winRate: 0, pickRate: 0, masteryPoints: 0, score: 0 });

const build = (advice: AdviceView, overrides: { draft?: DraftState; chosenRole?: "top"; stats?: StatsFile } = {}) =>
  buildDraftView({ draft: overrides.draft ?? draft, chosenRole: overrides.chosenRole, advice, champions, stats: "stats" in overrides ? overrides.stats : stats });

test("shows the draft with patch, role, turn and champion chips", () => {
  expect(build({ status: "idle" })).toEqual({
    screen: "draft",
    patch: "15.22",
    statsMissing: false,
    role: "middle",
    myTurn: true,
    allies: [{ name: "Jarvan IV", imageUrl: "Jarvan IV.png", role: "jungle" }],
    enemies: [{ name: "Ahri", imageUrl: "Ahri.png" }],
    advice: { status: "idle" },
  });
});

test("a ready answer becomes pick rows with the win rate for the player's role", () => {
  const view = build({ status: "ready", advice: { teamRead: "Engage team.", picks: [{ championId: ORIANNA, reason: "Ball and Jarvan IV." }] } });
  expect(view.advice).toEqual({
    status: "ready",
    teamRead: "Engage team.",
    picks: [{ name: "Orianna", imageUrl: "Orianna.png", winRate: 0.52, reason: "Ball and Jarvan IV." }],
  });
});

test("a loading answer shows the picks that have arrived", () => {
  expect(build({ status: "loading", partial: {} }).advice).toEqual({ status: "loading", teamRead: undefined, picks: [] });
  expect(build({ status: "loading", partial: { picks: [{ championId: ORIANNA, reason: "Ball." }] } }).advice).toMatchObject({
    status: "loading",
    picks: [{ name: "Orianna", reason: "Ball." }],
  });
});

test("an error shows the message and the fallback picks without reasons", () => {
  expect(build({ status: "error", message: "Claude is busy.", fallback: [candidate(ORIANNA)] }).advice).toEqual({
    status: "error",
    message: "Claude is busy.",
    picks: [{ name: "Orianna", imageUrl: "Orianna.png", winRate: 0.52 }],
  });
});

test("need-role uses the chosen role once the player picks one", () => {
  const noRole = { ...draft, role: undefined };
  expect(build({ status: "need-role" }, { draft: noRole })).toMatchObject({ role: undefined, advice: { status: "need-role" } });
  expect(build({ status: "idle" }, { draft: noRole, chosenRole: "top" }).role).toBe("top");
});

test("without statistics there is no patch and no win rate", () => {
  const view = build({ status: "ready", advice: { teamRead: "", picks: [{ championId: ORIANNA, reason: "Ball." }] } }, { stats: undefined });
  expect(view).toMatchObject({ patch: undefined, statsMissing: true });
  expect(view.advice).toMatchObject({ picks: [{ name: "Orianna", winRate: undefined }] });
});

test("a champion without games in the role has no win rate", () => {
  const view = build({ status: "error", message: "x", fallback: [candidate(59)] });
  expect(view.advice).toMatchObject({ picks: [{ name: "Jarvan IV", winRate: undefined }] });
});

test("a champion missing from the champion data shows as unknown", () => {
  const view = build({ status: "idle" }, { draft: { ...draft, enemies: [{ championId: 999 }] } });
  expect(view.enemies).toEqual([{ name: "Unknown champion", imageUrl: "" }]);
});
