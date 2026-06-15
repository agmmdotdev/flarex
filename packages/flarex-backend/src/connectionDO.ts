import { DurableObject } from "cloudflare:workers";
import { json } from "./http";
import type { Env } from "./types";

export class ConnectionDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ service: "flarex-connection", status: "ok" });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "Connected", protocol: "flarex-v0" }));
    return new Response(null, { status: 101, webSocket: client });
  }
}
