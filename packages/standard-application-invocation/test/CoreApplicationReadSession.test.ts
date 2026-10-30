import {
  CoreQueryInputError,
  CoreTransactionError,
  type CoreReadTransaction,
  type CoreQuery,
} from "@flarex/persistence-postgres/internal/core";
import { Cause, Context, Effect, Exit, Option, Result } from "effect";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { describe, expect, it } from "vitest";

import { makeCoreApplicationReadSession } from "../src/CoreApplicationReadSession";

const broker = Result.getOrThrow(createQueryCursorBroker({
  instanceName: "read-session-test", deploymentSecret: new Uint8Array(32).fill(11),
}));
const documentId = Result.getOrThrow(encodeDocumentId(1, new Uint8Array(16).fill(1)));
const queryRequest = { table: "users" };

function transaction(overrides: Partial<CoreReadTransaction> = {}): CoreReadTransaction {
  const unsupported = () => Effect.die(new Error("Unexpected test operation"));
  return {
    timestamp: 10n, unixTime: 20,
    tableNumber: () => Effect.succeed(1),
    normalizeId: () => Effect.succeed(Option.none()),
    usage: Effect.succeed({ user: { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 },
      system: { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 }, databaseQueries: 0 }),
    selectProgram: unsupported, get: unsupported, startQuery: unsupported, scan: unsupported,
    ...overrides,
  };
}

describe("shared Core Application read session", () => {
  it("serializes admitted callbacks and drains them before closing every stream", async () => {
    const events: string[] = [];
    let releasePage = () => {};
    const pageGate = new Promise<void>(resolve => { releasePage = resolve; });
    let enteredPage = () => {};
    const pageEntered = new Promise<void>(resolve => { enteredPage = resolve; });
    const query: CoreQuery = {
      queryFingerprint: new Uint8Array(32),
      nextPage: () => Effect.promise(async () => {
        events.push("page-start"); enteredPage(); await pageGate; events.push("page-end");
        return { documents: [], position: { kind: "end" as const }, done: true };
      }),
      close: () => Effect.sync(() => { events.push("stream-close"); }),
    };
    const session = makeCoreApplicationReadSession({ transaction: transaction({
      startQuery: () => Effect.succeed(query),
      get: () => Effect.sync(() => { events.push("get"); return Option.none(); }),
    }), tables: [{ tableId: 1, logicalName: "users" }], revalidate: Effect.void }, Context.empty(), broker);
    const started = await session.target.queryStart(queryRequest, { kind: "collect" });
    if (started.kind !== "ok") throw new Error("Expected admitted query");
    const page = session.target.queryNext(started.value.queryId, 1);
    await pageEntered;
    const read = session.target.readPointDocument("users", documentId);
    const drained = Effect.runPromise(session.closeAndDrain);
    await Promise.resolve();
    expect(events).toEqual(["page-start"]);
    await expect(session.target.revalidate()).rejects.toThrow("unavailable");
    releasePage();
    expect(await page).toMatchObject({ kind: "ok", value: { isDone: true } });
    expect(await read).toEqual({ kind: "missing" });
    await drained;
    expect(events).toEqual(["page-start", "page-end", "get", "stream-close"]);
  });

  it("returns ordinary query refusals without poisoning later admitted reads", async () => {
    let starts = 0;
    const session = makeCoreApplicationReadSession({ transaction: transaction({
      startQuery: () => { starts += 1; return Effect.fail(new CoreQueryInputError({ reason: "invalidQuery" })); },
      get: () => Effect.succeed(Option.none()),
    }), tables: [{ tableId: 1, logicalName: "users" }], revalidate: Effect.void }, Context.empty(), broker);
    expect(await session.target.queryStart(queryRequest, { kind: "collect" }))
      .toEqual({ kind: "queryError", message: "Invalid database query." });
    expect(await session.target.queryStart({ ...queryRequest, cursor: "malformed" }, { kind: "collect" }))
      .toEqual({ kind: "queryError", message: "Invalid query cursor." });
    expect(starts).toBe(1);
    expect(await session.target.readPointDocument("users", documentId)).toEqual({ kind: "missing" });
    await Effect.runPromise(session.closeAndDrain);
  });

  it("retains a mixed first Cause and combines stream cleanup without re-executing callbacks", async () => {
    const failure = new CoreTransactionError({ reason: "capacity" });
    const defect = new Error("page defect");
    const cleanup = new Error("cleanup defect");
    const original = Cause.combine(Cause.fail(failure), Cause.combine(Cause.die(defect), Cause.interrupt(712)));
    let laterReads = 0;
    const query: CoreQuery = {
      queryFingerprint: new Uint8Array(32), nextPage: () => Effect.failCause(original),
      close: () => Effect.die(cleanup),
    };
    const session = makeCoreApplicationReadSession({ transaction: transaction({
      startQuery: () => Effect.succeed(query),
      get: () => Effect.sync(() => { laterReads += 1; return Option.none(); }),
    }), tables: [{ tableId: 1, logicalName: "users" }], revalidate: Effect.void }, Context.empty(), broker);
    const started = await session.target.queryStart(queryRequest, { kind: "collect" });
    if (started.kind !== "ok") throw new Error("Expected admitted query");
    await expect(session.target.queryNext(started.value.queryId, 1)).rejects.toThrow("unavailable");
    await expect(session.target.readPointDocument("users", documentId)).rejects.toThrow("unavailable");
    expect(laterReads).toBe(0);
    const drained = await Effect.runPromiseExit(session.closeAndDrain);
    expect(Exit.isFailure(drained) && drained.cause).toEqual(Cause.combine(original, Cause.die(cleanup)));
  });
});
