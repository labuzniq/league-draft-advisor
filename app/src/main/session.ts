import type { Role, StatsFile } from "@lda/shared";
import type { AppView, DraftState, OwnedChampion } from "../shared/types";
import type { Advisor } from "./advisor/advisor";
import { AdviceController, type AdviceView } from "./advisor/controller";
import type { PromptData } from "./advisor/prompt";
import type { ChampionInfo } from "./champions/ddragon";
import { selectCandidates, selectCandidatesWithoutStats } from "./draft/candidates";
import { toDraftState, type LcuChampSelectSession } from "./draft/state";
import type { LcuClient } from "./lcu/client";
import type { LcuCredentials } from "./lcu/locate";
import type { SettingsStore } from "./settings";
import { buildDraftView } from "./view";

interface Deps {
  locate: () => Promise<LcuCredentials | undefined>;
  makeClient: (creds: LcuCredentials) => LcuClient;
  makeAdvisor: (apiKey: string, model: string, data: PromptData) => Advisor;
  settings: SettingsStore;
  loadStats: () => Promise<StatsFile | undefined>;
  loadChampions: () => Promise<{ version: string; champions: Map<number, ChampionInfo> }>;
  onView: (view: AppView) => void;
  pollMs?: number;
}

const DEFAULT_POLL_MS = 3000;

export class DraftSession {
  private readonly pollMs: number;
  private data: PromptData = { champions: new Map() };
  private championsLoaded = false;
  private controller?: AdviceController;
  private advice: AdviceView = { status: "idle" };
  private client?: LcuClient;
  private connected = false;
  private clientError = false;
  private unreadable = false;
  private owned: OwnedChampion[] = [];
  private draft?: DraftState;
  private chosenRole?: Role;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private looking = false;

  constructor(private readonly deps: Deps) {
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  }

  async start(): Promise<void> {
    this.deps.onView(this.deps.settings.getApiKey() ? { screen: "waiting", reason: "loading" } : { screen: "setup" });
    const [stats, champions] = await Promise.all([this.deps.loadStats(), this.tryLoadChampions()]);
    this.data = { champions: champions ?? new Map(), stats };
    this.championsLoaded = champions !== undefined;
    this.settingsChanged();
  }

  chooseRole(role: Role): void {
    this.chosenRole = role;
    if (this.draft) this.controller?.update(this.draft, role);
    this.render();
  }

  retry(): void {
    this.controller?.retry();
  }

  settingsChanged(): void {
    this.dropController();
    const apiKey = this.deps.settings.getApiKey();
    if (!apiKey) {
      this.stopLooking();
      this.render();
      return;
    }
    this.controller = this.makeController(apiKey);
    if (this.draft) this.controller.update(this.draft, this.chosenRole);
    this.render();
    if (!this.looking) {
      this.looking = true;
      if (this.championsLoaded) void this.look(this.generation);
      else this.schedule(this.generation);
    }
  }

  stop(): void {
    this.dropController();
    this.stopLooking();
  }

  private makeController(apiKey: string): AdviceController {
    const { model, showAll } = this.deps.settings.get();
    const { stats } = this.data;
    const controller: AdviceController = new AdviceController({
      advisor: this.deps.makeAdvisor(apiKey, model, this.data),
      data: this.data,
      candidatesFor: (state, role) =>
        stats
          ? selectCandidates({ state, role, stats, owned: this.owned, showAll })
          : selectCandidatesWithoutStats({ state, owned: this.owned }),
      onView: (view) => {
        if (controller !== this.controller) return;
        this.advice = view;
        this.render();
      },
    });
    return controller;
  }

  private dropController(): void {
    const controller = this.controller;
    this.controller = undefined;
    this.advice = { status: "idle" };
    controller?.reset();
  }

  private stopLooking(): void {
    this.generation++;
    this.looking = false;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.client?.close();
    this.client = undefined;
    this.connected = false;
    this.clientError = false;
    this.unreadable = false;
    this.draft = undefined;
    this.chosenRole = undefined;
  }

  private async tryLoadChampions(): Promise<Map<number, ChampionInfo> | undefined> {
    try {
      return (await this.deps.loadChampions()).champions;
    } catch {
      return undefined;
    }
  }

  private schedule(generation: number): void {
    this.pollTimer = setTimeout(() => void this.look(generation), this.pollMs);
  }

  private async look(generation: number): Promise<void> {
    this.pollTimer = undefined;
    if (!this.championsLoaded) {
      const champions = await this.tryLoadChampions();
      if (generation !== this.generation) return;
      if (!champions) return this.schedule(generation);
      this.data = { ...this.data, champions };
      this.championsLoaded = true;
      this.settingsChanged();
    }
    const creds = await this.deps.locate();
    if (generation !== this.generation) return;
    if (creds && (await this.connect(creds, generation))) return;
    if (generation !== this.generation) return;
    this.clientError = creds !== undefined;
    this.render();
    this.schedule(generation);
  }

  private async connect(creds: LcuCredentials, generation: number): Promise<boolean> {
    const client = this.deps.makeClient(creds);
    this.client = client;
    client.onSession((session) => {
      if (client === this.client) this.sessionChanged(session);
    });
    client.onClose(() => {
      if (client === this.client) this.clientLost(generation);
    });
    try {
      this.owned = await client.getOwnedChampions();
      await client.connect();
    } catch {
      if (client === this.client) this.client = undefined;
      return false;
    }
    if (client !== this.client) {
      client.close();
      return true;
    }
    this.connected = true;
    this.clientError = false;
    this.render();
    return true;
  }

  private sessionChanged(session: LcuChampSelectSession | null): void {
    const draft = session === null ? undefined : readDraft(session);
    this.unreadable = session !== null && draft === undefined;
    if (draft) {
      this.draft = draft;
      this.controller?.update(draft, this.chosenRole);
    } else {
      this.endChampSelect();
    }
    this.render();
  }

  private clientLost(generation: number): void {
    this.client = undefined;
    this.connected = false;
    this.unreadable = false;
    this.endChampSelect();
    this.render();
    this.schedule(generation);
  }

  private endChampSelect(): void {
    this.draft = undefined;
    this.chosenRole = undefined;
    this.controller?.reset();
  }

  private render(): void {
    this.deps.onView(this.view());
  }

  private view(): AppView {
    if (!this.controller) return { screen: "setup" };
    if (!this.championsLoaded) return { screen: "waiting", reason: "no-data" };
    if (this.draft) {
      return buildDraftView({ draft: this.draft, chosenRole: this.chosenRole, advice: this.advice, champions: this.data.champions, stats: this.data.stats });
    }
    if (this.unreadable) return { screen: "waiting", reason: "unreadable" };
    if (this.connected) return { screen: "waiting", reason: "no-champ-select" };
    return { screen: "waiting", reason: this.clientError ? "client-error" : "no-client" };
  }
}

function readDraft(session: LcuChampSelectSession): DraftState | undefined {
  try {
    return toDraftState(session);
  } catch {
    return undefined;
  }
}
