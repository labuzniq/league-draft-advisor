# Draft Advisor App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A desktop app that watches League of Legends champion select and shows 1 to 5 suggested picks with short reasons and a one-line team read.

**Architecture:** An Electron app. The main process holds all logic as small modules: client connector, draft state, candidate filter, stats loader, champion data, advisor, advice controller, settings. The renderer is a thin React window that draws one view object sent from the main process. The statistics file format lives in a shared package that the stats job (separate plan) also uses.

**Tech Stack:** TypeScript, Electron, electron-vite, React, Vitest, `@anthropic-ai/sdk`, `zod`, `ws`, electron-builder, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-17-draft-advisor-design.md`

**Related plan:** `docs/superpowers/plans/2026-11-17-draft-advisor-stats-job.md` (builds the statistics file this app downloads). This app plan comes first and works with a fixture statistics file until the job exists.

## Global Constraints

- Never show, store, or request other players' names or stats. Only champions and roles.
- The League client is used read-only: `GET` requests and websocket subscriptions only. No hovering, locking, or banning.
- All client-specific code stays in `app/src/main/lcu/` and `app/src/main/draft/state.ts`.
- The Claude API (Application Programming Interface) key is stored only through Electron `safeStorage` and sent only to Anthropic.
- Default model `claude-opus-5-5` at effort `low`. Selectable: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. One constant holds the default.
- Speed target: first suggestion on screen within 5 seconds of a locked pick, grouping pause included. Full answer within about 10 seconds.
- Cost aim: under 25 cents per draft at the default model.
- No AI requests during the ban phase, and none after the player locks in.
- Text in the window is phrased as suggestions, never as orders.
- Installers are not published as GitHub releases. No auto-update. No code signing.
- Window text uses plain words, no jargon.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

## Review Focus

1. **No assigned role** (queues without role selection): the window asks for a role with a dropdown, and no AI request starts until one is chosen. Test in Task 8 and Task 11.
2. **Champion missing from the statistics file or champion data** (new champion mid-patch): treated as unknown with zero games, no crash. Tests in Task 6 and Task 7.
3. **AI answer names a champion that is not a candidate**: that pick is dropped. If no pick is left, the error view with the statistics list shows. Test in Task 7 and Task 8.
4. **Champion select ends early** (dodge, client closed): the in-flight request is cancelled and the window goes back to waiting. Tests in Task 8 and Task 9.
5. **Wrong API key** (HTTP 401): the message says the key was rejected and points to settings. Test in Task 7.

## File Structure

```
package.json                      npm workspaces: shared, app, stats-job
shared/
  src/stats.ts                    StatsFile type and rate helpers
  src/stats.test.ts
