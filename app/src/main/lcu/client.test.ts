import { afterEach, expect, test, vi } from "vitest";
import recordingFile from "../../../test/fixtures/recording.json";
import { startFakeLcu } from "../../../test/helpers/fake-lcu";
import type { LcuChampSelectSession } from "../draft/state";
import { LCU_TIMEOUT_MS, LcuClient, type Recording } from "./client";

const recording = recordingFile as Recording;
const OWNED_PATH = "/lol-champions/v1/owned-champions-minimal";
const MASTERY_PATH = "/lol-champion-mastery/v1/local-player/champion-mastery";
const SHORT_TIMEOUT_MS = 50;
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function connected(source: Recording = recording, options: Parameters<typeof startFakeLcu>[1] = {}) {
  const fake = await startFakeLcu(source, options);
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

test("websocket frames that are not the expected shape are ignored", async () => {
  const { fake, client } = await connected();
  const events: string[] = [];
  const delivered = new Promise<void>((resolve) => {
    client.onSession((_session, eventType) => {
      events.push(eventType);
      resolve();
    });
  });
  const event = "OnJsonApiEvent_lol-champ-select_v1_session";
  for (const frame of [[8, event], [8, event, null], [8, event, "text"], [8, event, { data: {} }]]) await fake.sendRaw(JSON.stringify(frame));
  await fake.send(0);
  await delivered;
  expect(events).toEqual(["Create"]);
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

test("a failed mastery request counts every champion as 0 points", async () => {
  const { client } = await connected(recording, { failPaths: [MASTERY_PATH] });
  expect(await client.getOwnedChampions()).toEqual([{ championId: 61, masteryPoints: 0 }, { championId: 3, masteryPoints: 0 }]);
});

test("a failed ownership request rejects", async () => {
  const { client } = await connected(recording, { failPaths: [OWNED_PATH] });
  await expect(client.getOwnedChampions()).rejects.toThrow(/500/);
});

test("the League client gets 5 seconds to answer", () => {
  expect(LCU_TIMEOUT_MS).toBe(5000);
});

test("getRaw rejects when the League client does not answer in time", async () => {
  const fake = await startFakeLcu(recording, { hangPaths: [OWNED_PATH] });
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds, SHORT_TIMEOUT_MS);
  await expect(client.getRaw(OWNED_PATH)).rejects.toThrow("League client did not answer in time");
});

test("connect rejects when the websocket handshake does not finish in time", async () => {
  const fake = await startFakeLcu(recording, { hangUpgrade: true });
  cleanups.push(() => fake.stop());
  const client = new LcuClient(fake.creds, SHORT_TIMEOUT_MS);
  cleanups.push(() => client.close());
  await expect(client.connect()).rejects.toThrow(/timed out/);
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
