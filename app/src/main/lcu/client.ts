import { get } from "node:https";
import WebSocket from "ws";
import type { OwnedChampion } from "../../shared/types";
import type { LcuChampSelectSession } from "../draft/state";
import type { LcuCredentials } from "./locate";

export interface Recording {
  ownedChampions: unknown;
  mastery: unknown;
  sessionKeyPaths?: string[];
  events: { atMs: number; eventType: "Create" | "Update" | "Delete"; data: unknown }[];
}

const HOST = "127.0.0.1";
const SESSION_PATH = "/lol-champ-select/v1/session";
const SESSION_EVENT = "OnJsonApiEvent_lol-champ-select_v1_session";
const WS_SUBSCRIBE = 5;
const WS_EVENT = 8;
export const LCU_TIMEOUT_MS = 5000;

type SessionCallback = (session: LcuChampSelectSession | null, eventType: string) => void;

export class LcuClient {
  private readonly authorization: string;
  private readonly sessionCallbacks: SessionCallback[] = [];
  private readonly closeCallbacks: (() => void)[] = [];
  private socket: WebSocket | undefined;
  private closing = false;

  constructor(
    private readonly creds: LcuCredentials,
    private readonly timeoutMs = LCU_TIMEOUT_MS,
  ) {
    this.authorization = `Basic ${Buffer.from(`riot:${creds.token}`).toString("base64")}`;
  }

  onSession(cb: SessionCallback): void {
    this.sessionCallbacks.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeCallbacks.push(cb);
  }

  async connect(): Promise<void> {
    const socket = new WebSocket(`wss://${HOST}:${this.creds.port}`, {
      headers: { Authorization: this.authorization },
      rejectUnauthorized: false,
      handshakeTimeout: this.timeoutMs,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("error", () => socket.close());
    socket.on("message", (raw) => this.handleMessage(raw.toString()));
    socket.on("close", () => {
      if (!this.closing) this.closeCallbacks.forEach((cb) => cb());
    });
    socket.send(JSON.stringify([WS_SUBSCRIBE, SESSION_EVENT]));

    try {
      this.emit(await this.getRaw(SESSION_PATH) as LcuChampSelectSession, "Create");
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("404"))) {
        this.close();
        throw error;
      }
    }
  }

  async getOwnedChampions(): Promise<OwnedChampion[]> {
    const [owned, mastery] = await Promise.all([
      this.getRaw("/lol-champions/v1/owned-champions-minimal") as Promise<{ id: number }[]>,
      (this.getRaw("/lol-champion-mastery/v1/local-player/champion-mastery") as Promise<{ championId: number; championPoints: number }[]>).catch(() => []),
    ]);
    const points = new Map(mastery.map((m) => [m.championId, m.championPoints]));
    return owned.map((c) => ({ championId: c.id, masteryPoints: points.get(c.id) ?? 0 }));
  }

  getRaw(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`League client did not answer in time for ${path}`));
        request.destroy();
      }, this.timeoutMs);
      const request = get(
        { host: HOST, port: this.creds.port, path, headers: { Authorization: this.authorization, Accept: "application/json" }, rejectUnauthorized: false, agent: false },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () => {
            clearTimeout(timer);
            const status = response.statusCode ?? 0;
            if (status < 200 || status >= 300) return reject(new Error(`League client answered ${status} for ${path}`));
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString()));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  close(): void {
    this.closing = true;
    this.socket?.terminate();
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(message) || message[0] !== WS_EVENT || message[1] !== SESSION_EVENT) return;
    const payload: unknown = message[2];
    if (typeof payload !== "object" || payload === null) return;
    const { eventType, data } = payload as { eventType: unknown; data: LcuChampSelectSession | null };
    if (typeof eventType !== "string") return;
    this.emit(eventType === "Delete" ? null : data, eventType);
  }

  private emit(session: LcuChampSelectSession | null, eventType: string): void {
    this.sessionCallbacks.forEach((cb) => cb(session, eventType));
  }
}