app/
  src/shared/types.ts             DraftState, Advice, AppView (used by main and renderer)
  src/main/index.ts               Electron entry: window, wiring, IPC
  src/main/session.ts             ties connector, state, controller, view together
  src/main/lcu/locate.ts          find the client's port and token
  src/main/lcu/client.ts          HTTPS + websocket to the client
  src/main/lcu/recorder.ts        save a champion select to a file
  src/main/draft/state.ts         raw session -> DraftState
  src/main/draft/candidates.ts    candidate filter
  src/main/stats/loader.ts        download, cache, choose statistics file
  src/main/champions/ddragon.ts   champion data download and cache
  src/main/advisor/prompt.ts      request text, answer schema, partial parse
  src/main/advisor/advisor.ts     Advisor interface and ClaudeAdvisor
  src/main/advisor/controller.ts  pause, cancel, cache, phase rules
  src/main/settings.ts            settings and secure key storage
  src/preload/index.ts            typed bridge to the renderer
  src/renderer/src/App.tsx        picks a screen from AppView
  src/renderer/src/screens/*.tsx  Waiting, Setup, Settings, Draft
  scripts/measure-advisor.ts      speed and cost measurement
  test/helpers/session.ts         builds raw sessions for tests
  test/helpers/fake-lcu.ts        fake League client that replays a recording
  test/fixtures/stats.json        small statistics file
  test/fixtures/recording.json    hand-written recording, replaced in Task 12
.github/workflows/ci.yml          typecheck, lint, test on pull requests
.github/workflows/build.yml       manual installer build, files kept as CI artifacts
```

Champion IDs used in tests: Galio 3, Jarvan IV 59, Orianna 61, Leona 89, Ahri 103, Jinx 222.

---

### Task 1: Workspace and app shell

**Files:**
- Create: `package.json`, `shared/package.json`, `shared/tsconfig.json`, `app/` (scaffold), `.github/workflows/ci.yml`
- Modify: `.gitignore` (add `out/`, `release/`)

**Interfaces:**
- Produces: workspace packages `@lda/shared` and `@lda/app`; commands `npm test`, `npm run typecheck`, `npm run lint` at the root that run in every workspace; `npm run dev -w app` opens the window.

- [ ] **Step 1:** Create the root `package.json` with `"private": true` and `"workspaces": ["shared", "app", "stats-job"]`, plus root scripts `test`, `typecheck`, `lint` that call `npm run <name> --workspaces --if-present`.
- [ ] **Step 2:** Scaffold `app/` with electron-vite's `react-ts` template (electron-vite "Getting Started"). Set its package name to `@lda/app`. Add Vitest with a `test` script (`vitest run`) and a `typecheck` script.
- [ ] **Step 3:** Create `shared/` as package `@lda/shared` with `"main": "src/stats.ts"` (source import, no build step), Vitest, and `test` and `typecheck` scripts. Add it as a dependency of `app`, and exclude `@lda/shared` from electron-vite's externalized dependencies so its source is bundled into the main process.
- [ ] **Step 4:** Replace the template renderer content with a single line of text: `Waiting for League of Legends…`.
- [ ] **Step 5:** Write `.github/workflows/ci.yml`: on `pull_request` and pushes to `main`, on `ubuntu-latest`, run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`.
- [ ] **Step 6:** Verify. Run: `npm install && npm run typecheck && npm test`. Expected: exit code 0 (no tests yet is fine; use `vitest run --passWithNoTests`). Run: `npm run dev -w app`. Expected: a window with the waiting text.
- [ ] **Step 7:** Commit: `chore: scaffold workspace and Electron app shell`.

---

### Task 2: Statistics file format

**Files:**
- Create: `shared/src/stats.ts`, `shared/src/stats.test.ts`, `app/test/fixtures/stats.json`

**Interfaces:**
- Produces:

```ts
export type Role = "top" | "jungle" | "middle" | "bottom" | "utility";
export const ROLES: readonly Role[];
export interface RoleStats { games: number; wins: number }
export interface ChampionStats { bans: number; roles: Partial<Record<Role, RoleStats>> }
export interface StatsFile {
  patch: string;        // "15.22"
  updatedAt: string;    // ISO time
  windowEnd: number;    // epoch seconds, used by the stats job
  matches: number;      // matches counted
  champions: Record<string, ChampionStats>; // key: champion ID as string
}
export function roleStats(file: StatsFile, championId: number, role: Role): RoleStats; // zeros when missing
export function winRate(s: RoleStats): number;                                         // 0 when games is 0
export function pickRate(file: StatsFile, championId: number, role: Role): number;     // games / matches
export function banRate(file: StatsFile, championId: number): number;                  // bans / matches
export function mainRole(file: StatsFile, championId: number): Role | undefined;       // role with most games
```

- [ ] **Step 1: Write the failing tests** in `shared/src/stats.test.ts`:

```ts
const file: StatsFile = { patch: "15.22", updatedAt: "2026-11-17T00:00:00Z", windowEnd: 0, matches: 1000,
  champions: { "61": { bans: 50, roles: { middle: { games: 100, wins: 52 }, utility: { games: 10, wins: 4 } } } } };

test("winRate", () => { expect(winRate({ games: 100, wins: 52 })).toBe(0.52); expect(winRate({ games: 0, wins: 0 })).toBe(0); });
test("pickRate and banRate", () => { expect(pickRate(file, 61, "middle")).toBe(0.1); expect(banRate(file, 61)).toBe(0.05); });
test("mainRole", () => { expect(mainRole(file, 61)).toBe("middle"); expect(mainRole(file, 999)).toBeUndefined(); });
test("missing champion gives zeros", () => { expect(roleStats(file, 999, "top")).toEqual({ games: 0, wins: 0 }); expect(pickRate(file, 999, "top")).toBe(0); });
```

- [ ] **Step 2:** Run: `npm test -w shared`. Expected: FAIL, functions not defined.
- [ ] **Step 3:** Implement `shared/src/stats.ts` with the signatures above.
- [ ] **Step 4:** Run: `npm test -w shared`. Expected: PASS.
- [ ] **Step 5:** Write `app/test/fixtures/stats.json`: a `StatsFile` with `patch: "15.22"`, `matches: 20000`, and entries for the six test champions with believable numbers. Orianna, Galio and Ahri have `middle` games of at least 400 each; Jarvan IV `jungle`; Jinx `bottom`; Leona `utility`.
- [ ] **Step 6:** Commit: `feat: add statistics file format and rate helpers`.

---

### Task 3: Draft state

**Files:**
- Create: `app/src/shared/types.ts`, `app/src/main/draft/state.ts`, `app/src/main/draft/state.test.ts`, `app/test/helpers/session.ts`

**Interfaces:**
- Produces, in `app/src/shared/types.ts`:

```ts
export interface DraftPick { championId: number; role?: Role }
export interface DraftState {
  phase: "ban" | "pick" | "done";
  role?: Role;               // the player's assigned role, undefined in queues without roles
  allies: DraftPick[];       // locked picks of teammates, not the player
  enemies: DraftPick[];      // locked enemy picks, role left undefined here
  bans: number[];
  localPlayerLocked: boolean;
  myTurn: boolean;           // the player's own pick action is in progress
}
export interface OwnedChampion { championId: number; masteryPoints: number }
export interface Pick { championId: number; reason: string }
export interface Advice { teamRead: string; picks: Pick[] }
```

- Produces, in `app/src/main/draft/state.ts` (field names are from memory of the unofficial client API; Task 12 checks them against a real client):

```ts
export interface LcuAction { id: number; actorCellId: number; championId: number; type: string; completed: boolean; isInProgress: boolean; isAllyAction: boolean }
export interface LcuTeamMember { cellId: number; championId: number; assignedPosition: string } // "" when the queue has no roles
export interface LcuChampSelectSession { localPlayerCellId: number; myTeam: LcuTeamMember[]; theirTeam: LcuTeamMember[]; actions: LcuAction[][]; timer: { phase: string } }
export function toDraftState(session: LcuChampSelectSession): DraftState;
export function draftKey(state: DraftState, role: Role): string; // same picks and bans in any order give the same key
```

- Produces, in `app/test/helpers/session.ts`:

```ts
export function makeSession(opts: {
  myRole?: Role;                                   // omit for a queue without roles
  allyPicks?: { championId: number; role?: Role }[];
  enemyPicks?: number[];
  bans?: number[];
  bansDone?: boolean;                              // default true
  localLocked?: number;                            // champion ID the player locked
  localPicking?: boolean;                          // the player's pick action is in progress
  timerPhase?: string;                             // default "BAN_PICK"
}): LcuChampSelectSession;
```

Rules for `toDraftState`:
- Locked picks are completed actions of type `pick` with a non-zero `championId`. `isAllyAction` gives the side. An ally's role comes from the `myTeam` member with the same `cellId`.
- Bans are completed actions of type `ban` with a non-zero `championId`.
- `phase` is `"done"` when the player's own pick action is completed or `timer.phase` is `FINALIZATION` or `GAME_STARTING`. Otherwise `"ban"` when `timer.phase` is `PLANNING` or any `ban` action is not completed. Otherwise `"pick"`.
- An `assignedPosition` that is not one of the five roles gives `role: undefined`.

- [ ] **Step 1: Write the failing tests:**

```ts
test("locked picks, bans and role", () => {
  const s = toDraftState(makeSession({ myRole: "middle", allyPicks: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }], enemyPicks: [103, 89], bans: [3] }));
  expect(s).toEqual({ phase: "pick", role: "middle", allies: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }], enemies: [{ championId: 103 }, { championId: 89 }], bans: [3], localPlayerLocked: false, myTurn: false });
});
test("myTurn while the player's pick is in progress", () => { expect(toDraftState(makeSession({ myRole: "middle", localPicking: true })).myTurn).toBe(true); });
test("ban phase while bans are open", () => { expect(toDraftState(makeSession({ myRole: "middle", bansDone: false })).phase).toBe("ban"); });
test("done after the player locks in", () => { const s = toDraftState(makeSession({ myRole: "middle", localLocked: 61 })); expect(s.phase).toBe("done"); expect(s.localPlayerLocked).toBe(true); expect(s.allies).toEqual([]); });
test("no role in queues without roles", () => { expect(toDraftState(makeSession({})).role).toBeUndefined(); });
test("hovered but not locked picks are ignored", () => { /* an in-progress pick action with championId 61, completed false */ expect(s.allies).toEqual([]); });
test("draftKey ignores order", () => { expect(draftKey(a, "middle")).toBe(draftKey(sameWithPicksReordered, "middle")); expect(draftKey(a, "middle")).not.toBe(draftKey(a, "top")); });
test("state holds no player names", () => { expect(JSON.stringify(toDraftState(sessionWithExtraNameFields))).not.toContain("SecretName"); });
```

- [ ] **Step 2:** Run: `npm test -w app -- state`. Expected: FAIL.
- [ ] **Step 3:** Implement `makeSession`, the types, `toDraftState` and `draftKey`.
- [ ] **Step 4:** Run: `npm test -w app -- state`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: turn the client's champion select session into a draft state`.

