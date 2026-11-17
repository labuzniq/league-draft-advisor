import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Role } from "@lda/shared";
import type { Advice, DraftState } from "../../shared/types";
import type { Candidate } from "../draft/candidates";
import { AdviceSchema, buildUserMessage, keepValidPicks, parsePartialAdvice, type DraftContext, type PromptData } from "./prompt";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;

export interface AdviceRequest { context: DraftContext; role: Role; state: DraftState; candidates: Candidate[] }

export class AdvisorError extends Error {
  constructor(message: string, readonly kind: "auth" | "rate-limit" | "refused" | "empty" | "other") {
    super(message);
    this.name = "AdvisorError";
  }
}

export interface Advisor { advise(req: AdviceRequest, onPartial: (a: Partial<Advice>) => void, signal: AbortSignal): Promise<Advice> }

function toAdvisorError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AdvisorError("Your Claude API key was rejected. Check it in Settings.", "auth");
  if (error instanceof Anthropic.RateLimitError) return new AdvisorError("Claude is busy right now. Try again in a moment.", "rate-limit");
  if (error instanceof Anthropic.APIError) return new AdvisorError("Could not get suggestions from Claude. Try again in a moment.", "other");
  return error;
}

export class ClaudeAdvisor implements Advisor {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly data: PromptData;
  lastUsage?: Anthropic.Beta.BetaUsage;

  constructor(opts: { apiKey: string; model: string; data: PromptData }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.data = opts.data;
  }

  private async request(req: AdviceRequest, onPartial: (a: Partial<Advice>) => void, signal: AbortSignal) {
    let buffer = "";
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 4000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: req.context.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: buildUserMessage(req, this.data) }],
          output_config: { effort: "low", format: zodOutputFormat(AdviceSchema) },
        },
        { signal },
      );
      stream.on("text", (delta) => {
        buffer += delta;
        onPartial(parsePartialAdvice(buffer));
      });
      return await stream.finalMessage();
    } catch (error) {
      throw toAdvisorError(error);
    }
  }

  async advise(req: AdviceRequest, onPartial: (a: Partial<Advice>) => void, signal: AbortSignal): Promise<Advice> {
    const message = await this.request(req, onPartial, signal);
    this.lastUsage = message.usage;
    if (message.stop_reason === "refusal") throw new AdvisorError("Claude declined to suggest picks for this draft.", "refused");
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const advice = keepValidPicks(AdviceSchema.parse(JSON.parse(text)), req.candidates);
    if (advice.picks.length === 0) throw new AdvisorError("Claude did not suggest any of the open champions.", "empty");
    return advice;
  }
}
