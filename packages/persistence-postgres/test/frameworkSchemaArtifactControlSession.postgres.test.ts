import { createServer, type Socket } from "node:net";
import { sql } from "drizzle-orm";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Clock, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  Client,
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";
import { describe, expect, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import { rowsFromDriverExecuteResult } from "../src/driverExecuteResult";
import {
  FrameworkSchemaArtifactControlSessionCleanupDefect,
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  makeFrameworkSchemaArtifactControlConnectionIdentity,
  makeFrameworkSchemaArtifactControlSessionStarter,
  runFrameworkSchemaArtifactControlEffect,
  startFrameworkSchemaArtifactControlDeadline,
  type FrameworkSchemaArtifactControlRestore,
} from "../src/frameworkSchema/artifact/controlSession";
import {
  makePostgresFrameworkSchemaArtifactControlSessionDriver,
} from "../src/frameworkSchema/artifact/postgresControlSession";
import { postgresUrl } from "./postgresHelpers";

type ControlPool = Parameters<
  typeof makePostgresFrameworkSchemaArtifactControlSessionDriver
>[0];
type ConnectCallback = Parameters<ControlPool["connect"]>[0];

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (cause: unknown) => void;
}

interface FakeClientOptions {
  readonly commitCommand?: string;
  readonly delayedQuery?: Deferred<FakeQueryResult>;
  readonly namedDelayedQueries?: Readonly<
    Record<string, Deferred<FakeQueryResult>>
  >;
  readonly releaseFailure?: (destroy: boolean) => unknown | undefined;
  readonly rollbackCommand?: string;
  readonly runtimeBackendKeyData?: Readonly<{
    readonly processId: number;
    readonly secretKey: number;
  }>;
  readonly emitEndOnDestroy?: boolean;
  readonly settleDelayedOnDestroy?: boolean;
  readonly useForeignPromise?: boolean;
}

interface FakeQueryResult {
  readonly command: string;
  readonly fields: readonly never[];
  readonly oid: number;
  readonly rowCount: number;
  readonly rows: readonly QueryResultRow[];
}

const restoreInterruptibility: FrameworkSchemaArtifactControlRestore =
  effect => effect;