---

### Task 4: Statistics loader

**Files:**
- Create: `app/src/main/stats/loader.ts`, `app/src/main/stats/loader.test.ts`

**Interfaces:**
- Consumes: `StatsFile` from `@lda/shared`.
- Produces:

```ts
export const STATS_BASE_URL = "https://github.com/labuzniq/league-draft-advisor/releases/download/stats";
export const MIN_MATCHES = 10_000;
export function chooseStats(current?: StatsFile, previous?: StatsFile): StatsFile | undefined;
export async function loadStats(cacheDir: string, fetchFn?: typeof fetch): Promise<StatsFile | undefined>;
```

Rules:
- `chooseStats`: `current` when it has at least `MIN_MATCHES` matches; otherwise `previous` when it exists; otherwise `current`; `undefined` when both are missing.
- `loadStats` downloads `current.json` and `previous.json` from `STATS_BASE_URL`, saves each good download into `cacheDir`, and reads from `cacheDir` for any file whose download failed. A missing `previous.json` (HTTP 404) is normal.

- [ ] **Step 1: Write the failing tests:** `chooseStats` for the four cases above; `loadStats` with a fake `fetchFn` and a temp folder: (a) both downloads succeed and files land in the cache, (b) fetch throws and the cached copy is returned, (c) fetch throws and the cache is empty gives `undefined`, (d) `previous.json` returns 404 and `current.json` is used.
- [ ] **Step 2:** Run: `npm test -w app -- loader`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w app -- loader`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: load and cache the statistics file`.

---

### Task 5: Champion data

**Files:**
- Create: `app/src/main/champions/ddragon.ts`, `app/src/main/champions/ddragon.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ChampionInfo { id: number; name: string; tags: string[]; kit: string; imageUrl: string }
export function toChampionInfo(raw: unknown, version: string): ChampionInfo;
export async function loadChampions(cacheDir: string, fetchFn?: typeof fetch): Promise<{ version: string; champions: Map<number, ChampionInfo> }>;
```

Source: Riot's Data Dragon. Latest version is the first entry of `https://ddragon.leagueoflegends.com/api/versions.json`. Champion data is `https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/championFull.json`; each entry has `key` (the numeric ID as a string), `name`, `tags`, `passive.name`, `passive.description`, `spells[].name`, `spells[].description`, `image.full`. Image URL: `https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{image.full}`.

`kit` is plain text, one line for the passive and one per spell, in the form `Q - Name: description`, with HTML tags removed. The downloaded JSON is cached in `cacheDir` per version; when offline the newest cached version is used.

- [ ] **Step 1: Write the failing tests:** `toChampionInfo` on a small hand-made raw entry gives the right `id` (number), `name`, `tags`, an `imageUrl` with the version in it, and a `kit` of five lines without `<` characters; `loadChampions` with a fake `fetchFn` returns a map keyed by numeric ID, and with a throwing `fetchFn` returns the cached version.
- [ ] **Step 2:** Run: `npm test -w app -- ddragon`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w app -- ddragon`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: load champion and spell data from Data Dragon`.

---

### Task 6: Candidate filter

