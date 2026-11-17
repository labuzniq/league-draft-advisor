import type { StatsFile } from "@lda/shared";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChampions } from "../src/main/champions/ddragon";
import { ClaudeAdvisor, DEFAULT_MODEL, MODELS } from "../src/main/advisor/advisor";
import { buildContext } from "../src/main/advisor/prompt";
import { selectCandidates } from "../src/main/draft/candidates";
import { toDraftState } from "../src/main/draft/state";
import { makeSession } from "../test/helpers/session";

interface Price { input: number; output: number; cacheRead: number }

const PRICES: Record<(typeof MODELS)[number], Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const CACHE_WRITE_FACTOR = 1.25;
const RUNS_PER_DRAFT = 3;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Set it to run the measurement.");
  process.exit(1);
}

const stats = JSON.parse(await readFile(join(import.meta.dirname, "../test/fixtures/stats.json"), "utf8")) as StatsFile;
const { champions } = await loadChampions(join(tmpdir(), "lda-measure-champions"));
const data = { champions, stats };
const advisor = new ClaudeAdvisor({ apiKey, model: DEFAULT_MODEL, data });
const price = PRICES[DEFAULT_MODEL];

const drafts = {
  "first pick": makeSession({ myRole: "middle", localPicking: true }),
  "mid draft": makeSession({ myRole: "middle", allyPicks: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }], enemyPicks: [103, 64], bans: [3, 238], localPicking: true }),
  "last pick": makeSession({
    myRole: "middle",
    allyPicks: [{ championId: 59, role: "jungle" }, { championId: 222, role: "bottom" }, { championId: 89, role: "utility" }, { championId: 266, role: "top" }],
    enemyPicks: [103, 64, 86, 51, 412],
    bans: [238, 157],
    localPicking: true,
  }),
};

interface Result { firstPickMs: number; totalMs: number; input: number; cacheWrite: number; cacheRead: number; output: number; cost: number }

const results: Result[] = [];
const ms = (value: number) => `${Math.round(value)} ms`;
const line = (r: Result) =>
  `first pick ${ms(r.firstPickMs)}, full answer ${ms(r.totalMs)}, input ${r.input}, cache write ${r.cacheWrite}, cache read ${r.cacheRead}, output ${r.output}, cost $${r.cost.toFixed(4)}`;

console.log(`Model: ${DEFAULT_MODEL}`);
for (const [name, session] of Object.entries(drafts)) {
  const state = toDraftState(session);
  const candidates = selectCandidates({ state, role: "middle", stats, owned: [], showAll: true });
  const context = buildContext({ role: "middle", state, candidates }, data);
  for (let run = 1; run <= RUNS_PER_DRAFT; run++) {
    const start = performance.now();
    let firstPickMs = Number.NaN;
    await advisor.advise({ context, role: "middle", state, candidates }, (partial) => {
      if (Number.isNaN(firstPickMs) && partial.picks?.length) firstPickMs = performance.now() - start;
    }, new AbortController().signal);
    const totalMs = performance.now() - start;
    const usage = advisor.lastUsage;
    const input = usage?.input_tokens ?? 0;
    const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
    const cacheRead = usage?.cache_read_input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    const cost = (input * price.input + cacheWrite * price.input * CACHE_WRITE_FACTOR + cacheRead * price.cacheRead + output * price.output) / 1_000_000;
    const result = { firstPickMs, totalMs, input, cacheWrite, cacheRead, output, cost };
    results.push(result);
    console.log(`${name} #${run}: ${line(result)}`);
  }
}

const average = (key: keyof Result) => results.reduce((sum, r) => sum + r[key], 0) / results.length;
console.log(`Average: ${line({
  firstPickMs: average("firstPickMs"),
  totalMs: average("totalMs"),
  input: Math.round(average("input")),
  cacheWrite: Math.round(average("cacheWrite")),
  cacheRead: Math.round(average("cacheRead")),
  output: Math.round(average("output")),
  cost: average("cost"),
})}`);
