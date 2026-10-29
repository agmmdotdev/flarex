import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { build } from "vite";
import { expect, it } from "vitest";

const Observation = Schema.Struct({
  readRejected: Schema.Boolean,
  reasonCloned: Schema.Boolean,
  kindMatches: Schema.Boolean,
  nonceMatches: Schema.Boolean,
  cancel: Schema.Literals(["fulfilled", "rejected"]),
  readerClosed: Schema.Literals(["fulfilled", "rejected"]),
  close: Schema.Literals(["fulfilled", "rejected"]),
  socketClosed: Schema.Literals(["fulfilled", "rejected"]),
});

it("preserves a private cancellation nonce through actual workerd's native TCP readable", async () => {
  const sockets = new Set<Socket>();
  const serverFailures: unknown[] = [];
  let bytesReceived = 0;
  let connections = 0;
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => { sockets.delete(socket); });
    socket.on("data", chunk => { bytesReceived += chunk.length; });
    socket.on("error", cause => { serverFailures.push(cause); });
  });
  let runtime: Miniflare | undefined;
  let primary: Readonly<{ cause: unknown }> | undefined;
  try {
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    server.on("error", cause => { serverFailures.push(cause); });
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("Missing native witness listener address.");
    const output = await build({ configFile: false, logLevel: "silent", build: {
      write: false, target: "es2022", lib: {
        entry: fileURLToPath(new URL("./pgCloudflareSocket.native.worker.ts", import.meta.url)),
        formats: ["es"], fileName: "native-cancellation",
      }, rolldownOptions: { external: id => id.startsWith("cloudflare:") },
    } });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
    const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "native-cancellation.js");
    if (worker === undefined || worker.type !== "chunk") throw new Error("Missing native cancellation worker.");
    runtime = new Miniflare({
      modules: [{ type: "ESModule", path: "native-cancellation.js", contents: worker.code }],
      compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
      bindings: { TCP_ADDRESS: `127.0.0.1:${address.port}` },
    });
    const response = await runtime.dispatchFetch("https://native-cancellation.test/", { signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(Observation))(text)).toEqual({
      readRejected: true, reasonCloned: true, kindMatches: true, nonceMatches: true,
      cancel: "fulfilled", readerClosed: "fulfilled", close: "fulfilled", socketClosed: "fulfilled",
    });
    expect(connections).toBe(1);
    expect(bytesReceived).toBe(0);
  } catch (cause) {
    primary = { cause };
    throw cause;
  } finally {
    const cleanup = await Promise.allSettled([
      runtime?.dispose(),
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        if (!server.listening) { resolve(); return; }
        server.close(cause => { if (cause === undefined) resolve(); else reject(cause); });
      }),
    ]);
    const failures: unknown[] = [...serverFailures,
      ...cleanup.flatMap(result => result.status === "rejected" ? [result.reason] : [])];
    if (failures.length !== 0) throw new AggregateError(
      primary === undefined ? failures : [primary.cause, ...failures], "Native cancellation witness cleanup failed.",
    );
  }
}, 30_000);