**Files:**
- Create: `app/src/main/draft/candidates.ts`, `app/src/main/draft/candidates.test.ts`

**Interfaces:**
- Consumes: `DraftState`, `OwnedChampion`, `StatsFile`, `roleStats`, `winRate`, `pickRate`.
- Produces:

```ts
export interface Candidate { championId: number; games: number; winRate: number; pickRate: number; masteryPoints: number; score: number }
export const MIN_ROLE_SHARE = 0.005;   // share of all matches a champion needs in the role
export const CANDIDATE_LIMIT = 25;
export function selectCandidates(input: { state: DraftState; role: Role; stats: StatsFile; owned: OwnedChampion[]; showAll: boolean }): Candidate[];
export function selectCandidatesWithoutStats(input: { state: DraftState; owned: OwnedChampion[] }): Candidate[];
```

`selectCandidatesWithoutStats` is for the case where no statistics file is available: the owned champions that are not picked or banned, sorted by `masteryPoints`, at most `CANDIDATE_LIMIT`, with `games`, `winRate`, `pickRate` and `score` set to 0. The role is not filtered here; the AI is told the role.

Rules for `selectCandidates`:
- Keep a champion when `pickRate(stats, id, role) >= MIN_ROLE_SHARE`, it is not in `allies`, `enemies` or `bans`, and it is owned (skipped when `showAll` is true).
- `score = (winRate - 0.5) * 100 + min(3, masteryPoints / 100_000 * 3)`. Win rate points above 50, plus up to 3 points for champions the player plays a lot.
- Sort by `score`, highest first, and return at most `CANDIDATE_LIMIT`.

- [ ] **Step 1: Write the failing tests** using `app/test/fixtures/stats.json`:

```ts
test("keeps owned champions of the role", () => { /* owned 61, 3; role middle */ expect(ids).toEqual(expect.arrayContaining([61, 3])); expect(ids).not.toContain(103); });
test("drops picked and banned champions", () => { /* enemy picked 103, ban 3, owned 61,3,103 */ expect(ids).toEqual([61]); });
test("showAll ignores ownership", () => { /* owned [] */ expect(ids).toContain(103); });
test("drops champions rarely played in the role", () => { /* Leona in middle has 0 games */ expect(ids).not.toContain(89); });
test("mastery lifts a champion over a slightly stronger one", () => { /* two champions 0.5 win rate points apart, weaker one has 100_000 mastery */ expect(ids[0]).toBe(weakerButPlayed); });
test("at most 25", () => { /* generated stats with 40 champions */ expect(result).toHaveLength(25); });
test("champion missing from stats is skipped without error", () => { /* owned includes 9999 */ expect(ids).not.toContain(9999); });
test("without stats: most-played owned champions that are still open", () => { /* owned 61 (50_000), 3 (90_000), 103 (10_000); 103 banned */ expect(ids).toEqual([3, 61]); });
```

- [ ] **Step 2:** Run: `npm test -w app -- candidates`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w app -- candidates`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: choose pick candidates from statistics and ownership`.

---

### Task 7: Advisor

**Files:**
- Create: `app/src/main/advisor/prompt.ts`, `app/src/main/advisor/prompt.test.ts`, `app/src/main/advisor/advisor.ts`, `app/src/main/advisor/advisor.test.ts`, `app/scripts/measure-advisor.ts`
- Modify: `app/package.json` (add `@anthropic-ai/sdk`, `zod`, script `measure`)

**Interfaces:**
- Consumes: `DraftState`, `Advice`, `Candidate`, `ChampionInfo`, `StatsFile`, `mainRole`.
- Produces, in `prompt.ts`:

```ts
export interface DraftContext { system: string; championIds: ReadonlySet<number> }
export interface PromptData { champions: Map<number, ChampionInfo>; stats?: StatsFile }
export function buildContext(input: { role: Role; state: DraftState; candidates: Candidate[] }, data: PromptData): DraftContext;
export function buildUserMessage(input: { context: DraftContext; role: Role; state: DraftState; candidates: Candidate[] }, data: PromptData): string;
export const AdviceSchema: z.ZodType<Advice>;        // teamRead first, then picks (1 to 5)
export function parsePartialAdvice(text: string): Partial<Advice>;
export function keepValidPicks(advice: Advice, candidates: Candidate[]): Advice;
```

- Produces, in `advisor.ts`:

```ts
export const DEFAULT_MODEL = "claude-opus-5-5";
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export interface AdviceRequest { context: DraftContext; role: Role; state: DraftState; candidates: Candidate[] }
export class AdvisorError extends Error { constructor(message: string, readonly kind: "auth" | "rate-limit" | "refused" | "empty" | "other") }
export interface Advisor { advise(req: AdviceRequest, onPartial: (a: Partial<Advice>) => void, signal: AbortSignal): Promise<Advice> }
export class ClaudeAdvisor implements Advisor { constructor(opts: { apiKey: string; model: string; data: PromptData }) }
```

How the request is built (this is what makes repeat requests cheap, so keep the order):
- `buildContext` runs once per draft, at the first request. `system` holds, in this order: the coach instructions, then champion data (name, tags, kit, and for candidates the role win rate, pick rate, ban rate and game count) for every candidate and every champion already picked. Champions are listed sorted by ID. No times, dates or random values.
- `buildUserMessage` runs for every request. It holds the current draft: the player's role, allies with roles, enemies with a guessed role (`mainRole`, or "unknown"), bans, the candidate IDs still open, and champion data for any picked champion that is not in `context.championIds`. A champion missing from `data.champions` is written as `Unknown champion (ID n)`.
- The coach instructions must cover: suggest 1 to 5 picks for the player's role from the open candidates only; weigh team needs (frontline, engage, damage mix of physical and magic, early or late power), combos between ally spells, and counters to enemy picks; either balance the team or commit to one plan, and say which; each reason is 1 to 2 sentences and names the specific ally or enemy champion it relies on; `teamRead` is one line; write suggestions, not orders; statistics are a guide, not the only reason.