const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("PostgreSQL framework artifact control-session adapter", () => {
  it("rejects an invalid quarantine-drain timeout at construction", () => {
    const pool = queuedPool([], []);
    for (const timeout of [0, -1, 60_001, 1.5, Number.NaN]) {
      expect(() => makePostgresFrameworkSchemaArtifactControlSessionDriver(
        pool,
        { quarantineDrainTimeoutMilliseconds: timeout },
      )).toThrow(
        "PostgreSQL quarantine drain timeout must be an integer from 1 through 60000 milliseconds.",
      );
    }
  });

  it("runs callbacks with the enclosing Effect clock context", async () => {
    const events: string[] = [];
    const client = fakePoolClient("clock", events);
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );

    const observed = await Effect.runPromise(Effect.gen(function* () {
      yield* TestClock.adjust("1234 millis");
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "read",
        1_000,
      );
      return yield* driver.runReadEffect(
        { deadline },
        () => Clock.currentTimeMillis,
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(observed).toBe(1_234);
    expect(events.at(-1)).toBe("clock:release:false");
  });

  it("drains callback-started queries before commit and releases normally", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const client = fakePoolClient("first", events, {
      delayedQuery: delayed,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await initialDeadline();

    const settlementPromise = Effect.runPromise(
      driver.runInitialTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          recoveryTimeoutMilliseconds: 1_000,
        },
        restoreInterruptibility,
        transaction => Effect.sync(() => {
          events.push("work:start");
          const pending = transaction.execute(
            sql.raw("select delayed_user_query"),
          );
          void pending.then(
            () => undefined,
            () => undefined,
          );
          events.push("work:return");
          return "created";
        }),
      ),
    );

    await waitFor(() => events.includes("first:query:select delayed_user_query"));
    expect(events).not.toContain("first:query:commit");
    expect(events).not.toContain("first:release:false");
    delayed.resolve(queryResult());

    await expect(settlementPromise).resolves.toEqual({
      kind: "committed",
      value: "created",
    });
    expect(events[3]).toMatch(
      /^first:query:select set_config\('lock_timeout', \$1, true\), set_config\('statement_timeout', \$2, true\):700ms,\d+ms$/,
    );
    expect(events.toSpliced(3, 1)).toEqual([
      "pool:acquire:first",
      "first:query:begin",
      "first:query:set transaction isolation level read committed",
      "work:start",
      "first:query:select delayed_user_query",
      "work:return",
      "first:query:commit",
      "first:release:false",
    ]);
  });

  it.each([
    { label: "native Promise", useForeignPromise: false },
    { label: "foreign PromiseLike", useForeignPromise: true },
  ])("does not commit after a detached $label query rejects", async ({
    useForeignPromise,
  }) => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const queryFailure = new Error("detached query failed");
    const client = fakePoolClient("rejected", events, {
      delayedQuery: delayed,
      useForeignPromise,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await initialDeadline();

    const settlementPromise = Effect.runPromise(
      driver.runInitialTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          recoveryTimeoutMilliseconds: 1_000,
        },
        restoreInterruptibility,
        transaction => Effect.sync(() => {
          void Promise.resolve(
            transaction.execute(sql.raw("select delayed_user_query")),
          ).catch(() => undefined);
          return "created";
        }),
      ),
    );
    await waitFor(() => events.includes(
      "rejected:query:select delayed_user_query"
    ));
    delayed.reject(queryFailure);
    const settlement = await settlementPromise;

    expect(settlement.kind).toBe("notCommitted");
    if (settlement.kind === "notCommitted") {
      const failure = Result.getOrThrow(Cause.findError(settlement.cause));
      expect(failure).toMatchObject({
        _tag: "FrameworkSchemaArtifactControlSessionResourceIssue",
        phase: "callback",
        cause: queryFailure,
      });
    }
    expect(events).not.toContain("rejected:query:commit");
    expect(events.slice(-2)).toEqual([
      "rejected:query:rollback",
      "rejected:release:false",
    ]);
  });

  it("retains a rejected query when another query exhausts the drain deadline", async () => {
    const events: string[] = [];
    const rejected = deferred<FakeQueryResult>();
    const stalled = deferred<FakeQueryResult>();
    const queryFailure = new Error("first detached query failed");
    const client = fakePoolClient("mixed", events, {
      namedDelayedQueries: {
        "select rejected_user_query": rejected,
        "select stalled_user_query": stalled,
      },
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );

    const settlement = await Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "initial",
        20,
      );
      const fiber = yield* Effect.forkChild(
        driver.runInitialTransactionEffect(
          {
            deadline,
            lockTimeoutMilliseconds: 20,
            recoveryTimeoutMilliseconds: 20,
          },
          restoreInterruptibility,
          transaction => Effect.sync(() => {
            for (const statement of [
              "select rejected_user_query",
              "select stalled_user_query",
            ]) {
              void Promise.resolve(
                transaction.execute(sql.raw(statement)),
              ).catch(() => undefined);
            }
            return "created";
          }),
        ),
      );
      while (!events.includes("mixed:query:select stalled_user_query")) {
        yield* Effect.yieldNow;
      }
      rejected.reject(queryFailure);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("20 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(settlement.kind).toBe("notCommitted");
    if (settlement.kind === "notCommitted") {
      expect(settlement.cause.reasons.filter(Cause.isFailReason).some(reason =>
        reason.error instanceof
          FrameworkSchemaArtifactControlSessionResourceIssue &&
        reason.error.cause === queryFailure
      )).toBe(true);
    }
    expect(events).not.toContain("mixed:query:commit");
    expect(events.at(-1)).toBe("mixed:destroy:settled");
  });

  it("treats a non-COMMIT initial command as uncertain", async () => {
    const events: string[] = [];
    const client = fakePoolClient("initial-command", events, {
      commitCommand: "ROLLBACK",
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await initialDeadline();

    const settlement = await Effect.runPromise(
      driver.runInitialTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          recoveryTimeoutMilliseconds: 1_000,
        },
        restoreInterruptibility,
        () => Effect.succeed("created"),
      ),
    );

    expect(settlement.kind).toBe("uncertain");
    if (settlement.kind === "uncertain") {
      expect(settlement.quarantine.kind).toBe("confirmed");
    }
    expect(events).toContain("initial-command:query:commit");
    expect(events.at(-1)).toBe("initial-command:release:true");
  });

  it("rejects a non-COMMIT recovery command", async () => {
    const events: string[] = [];
    const client = fakePoolClient("recovery-command", events, {
      commitCommand: "ROLLBACK",
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("recovery", 1_000),
    );

    const settlement = await Effect.runPromise(
      driver.runRecoveryTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          excludedConnectionIdentity:
            makeFrameworkSchemaArtifactControlConnectionIdentity(),
        },
        () => Effect.succeed("existing"),
      ),
    );

    expect(settlement.kind).toBe("unresolved");
    if (settlement.kind === "unresolved") {
      expect(settlement.resolution.kind).toBe("lifecycle");
    }
    expect(events).toContain("recovery-command:query:commit");
    expect(events.at(-1)).toBe("recovery-command:release:true");
  });

  it("preserves callback failure when initial rollback is not confirmed", async () => {
    const events: string[] = [];
    const callbackFailure = new Error("callback rejected");
    const client = fakePoolClient("initial-rollback-command", events, {
      rollbackCommand: "COMMIT",
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await initialDeadline();

    const settlement = await Effect.runPromise(
      driver.runInitialTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          recoveryTimeoutMilliseconds: 1_000,
        },
        restoreInterruptibility,
        () => Effect.fail(callbackFailure),
      ),
    );

    expect(settlement.kind).toBe("callbackCleanupFailed");
    if (settlement.kind === "callbackCleanupFailed") {
      expect(Result.getOrThrow(Cause.findError(settlement.callbackCause)))
        .toBe(callbackFailure);
      expect(settlement.cleanupCause.reasons.filter(Cause.isDieReason).some(
        reason => reason.defect instanceof
          FrameworkSchemaArtifactControlSessionCleanupDefect &&
          reason.defect.phase === "rollback",
      )).toBe(true);
    }
    expect(events).toContain("initial-rollback-command:query:rollback");
    expect(events.at(-1)).toBe("initial-rollback-command:release:true");
  });

  it("preserves query failure when recovery rollback is not confirmed", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const queryFailure = new Error("recovery query failed");
    const client = fakePoolClient("recovery-rollback-command", events, {
      delayedQuery: delayed,
      rollbackCommand: "COMMIT",
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("recovery", 1_000),
    );

    const settlementPromise = Effect.runPromise(
      driver.runRecoveryTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          excludedConnectionIdentity:
            makeFrameworkSchemaArtifactControlConnectionIdentity(),
        },
        transaction => Effect.sync(() => {
          void Promise.resolve(
            transaction.execute(sql.raw("select delayed_user_query")),
          ).catch(() => undefined);
          return "existing";
        }),
      ),
    );
    await waitFor(() => events.includes(
      "recovery-rollback-command:query:select delayed_user_query"
    ));
    delayed.reject(queryFailure);
    const settlement = await settlementPromise;

    expect(settlement.kind).toBe("unresolved");
    if (settlement.kind === "unresolved") {
      expect(settlement.resolution.kind).toBe("lifecycle");
      expect(settlement.resolution.cause.reasons
        .filter(Cause.isFailReason)
        .some(reason => reason.error instanceof
          FrameworkSchemaArtifactControlSessionResourceIssue &&
          reason.error.cause === queryFailure)).toBe(true);
      expect(settlement.resolution.cause.reasons
        .filter(Cause.isFailReason)
        .some(reason => reason.error instanceof
          FrameworkSchemaArtifactControlSessionResourceIssue &&
          reason.error.phase === "rollback")).toBe(true);
    }
    expect(events).toContain("recovery-rollback-command:query:rollback");
    expect(events).toContain("recovery-rollback-command:release:true");
    expect(events.at(-1)).toBe("recovery-rollback-command:destroy:settled");
  });

  it("bounds callback cleanup when transaction work cannot settle", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const client = fakePoolClient("callback-stuck", events, {
      delayedQuery: delayed,
      settleDelayedOnDestroy: false,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
      { quarantineDrainTimeoutMilliseconds: 5 },
    );

    const settlement = await Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "initial",
        20,
      );
      const fiber = yield* Effect.forkChild(
        driver.runInitialTransactionEffect(
          {
            deadline,
            lockTimeoutMilliseconds: 20,
            recoveryTimeoutMilliseconds: 20,
          },
          restoreInterruptibility,
          transaction => Effect.sync(() => {
            void Promise.resolve(
              transaction.execute(sql.raw("select delayed_user_query")),
            ).catch(() => undefined);
          }).pipe(Effect.andThen(Effect.never)),
        ),
      );
      while (!events.includes(
        "callback-stuck:query:select delayed_user_query"
      )) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("20 millis");
      while (!events.includes("callback-stuck:release:true")) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("5 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(settlement.kind).toBe("callbackCleanupFailed");
    if (settlement.kind === "callbackCleanupFailed") {
      expect(settlement.cleanupCause.reasons.filter(Cause.isDieReason).some(
        reason => reason.defect instanceof
          FrameworkSchemaArtifactControlSessionCleanupDefect &&
          reason.defect.phase === "quarantine",
      )).toBe(true);
    }
    expect(events.at(-1)).toBe("callback-stuck:release:true");
    delayed.reject(new Error("Test cleanup settled delayed query."));
  });

  it("bounds recovery cleanup when transaction work cannot settle", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const client = fakePoolClient("recovery-stuck", events, {
      delayedQuery: delayed,
      settleDelayedOnDestroy: false,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
      { quarantineDrainTimeoutMilliseconds: 5 },
    );

    const settlement = await Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "recovery",
        20,
      );
      const fiber = yield* Effect.forkChild(
        driver.runRecoveryTransactionEffect(
          {
            deadline,
            lockTimeoutMilliseconds: 20,
            excludedConnectionIdentity:
              makeFrameworkSchemaArtifactControlConnectionIdentity(),
          },
          transaction => Effect.sync(() => {
            void Promise.resolve(
              transaction.execute(sql.raw("select delayed_user_query")),
            ).catch(() => undefined);
          }).pipe(Effect.andThen(Effect.never)),
        ),
      );
      while (!events.includes(
        "recovery-stuck:query:select delayed_user_query"
      )) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("20 millis");
      while (!events.includes("recovery-stuck:release:true")) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("5 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(settlement.kind).toBe("unresolved");
    if (settlement.kind === "unresolved") {
      expect(settlement.resolution.cause.reasons.filter(Cause.isDieReason).some(
        reason => reason.defect instanceof
          FrameworkSchemaArtifactControlSessionCleanupDefect &&
          reason.defect.phase === "quarantine",
      )).toBe(true);
    }
    expect(events.at(-1)).toBe("recovery-stuck:release:true");
    delayed.reject(new Error("Test cleanup settled delayed query."));
  });

  it("maps acquisition expiry and destroys a client delivered after abandonment", async () => {
    const events: string[] = [];
    let pendingConnect: ConnectCallback | undefined;
    const pool: ControlPool = {
      connect(callback) {
        pendingConnect = callback;
        events.push("pool:waiting");
      },
    };
    const client = fakePoolClient("late", events);
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(pool);
    const exit = await Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "read",
        20,
      );
      const fiber = yield* Effect.forkChild(driver.runReadEffect(
        { deadline },
        () => Effect.succeed("unreached"),
      ));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("20 millis");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Result.getOrThrow(Cause.findError(exit.cause));
      expect(failure).toBeInstanceOf(
        FrameworkSchemaArtifactControlSessionResourceIssue,
      );
      if (failure instanceof FrameworkSchemaArtifactControlSessionResourceIssue) {
        expect(failure.phase).toBe("acquire");
        expect(failure.cause).toBeInstanceOf(
          FrameworkSchemaArtifactControlSessionDeadlineIssue,
        );
      }
    }

    expect(pendingConnect).toBeDefined();
    pendingConnect?.(undefined, client, () => undefined);
    expect(events).toEqual([
      "pool:waiting",
      "late:release:true",
    ]);
  });

  it("destroys and drains active work after the operation deadline expires", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const client = fakePoolClient("expired", events, {
      delayedQuery: delayed,
      settleDelayedOnDestroy: false,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );

    let operationSettled = false;
    const exitPromise = Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "read",
        20,
      );
      const fiber = yield* Effect.forkChild(driver.runReadEffect(
        { deadline },
        database => Effect.sync(() => {
          void Promise.resolve(
            database.execute(sql.raw("select delayed_user_query")),
          ).catch(() => undefined);
        }).pipe(Effect.andThen(Effect.never)),
      ));
      while (!events.includes("expired:query:select delayed_user_query")) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("20 millis");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer()))).then(exit => {
      operationSettled = true;
      return exit;
    });

    await waitFor(() => events.includes("expired:release:true"));
    expect(operationSettled).toBe(false);
    events.push("expired:destroy:settled");
    delayed.reject(new Error("Fake client was destroyed."));
    const exit = await exitPromise;

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
    }
    expect(events).toContain("expired:release:true");
    expect(events.at(-1)).toBe("expired:destroy:settled");
  });

  it("preserves read callback finalization while discarding on interruption", async () => {
    const events: string[] = [];
    const finalizerDefect = new Error("read callback finalizer failed");
    const client = fakePoolClient("read-interrupt", events);
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("read", 1_000),
    );
    const controller = new AbortController();

    const exitPromise = Effect.runPromiseExit(driver.runReadEffect(
      { deadline },
      () => Effect.sync(() => {
        events.push("read-work:start");
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Effect.die(finalizerDefect)),
      ),
    ), { signal: controller.signal });
    await waitFor(() => events.includes("read-work:start"));
    controller.abort();
    const exit = await exitPromise;

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(1);
      expect(exit.cause.reasons.filter(Cause.isDieReason).map(
        reason => reason.defect,
      )).toContain(finalizerDefect);
    }
    expect(events.at(-1)).toBe("read-interrupt:release:true");
  });

  it("bounds failed quarantine when destroyed work cannot settle", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const destroyFailure = new Error("destroy failed");
    let lifecycleFaultReads = 0;
    let quarantineTimeoutReads = 0;
    const client = fakePoolClient("stuck", events, {
      delayedQuery: delayed,
      releaseFailure: destroy => destroy ? destroyFailure : undefined,
      settleDelayedOnDestroy: false,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
      {
        get lifecycleFault() {
          lifecycleFaultReads += 1;
          return () => undefined;
        },
        get quarantineDrainTimeoutMilliseconds() {
          quarantineTimeoutReads += 1;
          return quarantineTimeoutReads === 1 ? 5 : 0;
        },
      },
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("read", 1_000),
    );
    const controller = new AbortController();

    const exitPromise = Effect.runPromiseExit(driver.runReadEffect(
      { deadline },
      database => Effect.sync(() => {
        void Promise.resolve(
          database.execute(sql.raw("select delayed_user_query")),
        ).catch(() => undefined);
      }).pipe(Effect.andThen(Effect.never)),
    ), { signal: controller.signal });
    await waitFor(() => events.includes("stuck:query:select delayed_user_query"));
    controller.abort();
    const exit = await exitPromise;

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const cleanupDefect = exit.cause.reasons
        .filter(Cause.isDieReason)
        .map(reason => reason.defect)
        .find(defect => defect instanceof
          FrameworkSchemaArtifactControlSessionCleanupDefect);
      expect(cleanupDefect).toMatchObject({
        phase: "quarantine",
      });
    }
    expect(events.at(-1)).toBe("stuck:release:true");
    expect(lifecycleFaultReads).toBe(1);
    expect(quarantineTimeoutReads).toBe(1);
  });

  it("bounds a stalled authenticated cancellation transport", async () => {
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP cancellation-test listener.");
    }

    try {
      const events: string[] = [];
      const delayed = deferred<FakeQueryResult>();
      const client = fakePoolClient("cancel-stall", events, {
        delayedQuery: delayed,
        emitEndOnDestroy: true,
        runtimeBackendKeyData: { processId: 731, secretKey: -913 },
      });
      const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
        queuedPool([client], events, {
          host: "127.0.0.1",
          port: address.port,
        }),
        { quarantineDrainTimeoutMilliseconds: 20 },
      );
      const deadline = await Effect.runPromise(
        startFrameworkSchemaArtifactControlDeadline("read", 1_000),
      );
      const controller = new AbortController();

      const exitPromise = Effect.runPromiseExit(driver.runReadEffect(
        { deadline },
        database => Effect.sync(() => {
          void Promise.resolve(
            database.execute(sql.raw("select delayed_user_query")),
          ).catch(() => undefined);
        }).pipe(Effect.andThen(Effect.never)),
      ), { signal: controller.signal });
      await waitFor(() => events.includes(
        "cancel-stall:query:select delayed_user_query",
      ));
      controller.abort();
      const exit = await exitPromise;

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cleanupDefect = exit.cause.reasons
          .filter(Cause.isDieReason)
          .map(reason => reason.defect)
          .find(defect => defect instanceof
            FrameworkSchemaArtifactControlSessionCleanupDefect);
        expect(cleanupDefect).toMatchObject({ phase: "quarantine" });
      }
      expect(events).toContain("cancel-stall:release:true");
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error === undefined ? resolve() : reject(error));
      });
    }
  });

  it("maps cancellation connection errors into cleanup failure", async () => {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const address = reservation.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP cancellation-test listener.");
    }
    await new Promise<void>((resolve, reject) => {
      reservation.close(error => error === undefined ? resolve() : reject(error));
    });

    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const client = fakePoolClient("cancel-error", events, {
      delayedQuery: delayed,
      emitEndOnDestroy: true,
      runtimeBackendKeyData: { processId: 947, secretKey: 1_127 },
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events, {
        host: "127.0.0.1",
        port: address.port,
      }),
      { quarantineDrainTimeoutMilliseconds: 500 },
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("read", 1_000),
    );
    const controller = new AbortController();

    const exitPromise = Effect.runPromiseExit(driver.runReadEffect(
      { deadline },
      database => Effect.sync(() => {
        void Promise.resolve(
          database.execute(sql.raw("select delayed_user_query")),
        ).catch(() => undefined);
      }).pipe(Effect.andThen(Effect.never)),
    ), { signal: controller.signal });
    await waitFor(() => events.includes(
      "cancel-error:query:select delayed_user_query",
    ));
    controller.abort();
    const exit = await exitPromise;

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.filter(Cause.isDieReason).some(reason =>
        reason.defect instanceof
          FrameworkSchemaArtifactControlSessionCleanupDefect &&
        reason.defect.phase === "quarantine"
      )).toBe(true);
    }
    expect(events).toContain("cancel-error:release:true");
  });

  it("fails cancellation closed before opening a TLS transport", async () => {
    const events: string[] = [];
    const delayed = deferred<FakeQueryResult>();
    const client = fakePoolClient("cancel-tls", events, {
      delayedQuery: delayed,
      emitEndOnDestroy: true,
      runtimeBackendKeyData: { processId: 1_013, secretKey: -1_219 },
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events, {
        host: "127.0.0.1",
        port: 1,
        ssl: true,
      }),
      { quarantineDrainTimeoutMilliseconds: 500 },
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("read", 1_000),
    );
    const controller = new AbortController();

    const exitPromise = Effect.runPromiseExit(driver.runReadEffect(
      { deadline },
      database => Effect.sync(() => {
        void Promise.resolve(
          database.execute(sql.raw("select delayed_user_query")),
        ).catch(() => undefined);
      }).pipe(Effect.andThen(Effect.never)),
    ), { signal: controller.signal });
    await waitFor(() => events.includes(
      "cancel-tls:query:select delayed_user_query",
    ));
    controller.abort();
    const exit = await exitPromise;

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defects = exit.cause.reasons.filter(Cause.isDieReason).map(
        reason => reason.defect,
      );
      expect(defects.some(defect => defect instanceof
        FrameworkSchemaArtifactControlSessionCleanupDefect &&
        defect.phase === "quarantine"
      )).toBe(true);
      expect(Cause.pretty(exit.cause)).toContain(
        "authenticated cancellation is not enabled for TLS connections",
      );
    }
    expect(events).toContain("cancel-tls:release:true");
  });

  it("destroys a checked-out client when session construction throws", async () => {
    const events: string[] = [];
    const client = fakePoolClient("construction", events);
    Object.defineProperty(client, "on", {
      configurable: true,
      value: () => {
        throw new Error("observer installation failed");
      },
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("read", 1_000),
    );

    const exit = await Effect.runPromiseExit(driver.runReadEffect(
      { deadline },
      () => Effect.succeed("unreached"),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(events).toEqual([
      "pool:acquire:construction",
      "construction:release:true",
    ]);
  });

  it("discards after a failed normal release", async () => {
    const events: string[] = [];
    const releaseCause = new Error("release failed");
    const client = fakePoolClient("read", events, {
      releaseFailure: destroy => destroy ? undefined : releaseCause,
    });
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await Effect.runPromise(
      startFrameworkSchemaArtifactControlDeadline("read", 1_000),
    );

    const exit = await Effect.runPromiseExit(driver.runReadEffect(
      { deadline },
      () => Effect.succeed("value"),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(events.slice(-2)).toEqual([
      "read:release:false",
      "read:release:true",
    ]);
  });

  it("excludes the uncertain physical session before one recovery attempt", async () => {
    const events: string[] = [];
    const first = fakePoolClient("first", events);
    const second = fakePoolClient("second", events);
    let faulted = false;
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([first, first, second], events),
      {
        lifecycleFault: ({ phase, edge, client }) => {
          if (!faulted && client === first && phase === "commit" &&
            edge === "after") {
            faulted = true;
            throw new Error("commit acknowledgement lost");
          }
        },
      },
    );
    const deadline = await initialDeadline();
    const initial = await Effect.runPromise(
      driver.runInitialTransactionEffect(
        {
          deadline,
          lockTimeoutMilliseconds: 700,
          recoveryTimeoutMilliseconds: 1_000,
        },
        restoreInterruptibility,
        () => Effect.succeed("initial"),
      ),
    );
    expect(initial.kind).toBe("uncertain");
    if (initial.kind !== "uncertain") {
      throw new Error("Expected uncertain initial settlement.");
    }
    expect(initial.quarantine.kind).toBe("confirmed");
    if (initial.quarantine.kind !== "confirmed") {
      throw new Error("Expected confirmed initial-session quarantine.");
    }

    const recovered = await Effect.runPromise(
      driver.runRecoveryTransactionEffect(
        {
          deadline: initial.recoveryDeadline,
          lockTimeoutMilliseconds: 700,
          excludedConnectionIdentity:
            initial.quarantine.excludedConnectionIdentity,
        },
        () => Effect.succeed("recovered"),
      ),
    );
    expect(recovered).toEqual({ kind: "committed", value: "recovered" });
    expect(events.filter(event => event === "first:query:begin")).toHaveLength(1);
    expect(events.filter(event => event === "first:release:true")).toHaveLength(2);
    expect(events.filter(event => event === "second:query:begin")).toHaveLength(1);
    expect(events.at(-1)).toBe("second:release:false");
  });

  it("rolls back and releases before preserving callback interruption", async () => {
    const events: string[] = [];
    const finalizerDefect = new Error("callback finalizer failed");
    const client = fakePoolClient("interrupt", events);
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
    );
    const deadline = await initialDeadline();
    const controller = new AbortController();
    const controlDb = Object.freeze({}) as unknown as FlarexMetadataDatabase;
    const starter = makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver,
    });
    const operation = runFrameworkSchemaArtifactControlEffect(
      starter,
      {
        initialDeadline: deadline,
        lockTimeoutMilliseconds: 700,
        recoveryTimeoutMilliseconds: 1_000,
      },
      {
        runLockedEffect: () => Effect.never.pipe(
          Effect.ensuring(Effect.die(finalizerDefect)),
        ),
        resolveExistingEffect: () => Effect.die("unexpected resolution"),
      },
    );
    const exitPromise = Effect.runPromiseExit(operation, {
      signal: controller.signal,
    });
    await waitFor(() => events.some(event =>
      event.includes("set_config('lock_timeout'")));
    controller.abort();
    const exit = await exitPromise;

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(1);
      expect(exit.cause.reasons.filter(Cause.isDieReason).map(
        reason => reason.defect,
      )).toContain(finalizerDefect);
    }
    expect(events.slice(-2)).toEqual([
      "interrupt:query:rollback",
      "interrupt:release:false",
    ]);
  });

  it("preserves callback finalization when the transaction deadline expires", async () => {
    const events: string[] = [];
    const finalizerGate = deferred<void>();
    const finalizerDefect = new Error("deadline callback finalizer failed");
    const client = fakePoolClient("deadline", events);
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([client], events),
      {
        lifecycleFault: ({ phase, edge }) => {
          if (phase === "quarantine" && edge === "after") {
            finalizerGate.resolve(undefined);
          }
        },
      },
    );
    const controlDb = Object.freeze({}) as unknown as FlarexMetadataDatabase;
    const starter = makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver,
    });

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "initial",
        20,
      );
      const fiber = yield* Effect.forkChild(
        runFrameworkSchemaArtifactControlEffect(
          starter,
          {
            initialDeadline: deadline,
            lockTimeoutMilliseconds: 20,
            recoveryTimeoutMilliseconds: 20,
          },
          {
            runLockedEffect: () => Effect.never.pipe(
              Effect.ensuring(Effect.promise(() => finalizerGate.promise).pipe(
                Effect.andThen(Effect.die(finalizerDefect)),
              )),
            ),
            resolveExistingEffect: () => Effect.die("unexpected resolution"),
          },
        ),
      );
      while (!events.some(event =>
        event.includes("set_config('lock_timeout'"))) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("20 millis");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.filter(Cause.isDieReason).map(
        reason => reason.defect,
      )).toContain(finalizerDefect);
      expect(exit.cause.reasons.filter(Cause.isFailReason).some(reason =>
        reason.error instanceof
          FrameworkSchemaArtifactControlSessionResourceIssue &&
        reason.error.cause instanceof
          FrameworkSchemaArtifactControlSessionDeadlineIssue
      )).toBe(true);
    }
    expect(events.at(-1)).toBe("deadline:release:true");
  });

  it("preserves recovery callback finalization when its deadline expires", async () => {
    const events: string[] = [];
    const finalizerGate = deferred<void>();
    const finalizerDefect = new Error("recovery callback finalizer failed");
    const first = fakePoolClient("recovery-first", events);
    const second = fakePoolClient("recovery-second", events);
    let faulted = false;
    const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
      queuedPool([first, second], events),
      {
        lifecycleFault: ({ phase, edge, client }) => {
          if (!faulted && client === first && phase === "commit" &&
            edge === "after") {
            faulted = true;
            throw new Error("commit acknowledgement lost");
          }
          if (client === second && phase === "quarantine" && edge === "after") {
            finalizerGate.resolve(undefined);
          }
        },
      },
    );
    const controlDb = Object.freeze({}) as unknown as FlarexMetadataDatabase;
    const starter = makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver,
    });

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "initial",
        1_000,
      );
      const fiber = yield* Effect.forkChild(
        runFrameworkSchemaArtifactControlEffect(
          starter,
          {
            initialDeadline: deadline,
            lockTimeoutMilliseconds: 20,
            recoveryTimeoutMilliseconds: 20,
          },
          {
            runLockedEffect: (_transaction, attempt) => attempt === "initial"
              ? Effect.succeed(Object.freeze({
                kind: "created" as const,
                value: "initial",
              }))
              : Effect.sync(() => {
                events.push("recovery-work:start");
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.promise(() => finalizerGate.promise).pipe(
                    Effect.andThen(Effect.die(finalizerDefect)),
                  ),
                ),
              ),
            resolveExistingEffect: () => Effect.die("unexpected resolution"),
          },
        ),
      );
      while (!events.includes("recovery-work:start")) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("20 millis");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.filter(Cause.isDieReason).map(
        reason => reason.defect,
      )).toContain(finalizerDefect);
    }
    expect(events.at(-1)).toBe("recovery-second:release:true");
  });
});

