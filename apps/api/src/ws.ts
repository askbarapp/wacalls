import type { FastifyInstance } from "fastify";
import { verifyAccessToken } from "@wacalls/auth";
import { env } from "./env.js";

type Client = { socket: { send: (s: string) => void }; orgId: string };
const clients = new Set<Client>();

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

export async function registerWs(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token") ?? "";
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
}