`ClaudeAdvisor.advise`:
- Calls `client.messages.stream` with `model`, `max_tokens: 4000`, `system: [{ type: "text", text: context.system, cache_control: { type: "ephemeral" } }]`, one user message, and `output_config: { effort: "low", format: zodOutputFormat(AdviceSchema) }` (`zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`). Pass `{ signal }` as the request option.
- On each `stream.on("text", ...)` delta, add to a buffer and call `onPartial(parsePartialAdvice(buffer))`.
- After `await stream.finalMessage()`: when `stop_reason` is `"refusal"`, throw `AdvisorError` of kind `"refused"`. Otherwise parse the full text with `AdviceSchema`, run `keepValidPicks`, and throw kind `"empty"` when no pick is left.
- Map errors with the SDK's classes, most specific first: `Anthropic.AuthenticationError` gives kind `"auth"` with the message `Your Claude API key was rejected. Check it in Settings.`; `Anthropic.RateLimitError` gives `"rate-limit"`; any other `Anthropic.APIError` gives `"other"`. An abort is rethrown as is.
- Refusal fallback: also try the server-side fallback, `client.beta.messages.stream` with `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`. If the installed SDK's types do not accept it together with `output_config.format`, leave it out and keep the `"refused"` error; say which one was done in the commit message.

`parsePartialAdvice` returns `teamRead` once its closing quote has arrived and every pick object whose closing brace has arrived. It never throws.

- [ ] **Step 1: Write the failing tests** in `prompt.test.ts`:

```ts
test("context is stable for the same input", () => { expect(buildContext(input, data).system).toBe(buildContext(input, data).system); });
test("context lists champions sorted by ID and includes candidate numbers", () => { /* index of "Galio" < index of "Orianna"; contains "52.0%" for Orianna from the fixture */ });
test("user message names open candidates and guesses enemy roles", () => { /* enemy Ahri -> "middle" */ });
test("user message carries data for a newly picked champion that is not in the context", () => { /* Leona picked after context was built */ expect(msg).toContain("Leona"); });
test("unknown champion does not throw", () => { /* enemy pick 9999 */ expect(msg).toContain("Unknown champion (ID 9999)"); });
test("parsePartialAdvice returns finished parts only", () => {
  expect(parsePartialAdvice('{"teamRead":"No frontline","picks":[{"championId":61,"reason":"Combo."},{"championId":3,"rea')).toEqual({ teamRead: "No frontline", picks: [{ championId: 61, reason: "Combo." }] });
  expect(parsePartialAdvice('{"teamRead":"No fr')).toEqual({});
});
test("keepValidPicks drops champions that are not candidates", () => { /* picks 61 and 103, candidates only 61 */ expect(result.picks.map(p => p.championId)).toEqual([61]); });
```

- [ ] **Step 2: Write the failing tests** in `advisor.test.ts`, with `@anthropic-ai/sdk` mocked through `vi.mock` so no real request is made: (a) deltas reach `onPartial` and the final `Advice` is returned; (b) an answer whose only pick is not a candidate throws kind `"empty"`; (c) `stop_reason: "refusal"` throws kind `"refused"`; (d) a thrown `Anthropic.AuthenticationError` becomes kind `"auth"` with the message above; (e) the request carries `model`, `output_config.effort === "low"`, and `cache_control` on the system block.
- [ ] **Step 3:** Run: `npm test -w app -- advisor`. Expected: FAIL.
- [ ] **Step 4:** Implement `prompt.ts` and `advisor.ts`.
- [ ] **Step 5:** Run: `npm test -w app -- advisor`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: ask Claude for pick suggestions with reasons`.
- [ ] **Step 7:** Write `app/scripts/measure-advisor.ts` (the spec asks to measure speed early): for three draft states built with `makeSession` (first pick with nothing locked, mid draft, last pick), run `ClaudeAdvisor` three times each with the fixture statistics and real champion data from `loadChampions`. Print per run: milliseconds to the first finished pick, milliseconds to the full answer, input, cached and output tokens, and the cost worked out from the token counts. Print the averages at the end. The key comes from the `ANTHROPIC_API_KEY` environment variable. This spends real money (a few cents); ask Martin before running it.
- [ ] **Step 8:** Run: `npm run measure -w app`. Expected: nine result lines and the averages.
- [ ] **Step 9: Apply the speed plan from the spec.** The average time to the first pick plus the 800 ms grouping pause must be at most 5 seconds. If it is not: lower `CANDIDATE_LIMIT` to 15 and shorten `kit` to the passive and ultimate lines, then measure again. If it is still too slow, set `DEFAULT_MODEL` to `claude-sonnet-5-5` and measure once more. Also check the cost: average cost per request times 5 should be under 25 cents; report it if not.
- [ ] **Step 10:** Commit: `chore: measure advisor speed and cost`, with the final numbers and which step of the speed plan was needed in the message.

---

### Task 8: Advice controller

**Files:**
- Create: `app/src/main/advisor/controller.ts`, `app/src/main/advisor/controller.test.ts`

**Interfaces:**
- Consumes: `Advisor`, `AdviceRequest`, `AdvisorError`, `buildContext`, `draftKey`, `selectCandidates`.
- Produces:

```ts
export type AdviceView =
  | { status: "idle" }
  | { status: "need-role" }
  | { status: "loading"; partial: Partial<Advice> }
  | { status: "ready"; advice: Advice }
  | { status: "error"; message: string; fallback: Candidate[] };   // fallback: top 5 candidates by score