describePostgres("PostgreSQL framework artifact control-session server proof", () => {
  it("uses one backend, read committed, positive local budgets, and exact read reset", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL is unavailable.");
    const pool = new Pool({ connectionString: postgresUrl, max: 1 });
    try {
      const baseline = await pool.query<{
        readonly pid: number;
        readonly statementTimeout: string;
      }>(`
        select pg_backend_pid()::int as pid,
               current_setting('statement_timeout') as "statementTimeout"
      `);
      const baselineRow = baseline.rows[0];
      if (baselineRow === undefined) throw new Error("Missing baseline probe.");
      const driver = makePostgresFrameworkSchemaArtifactControlSessionDriver(
        pool,
      );
      const readDeadline = await Effect.runPromise(
        startFrameworkSchemaArtifactControlDeadline("read", 5_000),
      );
      const readProbe = await Effect.runPromise(driver.runReadEffect(
        { deadline: readDeadline },
        postgresProbe,
      ));
      expect(readProbe.pid).toBe(baselineRow.pid);
      expect(readProbe.statementTimeoutMilliseconds).toBeGreaterThan(0);

      const afterRead = await pool.query<{
        readonly pid: number;
        readonly statementTimeout: string;
      }>(`
        select pg_backend_pid()::int as pid,
               current_setting('statement_timeout') as "statementTimeout"
      `);
      expect(afterRead.rows[0]).toEqual(baselineRow);

      const transactionDeadline = await initialDeadline(5_000);
      const settlement = await Effect.runPromise(
        driver.runInitialTransactionEffect(
          {
            deadline: transactionDeadline,
            lockTimeoutMilliseconds: 731,
            recoveryTimeoutMilliseconds: 5_000,
          },
          restoreInterruptibility,
          postgresProbe,
        ),
      );
      expect(settlement.kind).toBe("committed");
      if (settlement.kind === "committed") {
        expect(settlement.value).toMatchObject({
          pid: baselineRow.pid,
          isolation: "read committed",
          lockTimeoutMilliseconds: 731,
        });
        expect(settlement.value.statementTimeoutMilliseconds)
          .toBeGreaterThan(0);
        expect(settlement.value.statementTimeoutMilliseconds)
          .toBeLessThanOrEqual(5_000);
      }
    } finally {
      await pool.end();
    }
  }, 60_000);
});

