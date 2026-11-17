import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, expect, test, vi } from "vitest";
import type { Advice } from "../../shared/types";
import type { ChampionInfo } from "../champions/ddragon";
import type { Candidate } from "../draft/candidates";
import { AdvisorError, ClaudeAdvisor, type AdviceRequest } from "./advisor";
import type { PromptData } from "./prompt";

const stream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      Object.assign(this, { beta: { messages: { stream } } });
    }
  }
  return { ...actual, default: FakeAnthropic };
});

function fakeStream(chunks: string[], stopReason = "end_turn") {
  const handlers: ((delta: string) => void)[] = [];
  return {
    on(event: string, handler: (delta: string) => void) {
      if (event === "text") handlers.push(handler);
      return this;
    },
    async finalMessage() {
      for (const chunk of chunks) handlers.forEach((handler) => handler(chunk));
      return { stop_reason: stopReason, content: [{ type: "text", text: chunks.join("") }] };
    },
  };
}

function failingStream(error: Error) {
  return {
    on() {
      return this;
    },
    finalMessage: () => Promise.reject(error),
  };
}

const orianna: ChampionInfo = { id: 61, name: "Orianna", tags: ["Mage"], kit: "Passive - Clockwork.", imageUrl: "https://example.test/Orianna.png" };
const data: PromptData = { champions: new Map([[61, orianna]]) };
const candidate = (championId: number): Candidate => ({ championId, games: 0, winRate: 0, pickRate: 0, masteryPoints: 0, score: 0 });
const request: AdviceRequest = {
  context: { system: "Coach instructions and champion data.", championIds: new Set([61]) },
  role: "middle",
  state: { phase: "pick", role: "middle", allies: [], enemies: [], bans: [], localPlayerLocked: false, myTurn: true },
  candidates: [candidate(61)],
};

const advisor = () => new ClaudeAdvisor({ apiKey: "test-key", model: "claude-opus-5-5", data });
const signal = new AbortController().signal;
const advise = (onPartial: (a: Partial<Advice>) => void = () => {}) => advisor().advise(request, onPartial, signal);

async function adviseError(): Promise<AdvisorError> {
  const error = await advise().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AdvisorError);
  return error as AdvisorError;
}

beforeEach(() => {
  stream.mockReset();
});

test("deltas reach onPartial and the final advice is returned", async () => {
  stream.mockReturnValue(fakeStream(['{"teamRead":"No front', 'line","picks":[{"championId":61,', '"reason":"Combo with Jarvan IV."}', "]}"]));
  const partials: Partial<Advice>[] = [];
  const advice = await advise((a) => partials.push(a));
  expect(partials).toHaveLength(4);
  expect(partials[0]).toEqual({});
  expect(partials[1]).toEqual({ teamRead: "No frontline" });
  expect(partials[2]).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo with Jarvan IV." }] });
  expect(advice).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo with Jarvan IV." }] });
});

test("an answer whose only pick is not a candidate throws empty", async () => {
  stream.mockReturnValue(fakeStream(['{"teamRead":"Read.","picks":[{"championId":103,"reason":"Strong."}]}']));
  expect((await adviseError()).kind).toBe("empty");
});

test("a refusal throws refused", async () => {
  stream.mockReturnValue(fakeStream([], "refusal"));
  expect((await adviseError()).kind).toBe("refused");
});

test("a rejected API key becomes an auth error with a plain message", async () => {
  stream.mockReturnValue(failingStream(new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers())));
  const error = await adviseError();
  expect(error.kind).toBe("auth");
  expect(error.message).toBe("Your Claude API key was rejected. Check it in Settings.");
});

test("a rate limit becomes a rate-limit error", async () => {
  stream.mockReturnValue(failingStream(new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers())));
  expect((await adviseError()).kind).toBe("rate-limit");
});

test("an abort is rethrown as is", async () => {
  const abort = new Anthropic.APIUserAbortError();
  stream.mockReturnValue(failingStream(abort));
  await expect(advise()).rejects.toBe(abort);
});

test("the request carries the model, low effort and a cached system block", async () => {
  stream.mockReturnValue(fakeStream(['{"teamRead":"Read.","picks":[{"championId":61,"reason":"Fits."}]}']));
  await advise();
  const [body, options] = stream.mock.calls[0];
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.output_config.effort).toBe("low");
  expect(body.output_config.format.type).toBe("json_schema");
  expect(body.system).toEqual([{ type: "text", text: request.context.system, cache_control: { type: "ephemeral" } }]);
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0].role).toBe("user");
  expect(body).not.toHaveProperty("thinking");
  expect(body).not.toHaveProperty("temperature");
  expect(options).toEqual({ signal });
});