export const DEBOUNCE_MS = 800;
export const TIMEOUT_MS = 15_000;
export class AdviceController {
  constructor(deps: {
    advisor: Advisor;
    data: PromptData;
    candidatesFor: (state: DraftState, role: Role) => Candidate[];
    onView: (view: AdviceView) => void;
  });
  update(state: DraftState, chosenRole?: Role): void; // chosenRole: from the dropdown when state.role is undefined
  retry(): void;
  reset(): void;                                      // champion select ended
}
```

Rules:
- `phase === "ban"`: view `idle`, no request.
- `phase === "done"`: keep the current view, cancel any pending or running request, start nothing.
- No role (`state.role ?? chosenRole` is undefined): view `need-role`, no request.
- Otherwise: wait `DEBOUNCE_MS` after the latest `update`, then start one request. A newer `update` with a different `draftKey` cancels the pending timer and aborts the running request.
- The `DraftContext` is built at the first request of a draft and reused until `reset()`.
- Finished answers are kept by `draftKey`; a state seen before shows its answer at once without a request.
- A request that runs longer than `TIMEOUT_MS` is aborted and shows `error` with the message `The suggestion took too long.`
- An `AdvisorError` shows `error` with its message. Any other error shows `error` with `Could not get suggestions.` An abort caused by a newer state shows nothing.
- `retry()` starts a request for the latest state right away.
- `reset()` aborts, clears the context and the kept answers, and shows `idle`.

- [ ] **Step 1: Write the failing tests** with a fake `Advisor` and `vi.useFakeTimers()`:

```ts
test("no request during bans", ...);                       // advise not called, view idle
test("waits 800 ms, then asks once", ...);                 // not called at 799 ms, called once at 800 ms
test("two quick updates give one request", ...);
test("a new state aborts the running request", ...);       // first signal.aborted is true
test("the same state is not asked twice", ...);            // second update shows ready without a new call
test("no request after the player locks in", ...);
test("need-role until a role is chosen", ...);             // then update(state, "middle") starts a request
test("timeout shows the error with the top 5 candidates", ...);
test("AdvisorError message is shown", ...);                // kind "auth" message reaches the view
test("reset aborts and clears", ...);                      // aborted, view idle, same state asks again afterwards
test("context is built once per draft", ...);              // two requests in one draft share the same context object
```

- [ ] **Step 2:** Run: `npm test -w app -- controller`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w app -- controller`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: control when suggestions are requested and cancelled`.

---

### Task 9: League client connector

**Files:**
- Create: `app/src/main/lcu/locate.ts`, `app/src/main/lcu/locate.test.ts`, `app/src/main/lcu/client.ts`, `app/src/main/lcu/client.test.ts`, `app/test/helpers/fake-lcu.ts`, `app/test/fixtures/recording.json`
- Modify: `app/package.json` (add `ws`; dev: `selfsigned`)

**Interfaces:**
- Produces, in `locate.ts`:

```ts
export interface LcuCredentials { port: number; token: string }
export function parseCommandLine(commandLine: string): LcuCredentials | undefined; // reads --app-port= and --remoting-auth-token=
export async function locateClient(): Promise<LcuCredentials | undefined>;
```

`locateClient` reads the command line of the running `LeagueClientUx` process: on Windows through PowerShell `Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'"`, on macOS through `ps -A -o args`. It returns `undefined` when the process is not running.

- Produces, in `client.ts`:

```ts
export interface Recording {
  ownedChampions: unknown;   // raw answer of the owned-champions request
  mastery: unknown;          // raw answer of the mastery request
  events: { atMs: number; eventType: "Create" | "Update" | "Delete"; data: unknown }[];
}
export class LcuClient {
  constructor(creds: LcuCredentials);
  connect(): Promise<void>;
  onSession(cb: (session: LcuChampSelectSession | null, eventType: string) => void): void; // null when champion select ended
  onClose(cb: () => void): void;
  getOwnedChampions(): Promise<OwnedChampion[]>;
  getRaw(path: string): Promise<unknown>;
  close(): void;
}
```

Client details (from memory of the unofficial API; Task 12 checks them):
- Address `127.0.0.1:{port}`, HTTPS and WSS, HTTP basic login with user `riot` and the token as password. The client uses its own certificate, so certificate checks are turned off for this local address only.
- After the websocket opens, send `[5, "OnJsonApiEvent_lol-champ-select_v1_session"]`. Events arrive as `[8, "OnJsonApiEvent_lol-champ-select_v1_session", { eventType, data }]`. `eventType` `Delete` means champion select ended.
- On connect, also `GET /lol-champ-select/v1/session` once; HTTP 404 means not in champion select.
- Owned champions: `GET /lol-champions/v1/owned-champions-minimal` (array with `id`). Mastery: `GET /lol-champion-mastery/v1/local-player/champion-mastery` (array with `championId`, `championPoints`). `getOwnedChampions` joins the two; a champion without a mastery entry has 0 points.
- Only `GET` requests are sent.

`fake-lcu.ts` exports `startFakeLcu(recording: Recording): Promise<{ creds: LcuCredentials; play(): Promise<void>; stop(): Promise<void> }>`: an HTTPS and WSS server on a free local port with a certificate made by `selfsigned`, that checks the basic login, answers the three `GET` paths, and on `play()` sends the recording's events in order (without waiting the real `atMs` gaps).

`recording.json` is hand-written: owned champions 61 and 3 with mastery, and four events: `Create` in ban phase, `Update` with bans done and Jarvan IV locked by an ally, `Update` with Ahri locked by the enemy, `Delete`.

