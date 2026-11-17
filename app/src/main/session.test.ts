import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatsFile } from "@lda/shared";
import { afterEach, expect, test, vi } from "vitest";
import recordingFile from "../../test/fixtures/recording.json";
import statsFile from "../../test/fixtures/stats.json";
import { startFakeLcu } from "../../test/helpers/fake-lcu";
import { MODELS } from "../shared/models";
import type { Advice, AppView } from "../shared/types";
import type { AdviceRequest, Advisor } from "./advisor/advisor";
import type { PromptData } from "./advisor/prompt";
import type { ChampionInfo } from "./champions/ddragon";
import { LcuClient, type Recording } from "./lcu/client";
import type { LcuCredentials } from "./lcu/locate";
import { DraftSession } from "./session";
import { SettingsStore, type KeyCipher } from "./settings";

const recording = recordingFile as Recording;
const stats = statsFile as StatsFile;
const ORIANNA = 61;
const ANSWER: Advice = { teamRead: "Jarvan IV brings engage.", picks: [{ championId: ORIANNA, reason: "Her ball follows Jarvan IV into fights." }] };
const DELETE_EVENT = 3;

const imageUrl = (name: string) => `https://ddragon.leagueoflegends.com/cdn/15.22.1/img/champion/${name}.png`;
const champion = (id: number, name: string): ChampionInfo => ({ id, name, tags: [], kit: "", imageUrl: imageUrl(name) });
const champions = new Map(
  [champion(59, "Jarvan IV"), champion(103, "Ahri"), champion(ORIANNA, "Orianna"), champion(3, "Galio")].map((c) => [c.id, c]),
);
const cipher: KeyCipher = { encrypt: (text) => Buffer.from(text), decrypt: (data) => data.toString() };
const noClient: AppView = { screen: "waiting", reason: "no-client" };
const noChampSelect: AppView = { screen: "waiting", reason: "no-champ-select" };
const unreadable: AppView = { screen: "waiting", reason: "unreadable" };
const UNREADABLE_EVENT = { atMs: 0, eventType: "Update" as const, data: {} };

class FakeAdvisor implements Advisor {
  readonly requests: { req: AdviceRequest; signal: AbortSignal }[] = [];
  constructor(private readonly answer?: Advice) {}