interface PostgresProbe {
  readonly isolation: string;
  readonly lockTimeoutMilliseconds: number;
  readonly pid: number;
  readonly statementTimeoutMilliseconds: number;
}

function postgresProbe(
  database: FlarexMetadataDatabase,
): Effect.Effect<PostgresProbe, Error, never> {
  return Effect.tryPromise({
    try: () => database.execute(sql<PostgresProbe>`
      select pg_backend_pid()::int as pid,
             current_setting('transaction_isolation') as isolation,
             round(extract(epoch from current_setting('lock_timeout')::interval)
               * 1000)::int as "lockTimeoutMilliseconds",
             round(extract(epoch from current_setting('statement_timeout')::interval)
               * 1000)::int as "statementTimeoutMilliseconds"
    `),
    catch: cause => new Error("PostgreSQL lifecycle probe failed.", { cause }),
  }).pipe(Effect.flatMap(result => {
    const rows = rowsFromDriverExecuteResult(result, () => {
      throw new Error("PostgreSQL lifecycle probe returned no rows wrapper.");
    });
    const row = rows[0];
    if (!isNonArrayRecord(row) || typeof row.pid !== "number" ||
      typeof row.isolation !== "string" ||
      typeof row.lockTimeoutMilliseconds !== "number" ||
      typeof row.statementTimeoutMilliseconds !== "number") {
      return Effect.fail(
        new Error("PostgreSQL lifecycle probe returned an invalid row."),
      );
    }
    return Effect.succeed({
      pid: row.pid,
      isolation: row.isolation,
      lockTimeoutMilliseconds: row.lockTimeoutMilliseconds,
      statementTimeoutMilliseconds: row.statementTimeoutMilliseconds,
    });
  }));
}