- [ ] **Step 1: Write the failing tests:**

```ts
test("parseCommandLine reads port and token", () => { expect(parseCommandLine('"LeagueClientUx.exe" --remoting-auth-token=abc123 --app-port=51234 --x')).toEqual({ port: 51234, token: "abc123" }); });
test("parseCommandLine gives undefined without them", () => { expect(parseCommandLine("notepad.exe")).toBeUndefined(); });
test("client receives session events and the end of champion select", async () => { /* fake LCU, play(); collected: 3 sessions then null */ });
test("getOwnedChampions joins ownership and mastery", async () => { expect(owned).toEqual(expect.arrayContaining([{ championId: 61, masteryPoints: expect.any(Number) }])); });
test("onClose fires when the client goes away", async () => { /* stop() the fake */ });
test("wrong token is rejected", async () => { await expect(new LcuClient({ port, token: "bad" }).connect()).rejects.toThrow(); });
```

- [ ] **Step 2:** Run: `npm test -w app -- lcu`. Expected: FAIL.
- [ ] **Step 3:** Implement `fake-lcu.ts`, `locate.ts`, `client.ts`, and write `recording.json`.
- [ ] **Step 4:** Run: `npm test -w app -- lcu`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: connect to the League client and follow champion select`.

---

### Task 10: Settings and secure key storage

**Files:**
- Create: `app/src/main/settings.ts`, `app/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MODEL`, `MODELS`.
- Produces:

```ts
export interface Settings { model: string; showAll: boolean; hasApiKey: boolean }
export interface KeyCipher { encrypt(text: string): Buffer; decrypt(data: Buffer): string } // Electron safeStorage in the app, a fake in tests
export class SettingsStore {
  constructor(filePath: string, cipher: KeyCipher);
  get(): Settings;                       // defaults: model DEFAULT_MODEL, showAll false
  set(patch: { model?: string; showAll?: boolean }): Settings;  // rejects a model that is not in MODELS
  setApiKey(key: string): void;          // empty string removes the key
  getApiKey(): string | undefined;
}
```

The file is JSON in the app's user data folder. The key is stored only as the cipher's output, base64 encoded.

- [ ] **Step 1: Write the failing tests** with a temp file and a fake cipher: defaults; `set` persists across a new `SettingsStore`; an unknown model throws; `setApiKey` then `getApiKey` round-trips and `hasApiKey` is true; the file's text does not contain the plain key; `setApiKey("")` removes it.
- [ ] **Step 2:** Run: `npm test -w app -- settings`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run: `npm test -w app -- settings`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: store settings and the API key securely`.

---

### Task 11: Wiring and window

**Files:**
- Create: `app/src/main/session.ts`, `app/src/main/session.test.ts`, `app/src/renderer/src/screens/Waiting.tsx`, `Setup.tsx`, `SettingsScreen.tsx`, `Draft.tsx`, `app/src/renderer/src/screens/Draft.test.tsx`
- Modify: `app/src/shared/types.ts`, `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3 to 10.
- Produces, in `app/src/shared/types.ts`:

```ts
export interface ChampionChip { name: string; imageUrl: string; role?: Role }
export interface PickRow { name: string; imageUrl: string; winRate?: number; reason?: string }
export type AppView =
  | { screen: "setup" }
  | { screen: "waiting"; reason: "no-client" | "no-champ-select" }
  | { screen: "draft"; patch?: string; statsMissing: boolean; role?: Role; myTurn: boolean; allies: ChampionChip[]; enemies: ChampionChip[];
      advice: { status: "idle" | "need-role" } | { status: "loading" | "ready"; teamRead?: string; picks: PickRow[] } | { status: "error"; message: string; picks: PickRow[] } };
