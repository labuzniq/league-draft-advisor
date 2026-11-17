import type { Role } from "@lda/shared";

export interface DraftPick { championId: number; role?: Role }
export interface DraftState {
  phase: "ban" | "pick" | "done";
  role?: Role; // the player's assigned role, undefined in queues without roles
  allies: DraftPick[]; // locked picks of teammates, not the player
  enemies: DraftPick[]; // locked enemy picks, role left undefined here
  bans: number[];
  localPlayerLocked: boolean;
  myTurn: boolean; // the player's own pick action is in progress
}
export interface OwnedChampion { championId: number; masteryPoints: number }
export interface Pick { championId: number; reason: string }
export interface Advice { teamRead: string; picks: Pick[] }
export interface Settings { model: string; showAll: boolean; hasApiKey: boolean }

export interface ChampionChip { name: string; imageUrl: string; role?: Role }
export interface PickRow { name: string; imageUrl: string; winRate?: number; reason?: string }
export type AppView =
  | { screen: "setup" }
  | { screen: "waiting"; reason: "no-data" | "no-client" | "client-error" | "no-champ-select" | "unreadable" }
  | { screen: "draft"; patch?: string; statsMissing: boolean; role?: Role; myTurn: boolean; allies: ChampionChip[]; enemies: ChampionChip[];
      advice: { status: "idle" | "need-role" } | { status: "loading" | "ready"; teamRead?: string; picks: PickRow[] } | { status: "error"; message: string; picks: PickRow[] } };
export interface AppApi {
  onView(cb: (view: AppView) => void): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: { model?: string; showAll?: boolean }): Promise<Settings>;
  setApiKey(key: string): Promise<void>;
  chooseRole(role: Role): void;
  retry(): void;
}
