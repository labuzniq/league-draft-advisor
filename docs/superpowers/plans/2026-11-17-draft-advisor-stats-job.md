# Draft Advisor Stats Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily job that downloads a sample of high-rank ranked matches from Riot's API (Application Programming Interface) and publishes one statistics file with win, pick and ban counts per champion and role.

**Architecture:** A small Node script in the `stats-job` workspace. Each run reads the published file, adds matches from the time window since the last run, and writes the file back. The file itself is the job's memory, so there is no database. GitHub Actions runs it once a day and uploads the result as files on a GitHub release named `stats`.

**Tech Stack:** TypeScript, Node (built-in `fetch`), `tsx`, Vitest, GitHub Actions, `gh` CLI (Command Line Interface).

**Spec:** `docs/superpowers/specs/2026-11-17-draft-advisor-design.md`

**Depends on:** Tasks 1 and 2 of `docs/superpowers/plans/2026-11-17-draft-advisor-app.md` (the workspace and the `StatsFile` type in `@lda/shared`).

**Needs from Martin before Task 5 can finish:** a personal Riot API key, saved as the repository secret `RIOT_API_KEY`.

## Global Constraints

- Riot personal key limits: 20 requests per 1 second and 100 requests per 2 minutes, counted per host. Never go over them.
- The Riot key is read only from the `RIOT_API_KEY` environment variable. It is never written to a file or a log.
- Ranked solo queue only (queue ID 420). Emerald and above. Europe West (`euw1` and `europe` hosts). Rank floor and region are constants in one place.
- Totals build up within a patch and start fresh on a new patch. The previous patch's file is kept as `previous.json`.
- The published files hold champion numbers only. No player names or IDs.
- Published at `https://github.com/labuzniq/league-draft-advisor/releases/download/stats/current.json` and `.../previous.json` (the app's `STATS_BASE_URL`).
- Conventional commits.

## Review Focus

1. **Riot answers 429 (too many requests)**: wait the seconds in the `Retry-After` header, then send the same request again. Test in Task 1.
2. **A match cannot be fetched** (404, or 5xx after retries): skip that match and keep going. Test in Task 4.
3. **The run hits its time limit**: it stops cleanly and still writes the files with everything counted so far. Test in Task 4.
4. **A newer patch shows up during a run**: the current file becomes the previous file and counting starts fresh. Test in Task 4.
5. **Very first run, nothing published yet**: starts with an empty file and a 24 hour window. Tests in Task 4 and Task 5.

## File Structure

```
stats-job/
  package.json                 @lda/stats-job, depends on @lda/shared
  src/config.ts                region hosts, rank floor, limits
  src/riot.ts                  RiotClient: requests, rate limit, retries
  src/aggregate.ts             patch helpers, add one match to the totals
  src/players.ts               list of high-rank player IDs
  src/run.ts                   one run: window, loop, patch change, time limit
  src/main.ts                  reads files and env, calls run, writes files
  src/*.test.ts
.github/workflows/stats.yml    daily schedule, download, run, upload
```

---

### Task 1: Riot client with rate limiting

**Files:**
- Create: `stats-job/package.json`, `stats-job/tsconfig.json`, `stats-job/src/config.ts`, `stats-job/src/riot.ts`, `stats-job/src/riot.test.ts`

**Interfaces:**
- Produces, in `config.ts`:

```ts
export const PLATFORM_HOST = "euw1.api.riotgames.com";
export const REGION_HOST = "europe.api.riotgames.com";
export const QUEUE = "RANKED_SOLO_5x5";
export const QUEUE_ID = 420;
export const RANKS: readonly { tier: string; division: string }[]; // CHALLENGER I, GRANDMASTER I, MASTER I, DIAMOND I-IV, EMERALD I-IV (11 entries)
export const LIMITS = [{ count: 20, perMs: 1_000 }, { count: 100, perMs: 120_000 }] as const;
```

- Produces, in `riot.ts`:

```ts
export class RiotError extends Error { constructor(readonly status: number, path: string) }
export class RiotClient {
  constructor(opts: { apiKey: string; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number });
  get<T>(host: string, path: string): Promise<T>;
}
```

Rules:
- Each request sends the header `X-Riot-Token`.
- Before each request the client waits until sending it keeps the host inside every entry of `LIMITS`. Each host is counted on its own.
- Status 429: wait `Retry-After` seconds (1 second when the header is missing), then try again. This does not count as a failed try.
- Status 5xx or a network error: try again up to 3 times with waits of 1, 2 and 4 seconds, then throw `RiotError`.
- Any other non-2xx status: throw `RiotError` at once.

- [ ] **Step 1:** Create the `stats-job` workspace package `@lda/stats-job` with `tsx`, Vitest, scripts `test`, `typecheck`, and `start` (`tsx src/main.ts`), and a dependency on `@lda/shared`.
- [ ] **Step 2: Write the failing tests** with a fake `fetchFn`, fake `sleep` and fake `now`:

```ts
test("sends the key header and returns JSON", ...);
test("the 21st request inside one second waits", ...);            // sleep called with a wait that moves it past the 1 s window
test("the 101st request inside two minutes waits", ...);
test("hosts are counted separately", ...);                        // 20 requests to each host, no sleep
test("429 waits Retry-After seconds and retries", ...);           // header "7" -> sleep(7000), then success
test("5xx is retried three times, then RiotError", ...);          // 4 fetch calls, error.status 503
test("404 throws RiotError at once", ...);                        // 1 fetch call, error.status 404
test("the key never appears in an error message", ...);
```

- [ ] **Step 3:** Run: `npm test -w stats-job -- riot`. Expected: FAIL.
- [ ] **Step 4:** Implement `config.ts` and `riot.ts`.
- [ ] **Step 5:** Run: `npm test -w stats-job -- riot`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: add a rate-limited Riot API client`.

---

### Task 2: Adding a match to the totals

**Files:**
- Create: `stats-job/src/aggregate.ts`, `stats-job/src/aggregate.test.ts`

**Interfaces:**
- Consumes: `StatsFile`, `Role` from `@lda/shared`.
- Produces:

```ts
export interface MatchDto {
  info: {
    gameVersion: string; gameDuration: number; queueId: number;
    participants: { championId: number; teamPosition: string; win: boolean }[];
    teams: { bans: { championId: number }[] }[];
  };
}
export function patchOf(gameVersion: string): string;          // "15.22.701.1234" -> "15.22"
export function comparePatch(a: string, b: string): number;    // negative, 0, positive; compares numbers, so "15.9" < "15.10"
export function emptyStats(patch: string, windowEnd: number): StatsFile;
export function addMatch(file: StatsFile, match: MatchDto): boolean; // false when the match was not counted
```

Rules for `addMatch`:
- Not counted when: `queueId` is not 420, `gameDuration` is under 300 seconds (a remake), or the match's patch differs from `file.patch`.
- When counted: `matches` goes up by 1. For each participant with a `teamPosition` of `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM` or `UTILITY`, the champion's role entry (lower-case role) gets `games + 1` and `wins + 1` on a win. Participants with any other `teamPosition` are skipped.
- Bans: each champion banned in the match gets `bans + 1` once, even when both teams banned it. A ban with `championId` of -1 or 0 is no ban.

- [ ] **Step 1: Write the failing tests:**

```ts
test("patchOf", () => { expect(patchOf("15.22.701.1234")).toBe("15.22"); });
test("comparePatch compares numbers", () => { expect(comparePatch("15.9", "15.10")).toBeLessThan(0); expect(comparePatch("16.1", "15.24")).toBeGreaterThan(0); expect(comparePatch("15.22", "15.22")).toBe(0); });
test("counts games, wins and roles", () => { /* 10 participants, Orianna MIDDLE win */ expect(file.matches).toBe(1); expect(file.champions["61"].roles.middle).toEqual({ games: 1, wins: 1 }); });
test("a champion banned by both teams counts once", () => { expect(file.champions["3"].bans).toBe(1); });
test("no-ban entries are ignored", () => { /* championId -1 */ expect(file.champions["-1"]).toBeUndefined(); });
test("remakes, other queues and other patches are not counted", () => { expect(addMatch(file, remake)).toBe(false); expect(file.matches).toBe(0); });
test("participants without a position are skipped", () => { /* teamPosition "" */ });
```

- [ ] **Step 2:** Run: `npm test -w stats-job -- aggregate`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w stats-job -- aggregate`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: count wins, picks and bans from a match`.

---

### Task 3: High-rank player list

**Files:**
- Create: `stats-job/src/players.ts`, `stats-job/src/players.test.ts`

**Interfaces:**
- Consumes: `RiotClient`, `RANKS`, `PLATFORM_HOST`, `QUEUE`.
- Produces:

```ts
export const PAGES_PER_RANK = 2;
export const MAX_PAGE = 50;
export async function listPlayers(client: RiotClient, random?: () => number): Promise<string[]>; // player IDs (puuid), shuffled, no repeats
```

Rules:
- For each entry of `RANKS`, fetch `PAGES_PER_RANK` pages of `/lol/league-exp/v4/entries/{QUEUE}/{tier}/{division}?page={n}` from `PLATFORM_HOST`, with `n` random between 1 and `MAX_PAGE`. An empty page is replaced by page 1 once.
- Each entry gives one player ID from its `puuid` field. Entries without a `puuid` are skipped.
- The result is shuffled with `random`, so every run samples different players across all ranks.

- [ ] **Step 1:** Check the live answer once before writing code. Run with a development key: `curl -s -H "X-Riot-Token: $RIOT_API_KEY" "https://euw1.api.riotgames.com/lol/league-exp/v4/entries/RANKED_SOLO_5x5/DIAMOND/I?page=1" | head -c 600`. Expected: an array of entries with a `puuid` field. If the field is missing, stop and report; the plan for getting player IDs must change.
- [ ] **Step 2: Write the failing tests** with a fake client: 22 page requests for 11 ranks; IDs are unique; an entry without `puuid` is skipped; an empty page falls back to page 1; with a fixed `random` the order is the same on every call.
- [ ] **Step 3:** Run: `npm test -w stats-job -- players`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run: `npm test -w stats-job -- players`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: sample high-rank players for the stats job`.

---

### Task 4: One run

**Files:**
- Create: `stats-job/src/run.ts`, `stats-job/src/run.test.ts`

**Interfaces:**
- Consumes: `RiotClient`, `RiotError`, `listPlayers`, `addMatch`, `emptyStats`, `patchOf`, `comparePatch`, `REGION_HOST`, `QUEUE_ID`.
- Produces:

```ts
export const SAFETY_GAP_S = 2 * 3600;      // games newer than this may still be running
export const FIRST_WINDOW_S = 24 * 3600;
export interface RunResult { current: StatsFile; previous?: StatsFile; counted: number; skipped: number }
export async function runOnce(input: {
  client: RiotClient;
  current?: StatsFile;
  previous?: StatsFile;
  nowS: number;               // epoch seconds at start
  deadlineMs: number;         // stop starting new players after this time
  nowMs?: () => number;
  log?: (line: string) => void;
}): Promise<RunResult>;
```

Rules:
- Window: from `current.windowEnd` (or `nowS - FIRST_WINDOW_S` when there is no current file) to `nowS - SAFETY_GAP_S`. Windows of two runs never overlap, so a match is counted in one run only.
- For each player from `listPlayers`: fetch match IDs from `REGION_HOST` at `/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&startTime={from}&endTime={to}&start=0&count=100`. For each ID not yet seen in this run, fetch `/lol/match/v5/matches/{id}` and pass it to `addMatch`.
- Patch change: when a match's patch is newer than `current.patch` (`comparePatch`), `previous` becomes the old `current` and `current` becomes `emptyStats(newPatch, …)` before the match is added. When there is no current file, the first match's patch starts the file. Matches from older patches are not counted.
- A `RiotError` for one player or one match is logged, added to `skipped`, and the loop goes on. A `RiotError` with status 401 or 403 (bad key) stops the run by throwing.
- The loop stops when `nowMs()` passes `deadlineMs` or the players run out.
- At the end `current.windowEnd` is set to the window's end and `current.updatedAt` to the current time, also when the loop stopped at the deadline.

- [ ] **Step 1: Write the failing tests** with a fake client that serves players, match IDs and matches from in-memory maps:

```ts
test("counts each match once even when two players share it", ...);          // counted 1, one match request
test("uses the window from the last run", ...);                              // ids request has startTime = current.windowEnd and endTime = nowS - 7200
test("first run uses a 24 hour window and starts an empty file", ...);
test("a newer patch moves current to previous and starts fresh", ...);       // previous.patch "15.22", current.patch "15.23", current.matches 1
test("an older patch match is not counted", ...);
test("a match that fails with 404 is skipped and the run goes on", ...);     // skipped 1, later match counted
test("a bad key stops the run", ...);                                        // 403 -> rejects
test("stops at the deadline and still returns the totals", ...);             // nowMs jumps past deadline after the first player
test("windowEnd and updatedAt are set at the end", ...);
```

- [ ] **Step 2:** Run: `npm test -w stats-job -- run`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w stats-job -- run`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: run one stats collection pass`.

---

### Task 5: Entry point, schedule and publishing

**Files:**
- Create: `stats-job/src/main.ts`, `.github/workflows/stats.yml`
- Modify: `README.md` (section on the stats job and the Riot key)

**Interfaces:**
- Consumes: `runOnce`, `RiotClient`.
- Produces: `npm start -w stats-job` reads `current.json` and `previous.json` from the folder in `STATS_DIR` (default `./stats-out`) when they exist, runs for `RUN_MINUTES` minutes (default 330), and writes both files back. It exits with a non-zero code when `RIOT_API_KEY` is missing or the run throws.

- [ ] **Step 1:** Implement `main.ts` as described above. It logs one summary line at the end: patch, matches in the file, matches counted this run, skipped.
- [ ] **Step 2:** Write `.github/workflows/stats.yml`:
  - Triggers: `schedule` with cron `0 3 * * *`, and `workflow_dispatch` with an input `run_minutes` (default `330`).
  - `permissions: contents: write`, `timeout-minutes: 350`, `concurrency` group `stats` so two runs never overlap.
  - Steps: checkout; setup Node; `npm ci`; download the old files with `gh release download stats --dir stats-out --pattern "*.json"` (allowed to fail on the first run); `npm start -w stats-job` with `RIOT_API_KEY` from secrets, `STATS_DIR=stats-out`, `RUN_MINUTES` from the input; create the release if it is missing with `gh release create stats --title "Statistics data" --notes "Data files for the Draft Advisor app. Updated daily."`; upload with `gh release upload stats stats-out/*.json --clobber`.
- [ ] **Step 3:** Local short run with a real key. Run: `RIOT_API_KEY=… RUN_MINUTES=3 npm start -w stats-job`. Expected: a summary line with more than 0 matches counted, and `stats-out/current.json` with a `patch` and champion entries. Run it a second time. Expected: the match count goes up and no match is counted twice (the window moved).
- [ ] **Step 4:** After Martin adds the `RIOT_API_KEY` secret: start the workflow by hand with `run_minutes: 5` (`gh workflow run stats.yml -f run_minutes=5`). Expected: the run is green and `https://github.com/labuzniq/league-draft-advisor/releases/download/stats/current.json` downloads a valid file.
- [ ] **Step 5:** Add the README section: what the job does, how to get a personal Riot key, where to save it (`Settings > Secrets and variables > Actions > RIOT_API_KEY`), and that GitHub turns scheduled jobs off after 60 days without repository activity.
- [ ] **Step 6:** Commit: `feat: publish daily statistics through GitHub Actions`.
