import type { Role } from "@lda/shared";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { makeSession } from "../../../test/helpers/session";
import type { Advice, DraftState } from "../../shared/types";
import type { Candidate } from "../draft/candidates";
import { toDraftState } from "../draft/state";
import { AdvisorError, type AdviceRequest, type Advisor } from "./advisor";
import { AdviceController, DEBOUNCE_MS, TIMEOUT_MS, type AdviceView } from "./controller";
import type { PromptData } from "./prompt";

interface Call { req: AdviceRequest; onPartial: (a: Partial<Advice>) => void; signal: AbortSignal; resolve: (a: Advice) => void; reject: (e: unknown) => void }

class FakeAdvisor implements Advisor {
  calls: Call[] = [];
  advise(req: AdviceRequest, onPartial: (a: Partial<Advice>) => void, signal: AbortSignal): Promise<Advice> {
    return new Promise((resolve, reject) => {
      this.calls.push({ req, onPartial, signal, resolve, reject });
    });
  }
}

const data: PromptData = { champions: new Map() };
const ADVICE: Advice = { teamRead: "Needs a frontline.", picks: [{ championId: 10, reason: "Tanky." }] };
const candidate = (championId: number, score: number): Candidate => ({ championId, games: 100, winRate: 0.5, pickRate: 0.1, masteryPoints: 0, score });
const CANDIDATES = [10, 11, 12, 13, 14, 15, 16].map((id, i) => candidate(id, 10 - i));

const pickState = (opts: { myRole?: Role; enemyPicks?: number[] } = {}): DraftState =>
  toDraftState(makeSession({ myRole: "middle", ...opts }));

let advisor: FakeAdvisor;
let views: AdviceView[];
let candidatesFor: ReturnType<typeof vi.fn<(state: DraftState, role: Role) => Candidate[]>>;
let controller: AdviceController;

beforeEach(() => {
  vi.useFakeTimers();
  advisor = new FakeAdvisor();
  views = [];
  candidatesFor = vi.fn(() => CANDIDATES);
  controller = new AdviceController({ advisor, data, candidatesFor, onView: (v) => views.push(v) });
});

afterEach(() => {
  vi.useRealTimers();
});

const lastView = () => views[views.length - 1];

test("no request during bans", () => {
  controller.update(toDraftState(makeSession({ myRole: "middle", bans: [1], bansDone: false })));
  vi.advanceTimersByTime(DEBOUNCE_MS * 2);
  expect(advisor.calls).toHaveLength(0);
  expect(lastView()).toEqual({ status: "idle" });
});

test("waits 800 ms, then asks once", () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS - 1);
  expect(advisor.calls).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(advisor.calls).toHaveLength(1);
  expect(lastView()).toEqual({ status: "loading", partial: {} });
});

test("two quick updates give one request", () => {
  controller.update(pickState());
  vi.advanceTimersByTime(300);
  controller.update(pickState({ enemyPicks: [1] }));
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls).toHaveLength(1);
  expect(advisor.calls[0].req.state.enemies).toEqual([{ championId: 1 }]);
});

test("a new state aborts the running request", () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  controller.update(pickState({ enemyPicks: [1] }));
  expect(advisor.calls[0].signal.aborted).toBe(true);
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls).toHaveLength(2);
});

test("a late answer for a replaced state is not shown", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  controller.update(pickState({ enemyPicks: [1] }));
  const before = views.length;
  advisor.calls[0].onPartial({ teamRead: "late" });
  advisor.calls[0].resolve(ADVICE);
  await vi.advanceTimersByTimeAsync(0);
  expect(views).toHaveLength(before);
});

test("the same state is not asked twice", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].resolve(ADVICE);
  await vi.advanceTimersByTimeAsync(0);
  expect(lastView()).toEqual({ status: "ready", advice: ADVICE });

  controller.update(pickState({ enemyPicks: [1] }));
  controller.update(pickState());
  expect(lastView()).toEqual({ status: "ready", advice: ADVICE });
  vi.advanceTimersByTime(DEBOUNCE_MS * 2);
  expect(advisor.calls).toHaveLength(1);
});

test("partial answers show as loading", () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].onPartial({ teamRead: "Needs a frontline." });
  expect(lastView()).toEqual({ status: "loading", partial: { teamRead: "Needs a frontline." } });
});

const lockedState = () => toDraftState(makeSession({ myRole: "middle", localLocked: 20 }));

test("lock-in while a request runs aborts it and shows idle", () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  controller.update(lockedState());
  expect(advisor.calls[0].signal.aborted).toBe(true);
  vi.advanceTimersByTime(DEBOUNCE_MS * 2);
  expect(advisor.calls).toHaveLength(1);
  expect(lastView()).toEqual({ status: "idle" });
});

test("lock-in during the grouping pause shows idle and starts nothing", () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS - 1);
  controller.update(lockedState());
  vi.advanceTimersByTime(DEBOUNCE_MS * 2);
  expect(advisor.calls).toHaveLength(0);
  expect(lastView()).toEqual({ status: "idle" });
});

