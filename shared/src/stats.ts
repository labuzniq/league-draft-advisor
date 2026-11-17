export type Role = "top" | "jungle" | "middle" | "bottom" | "utility";
export const ROLES: readonly Role[] = ["top", "jungle", "middle", "bottom", "utility"];

export interface RoleStats { games: number; wins: number }
export interface ChampionStats { bans: number; roles: Partial<Record<Role, RoleStats>> }
export interface StatsFile {
  patch: string; // "15.22"
  updatedAt: string; // ISO time
  windowEnd: number; // epoch seconds, used by the stats job
  matches: number; // matches counted
  champions: Record<string, ChampionStats>; // key: champion ID as string
}

export function roleStats(file: StatsFile, championId: number, role: Role): RoleStats {
  return file.champions[String(championId)]?.roles[role] ?? { games: 0, wins: 0 };
}

export function winRate(s: RoleStats): number {
  return s.games === 0 ? 0 : s.wins / s.games;
}

export function pickRate(file: StatsFile, championId: number, role: Role): number {
  return roleStats(file, championId, role).games / file.matches;
}

export function banRate(file: StatsFile, championId: number): number {
  return (file.champions[String(championId)]?.bans ?? 0) / file.matches;
}

export function mainRole(file: StatsFile, championId: number): Role | undefined {
  let best: Role | undefined;
  let bestGames = 0;
  for (const role of ROLES) {
    const { games } = roleStats(file, championId, role);
    if (games > bestGames) {
      best = role;
      bestGames = games;
    }
  }
  return best;
}
