import { CoreTransactionError, type CoreQuery, type CoreReadTransaction } from "@flarex/persistence-postgres/internal/core";
import { Cause, Context, Effect, Exit, Result } from "effect";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { describe, expect, it } from "vitest";

import { makeCoreApplicationReadSession } from "../src/CoreApplicationReadSession";

const broker = Result.getOrThrow(createQueryCursorBroker({
  instanceName: "read-session-capacity-test", deploymentSecret: new Uint8Array(32).fill(9),
}));

function transaction(): CoreReadTransaction {
  const unexpected = () => Effect.die("Unexpected transaction operation");
  return {
    timestamp: 10n, unixTime: 20, tableMappings: Effect.succeed([]),
    tableNumber: unexpected, normalizeId: unexpected, selectProgram: unexpected,
    get: unexpected, startQuery: unexpected, scan: unexpected,
    usage: Effect.succeed({ user: { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 },
      system: { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 }, databaseQueries: 0 }),
  };
}

describe("Core Application foreign callback capacity", () => {
  it("latches overflow before rejection and drains existing work without running queued callbacks", async () => {
    let entered = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let callbacks = 0;
    const session = makeCoreApplicationReadSession({ transaction: transaction(), revalidate: Effect.void },
      Context.empty(), broker, { maxPendingCallbacks: 2, maxOpenQueries: 1 });
    const first = session.run(() => Effect.promise(async () => { callbacks += 1; entered(); await gate; return "first"; }));
    await started;
    const second = session.run(() => Effect.sync(() => { callbacks += 1; return "second"; }));
    const secondResult = second.then(value => ({ value }), error => ({ error }));
    await expect(session.run(() => Effect.die("Overflow callback ran"))).rejects.toThrow("unavailable");
    await expect(session.run(() => Effect.die("Post-overflow callback ran"))).rejects.toThrow("unavailable");
    let drained = false;
    const closing = Effect.runPromiseExit(session.closeAndDrain).then(exit => { drained = true; return exit; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    expect(await first).toBe("first");
    expect(await secondResult).toHaveProperty("error");
    const closed = await closing;
    expect(Exit.isFailure(closed) && closed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual([expect.objectContaining({ _tag: "CoreApplicationAdmissionError", reason: "callbackCapacity" })]);
    expect(callbacks).toBe(1);
  });

  it("releases successful outstanding slots for subsequent callbacks", async () => {
    const session = makeCoreApplicationReadSession({ transaction: transaction(), revalidate: Effect.void },
      Context.empty(), broker, { maxPendingCallbacks: 1, maxOpenQueries: 1 });
    expect(await session.run(() => Effect.succeed("first"))).toBe("first");
    expect(await session.run(() => Effect.succeed("second"))).toBe("second");
    await Effect.runPromise(session.closeAndDrain);
  });

  it("bounds retained stream handles without changing the core interval budget", async () => {
    let started = 0;
    let closed = 0;
    const query: CoreQuery = { queryFingerprint: new Uint8Array(32),
      nextPage: () => Effect.succeed({ documents: [], position: { kind: "end" }, done: true }),
      close: () => Effect.sync(() => { closed++; }),
    };
    const session = makeCoreApplicationReadSession({ transaction: { ...transaction(),
      startQuery: () => Effect.sync(() => { started++; return query; }) }, revalidate: Effect.void },
    Context.empty(), broker, { maxPendingCallbacks: 2, maxOpenQueries: 1 });
    expect((await session.target.queryStart({ table: "users" }, { kind: "collect" })).kind).toBe("ok");
    await expect(session.target.queryStart({ table: "users" }, { kind: "collect" })).rejects.toThrow("unavailable");
    expect(started).toBe(1);
    const drained = await Effect.runPromiseExit(session.closeAndDrain);
    expect(Exit.isFailure(drained) && drained.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual([expect.objectContaining({ reason: "queryCapacity" })]);
    expect(closed).toBe(1);
  });

  it("preserves the active full Cause when overflow races its failure", async () => {
    let entered = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = Cause.combine(Cause.fail(new CoreTransactionError({ reason: "capacity" })), Cause.combine(Cause.die("active defect"), Cause.interrupt(314)));
    const session = makeCoreApplicationReadSession({ transaction: transaction(), revalidate: Effect.void },
      Context.empty(), broker, { maxPendingCallbacks: 1, maxOpenQueries: 1 });
    const active = session.run(() => Effect.promise(async () => { entered(); await gate; })
      .pipe(Effect.andThen(Effect.failCause(original))));
    const activeResult = active.then(() => undefined, error => error);
    await started;
    await expect(session.run(() => Effect.void)).rejects.toThrow("unavailable");
    release();
    expect(await activeResult).toBeInstanceOf(Error);
    const drained = await Effect.runPromiseExit(session.closeAndDrain);
    expect(Exit.isFailure(drained) && drained.cause.reasons.slice(1)).toEqual(original.reasons);
    expect(Exit.isFailure(drained) && drained.cause.reasons.filter(Cause.isFailReason)[0]?.error)
      .toMatchObject({ reason: "callbackCapacity" });
  });
});