async function initialDeadline(timeoutMilliseconds = 1_000) {
  return Effect.runPromise(startFrameworkSchemaArtifactControlDeadline(
    "initial",
    timeoutMilliseconds,
  ));
}

function queuedPool(
  clients: readonly PoolClient[],
  events: string[],
  options?: PoolConfig,
): ControlPool {
  const queue = [...clients];
  return {
    ...(options === undefined ? {} : { options }),
    connect(callback) {
      const client = queue.shift();
      if (client === undefined) {
        callback(new Error("Fake pool has no queued client."), undefined, () => undefined);
        return;
      }
      const name = fakeClientName(client);
      events.push(`pool:acquire:${name}`);
      callback(undefined, client, () => undefined);
    },
  };
}

const fakeClientNames = new WeakMap<PoolClient, string>();

function fakePoolClient(
  name: string,
  events: string[],
  options: FakeClientOptions = {},
): PoolClient {
  const client = new Client();
  if (options.runtimeBackendKeyData !== undefined) {
    Reflect.set(client, "_connected", true);
    Reflect.set(
      client,
      "processID",
      options.runtimeBackendKeyData.processId,
    );
    Reflect.set(
      client,
      "secretKey",
      options.runtimeBackendKeyData.secretKey,
    );
  }
  Object.defineProperty(client, "query", {
    configurable: true,
    value: function (this: unknown, query: unknown, values?: unknown) {
      if (this !== client) {
        return Promise.reject(new Error("Fake query lost its raw client receiver."));
      }
      const text = queryText(query);
      const parameterText = Array.isArray(values) && values.length > 0
        ? `:${values.join(",")}`
        : "";
      events.push(`${name}:query:${text}${parameterText}`);
      if (text === "show statement_timeout") {
        return Promise.resolve(queryResult([{ statement_timeout: "0" }]));
      }
      const delayedQuery = text === "select delayed_user_query"
        ? options.delayedQuery
        : options.namedDelayedQueries?.[text];
      if (delayedQuery !== undefined) {
        return options.useForeignPromise === true
          ? foreignPromiseLike(delayedQuery.promise)
          : delayedQuery.promise;
      }
      const command = text === "commit"
        ? options.commitCommand ?? "COMMIT"
        : text === "rollback"
        ? options.rollbackCommand ?? "ROLLBACK"
        : text === "begin"
        ? "BEGIN"
        : "SELECT";
      return Promise.resolve(queryResult([], command));
    },
  });
  const poolClient = Object.assign(client, {
    release(error?: Error | boolean) {
      const destroy = error === true || error instanceof Error;
      events.push(`${name}:release:${String(destroy)}`);
      const releaseFailure = options.releaseFailure?.(destroy);
      if (releaseFailure !== undefined) throw releaseFailure;
      if (
        destroy &&
        (options.delayedQuery !== undefined ||
          options.namedDelayedQueries !== undefined) &&
        options.settleDelayedOnDestroy !== false
      ) {
        events.push(`${name}:destroy:settled`);
        const cause = new Error("Fake client was destroyed.");
        options.delayedQuery?.reject(cause);
        for (const delayed of Object.values(
          options.namedDelayedQueries ?? {},
        )) {
          delayed.reject(cause);
        }
      }
      if (destroy && options.emitEndOnDestroy === true) {
        queueMicrotask(() => client.emit("end"));
      }
    },
  });
  fakeClientNames.set(poolClient, name);
  return poolClient;
}

function fakeClientName(client: PoolClient): string {
  return fakeClientNames.get(client) ?? "unknown";
}

function queryText(query: unknown): string {
  if (typeof query === "string") return normalizeSql(query);
  if (typeof query !== "object" || query === null) {
    throw new Error("Expected a PostgreSQL query string or config.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(query, "text");
  if (descriptor === undefined || !("value" in descriptor) ||
    typeof descriptor.value !== "string") {
    throw new Error("Expected PostgreSQL query config text.");
  }
  return normalizeSql(descriptor.value);
}

function normalizeSql(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function queryResult(
  rows: readonly QueryResultRow[] = [],
  command = "SELECT",
): FakeQueryResult {
  return {
    command,
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}

function foreignPromiseLike<Value>(promise: Promise<Value>): PromiseLike<Value> {
  return Object.freeze({
    then: promise.then.bind(promise),
  });
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const expiresAt = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= expiresAt) {
      throw new Error("Timed out waiting for fake PostgreSQL lifecycle event.");
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
