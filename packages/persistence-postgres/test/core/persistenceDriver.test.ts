import { PGlite } from "@electric-sql/pglite";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { expect, it } from "vitest";
import { CorePersistenceError } from "../../src/core/contracts";
import { makeCorePGliteDriver, type CoreSqlDriver } from "../../src/database/corePersistence/driver";
import { installCorePersistence, loadCorePersistenceTarget } from "../../src/database/corePersistence/target";

it("interrupts the actual parent callback and rolls back before returning", async () => {
  const database = new PGlite();
  const driver = makeCorePGliteDriver(database);
  const entered = await Effect.runPromise(Deferred.make<void>());
  const released = await Effect.runPromise(Deferred.make<void>());
  let running: Fiber.Fiber<void, unknown> | undefined;
  try {
    await Effect.runPromise(driver.query("CREATE TABLE proof (id INT PRIMARY KEY)"));
    running = Effect.runFork(driver.transaction(connection => Effect.gen(function* () {
      yield* connection.query("INSERT INTO proof (id) VALUES (1)");
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(released);
    })));
    await Effect.runPromise(Deferred.await(entered));
    const interrupting = Effect.runPromise(Fiber.interrupt(running));
    await Effect.runPromise(Deferred.succeed(released, undefined));
    await interrupting;
    const exit = await Effect.runPromise(Fiber.await(running));
    const rows = await Effect.runPromise(driver.query("SELECT id FROM proof"));
    expect({ interrupted: Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause), rows })
      .toEqual({ interrupted: true, rows: [] });
  } finally {
    await Effect.runPromise(Deferred.succeed(released, undefined));
    if (running !== undefined) await Effect.runPromise(Fiber.interrupt(running));
    await database.close();
  }
});

it("preserves the parent's Clock and current span inside the transaction callback", async () => {
  const database = new PGlite();
  const driver = makeCorePGliteDriver(database);
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => 1234, currentTimeMillis: Effect.succeed(1234),
    currentTimeNanosUnsafe: () => 1_234_000_000n, currentTimeNanos: Effect.succeed(1_234_000_000n),
    monotonicTimeNanosUnsafe: () => 0n, monotonicTimeNanos: Effect.succeed(0n), sleep: () => Effect.void,
  };
  try {
    const result = await Effect.runPromise(driver.transaction(() => Effect.gen(function* () {
      const time = yield* Clock.currentTimeMillis;
      const span = yield* Effect.withFiber(fiber => Effect.succeed(
        fiber.currentSpan?._tag === "Span" ? fiber.currentSpan.name : undefined,
      ));
      return { time, span };
    })).pipe(Effect.withSpan("transaction-parent"), Effect.provideService(Clock.Clock, clock)));
    expect(result).toEqual({ time: 1234, span: "transaction-parent" });
  } finally { await database.close(); }
});

it("joins callback cleanup and actual rollback before completing interruption", async () => {
  const database = new PGlite();
  let drained = false;
  const driver = makeCorePGliteDriver({ query: database.query.bind(database), transaction: async run => {
    try { return await database.transaction(run); } finally { drained = true; }
  } });
  const entered = await Effect.runPromise(Deferred.make<void>());
  const cleaning = await Effect.runPromise(Deferred.make<void>());
  const cleaned = await Effect.runPromise(Deferred.make<void>());
  const cleanupDefect = new Error("Callback cleanup defect");
  let running: Fiber.Fiber<void, unknown> | undefined;
  let interrupting: Promise<void> | undefined;
  try {
    await Effect.runPromise(driver.query("CREATE TABLE proof (id INT PRIMARY KEY)"));
    running = Effect.runFork(driver.transaction(connection => Effect.gen(function* () {
      yield* connection.query("INSERT INTO proof (id) VALUES (1)");
      yield* Deferred.succeed(entered, undefined);
      yield* Effect.never;
    }).pipe(Effect.ensuring(Effect.gen(function* () {
      yield* Deferred.succeed(cleaning, undefined);
      yield* Deferred.await(cleaned);
      yield* Effect.die(cleanupDefect);
    })))));
    await Effect.runPromise(Deferred.await(entered));
    let completed = false;
    interrupting = Effect.runPromise(Fiber.interrupt(running)).then(() => { completed = true; });
    await Effect.runPromise(Deferred.await(cleaning));
    expect({ completed, drained }).toEqual({ completed: false, drained: false });
    await Effect.runPromise(Deferred.succeed(cleaned, undefined));
    await interrupting;
    const result = await Effect.runPromise(Fiber.await(running));
    if (!Exit.isFailure(result)) throw new Error("Expected interruption and cleanup defect");
    expect(Cause.hasInterrupts(result.cause)).toBe(true);
    expect(result.cause.reasons).toContainEqual(expect.objectContaining({ _tag: "Die", defect: cleanupDefect }));
    expect(drained).toBe(true);
    expect(await Effect.runPromise(driver.query("SELECT id FROM proof"))).toEqual([]);
  } finally {
    await Effect.runPromise(Deferred.succeed(cleaned, undefined));
    if (running !== undefined) await Effect.runPromise(Fiber.interrupt(running));
    await interrupting;
    await database.close();
  }
});

