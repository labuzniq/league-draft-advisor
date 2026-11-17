import type { Role } from "@lda/shared";
import type { LcuAction, LcuChampSelectSession, LcuTeamMember } from "../../src/main/draft/state";

const LOCAL_CELL = 0;

export function makeSession(opts: {
  myRole?: Role;
  allyPicks?: { championId: number; role?: Role }[];
  enemyPicks?: number[];
  bans?: number[];
  bansDone?: boolean;
  localLocked?: number;
  localPicking?: boolean;
  timerPhase?: string;
}): LcuChampSelectSession {
  const { myRole, allyPicks = [], enemyPicks = [], bans = [], bansDone = true, localLocked, localPicking = false, timerPhase = "BAN_PICK" } = opts;
  let nextId = 0;
  const action = (a: Omit<LcuAction, "id">): LcuAction => ({ id: nextId++, ...a });

  const myTeam: LcuTeamMember[] = [
    { cellId: LOCAL_CELL, championId: localLocked ?? 0, assignedPosition: myRole ?? "" },
    ...allyPicks.map((p, i) => ({ cellId: i + 1, championId: p.championId, assignedPosition: p.role ?? "" })),
  ];
  const theirTeam: LcuTeamMember[] = enemyPicks.map((championId, i) => ({ cellId: i + 5, championId, assignedPosition: "" }));

  const banActions = bans.map((championId, i) =>
    action({ actorCellId: i, championId, type: "ban", completed: bansDone, isInProgress: false, isAllyAction: i % 2 === 0 }));
  if (!bansDone && bans.length === 0) {
    banActions.push(action({ actorCellId: LOCAL_CELL, championId: 0, type: "ban", completed: false, isInProgress: true, isAllyAction: true }));
  }

  const pickActions = [
    action({ actorCellId: LOCAL_CELL, championId: localLocked ?? 0, type: "pick", completed: localLocked !== undefined, isInProgress: localPicking, isAllyAction: true }),
    ...myTeam.slice(1).map((m) => action({ actorCellId: m.cellId, championId: m.championId, type: "pick", completed: true, isInProgress: false, isAllyAction: true })),
    ...theirTeam.map((m) => action({ actorCellId: m.cellId, championId: m.championId, type: "pick", completed: true, isInProgress: false, isAllyAction: false })),
  ];

  return { localPlayerCellId: LOCAL_CELL, myTeam, theirTeam, actions: [banActions, pickActions], timer: { phase: timerPhase } };
}
