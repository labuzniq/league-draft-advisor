import { describe, expect, test } from "vitest";
import { PLATFORM_HOST, REGION_HOST } from "./config";
import { RiotClient, RiotError } from "./riot";

const KEY = "RGAPI-secret-key";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function setup(respond: (call: number) => Response | Error = () => json({ ok: true })) {
  let time = 0;
  const sleeps: number[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const result = respond(calls.length);
    if (result instanceof Error) throw result;
    return result;
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    time += ms;
  };
  const client = new RiotClient({ apiKey: KEY, fetchFn, sleep, now: () => time });
  return { client, calls, sleeps };
}

async function expectRiotError(promise: Promise<unknown>): Promise<RiotError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RiotError);
  return error as RiotError;
}

describe("RiotClient", () => {
  test("sends the key header and returns JSON", async () => {
    const { client, calls } = setup(() => json({ name: "x" }));
    await expect(client.get(PLATFORM_HOST, "/lol/thing")).resolves.toEqual({ name: "x" });
    expect(calls[0].url).toBe(`https://${PLATFORM_HOST}/lol/thing`);
    expect(new Headers(calls[0].init?.headers).get("X-Riot-Token")).toBe(KEY);
  });

  test("the 21st request inside one second waits", async () => {
    const { client, sleeps } = setup();
    for (let i = 0; i < 20; i++) await client.get(PLATFORM_HOST, "/a");
    expect(sleeps).toEqual([]);
    await client.get(PLATFORM_HOST, "/a");
    expect(sleeps).toEqual([1_000]);
  });

  test("the 101st request inside two minutes waits", async () => {
    const { client, sleeps } = setup();
    for (let i = 0; i < 100; i++) await client.get(PLATFORM_HOST, "/a");
    // bursts of 20 are spaced by the 1 s limit, so the 100th request goes out at 4 s
    expect(sleeps).toEqual([1_000, 1_000, 1_000, 1_000]);
    await client.get(PLATFORM_HOST, "/a");
    expect(sleeps).toHaveLength(5);
    expect(sleeps[4]).toBe(116_000);
  });

  test("hosts are counted separately", async () => {
    const { client, sleeps } = setup();
    for (let i = 0; i < 20; i++) {
      await client.get(PLATFORM_HOST, "/a");
      await client.get(REGION_HOST, "/a");
    }
    expect(sleeps).toEqual([]);
  });

  test("429 waits Retry-After seconds and retries", async () => {
    const { client, calls, sleeps } = setup((n) =>
      n === 1 ? json({}, 429, { "Retry-After": "7" }) : json({ ok: true }),
    );
    await expect(client.get(PLATFORM_HOST, "/a")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([7_000]);
    expect(calls).toHaveLength(2);
  });

  test("5xx is retried three times, then RiotError", async () => {
    const { client, calls, sleeps } = setup(() => json({}, 503));
    const error = await expectRiotError(client.get(PLATFORM_HOST, "/a"));
    expect(error.status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
  });

  test("a 2xx body that cannot be read is retried three times, then RiotError with status 0", async () => {
    const { client, calls, sleeps } = setup(() => new Response("{not json", { status: 200 }));
    const error = await expectRiotError(client.get(PLATFORM_HOST, "/a"));
    expect(error.status).toBe(0);
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
  });

  test("a 2xx body that cannot be read once is retried and then returned", async () => {
    const { client, calls } = setup((n) => (n === 1 ? new Response("{not json", { status: 200 }) : json({ ok: true })));
    await expect(client.get(PLATFORM_HOST, "/a")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  test("404 throws RiotError at once", async () => {
    const { client, calls, sleeps } = setup(() => json({}, 404));
    const error = await expectRiotError(client.get(PLATFORM_HOST, "/a"));
    expect(error.status).toBe(404);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("the key never appears in an error message", async () => {
    const http = setup(() => json({}, 403));
    const httpError = await expectRiotError(http.client.get(PLATFORM_HOST, "/a"));
    expect(httpError.message).toBe("Riot API error 403 for /a");
    expect(httpError.message).not.toContain(KEY);

    const network = setup(() => new Error(`connect failed for ${KEY}`));
    const networkError = await expectRiotError(network.client.get(PLATFORM_HOST, "/a"));
    expect(networkError.status).toBe(0);
    expect(networkError.message).not.toContain(KEY);
  });
});
