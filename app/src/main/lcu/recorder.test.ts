import { afterEach, expect, test } from "vitest";
import recordingFile from "../../../test/fixtures/recording.json";
import { startFakeLcu } from "../../../test/helpers/fake-lcu";
import { LcuClient, type Recording } from "./client";
import { Recorder } from "./recorder";

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
