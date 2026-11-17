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
