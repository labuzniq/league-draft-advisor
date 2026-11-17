import { banRate, mainRole, type Role, type StatsFile } from "@lda/shared";
import { z } from "zod";
import type { Advice, DraftPick, DraftState, Pick } from "../../shared/types";
import type { ChampionInfo } from "../champions/ddragon";
import type { Candidate } from "../draft/candidates";

export interface DraftContext { system: string; championIds: ReadonlySet<number> }
export interface PromptData { champions: Map<number, ChampionInfo>; stats?: StatsFile }

const MAX_PICKS = 5;

const COACH_INSTRUCTIONS = `You are a League of Legends draft coach. The player is in champion select and wants to know which champion to pick.

Suggest 1 to 5 picks for the player's role, strongest first. Choose only from the open candidates listed in the current draft, and give each one by its champion ID.
Weigh what the team needs: frontline, engage, a mix of physical and magic damage, and early or late game power. Look for combos between ally spells and for counters to the enemy picks.
Either balance the team or commit to one plan, and say which one you chose.
Each reason is 1 to 2 sentences and names the specific ally or enemy champion it relies on.
teamRead is one line about the team as it stands.
Write suggestions, not orders.`;

const STATS_NOTE = "Statistics are a guide, not the only reason for a pick.";
const NO_STATS_NOTE = "Statistics are not available, so judge from the champion kits and the draft.";

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const label = (id: number, data: PromptData): string => {
  const name = data.champions.get(id)?.name;
  return name ? `${name} (ID ${id})` : `Unknown champion (ID ${id})`;
};

function championBlock(id: number, data: PromptData, statsLine?: string): string {
  const info = data.champions.get(id);
  if (!info) return label(id, data);
  const lines = [label(id, data), `Tags: ${info.tags.join(", ")}`, "Kit:", info.kit];
  if (statsLine) lines.push(statsLine);
  return lines.join("\n");
}

function statsLine(candidate: Candidate, role: Role, stats: StatsFile): string {
  return `${role}: win rate ${percent(candidate.winRate)}, pick rate ${percent(candidate.pickRate)}, ban rate ${percent(banRate(stats, candidate.championId))}, ${candidate.games} games`;
}

function dataBlock(id: number, candidates: Map<number, Candidate>, role: Role, data: PromptData): string {
  const candidate = candidates.get(id);
  return championBlock(id, data, candidate && data.stats ? statsLine(candidate, role, data.stats) : undefined);
}

const pickedIds =(state: DraftState): number[] => [...state.allies, ...state.enemies].map((p) => p.championId);

export function buildContext(input: { role: Role; state: DraftState; candidates: Candidate[] }, data: PromptData): DraftContext {
  const { role, state, candidates } = input;
  const byId = new Map(candidates.map((c) => [c.championId, c]));
  const ids = [...new Set([...byId.keys(), ...pickedIds(state)])].sort((a, b) => a - b);
  const blocks = ids.map((id) => dataBlock(id, byId, role, data));
  const system = [COACH_INSTRUCTIONS, data.stats ? STATS_NOTE : NO_STATS_NOTE, "", "Champion data:", "", blocks.join("\n\n")].join("\n");
  return { system, championIds: new Set(ids) };
}

const listOrNone = (items: string[], separator: string): string => (items.length > 0 ? items.join(separator) : "none");

export function buildUserMessage(input: { context: DraftContext; role: Role; state: DraftState; candidates: Candidate[] }, data: PromptData): string {
  const { context, role, state, candidates } = input;
  const ally = (p: DraftPick) => `- ${label(p.championId, data)}, ${p.role ?? "unknown"}`;
  const enemy = (p: DraftPick) => `- ${label(p.championId, data)}, likely ${(data.stats && mainRole(data.stats, p.championId)) ?? "unknown"}`;
  const byId = new Map(candidates.map((c) => [c.championId, c]));
  const newIds = [...new Set([...pickedIds(state), ...byId.keys()])].filter((id) => !context.championIds.has(id));
  const lines = [
    `Your role: ${role}`,
    `Allies:\n${listOrNone(state.allies.map(ally), "\n")}`,
    `Enemies:\n${listOrNone(state.enemies.map(enemy), "\n")}`,
    `Bans: ${listOrNone(state.bans.map((id) => label(id, data)), ", ")}`,
    `Open candidates: ${listOrNone(candidates.map((c) => label(c.championId, data)), ", ")}`,
  ];
  if (newIds.length > 0) lines.push(`Champion data not listed before:\n\n${newIds.map((id) => dataBlock(id, byId, role, data)).join("\n\n")}`);
  return lines.join("\n\n");
}

export const AdviceSchema: z.ZodType<Advice> = z.object({
  teamRead: z.string(),
  picks: z.array(z.object({ championId: z.number(), reason: z.string() })),
});

const isPick = (value: unknown): value is Pick =>
  typeof value === "object" && value !== null && typeof (value as Pick).championId === "number" && typeof (value as Pick).reason === "string";

function finishedPicks(text: string, start: number): Pick[] {
  const picks: Pick[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        const value: unknown = JSON.parse(text.slice(objectStart, i + 1));
        if (isPick(value)) picks.push({ championId: value.championId, reason: value.reason });
      }
    } else if (char === "]" && depth === 0) break;
  }
  return picks;
}

export function parsePartialAdvice(text: string): Partial<Advice> {
  const result: Partial<Advice> = {};
  try {
    const teamRead = /"teamRead"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
    if (teamRead) result.teamRead = JSON.parse(teamRead[1]) as string;
    const picksStart = /"picks"\s*:\s*\[/.exec(text);
    if (picksStart) {
      const picks = finishedPicks(text, picksStart.index + picksStart[0].length).slice(0, MAX_PICKS);
      if (picks.length > 0) result.picks = picks;
    }
  } catch {
    return result;
  }
  return result;
}

export function keepValidPicks(advice: Advice, candidates: Candidate[]): Advice {
  const open = new Set(candidates.map((c) => c.championId));
  const seen = new Set<number>();
  const picks = advice.picks.filter((p) => {
    if (!open.has(p.championId) || seen.has(p.championId)) return false;
    seen.add(p.championId);
    return true;
  });
  return { ...advice, picks: picks.slice(0, MAX_PICKS) };
}