it("preserves a synchronous callback-factory defect through actual PGlite rollback", async () => {
  const database = new PGlite();
  const driver = makeCorePGliteDriver(database);
  const defect = new Error("Synchronous callback factory defect");
  try {
    const result = await Effect.runPromiseExit(driver.transaction(() => { throw defect; }));
    if (!Exit.isFailure(result)) throw new Error("Expected callback defect");
    expect(result.cause.reasons).toMatchObject([{ _tag: "Die", defect }]);
    expect(await Effect.runPromise(driver.query("SELECT 1 AS valid"))).toEqual([{ valid: 1 }]);
  } finally { await database.close(); }
});

it("wakes and joins the waiting callback if foreign BEGIN fails before invocation", async () => {
  const failure = new Error("Foreign BEGIN failure");
  const driver = makeCorePGliteDriver({ query: async () => ({ rows: [] }), transaction: () => Promise.reject(failure) });
  const result = await Effect.runPromise(Effect.result(driver.transaction(() => Effect.void).pipe(Effect.timeout("1 second"))));
  expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CorePersistenceError", reason: "unavailable", cause: failure } });
});

it("preserves typed failure and defect together while rolling back the actual PGlite callback", async () => {
  const database = new PGlite();
  const driver = makeCorePGliteDriver(database);
  try {
    await Effect.runPromise(driver.query("CREATE TABLE proof (id INT PRIMARY KEY)"));
    const cause = Cause.combine(Cause.fail("typed failure"), Cause.die(new Error("defect")));
    const result = await Effect.runPromiseExit(driver.transaction(connection => Effect.gen(function* () {
      yield* connection.query("INSERT INTO proof (id) VALUES (1)");
      return yield* Effect.failCause(cause);
    })));
    if (!Exit.isFailure(result)) throw new Error("Expected the full callback failure");
    expect(result.cause).toEqual(cause);
    expect(await Effect.runPromise(driver.query("SELECT count(*)::int AS count FROM proof"))).toEqual([{ count: 0 }]);
  } finally { await database.close(); }
});

it("retains the callback cause if the foreign transaction replaces it with a settlement error", async () => {
  const database = new PGlite();
  const settlement = new Error("Injected foreign rollback acknowledgement loss");
  const driver = makeCorePGliteDriver({ query: database.query.bind(database), transaction: async run => {
    try { return await database.transaction(run); } catch { throw settlement; }
  } });
  try {
    const result = await Effect.runPromiseExit(driver.transaction(() => Effect.fail("original")));
    if (!Exit.isFailure(result)) throw new Error("Expected callback and settlement failures");
    expect(result.cause.reasons).toMatchObject([
      { _tag: "Fail", error: "original" },
      { _tag: "Fail", error: { _tag: "CorePersistenceError", reason: "unavailable", cause: settlement } },
    ]);
  } finally { await database.close(); }
});

it("rolls back interrupted physical installation and refuses to adopt an already installed namespace", async () => {
  const database = new PGlite();
  const driver = makeCorePGliteDriver(database);
  const interrupted: CoreSqlDriver = { query: driver.query, withConnection: driver.withConnection,
    transaction: run => driver.transaction(connection => run({
      query: (statement, parameters) => statement.includes('CREATE TABLE "core_install"."indexes"')
        ? Effect.fail(new CorePersistenceError({ reason: "unavailable" })) : connection.query(statement, parameters),
    })),
  };
  try {
    expect(Result.isFailure(await Effect.runPromise(Effect.result(installCorePersistence(interrupted, "core_install"))))).toBe(true);
    expect(await Effect.runPromise(driver.query("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_install') AS present")))
      .toEqual([{ present: false }]);
    const installed = await Effect.runPromise(installCorePersistence(driver, "core_install"));
    expect(installed.namespace).toBe("core_install");
    expect((await Effect.runPromise(loadCorePersistenceTarget(driver, "core_install"))).namespace).toBe("core_install");
    expect(await Effect.runPromise(Effect.result(installCorePersistence(driver, "core_install"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
  } finally { await database.close(); }
});
