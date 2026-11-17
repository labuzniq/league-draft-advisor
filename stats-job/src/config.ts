export const PLATFORM_HOST = "euw1.api.riotgames.com";
export const REGION_HOST = "europe.api.riotgames.com";
export const QUEUE = "RANKED_SOLO_5x5";
export const QUEUE_ID = 420;

export const RANKS: readonly { tier: string; division: string }[] = [
  { tier: "CHALLENGER", division: "I" },
  { tier: "GRANDMASTER", division: "I" },
  { tier: "MASTER", division: "I" },
  ...["DIAMOND", "EMERALD"].flatMap((tier) =>
    ["I", "II", "III", "IV"].map((division) => ({ tier, division })),
  ),
];

export const LIMITS = [
  { count: 20, perMs: 1_000 },
  { count: 100, perMs: 120_000 },
] as const;
