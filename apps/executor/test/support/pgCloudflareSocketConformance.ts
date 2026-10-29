import { CloudflareSocket } from "pg-cloudflare";
import { PrimitiveSocket, queuePrimitiveSocket } from "./pgCloudflareSocketPrimitives";

type SocketEvent =
  | Readonly<{ kind: "connect" | "close" }>
  | Readonly<{ kind: "data"; value: Uint8Array }>
  | Readonly<{ kind: "error"; cause: unknown }>;

/** This entry is bundled with the actual pg-used package and exactly one alias:
 * cloudflare:sockets becomes the primitive I/O fixture, never another driver. */
export function createSocketFixture(
  options: ConstructorParameters<typeof PrimitiveSocket>[0] = {},
  ssl = false,
) {
  const io = new PrimitiveSocket(options);
  queuePrimitiveSocket(io);
  const socket = new CloudflareSocket(ssl);
  const events: SocketEvent[] = [];
  let close!: () => void;
  const closed = new Promise<void>(resolve => { close = resolve; });
  socket.on("connect", () => { events.push({ kind: "connect" }); });
  socket.on("data", (value: Uint8Array) => { events.push({ kind: "data", value }); });
  socket.on("error", (cause: unknown) => { events.push({ kind: "error", cause }); });
  socket.on("close", () => { events.push({ kind: "close" }); close(); });
  return { io, socket, events, closed,
    createTls: (tlsOptions: ConstructorParameters<typeof PrimitiveSocket>[0] = {}) => {
      const tls = new PrimitiveSocket(tlsOptions);
      io.tls = tls;
      return tls;
    } };
}
