import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LcuAction, LcuTeamMember } from "../draft/state";
import type { LcuClient, Recording } from "./client";

type EventType = Recording["events"][number]["eventType"];

const OWNED_PATH = "/lol-champions/v1/owned-champions-minimal";
const MASTERY_PATH = "/lol-champion-mastery/v1/local-player/champion-mastery";

const ACTION_FIELDS: Record<keyof LcuAction, true> = {
  id: true,
  actorCellId: true,
  championId: true,
  type: true,
  completed: true,
  isInProgress: true,
  isAllyAction: true,
};
const MEMBER_FIELDS: Record<keyof LcuTeamMember, true> = { cellId: true, championId: true, assignedPosition: true };

function pick(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const source = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]));
}

function list(value: unknown, reduce: (item: unknown) => unknown): unknown[] {
  return Array.isArray(value) ? value.map(reduce) : [];
}

function reduceSession(data: unknown): unknown {
  if (data === null || typeof data !== "object") return data;
  const session = data as Record<string, unknown>;
  const member = (item: unknown) => pick(item, Object.keys(MEMBER_FIELDS));
  const action = (item: unknown) => pick(item, Object.keys(ACTION_FIELDS));
  return {
    localPlayerCellId: session["localPlayerCellId"],
    myTeam: list(session["myTeam"], member),
    theirTeam: list(session["theirTeam"], member),
    actions: list(session["actions"], (round) => list(round, action)),
    timer: pick(session["timer"], ["phase"]),
  };
}

const MAX_KEY_LENGTH = 32;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function looksLikeIdentifier(key: string): boolean {
  return /^\d+$/.test(key) || key.length > MAX_KEY_LENGTH || UUID.test(key);
}

export function saveRecording(recording: Recording, dir: string, now: Date): string | undefined {
  const path = join(dir, `recording-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  try {
    writeFileSync(path, JSON.stringify(recording, null, 2));
    return path;
  } catch (error) {
    console.error("Recording could not be saved:", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
}

function collectKeyPaths(value: unknown, path: string, into: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeyPaths(item, `${path}[]`, into));
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const name = looksLikeIdentifier(key) ? "*" : key;
      const childPath = path ? `${path}.${name}` : name;
      into.add(childPath);
      collectKeyPaths(child, childPath, into);
    }
  }
}

export class Recorder {
  private readonly events: Recording["events"] = [];
  private readonly keyPaths = new Set<string>();
  private ownedChampions: unknown;
  private mastery: unknown;
  private firstEventAt?: number;

  constructor(private readonly client: LcuClient) {}

  async start(): Promise<void> {
    this.client.onSession((session, eventType) => this.record(session, eventType as EventType));
    const [owned, mastery] = await Promise.all([this.client.getRaw(OWNED_PATH), this.client.getRaw(MASTERY_PATH)]);
    this.ownedChampions = list(owned, (champion) => pick(champion, ["id"]));
    this.mastery = list(mastery, (entry) => pick(entry, ["championId", "championPoints"]));
  }

  hasEvents(): boolean {
    return this.events.length > 0;
  }

  stop(): Recording {
    return {
      ownedChampions: this.ownedChampions,
      mastery: this.mastery,
      sessionKeyPaths: [...this.keyPaths].sort(),
      events: this.events.splice(0),
    };
  }

  private record(session: unknown, eventType: EventType): void {
    const now = Date.now();
    this.firstEventAt ??= now;
    collectKeyPaths(session, "", this.keyPaths);
    this.events.push({ atMs: now - this.firstEventAt, eventType, data: reduceSession(session) });
  }
}