test("lock-in keeps a ready answer", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].resolve(ADVICE);
  await vi.advanceTimersByTimeAsync(0);
  controller.update(lockedState());
  expect(lastView()).toEqual({ status: "ready", advice: ADVICE });
});

test("lock-in after an error shows idle", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].reject(new Error("boom"));
  await vi.advanceTimersByTimeAsync(0);
  controller.update(lockedState());
  expect(lastView()).toEqual({ status: "idle" });
  controller.retry();
  expect(advisor.calls).toHaveLength(1);
});

test("need-role until a role is chosen", () => {
  const state = toDraftState(makeSession({}));
  controller.update(state);
  vi.advanceTimersByTime(DEBOUNCE_MS * 2);
  expect(lastView()).toEqual({ status: "need-role" });
  expect(advisor.calls).toHaveLength(0);

  controller.update(state, "middle");
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls).toHaveLength(1);
  expect(advisor.calls[0].req.role).toBe("middle");
});

test("timeout shows the error with the top 5 candidates", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
  expect(advisor.calls[0].signal.aborted).toBe(true);
  expect(lastView()).toEqual({ status: "error", message: "The suggestion took too long.", fallback: CANDIDATES.slice(0, 5) });
});

test("AdvisorError message is shown", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].reject(new AdvisorError("Your Claude API key was rejected.", "auth"));
  await vi.advanceTimersByTimeAsync(0);
  expect(lastView()).toEqual({ status: "error", message: "Your Claude API key was rejected.", fallback: CANDIDATES.slice(0, 5) });
});

test("other errors show a general message", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].reject(new Error("boom"));
  await vi.advanceTimersByTimeAsync(0);
  expect(lastView()).toEqual({ status: "error", message: "Could not get suggestions.", fallback: CANDIDATES.slice(0, 5) });
});

test("empty answer shows the error with the top 5 candidates", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].reject(new AdvisorError("Claude did not suggest any of the open champions.", "empty"));
  await vi.advanceTimersByTimeAsync(0);
  expect(lastView()).toEqual({ status: "error", message: "Claude did not suggest any of the open champions.", fallback: CANDIDATES.slice(0, 5) });
});

test("a throw while choosing candidates shows the general error without a fallback", () => {
  candidatesFor.mockImplementation(() => {
    throw new Error("boom");
  });
  controller.update(pickState());
  expect(() => vi.advanceTimersByTime(DEBOUNCE_MS)).not.toThrow();
  expect(lastView()).toEqual({ status: "error", message: "Could not get suggestions.", fallback: [] });
});

test("a throw while building the context shows the general error with the fallback", () => {
  const broken = {
    get champions(): never {
      throw new Error("boom");
    },
  } as unknown as PromptData;
  controller = new AdviceController({ advisor, data: broken, candidatesFor, onView: (v) => views.push(v) });
  controller.update(pickState());
  expect(() => vi.advanceTimersByTime(DEBOUNCE_MS)).not.toThrow();
  expect(advisor.calls).toHaveLength(0);
  expect(lastView()).toEqual({ status: "error", message: "Could not get suggestions.", fallback: CANDIDATES.slice(0, 5) });
});

test("a synchronous throw from the advisor shows the general error and no later timeout", () => {
  vi.spyOn(advisor, "advise").mockImplementation(() => {
    throw new Error("boom");
  });
  controller.update(pickState());
  expect(() => vi.advanceTimersByTime(DEBOUNCE_MS)).not.toThrow();
  const error: AdviceView = { status: "error", message: "Could not get suggestions.", fallback: CANDIDATES.slice(0, 5) };
  expect(lastView()).toEqual(error);
  const count = views.length;
  vi.advanceTimersByTime(TIMEOUT_MS);
  expect(views).toHaveLength(count);
});

test("no candidates shows an error and makes no request", () => {
  candidatesFor.mockReturnValue([]);
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls).toHaveLength(0);
  expect(lastView()).toEqual({ status: "error", message: "No champions to suggest.", fallback: [] });
});

test("retry asks again right away", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  advisor.calls[0].reject(new Error("boom"));
  await vi.advanceTimersByTimeAsync(0);
  controller.retry();
  expect(advisor.calls).toHaveLength(2);
  expect(lastView()).toEqual({ status: "loading", partial: {} });
});

test("retry does nothing without a pick state", () => {
  controller.retry();
  controller.update(toDraftState(makeSession({ myRole: "middle", bans: [1], bansDone: false })));
  controller.retry();
  expect(advisor.calls).toHaveLength(0);
  expect(lastView()).toEqual({ status: "idle" });
});

test("reset aborts and clears", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  controller.reset();
  expect(advisor.calls[0].signal.aborted).toBe(true);
  expect(lastView()).toEqual({ status: "idle" });

  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls).toHaveLength(2);
});

test("context is built once per draft", async () => {
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  controller.update(pickState({ enemyPicks: [1] }));
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls).toHaveLength(2);
  expect(advisor.calls[1].req.context).toBe(advisor.calls[0].req.context);

  controller.reset();
  controller.update(pickState());
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(advisor.calls[2].req.context).not.toBe(advisor.calls[0].req.context);
});