  advise(req: AdviceRequest, _onPartial: (a: Partial<Advice>) => void, signal: AbortSignal): Promise<Advice> {
    this.requests.push({ req, signal });
    return this.answer ? Promise.resolve(this.answer) : new Promise<Advice>(() => {});
  }
}

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function settingsStore(apiKey?: string): SettingsStore {
  const dir = mkdtempSync(join(tmpdir(), "lda-session-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new SettingsStore(join(dir, "settings.json"), cipher);
  if (apiKey) store.setApiKey(apiKey);
  return store;
}

async function startSession(opts: {
  answer?: Advice | "never";
  noStats?: boolean;
  recording?: Recording;
  beforeStart?: (fake: { send(index: number): Promise<void> }) => Promise<void>;
  loadChampions?: () => Promise<{ version: string; champions: Map<number, ChampionInfo> }>;
  settings?: SettingsStore;
  locate?: (fakeCreds: LcuCredentials) => () => Promise<LcuCredentials | undefined>;
} = {}) {
  const fake = await startFakeLcu(opts.recording ?? recording);
  cleanups.push(() => fake.stop());
  await opts.beforeStart?.(fake);
  const views: AppView[] = [];
  const made: { model: string; data: PromptData; advisor: FakeAdvisor }[] = [];
  const settings = opts.settings ?? settingsStore("sk-test");
  const locate = vi.fn(opts.locate?.(fake.creds) ?? (async () => fake.creds));
  const makeClient = vi.fn((creds: LcuCredentials) => new LcuClient(creds));
  const session = new DraftSession({
    locate,
    makeClient,
    makeAdvisor: (_apiKey, model, data) => {
      const advisor = new FakeAdvisor(opts.answer === "never" ? undefined : (opts.answer ?? ANSWER));
      made.push({ model, data, advisor });
      return advisor;
    },
    settings,
    loadStats: async () => (opts.noStats ? undefined : stats),
    loadChampions: opts.loadChampions ?? (async () => ({ version: "15.22.1", champions })),
    onView: (view) => views.push(view),
    pollMs: 20,
  });
  cleanups.push(() => session.stop());
  await session.start();
  return { fake, session, settings, views, made, locate, makeClient, last: () => views.at(-1) };
}

const draftOf = (view: AppView | undefined) => {
  if (view?.screen !== "draft") throw new Error(`not a draft view: ${JSON.stringify(view)}`);
  return view;
};

async function untilReady(last: () => AppView | undefined) {
  await vi.waitFor(() => expect(last()).toMatchObject({ screen: "draft", advice: { status: "ready" } }), { timeout: 3000 });
  return draftOf(last());
}

async function enterPickPhase(fake: { send(index: number): Promise<void> }, last: () => AppView | undefined) {
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
  for (const index of [0, 1, 2]) await fake.send(index);
}

test("setup screen without an API key", async () => {
  const { views, locate } = await startSession({ settings: settingsStore() });
  expect(views).toEqual([{ screen: "setup" }]);
  expect(locate).not.toHaveBeenCalled();
});

test("shows the no-data screen when champion data cannot be loaded, then recovers", async () => {
  const loadChampions = vi
    .fn<() => Promise<{ version: string; champions: Map<number, ChampionInfo> }>>()
    .mockRejectedValueOnce(new Error("Champion data is not available."))
    .mockResolvedValue({ version: "15.22.1", champions });
  const { fake, views, locate, made, last } = await startSession({ loadChampions });
  expect(views).toEqual([{ screen: "waiting", reason: "no-data" }]);
  expect(locate).not.toHaveBeenCalled();
  await enterPickPhase(fake, last);
  const view = await untilReady(last);
  expect(view.allies).toMatchObject([{ name: "Jarvan IV" }]);
  expect(made.at(-1)?.data.champions).toBe(champions);
  expect(loadChampions).toHaveBeenCalledTimes(2);
});

test("setup comes first when champion data cannot be loaded and there is no key", async () => {
  const { views } = await startSession({ settings: settingsStore(), loadChampions: async () => Promise.reject(new Error("offline")) });
  expect(views).toEqual([{ screen: "setup" }]);
});

test("shows the unreadable screen for a session it cannot read, then recovers", async () => {
  const { fake, last } = await startSession({ recording: { ...recording, events: [UNREADABLE_EVENT, ...recording.events] } });
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
  await fake.send(0);
  await vi.waitFor(() => expect(last()).toEqual(unreadable));
  for (const index of [1, 2, 3]) await fake.send(index);
  const view = await untilReady(last);
  expect(view.enemies).toMatchObject([{ name: "Ahri" }]);
});

test("an unreadable first session keeps the connection", async () => {
  const { fake, makeClient, last } = await startSession({
    recording: { ...recording, events: [UNREADABLE_EVENT, ...recording.events] },
    beforeStart: (fake) => fake.send(0),
  });
  await vi.waitFor(() => expect(last()).toEqual(unreadable));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(makeClient).toHaveBeenCalledTimes(1);
  expect(last()).toEqual(unreadable);
  await fake.send(4);
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
});

test("waiting until the client is found, then waiting for champion select", async () => {
  let calls = 0;
  const { views, locate, last } = await startSession({ locate: (creds) => async () => (++calls > 2 ? creds : undefined) });
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
  expect(views[0]).toEqual(noClient);
  expect(views.filter((view) => view.screen !== "waiting" || view.reason !== "no-client")).toEqual([noChampSelect]);
  expect(locate).toHaveBeenCalledTimes(3);
});

test("draft view shows allies, enemies and suggestions after the recording plays", async () => {
  const { fake, last } = await startSession();
  await enterPickPhase(fake, last);
  const view = await untilReady(last);
  expect(view).toMatchObject({ patch: "15.22", statsMissing: false, role: "middle", myTurn: true });
  expect(view.allies).toEqual([{ name: "Jarvan IV", imageUrl: imageUrl("Jarvan IV"), role: "jungle" }]);
  expect(view.enemies).toEqual([{ name: "Ahri", imageUrl: imageUrl("Ahri") }]);
  expect(view.advice).toEqual({
    status: "ready",
    teamRead: ANSWER.teamRead,
    picks: [{ name: "Orianna", imageUrl: imageUrl("Orianna"), winRate: 0.52, reason: ANSWER.picks[0].reason }],
  });
});

test("back to waiting when champion select ends, and the request is cancelled", async () => {
  const { fake, made, last } = await startSession({ answer: "never" });
  await enterPickPhase(fake, last);
  await vi.waitFor(() => expect(made[0].advisor.requests).toHaveLength(1), { timeout: 3000 });
  await fake.send(DELETE_EVENT);
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
  expect(made[0].advisor.requests[0].signal.aborted).toBe(true);
});

test("statsMissing view when no statistics file is available", async () => {
  const { fake, made, last } = await startSession({ noStats: true });
  await enterPickPhase(fake, last);
  const view = await untilReady(last);
  expect(view.statsMissing).toBe(true);
  expect(view.patch).toBeUndefined();
  expect(view.advice).toMatchObject({ picks: [{ name: "Orianna", reason: ANSWER.picks[0].reason }] });
  expect(made[0].data.stats).toBeUndefined();
  expect(made[0].advisor.requests[0].req.candidates.map((c) => c.championId)).toEqual([ORIANNA, 3]);
});

test("the view never contains player names", async () => {
  const { fake, views, last } = await startSession();
  await enterPickPhase(fake, last);
  await untilReady(last);
  await fake.send(DELETE_EVENT);
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
  expect(JSON.stringify(views)).not.toContain("SecretName");
});

test("resets the controller when the client closes", async () => {
  const { fake, made, last } = await startSession({ answer: "never" });
  await enterPickPhase(fake, last);
  await vi.waitFor(() => expect(made[0].advisor.requests).toHaveLength(1), { timeout: 3000 });
  await fake.stop();
  await vi.waitFor(() => expect(last()).toEqual(noClient));
  expect(made[0].advisor.requests[0].signal.aborted).toBe(true);
});

test("keeps looking when connecting fails", async () => {
  const unused = createServer();
  await new Promise<void>((resolve) => unused.listen(0, "127.0.0.1", resolve));
  const closedPort = (unused.address() as AddressInfo).port;
  await new Promise<void>((resolve) => unused.close(() => resolve()));
  let calls = 0;
  const { makeClient, last } = await startSession({
    locate: (creds) => async () => (++calls === 1 ? { port: closedPort, token: creds.token } : creds),
  });
  await vi.waitFor(() => expect(last()).toEqual(noChampSelect));
  expect(makeClient).toHaveBeenCalledTimes(2);
  expect(makeClient.mock.results[0].value).not.toBe(makeClient.mock.results[1].value);
});

test("a settings change rebuilds the advisor", async () => {
  const { fake, session, settings, made, last } = await startSession();
  await enterPickPhase(fake, last);
  await untilReady(last);
  settings.set({ model: MODELS[1] });
  session.settingsChanged();
  expect(made.map((m) => m.model)).toEqual([MODELS[0], MODELS[1]]);
  await vi.waitFor(() => expect(made[1].advisor.requests).toHaveLength(1), { timeout: 3000 });
  await untilReady(last);
});
