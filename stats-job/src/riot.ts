import { LIMITS } from "./config";

const RETRY_WAITS_MS = [1_000, 2_000, 4_000];
const DEFAULT_RETRY_AFTER_S = 1;

export class RiotError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Riot API error ${status} for ${path}`);
  }
}

interface Options {
  apiKey: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class RiotClient {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly sentAt = new Map<string, number[]>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: Options) {
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
  }

  get<T>(host: string, path: string): Promise<T> {
    const result = this.queue.then(() => this.request<T>(host, path));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async request<T>(host: string, path: string): Promise<T> {
    let failures = 0;
    for (;;) {
      await this.waitForSlot(host);
      let response: Response;
      try {
        response = await this.fetchFn(`https://${host}${path}`, {
          headers: { "X-Riot-Token": this.apiKey },
        });
      } catch {
        await this.retryOrThrow(failures++, 0, path);
        continue;
      }
      if (response.ok) return (await response.json()) as T;
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After") ?? DEFAULT_RETRY_AFTER_S);
        await this.sleep(seconds * 1_000);
      } else if (response.status >= 500) {
        await this.retryOrThrow(failures++, response.status, path);
      } else {
        throw new RiotError(response.status, path);
      }
    }
  }

  private async retryOrThrow(failures: number, status: number, path: string): Promise<void> {
    if (failures >= RETRY_WAITS_MS.length) throw new RiotError(status, path);
    await this.sleep(RETRY_WAITS_MS[failures]);
  }

  private async waitForSlot(host: string): Promise<void> {
    const sent = this.sentAt.get(host) ?? [];
    for (;;) {
      const now = this.now();
      const wait = Math.max(
        0,
        ...LIMITS.map(({ count, perMs }) => {
          const inWindow = sent.filter((t) => now - t < perMs);
          return inWindow.length < count ? 0 : inWindow[inWindow.length - count] + perMs - now;
        }),
      );
      if (wait === 0) break;
      await this.sleep(wait);
    }
    const now = this.now();
    const longest = Math.max(...LIMITS.map((l) => l.perMs));
    this.sentAt.set(host, [...sent.filter((t) => now - t < longest), now]);
  }
}
