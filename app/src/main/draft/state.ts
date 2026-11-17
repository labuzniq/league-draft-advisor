import { ROLES, type Role } from "@lda/shared";
import type { DraftPick, DraftState } from "../../shared/types";

export interface LcuAction { id: number; actorCellId: number; championId: number; type: string; completed: boolean; isInProgress: boolean; isAllyAction: boolean }
export interface LcuTeamMember { cellId: number; championId: number; assignedPosition: string } // "" when the queue has no roles
export interface LcuChampSelectSession { localPlayerCellId: number; myTeam: LcuTeamMember[]; theirTeam: LcuTeamMember[]; actions: LcuAction[][]; timer: { phase: string } }

function toRole(position: string | undefined): Role | undefined {
  return ROLES.find((role) => role === position);
}

export function toDraftState(session: LcuChampSelectSession): DraftState {
  const actions = session.actions.flat();
  const locked = (type: string) => actions.filter((a) => a.type === type && a.completed && a.championId !== 0);
  const roleOf = (cellId: number) => toRole(session.myTeam.find((m) => m.cellId === cellId)?.assignedPosition);

  const ownPick = actions.find((a) => a.type === "pick" && a.actorCellId === session.localPlayerCellId);
  const localPlayerLocked = ownPick?.completed === true;
  const timerPhase = session.timer.phase;

  let phase: DraftState["phase"] = "pick";
  if (localPlayerLocked || timerPhase === "FINALIZATION" || timerPhase === "GAME_STARTING") phase = "done";
  else if (timerPhase === "PLANNING" || actions.some((a) => a.type === "ban" && !a.completed)) phase = "ban";

  const picks = locked("pick");
  return {
    phase,
    role: roleOf(session.localPlayerCellId),
    allies: picks
      .filter((a) => a.isAllyAction && a.actorCellId !== session.localPlayerCellId)
      .map((a): DraftPick => ({ championId: a.championId, role: roleOf(a.actorCellId) })),
    enemies: picks.filter((a) => !a.isAllyAction).map((a): DraftPick => ({ championId: a.championId })),
    bans: locked("ban").map((a) => a.championId),
    localPlayerLocked,
    myTurn: ownPick?.isInProgress === true,
  };
}

export function draftKey(state: DraftState, role: Role): string {
  const ids = (picks: DraftPick[]) => picks.map((p) => p.championId).sort((a, b) => a - b).join(",");
  const bans = [...state.bans].sort((a, b) => a - b).join(",");
  return `${role}|${ids(state.allies)}|${ids(state.enemies)}|${bans}`;
}
