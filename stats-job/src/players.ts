import { PLATFORM_HOST, QUEUE, RANKS } from "./config";
import type { RiotClient } from "./riot";

export const PAGES_PER_RANK = 2;
export const MAX_PAGE = 50;

interface LeagueEntry {
  puuid?: string;
}

function pickPages(random: () => number): number[] {
  const pages: number[] = [];
  for (let i = 0; i < PAGES_PER_RANK; i++) {
    let page = 1 + Math.floor(random() * (MAX_PAGE - i));
    for (const taken of [...pages].sort((a, b) => a - b)) if (page >= taken) page++;
    pages.push(page);
  }
  return pages;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export async function listPlayers(
  client: RiotClient,
  random: () => number = Math.random,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const { tier, division } of RANKS) {
    const fetchPage = (page: number) =>
      client.get<LeagueEntry[]>(
        PLATFORM_HOST,
        `/lol/league-exp/v4/entries/${QUEUE}/${tier}/${division}?page=${page}`,
      );
    for (const page of pickPages(random)) {
      let entries = await fetchPage(page);
      if (entries.length === 0 && page !== 1) entries = await fetchPage(1);
      for (const { puuid } of entries) if (puuid) ids.add(puuid);
    }
  }
  return shuffle([...ids], random);
}
