import { request as httpRequest } from "node:http";

/** Miniflare's dispatchFetch retains a ws client after an unexpected HTTP reply.
 * This rejection witness owns the actual HTTP upgrade socket through closure. */
export async function requestSyncUpgrade(url: URL): Promise<{ status: number; body: unknown }> {
  const request = httpRequest(url, { agent: false, headers: {
    Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": "cHVibGljLWNvcmUtc3luYw==",
  } });
  const closed = new Promise<void>(resolve => { request.once("close", resolve); });
  const response = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    request.once("error", reject);
    request.once("upgrade", (_message, socket) => {
      socket.destroy();
      reject(new Error("Core sync refusal unexpectedly upgraded the socket."));
    });
    request.once("response", incoming => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      incoming.once("error", reject);
      incoming.once("end", () => {
        try {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve({ status: incoming.statusCode ?? 0, body });
        } catch (cause) { reject(cause); }
      });
    });
    request.end();
  });
  try { return await response; }
  finally { request.destroy(); await closed; }
}
