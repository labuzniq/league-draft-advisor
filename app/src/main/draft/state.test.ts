import { expect, test } from "vitest";
import { makeSession } from "../../../test/helpers/session";
import { draftKey, toDraftState } from "./state";

test("locked picks, bans and role", () => {
  const s = toDraftState(makeSession({ myRole: "middle", allyPicks: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }], enemyPicks: [103, 89], bans: [3] }));
  expect(s).toEqual({ phase: "pick", role: "middle", allies: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }], enemies: [{ championId: 103 }, { championId: 89 }], bans: [3], localPlayerLocked: false, myTurn: false });
});

test("myTurn while the player's pick is in progress", () => {
  expect(toDraftState(makeSession({ myRole: "middle", localPicking: true })).myTurn).toBe(true);
});

test("ban phase while bans are open", () => {
  expect(toDraftState(makeSession({ myRole: "middle", bansDone: false })).phase).toBe("ban");
});

test("done after the player locks in", () => {
  const s = toDraftState(makeSession({ myRole: "middle", localLocked: 61 }));
  expect(s.phase).toBe("done");
  expect(s.localPlayerLocked).toBe(true);
  expect(s.allies).toEqual([]);
});

test("no role in queues without roles", () => {
  expect(toDraftState(makeSession({})).role).toBeUndefined();
});

test("hovered but not locked picks are ignored", () => {
  const session = makeSession({ myRole: "middle", localPicking: true });
  const hovered = session.actions[1].find((a) => a.isInProgress);
  if (hovered) hovered.championId = 61;
  const s = toDraftState(session);
  expect(s.allies).toEqual([]);
  expect(s.localPlayerLocked).toBe(false);
});

test("draftKey ignores order", () => {
  const a = toDraftState(makeSession({ myRole: "middle", allyPicks: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }], enemyPicks: [103, 89], bans: [3, 7] }));
  const sameWithPicksReordered = toDraftState(makeSession({ myRole: "middle", allyPicks: [{ championId: 222, role: "bottom" }, { championId: 59, role: "jungle" }], enemyPicks: [89, 103], bans: [7, 3] }));
  expect(draftKey(a, "middle")).toBe(draftKey(sameWithPicksReordered, "middle"));
  expect(draftKey(a, "middle")).not.toBe(draftKey(a, "top"));
});

test("state holds no player names", () => {
  const session = makeSession({ myRole: "middle", allyPicks: [{ championId: 59, role: "jungle" }], enemyPicks: [103] });
  const named = { ...session, myTeam: session.myTeam.map((m) => ({ ...m, gameName: "SecretName" })), theirTeam: session.theirTeam.map((m) => ({ ...m, gameName: "SecretName" })) };
  expect(JSON.stringify(toDraftState(named))).not.toContain("SecretName");
});
