import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import recordingFile from "../../../test/fixtures/recording.json";
import { startFakeLcu } from "../../../test/helpers/fake-lcu";
import { LcuClient, type Recording } from "./client";
import { Recorder, saveRecording } from "./recorder";

const recording = recordingFile as Recording;
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("the recorder saves the played champion select without any player data", async () => {
  const fake = await startFakeLcu(recording);
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds);
  cleanups.push(() => client.close());
  const recorder = new Recorder(client);
  await recorder.start();
  await client.connect();
  await fake.play();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const result = recorder.stop();

  expect(result.ownedChampions).toEqual(recording.ownedChampions);
  expect(result.mastery).toEqual(recording.mastery);
  expect(result.events.map((e) => e.eventType)).toEqual(recording.events.map((e) => e.eventType));

  const withoutNames = structuredClone(recording.events.map((e) => e.data)) as { myTeam?: Record<string, unknown>[] }[];
  withoutNames.forEach((data) => data?.myTeam?.forEach((member) => delete member["gameName"]));
  expect(result.events.map((e) => e.data)).toEqual(withoutNames);

  const times = result.events.map((e) => e.atMs);
  expect(times).toEqual([...times].sort((a, b) => a - b));

  expect(JSON.stringify(result)).not.toContain("SecretName");
  expect(result.sessionKeyPaths).toContain("myTeam[].gameName");
  expect(result.sessionKeyPaths).toContain("timer.phase");
  expect(result.sessionKeyPaths).toEqual([...new Set(result.sessionKeyPaths)].sort());
});

test("the recorder keeps only champion numbers from owned champions and mastery", async () => {
  const fake = await startFakeLcu({
    ...recording,
    ownedChampions: [{ id: 61, name: "Orianna", ownership: { owned: true } }],
    mastery: [{ championId: 61, championPoints: 100, puuid: "secret-id", summonerId: 7 }],
  });
  cleanups.push(() => fake.stop());
  const recorder = new Recorder(new LcuClient(fake.creds));
  await recorder.start();

  const result = recorder.stop();
  expect(result.ownedChampions).toEqual([{ id: 61 }]);
  expect(result.mastery).toEqual([{ championId: 61, championPoints: 100 }]);
});

const dirty = {
  ownedChampions: [{ id: 61, purchaseDate: "OWNED-LEAK" }],
  mastery: [{ championId: 61, championPoints: 100, puuid: "MASTERY-PUUID-LEAK" }],
  events: [
    {
      atMs: 0,
      eventType: "Create" as const,
      data: {
        localPlayerCellId: 0,
        chatDetails: { mucJwtDto: "CHAT-LEAK" },
        myTeam: [{ cellId: 0, championId: 0, assignedPosition: "middle", summonerId: 424242, puuid: "PUUID-LEAK", gameName: "NAME-LEAK", tagLine: "TAG-LEAK" }],
        theirTeam: [],
        actions: [[{ id: 0, actorCellId: 0, championId: 0, type: "ban", completed: false, isInProgress: true, isAllyAction: true, extraAction: "ACTION-LEAK" }]],
        timer: { phase: "PLANNING", adjustedTimeLeftInPhase: 99 },
        byPlayer: { "123456789": { x: 1 }, ["a".repeat(40)]: { y: 1 }, "123e4567e89b12d3a456426614174000": { z: 1 } },
      },
    },
    { atMs: 5, eventType: "Delete" as const, data: null },
  ],
};

async function recordPlayed(source: Recording): Promise<Recording> {
  const fake = await startFakeLcu(source);
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds);
  cleanups.push(() => client.close());
  const recorder = new Recorder(client);
  await recorder.start();
  await client.connect();
  await fake.play();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return recorder.stop();
}

test("the saved events, owned champions and mastery hold no field outside the allow-list", async () => {
  const result = await recordPlayed(dirty);
  const saved = JSON.stringify({ events: result.events, ownedChampions: result.ownedChampions, mastery: result.mastery });
  for (const leak of ["LEAK", "summonerId", "puuid", "gameName", "tagLine", "chatDetails", "extraAction", "purchaseDate", "424242", "adjustedTimeLeftInPhase", "byPlayer"]) {
    expect(saved).not.toContain(leak);
  }
  expect(result.sessionKeyPaths).toContain("myTeam[].puuid");
  expect(result.sessionKeyPaths).toContain("chatDetails.mucJwtDto");
});

test("key paths hide keys that look like player or account identifiers", async () => {
  const result = await recordPlayed(dirty);
  expect(result.sessionKeyPaths).toContain("byPlayer.*.x");
  expect(result.sessionKeyPaths).toContain("byPlayer.*.y");
  expect(result.sessionKeyPaths).toContain("byPlayer.*.z");
  const text = JSON.stringify(result.sessionKeyPaths);
  expect(text).not.toContain("123456789");
  expect(text).not.toContain("aaaa");
  expect(text).not.toContain("123e4567");
});

test("saveRecording writes recording-{time}.json and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "recorder-"));
  cleanups.push(() => rmSync(dir, { recursive: true }));
  const recording: Recording = { ownedChampions: [], mastery: [], events: [] };
  const path = saveRecording(recording, dir, new Date("2026-11-17T20:21:22.345Z"));
  expect(path).toBe(join(dir, "recording-2026-11-17T20-21-22-345Z.json"));
  expect(JSON.parse(readFileSync(path as string, "utf8"))).toEqual(recording);
});

test("saveRecording returns undefined and does not throw when the folder cannot be written", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const recording: Recording = { ownedChampions: [{ id: 99999 }], mastery: [], events: [] };
  expect(saveRecording(recording, join(tmpdir(), "recorder-missing-folder", "nope"), new Date())).toBeUndefined();
  expect(spy).toHaveBeenCalledOnce();
  expect(String(spy.mock.calls[0])).not.toContain("99999");
  spy.mockRestore();
});
