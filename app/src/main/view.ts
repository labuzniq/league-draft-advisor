import { roleStats, winRate, type Role, type StatsFile } from "@lda/shared";
import type { AppView, ChampionChip, DraftPick, DraftState, PickRow } from "../shared/types";
import type { AdviceView } from "./advisor/controller";
import type { ChampionInfo } from "./champions/ddragon";

type DraftView = Extract<AppView, { screen: "draft" }>;

const UNKNOWN_CHAMPION = "Unknown champion";

export function buildDraftView(input: {
  draft: DraftState;
  chosenRole?: Role;
  advice: AdviceView;
  champions: Map<number, ChampionInfo>;
  stats?: StatsFile;
}): DraftView {
  const { draft, advice, champions, stats } = input;
  const role = draft.role ?? input.chosenRole;

  const looks = (championId: number) => {
    const info = champions.get(championId);
    return { name: info?.name ?? UNKNOWN_CHAMPION, imageUrl: info?.imageUrl ?? "" };
  };
  const chip = (pick: DraftPick): ChampionChip => (pick.role ? { ...looks(pick.championId), role: pick.role } : looks(pick.championId));
  const row = (championId: number, reason?: string): PickRow => {
    const result = stats && role ? roleStats(stats, championId, role) : undefined;
    const rate = result && result.games > 0 ? winRate(result) : undefined;
    return { ...looks(championId), winRate: rate, ...(reason === undefined ? {} : { reason }) };
  };

  return {
    screen: "draft",
    patch: stats?.patch,
    statsMissing: stats === undefined,
    role,
    myTurn: draft.myTurn,
    allies: draft.allies.map(chip),
    enemies: draft.enemies.map(chip),
    advice: adviceRows(advice, row),
  };
}

function adviceRows(advice: AdviceView, row: (championId: number, reason?: string) => PickRow): DraftView["advice"] {
  switch (advice.status) {
    case "idle":
    case "need-role":
      return { status: advice.status };
    case "loading":
      return { status: "loading", teamRead: advice.partial.teamRead, picks: (advice.partial.picks ?? []).map((p) => row(p.championId, p.reason)) };
    case "ready":
      return { status: "ready", teamRead: advice.advice.teamRead, picks: advice.advice.picks.map((p) => row(p.championId, p.reason)) };
    case "error":
      return { status: "error", message: advice.message, picks: advice.fallback.map((c) => row(c.championId)) };
  }
}
