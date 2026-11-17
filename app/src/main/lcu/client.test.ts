import { afterEach, expect, test, vi } from "vitest";
import recordingFile from "../../../test/fixtures/recording.json";
import { startFakeLcu } from "../../../test/helpers/fake-lcu";
import type { LcuChampSelectSession } from "../draft/state";
import { LcuClient, type Recording } from "./client";

const recording = recordingFile as Recording;
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function connected(source: Recording = recording) {
  const fake = await startFakeLcu(source);
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds);
  cleanups.push(() => client.close());
  await client.connect();
  return { fake, client };
}

test("client receives session events and the end of champion select", async () => {
  const { fake, client } = await connected();
  const received: (LcuChampSelectSession | null)[] = [];
  const done = new Promise<void>((resolve) => {
    client.onSession((session) => {
      received.push(session);
      if (session === null) resolve();
    });
  });
  await fake.play();
  await done;
  expect(received).toHaveLength(4);
  expect(received.slice(0, 3).every((s) => s !== null && s.localPlayerCellId === 0)).toBe(true);
  expect(received[3]).toBeNull();
});

test("a session already running at connect is delivered like a Create event", async () => {
  const fake = await startFakeLcu({ ...recording, events: recording.events.slice(0, 2) });
  cleanups.push(() => fake.stop());
  await fake.play();
  const client = new LcuClient(fake.creds);
  cleanups.push(() => client.close());
  const events: string[] = [];
  client.onSession((_session, eventType) => events.push(eventType));
  await client.connect();
  expect(events).toEqual(["Create"]);
});

test("nothing is delivered at connect when champion select is not running", async () => {
  const fake = await startFakeLcu(recording);
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds);
  cleanups.push(() => client.close());
  const events: string[] = [];
  client.onSession((_session, eventType) => events.push(eventType));
  await client.connect();
  expect(events).toEqual([]);
});

test("getOwnedChampions joins ownership and mastery", async () => {
  const { client } = await connected();
  const owned = await client.getOwnedChampions();
  expect(owned).toEqual(expect.arrayContaining([{ championId: 61, masteryPoints: expect.any(Number) }]));
  expect(owned).toEqual([{ championId: 61, masteryPoints: 48200 }, { championId: 3, masteryPoints: 15300 }]);
});

test("a champion without a mastery entry has 0 points", async () => {
  const { client } = await connected({ ...recording, mastery: [{ championId: 61, championPoints: 100 }] });
  expect(await client.getOwnedChampions()).toEqual([{ championId: 61, masteryPoints: 100 }, { championId: 3, masteryPoints: 0 }]);
});

test("getRaw rejects with the status for a non-2xx answer", async () => {
  const { client } = await connected();
  await expect(client.getRaw("/lol-champ-select/v1/session")).rejects.toThrow(/404/);
});

test("onClose fires when the client goes away", async () => {
  const { fake, client } = await connected();
  const closed = new Promise<void>((resolve) => client.onClose(resolve));
  await fake.stop();
  await closed;
});

test("wrong token is rejected", async () => {
  const fake = await startFakeLcu(recording);
  cleanups.push(() => fake.stop());
  const client = new LcuClient({ port: fake.creds.port, token: "bad" });
  cleanups.push(() => client.close());
  await expect(client.connect()).rejects.toThrow();
});

test("connect rejects when nothing is listening", async () => {
  const fake = await startFakeLcu(recording);
  const { creds } = fake;
  await fake.stop();
  await expect(new LcuClient(creds).connect()).rejects.toThrow();
});

test("a failed session request closes the socket and fires no callbacks", async () => {
  const fake = await startFakeLcu(recording, { failSession: true });
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds);
  const calls: string[] = [];
  client.onSession(() => calls.push("session"));
  client.onClose(() => calls.push("close"));
  await expect(client.connect()).rejects.toThrow(/500/);
  await vi.waitFor(() => expect(fake.openSockets()).toBe(0));
  await fake.play();
  expect(calls).toEqual([]);
});

test("close does not fire onClose", async () => {
  const { fake, client } = await connected();
  let closed = false;
  client.onClose(() => (closed = true));
  client.close();
  await vi.waitFor(() => expect(fake.openSockets()).toBe(0));
  expect(closed).toBe(false);
});
