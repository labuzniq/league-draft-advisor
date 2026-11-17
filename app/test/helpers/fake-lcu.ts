import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { generate } from "selfsigned";
import { WebSocketServer, type WebSocket } from "ws";
import type { Recording } from "../../src/main/lcu/client";
import type { LcuCredentials } from "../../src/main/lcu/locate";

const TOKEN = "fake-token";
const SESSION_PATH = "/lol-champ-select/v1/session";
const EVENT_NAME = "OnJsonApiEvent_lol-champ-select_v1_session";

export async function startFakeLcu(
  recording: Recording,
  options: { failSession?: boolean; failPaths?: string[]; hangPaths?: string[]; hangUpgrade?: boolean } = {},
): Promise<{ creds: LcuCredentials; send(index: number): Promise<void>; sendRaw(message: string): Promise<void>; play(): Promise<void>; stop(): Promise<void>; openSockets(): number }> {
  const pems = await generate([{ name: "commonName", value: "127.0.0.1" }]);
  const authorized = (header: string | undefined) => header === `Basic ${Buffer.from(`riot:${TOKEN}`).toString("base64")}`;
  const sockets = new Set<WebSocket>();
  const hungSockets = new Set<Duplex>();
  let current: unknown;

  const server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.method !== "GET") return reply(405);
    if (!authorized(req.headers.authorization)) return reply(401);
    if (options.hangPaths?.includes(req.url ?? "")) return;
    if (options.failPaths?.includes(req.url ?? "")) return reply(500);
    if (req.url === "/lol-champions/v1/owned-champions-minimal") return reply(200, recording.ownedChampions);
    if (req.url === "/lol-champion-mastery/v1/local-player/champion-mastery") return reply(200, recording.mastery);
    if (req.url === SESSION_PATH && options.failSession) return reply(500);
    if (req.url === SESSION_PATH) return current === undefined ? reply(404) : reply(200, current);
    reply(404);
  });

  server.on("secureConnection", (socket) => socket.on("error", () => socket.destroy()));

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (options.hangUpgrade) {
      hungSockets.add(socket);
      return;
    }
    if (!authorized(req.headers.authorization)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const sendRaw = async (message: string) => {
    await Promise.all([...sockets].map((ws) => new Promise<void>((resolve) => ws.send(message, () => resolve()))));
  };

  const send = async (index: number) => {
    const { eventType, data } = recording.events[index];
    current = eventType === "Delete" ? undefined : data;
    await sendRaw(JSON.stringify([8, EVENT_NAME, { eventType, data }]));
  };

  return {
    creds: { port, token: TOKEN },
    openSockets: () => sockets.size,
    send,
    sendRaw,
    async play() {
      for (let index = 0; index < recording.events.length; index++) await send(index);
    },
    async stop() {
      for (const ws of sockets) ws.terminate();
      for (const socket of hungSockets) socket.destroy();
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
