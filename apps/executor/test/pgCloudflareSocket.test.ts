import { builtinModules, createRequire } from "node:module";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Schema } from "effect";
import { build, defaultClientConditions, normalizePath } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { createSocketFixture as FixtureFactory } from "./support/pgCloudflareSocketConformance";

const decodeModule = Schema.decodeUnknownSync(Schema.Struct({
  // Functions cross a local generated-module boundary as opaque callables. The
  // signature comes from the same checked entry and the real driver declaration.
  createSocketFixture: Schema.declare<typeof FixtureFactory>((value): value is typeof FixtureFactory => typeof value === "function"),
}));
let createFixture: typeof FixtureFactory;
let directory: string | undefined;

describe("actual pg-cloudflare socket terminal ordering", { concurrent: false }, () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "flarex-pg-cloudflare-conformance-"));
    const fromExecutor = createRequire(import.meta.url);
    const fromPg = createRequire(fromExecutor.resolve("pg"));
    const actualPackage = fromPg.resolve("pg-cloudflare/package.json");
    expect(await realpath(actualPackage)).toBe(await realpath(fromExecutor.resolve("pg-cloudflare/package.json")));
    const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
    const output = await build({ configFile: false, logLevel: "silent",
      resolve: { conditions: ["workerd", ...defaultClientConditions] },
      plugins: [{ name: "actual-pg-socket-primitives", resolveId(id) {
        if (id === "pg-cloudflare") return normalizePath(join(dirname(actualPackage), "esm/index.mjs"));
        if (id === "cloudflare:sockets") return normalizePath(fileURLToPath(new URL("./support/pgCloudflareSocketPrimitives.ts", import.meta.url)));
        return undefined;
      } }],
      build: { write: false, target: "es2022", lib: {
        entry: fileURLToPath(new URL("./support/pgCloudflareSocketConformance.ts", import.meta.url)),
        formats: ["es"], fileName: "socket-conformance",
      }, rolldownOptions: { external: id => builtins.has(id), output: {
        banner: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      } } },
    });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => "output" in result ? result.output : []);
    const entry = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "socket-conformance.js");
    if (entry === undefined || entry.type !== "chunk") throw new Error("Missing actual socket conformance bundle.");
    const primitiveOwners = chunks.flatMap(chunk => chunk.type === "chunk" ? Object.keys(chunk.modules) : [])
      .filter(id => id.endsWith("/pgCloudflareSocketPrimitives.ts"));
    expect(primitiveOwners).toHaveLength(1);
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    for (const chunk of chunks) {
      if (chunk.type === "chunk") await writeFile(join(directory, chunk.fileName), chunk.code);
    }
    const file = join(directory, entry.fileName);
    createFixture = decodeModule(await import(/* @vite-ignore */ pathToFileURL(file).href)).createSocketFixture;
  }, 30_000);

  afterAll(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("delivers data and joins forced reader cancellation before its one terminal close", async () => {
    const fixture = createFixture({ holdCancel: true, holdClose: true });
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.io.receive(new Uint8Array([1, 2, 3]));
    await drain();
    expect(fixture.events).toContainEqual({ kind: "data", value: new Uint8Array([1, 2, 3]) });
    fixture.socket.destroy();
    await drain();
    expect(fixture.io.cancelCalls).toBe(1);
    fixture.io.closedResult.resolve();
    await drain();
    expect(fixture.events.filter(event => event.kind === "close")).toHaveLength(0);
    fixture.io.cancelResult.resolve();
    fixture.io.closeResult.resolve();
    await fixture.closed;
    expect(fixture.io.closeCalls).toBe(1);
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "data", "close"]);
    await drain();
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "data", "close"]);
  });

  it("joins a late reader rejection before the independently fulfilled socket closure", async () => {
    const fixture = createFixture();
    const failure = new Error("reader rejected behind socket.closed");
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.io.closedResult.resolve();
    fixture.io.readerError(failure);
    await fixture.closed;
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    await drain();
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
  });

  it("reports rejected socket.closed and still reaches one terminal close", async () => {
    const fixture = createFixture({ holdCancel: true, holdClose: true });
    const failure = new Error("socket.closed rejected");
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.io.closedResult.reject(failure);
    await drain();
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }]);
    expect(fixture.io.cancelCalls).toBe(1);
    expect(fixture.io.closeCalls).toBe(1);
    fixture.io.cancelResult.resolve();
    fixture.io.closeResult.resolve();
    await fixture.closed;
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    await drain();
    expect(fixture.events.at(-1)).toEqual({ kind: "close" });
    expect(fixture.events).toHaveLength(3);
  });

  it("retains a genuine reader failure racing intentional end", async () => {
    const fixture = createFixture();
    const failure = new Error("remote reader disconnected");
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.io.readerError(failure);
    fixture.socket.end();
    await fixture.closed;
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    expect(fixture.io.closeCalls).toBe(1);
    await drain();
    expect(fixture.events).toHaveLength(3);
  });

  it("retains a reader cancellation failure before terminal close", async () => {
    const fixture = createFixture({ holdCancel: true });
    const failure = new Error("reader cancellation rejected");
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.destroy();
    await drain();
    expect(fixture.io.cancelCalls).toBe(1);
    fixture.io.cancelResult.reject(failure);
    await fixture.closed;
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    expect(fixture.io.closeCalls).toBe(1);
  });

  it("joins a rejected native close operation instead of losing its promise", async () => {
    const fixture = createFixture({ holdClose: true });
    const failure = new Error("native socket.close rejected");
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.destroy();
    await drain();
    expect(fixture.io.closeCalls).toBe(1);
    fixture.io.closedResult.resolve();
    fixture.io.closeResult.reject(failure);
    await fixture.closed;
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    await drain();
    expect(fixture.events).toHaveLength(3);
  });

  it("preserves distinct cancellation, native-close and closed failures before the terminal event", async () => {
    const fixture = createFixture({ holdCancel: true, holdClose: true });
    const cancelFailure = new Error("distinct cancellation failure");
    const closeFailure = new Error("distinct close failure");
    const closedFailure = new Error("distinct closed failure");
    const callbacks: unknown[][] = [];
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.end(undefined, undefined, (...args: unknown[]) => { callbacks.push(args); });
    fixture.socket.destroy();
    await drain();
    fixture.io.cancelResult.reject(cancelFailure);
    await drain();
    expect(fixture.io.closeCalls).toBe(1);
    fixture.io.closeResult.reject(closeFailure);
    fixture.io.closedResult.reject(closedFailure);
    await fixture.closed;
    const errors = fixture.events.flatMap(event => event.kind === "error" ? [event.cause] : []);
    expect(errors).toHaveLength(3);
    expect(errors).toEqual(expect.arrayContaining([cancelFailure, closeFailure, closedFailure]));
    expect(fixture.events.at(-1)).toEqual({ kind: "close" });
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]?.[0]).toBe(cancelFailure);
    await drain();
    expect(fixture.events).toHaveLength(5);
  });

  it("owns the reader and socket when native writer acquisition fails partway through connect", async () => {
    const fixture = createFixture({ holdWriterLock: true, holdCancel: true, holdClose: true });
    const cancelFailure = new Error("partial acquisition cancellation failed");
    const closeFailure = new Error("partial acquisition close failed");
    const closedFailure = new Error("partial acquisition closed failed");
    await fixture.socket.connect(5432, "postgres.internal");
    await drain();
    expect(fixture.events).toHaveLength(1);
    const first = fixture.events[0];
    if (first?.kind !== "error") throw new Error("Native acquisition did not fail first.");
    expect(first.cause).toBeInstanceOf(TypeError);
    expect(first.cause).toMatchObject({ message: expect.stringMatching(/WritableStream.*locked/i) });
    expect(fixture.io.cancelCalls).toBe(1);
    expect(fixture.io.closeCalls).toBe(1);
    fixture.io.cancelResult.reject(cancelFailure);
    await drain();
    expect(fixture.io.closeCalls).toBe(1);
    fixture.io.closeResult.reject(closeFailure);
    fixture.io.closedResult.reject(closedFailure);
    await fixture.closed;
    const errors = fixture.events.flatMap(event => event.kind === "error" ? [event.cause] : []);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toBe(first.cause);
    expect(errors).toEqual(expect.arrayContaining([cancelFailure, closeFailure, closedFailure]));
    expect(fixture.events.at(-1)).toEqual({ kind: "close" });
    await drain();
    expect(fixture.events).toHaveLength(5);
    expect(fixture.io.closeCalls).toBe(1);
  });

  it("honors pg's Terminate write callback before ordered end and terminal close", async () => {
    const fixture = createFixture({ holdWrites: true });
    const writeCallbacks: unknown[][] = [];
    const endCallbacks: unknown[][] = [];
    const completionOrder: string[] = [];
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal");
      fixture.socket.on("close", () => { completionOrder.push("close"); });
      // pg Connection.end sends this Terminate frame, then calls stream.end()
      // from its write(data, callback) completion. There is no server ACK.
      fixture.socket.write(Buffer.from([0x58, 0, 0, 0, 4]), (...args: unknown[]) => {
        writeCallbacks.push(args); completionOrder.push("write");
        fixture.socket.end(undefined, undefined, (...endArgs: unknown[]) => {
          endCallbacks.push(endArgs); completionOrder.push("end");
        });
      });
      await drain();
      expect(fixture.io.writes).toEqual([new Uint8Array([0x58, 0, 0, 0, 4])]);
      expect(writeCallbacks).toHaveLength(0);
      expect(endCallbacks).toHaveLength(0);
      expect(fixture.io.cancelCalls).toBe(0);
      expect(fixture.io.closeCalls).toBe(0);
      fixture.io.writeResult.resolve();
      await drain();
      expect(fixture.io.cancelCalls).toBe(1);
      expect(fixture.io.closeCalls).toBe(1);
      await fixture.closed;
      expect(writeCallbacks).toHaveLength(1);
      expect(writeCallbacks[0]?.[0]).toBeUndefined();
      expect(endCallbacks).toHaveLength(1);
      expect(endCallbacks[0]?.[0]).toBeUndefined();
      expect(completionOrder).toEqual(["write", "end", "close"]);
      expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
    });
  });

  it("completes existing empty-write and end(data, encoding, callback) forms before close", async () => {
    const fixture = createFixture();
    await fixture.socket.connect(5432, "postgres.internal");
    const callbacks: unknown[][] = [];
    fixture.socket.write("", "utf8", (...args: unknown[]) => { callbacks.push(args); });
    fixture.socket.end(Buffer.from("last payload"), "utf8", (...args: unknown[]) => { callbacks.push(args); });
    await fixture.closed;
    expect(fixture.io.writes).toEqual([new TextEncoder().encode("last payload")]);
    expect(callbacks).toHaveLength(2);
    expect(callbacks.every(args => args[0] === undefined)).toBe(true);
    expect(fixture.io.closeCalls).toBe(1);
    expect(fixture.io.cancelCalls).toBe(1);
  });

  it("shares one actual teardown between an ordered end and repeated destroy", async () => {
    const fixture = createFixture({ holdCancel: true, holdClose: true });
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal");
      fixture.socket.end();
      await drain();
      expect(fixture.io.cancelCalls).toBe(1);
      expect(fixture.io.closeCalls).toBe(1);
      fixture.socket.destroy();
      await drain();
      expect(fixture.io.cancelCalls).toBe(1);
      expect(fixture.io.closeCalls).toBe(1);
      expect(fixture.events.filter(event => event.kind === "close")).toHaveLength(0);
      fixture.io.cancelResult.resolve();
      fixture.io.finishClose();
      await fixture.closed;
      expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
      fixture.socket.destroy();
      await drain();
      expect(fixture.io.closeCalls).toBe(1);
      expect(fixture.events).toHaveLength(2);
    });
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`escalates ordered end before a held write settles with ${outcome}`, async () => {
      const fixture = createFixture({ holdWrites: true, holdClose: true });
      const failure = new Error("accepted write failed after caller destruction");
      const callbacks: unknown[][] = [];
      const endCallbacks: unknown[][] = [];
      const order: string[] = [];
      await withSocketCleanup(fixture, async () => {
        await fixture.socket.connect(5432, "postgres.internal");
        fixture.socket.on("close", () => { order.push("close"); });
        fixture.socket.write("held write", (...args: unknown[]) => { callbacks.push(args); order.push("write"); });
        fixture.socket.end(undefined, undefined, (...args: unknown[]) => { endCallbacks.push(args); order.push("end"); });
        await drain();
        expect(fixture.io.closeCalls).toBe(0);
        expect(fixture.io.cancelCalls).toBe(0);
        fixture.socket.destroy();
        await drain();
        expect(fixture.io.closeCalls).toBe(1);
        expect(fixture.io.cancelCalls).toBe(1);
        expect(callbacks).toHaveLength(0);
        expect(fixture.events.filter(event => event.kind === "close")).toHaveLength(0);
        // Native close may itself flush: only its initiation was asserted above.
        if (outcome === "success") fixture.io.writeResult.resolve();
        else fixture.io.writeResult.reject(failure);
        await drain();
        expect(callbacks).toHaveLength(1);
        expect(callbacks[0]?.[0]).toBe(outcome === "success" ? undefined : failure);
        expect(endCallbacks).toHaveLength(0);
        expect(fixture.events.filter(event => event.kind === "close")).toHaveLength(0);
        fixture.io.finishClose();
        await fixture.closed;
        expect(endCallbacks).toHaveLength(1);
        expect(endCallbacks[0]?.[0]).toBe(outcome === "success" ? undefined : failure);
        expect(order).toEqual(["write", "end", "close"]);
        expect(fixture.events.filter(event => event.kind === "error"))
          .toEqual(outcome === "success" ? [] : [{ kind: "error", cause: failure }]);
        const terminal = [...fixture.events];
        await drain();
        expect(fixture.events).toEqual(terminal);
        expect(callbacks).toHaveLength(1);
        expect(endCallbacks).toHaveLength(1);
      });
    });
  }

  it("destroys the available TLS transport while its transition waits for a write", async () => {
    const fixture = createFixture({ holdWrites: true }, true);
    const secure = fixture.createTls();
    const before: unknown[][] = [];
    const after: unknown[][] = [];
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal", () => {
        fixture.socket.write("pre-TLS held write", (...args: unknown[]) => { before.push(args); });
        fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
        fixture.socket.write("queued startup", (...args: unknown[]) => { after.push(args); });
      });
      await drain();
      fixture.socket.destroy();
      await drain();
      expect(fixture.io.closeCalls).toBe(1);
      expect(fixture.io.cancelCalls).toBe(1);
      expect(fixture.io.events).not.toContain("socket.startTls");
      expect(fixture.events.filter(event => event.kind === "close")).toHaveLength(0);
      fixture.io.writeResult.resolve();
      await fixture.closed;
      expect(fixture.io.events).not.toContain("socket.startTls");
      expect(secure.writes).toHaveLength(0);
      expect(secure.closeCalls).toBe(0);
      expect(before).toHaveLength(1);
      expect(before[0]?.[0]).toBeUndefined();
      expect(after).toHaveLength(1);
      const refusal: unknown = after[0]?.[0];
      expect(refusal).toBeInstanceOf(Error);
      expect(fixture.events.filter(event => event.kind === "error")).toEqual([{ kind: "error", cause: refusal }]);
      expect(fixture.events.at(-1)).toEqual({ kind: "close" });
    });
  });

  it("closes the initial SSL transport when ordered end begins in connect without an upgrade", async () => {
    const fixture = createFixture({}, true);
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal", () => { fixture.socket.end(); });
      await drain();
      expect(fixture.io.cancelCalls).toBe(1);
      expect(fixture.io.closeCalls).toBe(1);
      await fixture.closed;
      expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
    });
  });

  it("retains a pending write rejection and its callback before terminal close", async () => {
    const fixture = createFixture({ holdWrites: true });
    const failure = new Error("pending writer rejected");
    const callbacks: unknown[][] = [];
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.write("pending payload", (...args: unknown[]) => { callbacks.push(args); });
    await drain();
    fixture.socket.end();
    fixture.io.writeResult.reject(failure);
    await fixture.closed;
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]?.[0]).toBe(failure);
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    expect(fixture.io.closeCalls).toBe(1);
  });

  it("joins repeated end/destroy calls into one shutdown", async () => {
    const fixture = createFixture();
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.end();
    fixture.socket.destroy();
    fixture.socket.end();
    await fixture.closed;
    expect(fixture.io.cancelCalls).toBe(1);
    expect(fixture.io.closeCalls).toBe(1);
    expect(fixture.socket.destroyed).toBe(true);
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
  });

  it("cancels the first STARTTLS negotiation read without decoding an absent value", async () => {
    const fixture = createFixture({}, true);
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.destroy();
    await fixture.closed;
    expect(fixture.io.cancelCalls).toBe(1);
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
  });

  it("recognizes only its native-like cloned read cancellation reason", async () => {
    const fixture = createFixture({ cloneCancellationReason: true });
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.destroy();
    await fixture.closed;
    expect(fixture.io.cancelReasons).toHaveLength(1);
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
    expect(fixture.io.cancelReasons[0]).toBeTypeOf("object");
    expect(fixture.io.closeCalls).toBe(1);
    await drain();
    expect(fixture.events).toHaveLength(2);
  });

  it("preserves an unrelated read rejection delivered after local cancellation starts", async () => {
    const failure = new Error("independent read failure after cancel began");
    const fixture = createFixture({ cloneCancellationReason: true, cancelReadFailure: { cause: failure } });
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.destroy();
    await fixture.closed;
    expect(fixture.io.cancelReasons).toHaveLength(1);
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: failure }, { kind: "close" }]);
    expect(fixture.io.closeCalls).toBe(1);
  });

  it("does not recognize a different reader's private cancellation nonce", async () => {
    const original = createFixture({ cloneCancellationReason: true });
    await original.socket.connect(5432, "postgres.internal");
    original.socket.destroy();
    await original.closed;
    const foreignReason: unknown = structuredClone(original.io.cancelReasons[0]);
    const fixture = createFixture({ cloneCancellationReason: true, cancelReadFailure: { cause: foreignReason } });
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.destroy();
    await fixture.closed;
    expect(fixture.io.cancelReasons[0]).not.toEqual(foreignReason);
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: foreignReason }, { kind: "close" }]);
  });

  for (const channel of ["cancel", "close", "closed"] as const) {
    it(`preserves its own matching cancellation marker rejected by ${channel}, outside read()`, async () => {
      const fixture = createFixture({ cloneCancellationReason: true, holdCancel: true, holdClose: true });
      await fixture.socket.connect(5432, "postgres.internal");
      fixture.socket.destroy();
      await drain();
      expect(fixture.io.cancelReasons).toHaveLength(1);
      const marker: unknown = structuredClone(fixture.io.cancelReasons[0]);
      if (channel === "cancel") fixture.io.cancelResult.reject(marker);
      else fixture.io.cancelResult.resolve();
      await drain();
      expect(fixture.io.closeCalls).toBe(1);
      if (channel === "close") fixture.io.closeResult.reject(marker);
      else fixture.io.closeResult.resolve();
      if (channel === "closed") fixture.io.closedResult.reject(marker);
      else fixture.io.closedResult.resolve();
      await fixture.closed;
      expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "error", cause: marker }, { kind: "close" }]);
      await drain();
      expect(fixture.events).toHaveLength(3);
    });
  }

  for (const channel of ["write", "data"] as const) {
    it(`preserves a foreign cancellation marker from a ${channel} failure`, async () => {
      const original = createFixture({ cloneCancellationReason: true });
      await original.socket.connect(5432, "postgres.internal");
      original.socket.destroy();
      await original.closed;
      const marker: unknown = structuredClone(original.io.cancelReasons[0]);
      const fixture = createFixture({ holdWrites: channel === "write" });
      await fixture.socket.connect(5432, "postgres.internal");
      if (channel === "write") {
        fixture.socket.write("write with independent failure");
        await drain();
        fixture.io.writeResult.reject(marker);
      } else {
        fixture.socket.on("data", () => { throw marker; });
        fixture.io.receive(new Uint8Array([1]));
      }
      await fixture.closed;
      expect(fixture.events.filter(event => event.kind === "error")).toEqual([{ kind: "error", cause: marker }]);
      expect(fixture.events.at(-1)).toEqual({ kind: "close" });
      expect(fixture.io.closeCalls).toBe(1);
    });
  }

  it("keeps a retired plaintext closure from closing the active TLS generation", async () => {
    const fixture = createFixture({}, true);
    const secure = fixture.createTls();
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.on("data", (value: Uint8Array) => {
      if (value[0] === 83) fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
    });
    fixture.io.receive(new Uint8Array([83]));
    await drain();
    expect(fixture.io.events).toContain("socket.startTls");
    fixture.io.closedResult.resolve();
    await drain();
    expect(fixture.events.filter(event => event.kind === "close")).toHaveLength(0);
    secure.receive(new Uint8Array([42]));
    await drain();
    expect(fixture.events).toContainEqual({ kind: "data", value: new Uint8Array([42]) });
    fixture.socket.end();
    await fixture.closed;
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "data", "data", "close"]);
    expect(secure.closeCalls).toBe(1);
    expect(fixture.io.closeCalls).toBe(0);
    await drain();
    expect(fixture.events).toHaveLength(4);
  });

  it("supports pg direct TLS from the synchronous connect callback without a plaintext byte", async () => {
    const fixture = createFixture({}, true);
    const secure = fixture.createTls();
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal", () => {
        fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
        fixture.socket.write("direct startup frame");
      });
      await drain();
      expect(fixture.io.events.filter(event => event === "socket.startTls")).toHaveLength(1);
      expect(fixture.io.writes).toHaveLength(0);
      expect(secure.writes).toEqual([new TextEncoder().encode("direct startup frame")]);
      expect(fixture.events.map(event => event.kind)).toEqual(["connect"]);
    });
  });

  it("joins end during pg direct TLS without waiting for a nonexistent plaintext byte", async () => {
    const fixture = createFixture({}, true);
    const secure = fixture.createTls();
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal", () => {
        fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
        fixture.socket.end();
      });
      await drain();
      expect(fixture.io.events.filter(event => event === "socket.startTls")).toHaveLength(1);
      expect(secure.closeCalls).toBe(1);
      fixture.io.closedResult.resolve();
      await fixture.closed;
      expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
    });
  });

  it("drains a held pre-TLS write when ending during the direct transition", async () => {
    const fixture = createFixture({ holdWrites: true }, true);
    const secure = fixture.createTls();
    await withSocketCleanup(fixture, async () => {
      await fixture.socket.connect(5432, "postgres.internal", () => {
        fixture.socket.write("held before direct upgrade");
        fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
        fixture.socket.end();
      });
      await drain();
      expect(fixture.io.writes).toEqual([new TextEncoder().encode("held before direct upgrade")]);
      expect(fixture.io.events).not.toContain("socket.startTls");
      expect(fixture.io.closeCalls).toBe(0);
      fixture.io.writeResult.resolve();
      await drain();
      expect(fixture.io.events.filter(event => event === "socket.startTls")).toHaveLength(1);
      expect(secure.closeCalls).toBe(1);
      fixture.io.closedResult.resolve();
      await fixture.closed;
      expect(fixture.events.map(event => event.kind)).toEqual(["connect", "close"]);
    });
  });

  it("observes a retired socket settling after secure shutdown without later driver events", async () => {
    const fixture = createFixture({}, true);
    fixture.createTls();
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.on("data", (value: Uint8Array) => {
      if (value[0] === 83) fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
    });
    fixture.io.receive(new Uint8Array([83]));
    await drain();
    fixture.socket.end();
    await drain();
    fixture.io.closedResult.resolve();
    await fixture.closed;
    const terminal = [...fixture.events];
    await drain();
    expect(fixture.events).toEqual(terminal);
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "data", "close"]);
  });

  it("joins pre-TLS writes and directs pg's immediate startup write to the secure generation", async () => {
    const fixture = createFixture({ holdWrites: true }, true);
    const secure = fixture.createTls();
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.write("ssl request");
    fixture.socket.on("data", (value: Uint8Array) => {
      if (value[0] === 83) {
        fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
        fixture.socket.write("startup frame");
      }
    });
    fixture.io.receive(new Uint8Array([83]));
    await drain();
    expect(fixture.io.writes).toEqual([new TextEncoder().encode("ssl request")]);
    expect(fixture.io.events).not.toContain("socket.startTls");
    expect(secure.writes).toHaveLength(0);
    fixture.io.writeResult.resolve();
    await drain();
    expect(fixture.io.events.filter(event => event === "socket.startTls")).toHaveLength(1);
    expect(fixture.io.writes).toEqual([new TextEncoder().encode("ssl request")]);
    expect(secure.writes).toEqual([new TextEncoder().encode("startup frame")]);
    fixture.io.closedResult.resolve();
    fixture.socket.end();
    await fixture.closed;
    expect(fixture.events.map(event => event.kind)).toEqual(["connect", "data", "close"]);
  });

  it("retains a secure generation failure independently of the retired plaintext socket", async () => {
    const fixture = createFixture({}, true);
    const secure = fixture.createTls();
    const failure = new Error("secure reader disconnected");
    await fixture.socket.connect(5432, "postgres.internal");
    fixture.socket.on("data", (value: Uint8Array) => {
      if (value[0] === 83) fixture.socket.startTls({ expectedServerHostname: "postgres.internal" });
    });
    fixture.io.receive(new Uint8Array([83]));
    await drain();
    fixture.io.closedResult.resolve();
    await drain();
    secure.readerError(failure);
    fixture.socket.end();
    await fixture.closed;
    expect(fixture.events).toEqual([{ kind: "connect" }, { kind: "data", value: Buffer.from([83]) },
      { kind: "error", cause: failure }, { kind: "close" }]);
    expect(secure.closeCalls).toBe(1);
    await drain();
    expect(fixture.events).toHaveLength(4);
  });
});

/** Deterministic promise scheduling, not a timeout or production retry. */
async function drain(): Promise<void> {
  for (let index = 0; index < 32; index++) await Promise.resolve();
}

async function withSocketCleanup(fixture: ReturnType<typeof FixtureFactory>, work: () => Promise<void>): Promise<void> {
  const [primary] = await Promise.allSettled([Promise.resolve().then(work)] as const);
  const [cleanup] = await Promise.allSettled([(async () => {
    // Release only primitive resources after the behavioral assertions have
    // settled. This lets the old deadlocked implementation fail without leaking.
    fixture.io.writeResult.resolve();
    fixture.io.cancelResult.resolve();
    fixture.io.closeResult.resolve();
    fixture.io.finishPeer();
    fixture.socket.destroy();
    await fixture.closed;
  })()] as const);
  const failures: unknown[] = [];
  if (primary.status === "rejected") failures.push(primary.reason);
  if (cleanup.status === "rejected") failures.push(cleanup.reason);
  if (failures.length !== 0) throw new AggregateError(failures, "Socket witness and cleanup failed.");
}
