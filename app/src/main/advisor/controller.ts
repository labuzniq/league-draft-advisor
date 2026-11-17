import type { Role } from "@lda/shared";
import type { Advice, DraftState } from "../../shared/types";
import type { Candidate } from "../draft/candidates";
import { draftKey } from "../draft/state";
import { AdvisorError, type Advisor } from "./advisor";
import { buildContext, type DraftContext, type PromptData } from "./prompt";

export type AdviceView =
  | { status: "idle" }
  | { status: "need-role" }
  | { status: "loading"; partial: Partial<Advice> }
  | { status: "ready"; advice: Advice }
  | { status: "error"; message: string; fallback: Candidate[] };

export const DEBOUNCE_MS = 800;
export const TIMEOUT_MS = 15_000;

const FALLBACK_SIZE = 5;
const TIMEOUT_MESSAGE = "The suggestion took too long.";
const UNKNOWN_ERROR_MESSAGE = "Could not get suggestions.";
const NO_CANDIDATES_MESSAGE = "No champions to suggest.";

interface Deps {
  advisor: Advisor;
  data: PromptData;
  candidatesFor: (state: DraftState, role: Role) => Candidate[];
  onView: (view: AdviceView) => void;
}

interface Latest { state: DraftState; role: Role; key: string }
interface Running { abort: AbortController; timeout: ReturnType<typeof setTimeout> }

export class AdviceController {
  private latest?: Latest;
  private keyInFlight?: string;
  private debounce?: ReturnType<typeof setTimeout>;
  private running?: Running;
  private context?: DraftContext;
  private readonly answers = new Map<string, Advice>();

  constructor(private readonly deps: Deps) {}

  update(state: DraftState, chosenRole?: Role): void {
    const role = state.role ?? chosenRole;
    if (state.phase !== "pick") {
      this.cancel();
      this.latest = undefined;
      if (state.phase === "ban") this.deps.onView({ status: "idle" });
      return;
    }
    if (!role) {
      this.cancel();
      this.latest = undefined;
      this.deps.onView({ status: "need-role" });
      return;
    }
    const key = draftKey(state, role);
    this.latest = { state, role, key };
    if (key === this.keyInFlight) return;
    this.cancel();
    const answer = this.answers.get(key);
    if (answer) {
      this.deps.onView({ status: "ready", advice: answer });
      return;
    }
    this.keyInFlight = key;
    this.debounce = setTimeout(() => this.start(), DEBOUNCE_MS);
  }

  retry(): void {
    if (this.latest?.state.phase !== "pick") return;
    this.cancel();
    this.keyInFlight = this.latest.key;
    this.start();
  }

  reset(): void {
    this.cancel();
    this.latest = undefined;
    this.context = undefined;
    this.answers.clear();
    this.deps.onView({ status: "idle" });
  }

  private cancel(): void {
    clearTimeout(this.debounce);
    this.debounce = undefined;
    this.keyInFlight = undefined;
    if (this.running) {
      clearTimeout(this.running.timeout);
      this.running.abort.abort();
      this.running = undefined;
    }
  }

  private start(): void {
    this.debounce = undefined;
    const latest = this.latest;
    if (!latest) return;
    const { state, role, key } = latest;
    const candidates = this.deps.candidatesFor(state, role);
    if (candidates.length === 0) {
      this.deps.onView({ status: "error", message: NO_CANDIDATES_MESSAGE, fallback: [] });
      return;
    }
    this.context ??= buildContext({ role, state, candidates }, this.deps.data);
    const fallback = candidates.slice(0, FALLBACK_SIZE);
    const abort = new AbortController();
    const running: Running = {
      abort,
      timeout: setTimeout(() => {
        this.finish(running, { status: "error", message: TIMEOUT_MESSAGE, fallback });
        abort.abort();
      }, TIMEOUT_MS),
    };
    this.running = running;
    this.deps.onView({ status: "loading", partial: {} });
    this.deps.advisor
      .advise(
        { context: this.context, role, state, candidates },
        (partial) => {
          if (this.running === running) this.deps.onView({ status: "loading", partial });
        },
        abort.signal,
      )
      .then(
        (advice) => {
          if (this.running !== running) return;
          this.answers.set(key, advice);
          this.finish(running, { status: "ready", advice });
        },
        (error: unknown) => {
          const message = error instanceof AdvisorError ? error.message : UNKNOWN_ERROR_MESSAGE;
          this.finish(running, { status: "error", message, fallback });
        },
      );
  }

  private finish(running: Running, view: AdviceView): void {
    if (this.running !== running) return;
    clearTimeout(running.timeout);
    this.running = undefined;
    this.deps.onView(view);
  }
}
