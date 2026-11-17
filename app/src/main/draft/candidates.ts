import { pickRate, roleStats, winRate, type Role, type StatsFile } from "@lda/shared";
import type { DraftState, OwnedChampion } from "../../shared/types";

export interface Candidate { championId: number; games: number; winRate: number; pickRate: number; masteryPoints: number; score: number }

export const MIN_ROLE_SHARE = 0.005; // share of all matches a champion needs in the role
export const CANDIDATE_LIMIT = 25;

function takenIds(state: DraftState): Set<number> {
  return new Set([...state.allies, ...state.enemies].map((p) => p.championId).concat(state.bans));
}

export function selectCandidates(input: { state: DraftState; role: Role; stats: StatsFile; owned: OwnedChampion[]; showAll: boolean }): Candidate[] {
  const { state, role, stats, owned, showAll } = input;
  const taken = takenIds(state);
  const mastery = new Map(owned.map((o) => [o.championId, o.masteryPoints]));
  const candidates: Candidate[] = [];
  for (const key of Object.keys(stats.champions)) {
    const championId = Number(key);
    if (taken.has(championId) || (!showAll && !mastery.has(championId))) continue;
    const share = pickRate(stats, championId, role);
    if (share < MIN_ROLE_SHARE) continue;
    const roleResult = roleStats(stats, championId, role);
    const rate = winRate(roleResult);
    const masteryPoints = mastery.get(championId) ?? 0;
    candidates.push({
      championId,
      games: roleResult.games,
      winRate: rate,
      pickRate: share,
      masteryPoints,
      score: (rate - 0.5) * 100 + Math.min(3, (masteryPoints / 100_000) * 3),
    });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, CANDIDATE_LIMIT);
}

export function selectCandidatesWithoutStats(input: { state: DraftState; owned: OwnedChampion[] }): Candidate[] {
  const taken = takenIds(input.state);
  return input.owned
    .filter((o) => !taken.has(o.championId))
    .sort((a, b) => b.masteryPoints - a.masteryPoints)
    .slice(0, CANDIDATE_LIMIT)
    .map((o) => ({ championId: o.championId, games: 0, winRate: 0, pickRate: 0, masteryPoints: o.masteryPoints, score: 0 }));
}
