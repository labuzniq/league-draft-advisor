import { ROLES, type ChampionStats, type Role, type StatsFile } from "@lda/shared";
import { QUEUE_ID } from "./config";

const MIN_GAME_SECONDS = 300;

export interface MatchDto {
  info: {
    gameVersion: string;
    gameDuration: number;
    queueId: number;
    participants: { championId: number; teamPosition: string; win: boolean }[];
    teams: { bans: { championId: number }[] }[];
  };
}

export function patchOf(gameVersion: string): string {
  return gameVersion.split(".").slice(0, 2).join(".");
}

export function comparePatch(a: string, b: string): number {
  const [aMajor, aMinor] = a.split(".").map(Number);
  const [bMajor, bMinor] = b.split(".").map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

export function emptyStats(patch: string, windowEnd: number): StatsFile {
  return { patch, updatedAt: "", windowEnd, matches: 0, champions: {} };
}

function entry(file: StatsFile, championId: number): ChampionStats {
  return (file.champions[String(championId)] ??= { bans: 0, roles: {} });
}

export function addMatch(file: StatsFile, match: MatchDto): boolean {
  const { info } = match;
  if (
    info.queueId !== QUEUE_ID ||
    info.gameDuration < MIN_GAME_SECONDS ||
    patchOf(info.gameVersion) !== file.patch
  ) {
    return false;
  }

  file.matches += 1;

  for (const p of info.participants) {
    const role = p.teamPosition.toLowerCase() as Role;
    if (!ROLES.includes(role)) continue;
    const stats = (entry(file, p.championId).roles[role] ??= { games: 0, wins: 0 });
    stats.games += 1;
    if (p.win) stats.wins += 1;
  }

  const banned = new Set(info.teams.flatMap((t) => t.bans.map((b) => b.championId)));
  for (const championId of banned) {
    if (championId > 0) entry(file, championId).bans += 1;
  }

  return true;
}
