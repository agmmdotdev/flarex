import { createServer, type Socket } from "node:net";
import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { withInstallationMaintenance } from "../../../src/database/postgresInstallationMaintenance";

it.each([
  { name: "default", timeout: undefined, maximum: 13_000, interrupt: false },
  { name: "zero", timeout: 0, maximum: 13_000, interrupt: true },
  { name: "tighter", timeout: 100, maximum: 3_000, interrupt: false },
])("bounds $name maintenance startup against a real TCP blackhole", async ({ timeout, maximum, interrupt }) => {
  const sockets = new Set<Socket>();
  let startupReceived = false;
  let ownedSocketClosed = false;
  let acceptStartup: () => void = () => { throw new Error("Startup barrier not initialized"); };
  const startup = new Promise<void>(resolve => { acceptStartup = resolve; });
  let acceptClose: () => void = () => { throw new Error("Close barrier not initialized"); };
  const closed = new Promise<void>(resolve => { acceptClose = resolve; });
  const server = createServer(socket => {
    sockets.add(socket);
    // Accept genuine pg startup bytes, then deliberately withhold all replies.
    socket.once("data", () => { startupReceived = true; acceptStartup(); });
    socket.once("close", () => { sockets.delete(socket); ownedSocketClosed = true; acceptClose(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing startup-blackhole TCP address");
  const controller = new AbortController();
  let entered = false;
  const began = performance.now();
  // A broken implementation must still release this test's listener. This
  // fail-safe runs beyond the asserted bound and cannot satisfy the witness.
  const watchdog = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, maximum + 500);
  try {
    const result = Effect.runPromiseExit(withInstallationMaintenance({
      host: "127.0.0.1", port: address.port, database: "startup_blackhole", user: "startup_blackhole",
      password: "fixture", ssl: false,
      ...(timeout === undefined ? {} : { connectionTimeoutMillis: timeout }),
    }, "startup_blackhole", () => Effect.sync(() => { entered = true; })), { signal: controller.signal });
    await startup;
    if (interrupt) controller.abort();
    const exit = await result;
    await closed;
    expect(performance.now() - began).toBeLessThan(maximum);
    expect(startupReceived).toBe(true);
    expect(entered).toBe(false);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // The masked pg connect boundary settles with its timeout failure even
      // when cancellation was requested. Preserve that actual foreign cause.
      if (interrupt) expect(controller.signal.aborted).toBe(true);
      expect(Cause.findErrorOption(exit.cause)).toMatchObject({ _tag: "Some", value: {
        _tag: "InstallationLifecycleError", reason: "resourceFailure", cause: { message: "timeout expired" },
      } });
    }
    // Observed before fixture teardown: the owned pg transport closed its socket.
    expect(ownedSocketClosed).toBe(true);
    expect(sockets.size).toBe(0);
  } finally {
    clearTimeout(watchdog);
    controller.abort();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error));
    });
  }
}, 15_000);
