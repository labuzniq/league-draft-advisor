import type { StatsFile } from "@lda/shared";
import { addMatch, comparePatch, emptyStats, isCountable, patchOf, type MatchDto } from "./aggregate";
import { QUEUE_ID, REGION_HOST } from "./config";
import { listPlayers } from "./players";
import { RiotError, type RiotClient } from "./riot";

export const SAFETY_GAP_S = 2 * 3600;
export const FIRST_WINDOW_S = 24 * 3600;

export interface RunResult {
  current: StatsFile;
  previous?: StatsFile;
  counted: number;
  skipped: number;
}

interface RunInput {
  client: RiotClient;
  current?: StatsFile;
  previous?: StatsFile;
  nowS: number;
  deadlineMs: number;
  nowMs?: () => number;
  log?: (line: string) => void;
}

function isKeyError(error: RiotError): boolean {
  return error.status === 401 || error.status === 403;
}

export async function runOnce(input: RunInput): Promise<RunResult> {
  const { client, nowS, deadlineMs } = input;
  const nowMs = input.nowMs ?? Date.now;
  const log = input.log ?? (() => undefined);
  let current = input.current && structuredClone(input.current);
  let previous = input.previous && structuredClone(input.previous);
  const from = current ? current.windowEnd + 1 : nowS - FIRST_WINDOW_S;
  const to = nowS - SAFETY_GAP_S;
  const seen = new Set<string>();
  let counted = 0;
  let skipped = 0;

  const skip = (error: unknown, what: string): void => {
    if (!(error instanceof RiotError)) throw error;
    if (isKeyError(error)) throw new Error(`Riot refused the API key (status ${error.status}).`);
    skipped += 1;
    log(`Skipped ${what} (status ${error.status}).`);
  };

  const players = await listPlayers(client).catch((error: unknown) => {
    if (!(error instanceof RiotError)) throw error;
    throw new Error(
      isKeyError(error)
        ? `Riot refused the API key (status ${error.status}).`
        : `The player list could not be fetched (status ${error.status}).`,
    );
  });
  log(`Found ${players.length} players.`);

  const handleMatch = (match: MatchDto): void => {
    if (!isCountable(match)) return;
    const patch = patchOf(match.info.gameVersion);
    if (!current) {
      current = emptyStats(patch, to);
    } else if (comparePatch(patch, current.patch) > 0) {
      previous = current;
      current = emptyStats(patch, to);
    }
    if (addMatch(current, match)) counted += 1;
  };

  for (const puuid of players) {
    if (nowMs() > deadlineMs) {
      log("Time limit reached, stopping.");
      break;
    }
    let ids: string[];
    try {
      ids = await client.get<string[]>(
        REGION_HOST,
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE_ID}&startTime=${from}&endTime=${to}&start=0&count=100`,
      );
    } catch (error) {
      skip(error, "a player");
      continue;
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        handleMatch(await client.get<MatchDto>(REGION_HOST, `/lol/match/v5/matches/${id}`));
      } catch (error) {
        skip(error, "a match");
      }
    }
  }

  if (!current) throw new Error("No matches were found, so no statistics file was started.");
  current.windowEnd = to;
  current.updatedAt = new Date(nowMs()).toISOString();
  log(`Counted ${counted} matches, skipped ${skipped}.`);
  return previous ? { current, previous, counted, skipped } : { current, counted, skipped };
}
