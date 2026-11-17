import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, expect, test, vi } from "vitest";
import type { Advice } from "../../shared/types";
import type { ChampionInfo } from "../champions/ddragon";
import type { Candidate } from "../draft/candidates";
import { AdvisorError, ClaudeAdvisor, type AdviceRequest } from "./advisor";
import type { PromptData } from "./prompt";

const { stream, constructed } = vi.hoisted(() => ({ stream: vi.fn(), constructed: vi.fn() }));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      constructed(opts);
      Object.assign(this, { beta: { messages: { stream } } });
    }
  }
  return { ...actual, default: FakeAnthropic };
});

type Block = { type: "text"; text: string } | { type: "fallback"; from: { model: string }; to: { model: string } };
interface Body { output_config: { format: { parse?: (content: string) => unknown } } }

// Like the real stream: text deltas arrive per chunk, and when the format has a
// `parse` method the SDK parses every text block on its own before finalMessage resolves.
function respond(chunks: string[], stopReason = "end_turn", content: Block[] = [{ type: "text", text: chunks.join("") }]) {
  stream.mockImplementation((body: Body) => {
    const handlers: ((delta: string) => void)[] = [];
    return {
      on(event: string, handler: (delta: string) => void) {
        if (event === "text") handlers.push(handler);
        return this;
      },
      async finalMessage() {
        for (const chunk of chunks) handlers.forEach((handler) => handler(chunk));
        const { parse } = body.output_config.format;
        if (parse) for (const block of content) if (block.type === "text") parse(block.text);
        return { stop_reason: stopReason, content };
      },
    };
  });
}

const fallbackBlock: Block = { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } };

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
  respond(['{"teamRead":"No front', 'line","picks":[{"championId":61,', '"reason":"Combo with Jarvan IV."}', "]}"]);
  const partials: Partial<Advice>[] = [];
  const advice = await advise((a) => partials.push(a));
  expect(partials).toHaveLength(4);
  expect(partials[0]).toEqual({});
  expect(partials[1]).toEqual({ teamRead: "No frontline" });
  expect(partials[2]).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo with Jarvan IV." }] });
  expect(advice).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo with Jarvan IV." }] });
});

test("an answer whose only pick is not a candidate throws empty", async () => {
  respond(['{"teamRead":"Read.","picks":[{"championId":103,"reason":"Strong."}]}']);
  expect((await adviseError()).kind).toBe("empty");
});

test("a refusal throws refused", async () => {
  respond([], "refusal", []);
  expect((await adviseError()).kind).toBe("refused");
});

test("a refusal after some text throws refused", async () => {
  respond(['{"teamRead":"No fr'], "refusal");
  expect((await adviseError()).kind).toBe("refused");
});

test("a fallback partway through the answer joins both parts", async () => {
  const before = '{"teamRead":"No front';
  const after = 'line","picks":[{"championId":61,"reason":"Combo with Jarvan IV."}]}';
  respond([before, after], "end_turn", [{ type: "text", text: before }, fallbackBlock, { type: "text", text: after }]);
  const partials: Partial<Advice>[] = [];
  const advice = await advise((a) => partials.push(a));
  expect(partials.at(-1)).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo with Jarvan IV." }] });
  expect(advice).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo with Jarvan IV." }] });
});

test("an answer cut off at max_tokens throws other", async () => {
  respond(['{"teamRead":"Read.","pi'], "max_tokens");
  const error = await adviseError();
  expect(error.kind).toBe("other");
  expect(error.message).toBe("The suggestion was cut off.");
});

test.each([
  ["text that is not JSON", "not json"],
  ["JSON of the wrong shape", '{"teamRead":1,"picks":[]}'],
])("%s throws other", async (_name, text) => {
  respond([text]);
  const error = await adviseError();
  expect(error.kind).toBe("other");
  expect(error.message).toBe("The suggestion could not be read.");
});

test("the client talks only to the Anthropic API", () => {
  advisor();
  expect(constructed).toHaveBeenLastCalledWith({ apiKey: "test-key", baseURL: "https://api.anthropic.com", authToken: null });
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
  respond(['{"teamRead":"Read.","picks":[{"championId":61,"reason":"Fits."}]}']);
  await advise();
  const [body, options] = stream.mock.calls[0];
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.output_config.effort).toBe("low");
  expect(body.output_config.format.type).toBe("json_schema");
  expect(body.output_config.format).not.toHaveProperty("parse");
  expect(body.system).toEqual([{ type: "text", text: request.context.system, cache_control: { type: "ephemeral" } }]);
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0].role).toBe("user");
  expect(body).not.toHaveProperty("thinking");
  expect(body).not.toHaveProperty("temperature");
  expect(options).toEqual({ signal });
});