export interface AppApi {            // exposed to the renderer by the preload script
  onView(cb: (view: AppView) => void): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: { model?: string; showAll?: boolean }): Promise<Settings>;
  setApiKey(key: string): Promise<void>;
  chooseRole(role: Role): void;
  retry(): void;
}
```

- Produces, in `session.ts`:

```ts
export class DraftSession {
  constructor(deps: {
    locate: () => Promise<LcuCredentials | undefined>;
    makeClient: (creds: LcuCredentials) => LcuClient;
    makeAdvisor: (apiKey: string, model: string, data: PromptData) => Advisor;
    settings: SettingsStore;
    loadStats: () => Promise<StatsFile | undefined>;
    loadChampions: () => Promise<{ version: string; champions: Map<number, ChampionInfo> }>;
    onView: (view: AppView) => void;
    pollMs?: number;   // default 3000
  });
  start(): Promise<void>;
  chooseRole(role: Role): void;
  retry(): void;
  settingsChanged(): void;   // new key, model or showAll: rebuild the advisor and refresh
  stop(): void;
}
```

Behaviour:
- No API key: `{ screen: "setup" }`.
- With a key: look for the client every `pollMs`. Not found: `waiting / no-client`. Connected but no champion select: `waiting / no-champ-select`. Client closed: back to looking.
- In champion select: each session event goes through `toDraftState` into the `AdviceController`; the controller's view plus champion names and images make the `draft` view. The win rate on a pick row comes from the statistics file for the player's role.
- `statsMissing` is true when `loadStats` gave nothing. Candidates then come from `selectCandidatesWithoutStats`, the request carries no statistics, and the window shows the line `Statistics are not available. Suggestions use game knowledge only.`
- The patch shown is the statistics file's `patch`.

Window (plain React, one stylesheet, dark theme):
- **Waiting**: `Waiting for League of Legends…` or `Waiting for champion select…`.
- **Setup**: short text on where to get a Claude API key (`platform.claude.com`, and that Max plans include monthly credits), a password-type input, a Save button.
- **Settings** (opened by a gear button on every screen): API key (shown as saved or not, never the key itself), model dropdown from `MODELS`, `Show all champions` checkbox.
- **Draft**: the layout from the spec's sketch. Header with patch and role, plus `Your pick` while `myTurn` is true; a role dropdown when `advice.status` is `need-role`; allies and enemies rows; team read line; pick rows with image, name, win rate as `52.1% win rate`, and reason. While `loading`, rows that have arrived show and a small `Thinking…` line sits under them. On `error`: the message, a Retry button, and the pick rows without reasons under the heading `Strong picks by statistics`.

- [ ] **Step 1: Write the failing tests** in `session.test.ts`, using the fake League client from Task 9, a fake `Advisor`, the fixture statistics and a small champion map:

```ts
test("setup screen without an API key", ...);
test("waiting until the client is found, then waiting for champion select", ...);
test("draft view shows allies, enemies and suggestions after the recording plays", ...);   // Jarvan IV in allies, Ahri in enemies, pick row "Orianna" with a reason
test("back to waiting when champion select ends, and the request is cancelled", ...);       // after the Delete event
test("statsMissing view when no statistics file is available", ...);
test("the view never contains player names", ...);                                          // JSON of every view has no "SecretName" from the recording
```

- [ ] **Step 2: Write the failing tests** in `Draft.test.tsx` (React Testing Library): a `ready` view renders `Orianna`, `52.1% win rate` and the reason; a `need-role` view renders a role dropdown and choosing `Mid` calls `chooseRole("middle")`; an `error` view renders the message, a Retry button that calls `retry`, and the heading `Strong picks by statistics`.
- [ ] **Step 3:** Run: `npm test -w app -- session Draft`. Expected: FAIL.
- [ ] **Step 4:** Implement `session.ts`, the preload bridge, `index.ts` wiring (real `locateClient`, `LcuClient`, `ClaudeAdvisor`, `safeStorage` cipher, cache folder under the app's user data folder), and the four screens.
- [ ] **Step 5:** Run: `npm test -w app`. Expected: PASS (all app tests).
- [ ] **Step 6:** Manual check. Add a dev-only start flag `--fake-lcu` to `index.ts` that starts the fake client with `recording.json`, replays it with real pauses, and uses it instead of `locateClient`. Run: `npm run dev -w app -- --fake-lcu`. Expected: the window goes from waiting to the draft view and back, with real suggestions when an API key is saved.
- [ ] **Step 7:** Commit: `feat: wire the draft advisor together and build the window`.

---

### Task 12: Recording and real client check

**Files:**
- Create: `app/src/main/lcu/recorder.ts`, `app/src/main/lcu/recorder.test.ts`, `docs/real-client-check.md`
- Modify: `app/src/main/index.ts` (start flag `--record`)

**Interfaces:**
- Consumes: `LcuClient`, `Recording`.
- Produces: `export class Recorder { constructor(client: LcuClient); start(): Promise<void>; stop(): Recording }`.

- [ ] **Step 1: Write the failing test** for the recorder with the fake client: after `start()`, `play()`, `stop()`, the result equals the played recording in `ownedChampions`, `mastery`, and the list of `eventType` and `data` values, with `atMs` values that do not go down. Player names must not be saved: the recorder removes every field of a session that `LcuChampSelectSession` does not list, and the test checks that `"SecretName"` is not in the output.
- [ ] **Step 2:** Run: `npm test -w app -- recorder`. Expected: FAIL. Implement. Run again. Expected: PASS.
- [ ] **Step 3:** Add the `--record` start flag: the app records from the first champion select event to its end and writes `recording-{time}.json` to the desktop.
- [ ] **Step 4:** Write `docs/real-client-check.md`, the steps Martin runs on his Windows PC: install the build from Task 13, start it with `--record`, play one ranked champion select, and check four things: the app left the waiting screen by itself, picks and bans in the window matched the client, suggestions arrived in time, and the recording file was written. He sends the file back.
- [ ] **Step 5:** Commit: `feat: record a champion select session for the real client check`.
- [ ] **Step 6:** After Martin sends the recording: replace `app/test/fixtures/recording.json` with it, run `npm test -w app`, and fix any field name in `state.ts` or `client.ts` that the real data proves wrong. Commit: `fix: match the real client's session data`. This step waits for Martin and does not block Task 13.

---

### Task 13: Installers

**Files:**
- Create: `app/electron-builder.yml`, `.github/workflows/build.yml`
- Modify: `app/package.json` (add `electron-builder`, script `dist`)

**Interfaces:**
- Produces: `npm run dist -w app` writes installers to `app/release/`; a manual GitHub workflow that builds them.

- [ ] **Step 1:** Write `electron-builder.yml`: `appId: gg.labuzniq.draftadvisor`, `productName: Draft Advisor`, output folder `release`, Windows target `nsis`, macOS target `dmg`. No publish settings.
- [ ] **Step 2:** Write `.github/workflows/build.yml`: trigger `workflow_dispatch` only; a matrix of `windows-latest` and `macos-latest`; steps `npm ci`, `npm test`, `npm run dist -w app -- --publish never`; upload `app/release/*.exe` and `app/release/*.dmg` with `actions/upload-artifact`. No release is created.
- [ ] **Step 3:** Verify locally. Run: `npm run dist -w app`. Expected: a `.dmg` in `app/release/` on macOS. Open it and start the app. Expected: the waiting screen.
- [ ] **Step 4:** Add a short `README.md` at the repository root: what the app does, how to run it in development, how to build an installer, and where a friend gets a Claude API key.
- [ ] **Step 5:** Commit: `chore: build Windows and macOS installers in CI`.
