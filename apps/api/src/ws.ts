import type { FastifyInstance } from "fastify";
import { verifyAccessToken } from "@wacalls/auth";
import { prisma } from "@wacalls/database";
import { env } from "./env.js";
import { redisMediaSub } from "./redis.js";
import { whatsappClient } from "./services/whatsapp-client.js";

type Client = { socket: { send: (s: string) => void }; orgId: string };
const clients = new Set<Client>();
const mediaClients = new Map<string, Set<{ send: (data: Buffer) => void; close: () => void }>>();

export function broadcast(organizationId: string | undefined, payload: unknown) {
  const data = JSON.stringify(payload);
  for (const c of clients) {
    if (!organizationId || c.orgId === organizationId) {
      try {
        c.socket.send(data);
      } catch {
        clients.delete(c);
      }
    }
  }
}

function tokenFromUpgrade(
  req: { cookies?: { [cookieName: string]: string | undefined }; headers: { cookie?: string }; url?: string },
  url: URL,
) {
  const query = url.searchParams.get("token") ?? "";
  if (query) return query;
  const cookie = req.cookies?.access_token;
  if (cookie) return cookie;
  const header = req.headers.cookie ?? "";
  const match = /(?:^|;\s*)access_token=([^;]+)/.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export async function registerWs(app: FastifyInstance) {
  await redisMediaSub.psubscribe("wacalls:pcm:*");
  redisMediaSub.on("pmessageBuffer", (_pattern, channel, message) => {
    const callId = channel.toString().slice("wacalls:pcm:".length);
    const sockets = mediaClients.get(callId);
    if (!sockets?.size) return;
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        sockets.delete(socket);
      }
    }
  });

  app.get("/ws", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = tokenFromUpgrade(req, url);
    void verifyAccessToken(token, env.JWT_SECRET)
      .then((claims) => {
        const client: Client = { socket, orgId: claims.orgId };
        clients.add(client);
        socket.send(JSON.stringify({ type: "hello", orgId: claims.orgId }));
        socket.on("close", () => clients.delete(client));
      })
      .catch(() => {
        socket.send(JSON.stringify({ type: "error", message: "unauthorized" }));
        socket.close();
      });
  });

  app.get("/ws/calls/:id/media", { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const url = new URL(req.url, "http://localhost");
    const token = tokenFromUpgrade(req, url);
    void (async () => {
      const claims = await verifyAccessToken(token, env.JWT_SECRET);
      const call = await prisma.call.findFirst({
        where: { id, organizationId: claims.orgId },
        select: { id: true, engineCallId: true },
      });
      if (!call) {
        socket.close();
        return;
      }
      const keys = [call.id, call.engineCallId].filter((k): k is string => Boolean(k));
      const client = {
        send: (data: Buffer) => {
          socket.send(data);
        },
        close: () => socket.close(),
      };
      for (const key of keys) {
        let set = mediaClients.get(key);
        if (!set) {
          set = new Set();
          mediaClients.set(key, set);
        }
        set.add(client);
      }
      socket.on("message", (raw: Buffer | string) => {
        const buf = Buffer.isBuffer(raw) ? Buffer.from(raw) : Buffer.from(raw);
        if (buf.byteLength < 4) return;
        void whatsappClient.sendPcm(call.engineCallId ?? call.id, buf).catch(() => undefined);
      });
      socket.on("close", () => {
        for (const key of keys) {
          const set = mediaClients.get(key);
          set?.delete(client);
          if (set && set.size === 0) mediaClients.delete(key);
        }
      });
    })().catch(() => {
      socket.close();
    });
  });
}
