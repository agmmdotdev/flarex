import { sql } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import type { PGliteFlarexPersistence } from "../src/pglite";
import { makePGliteFrameworkMigrationTargetEffect } from
  "../src/migrationCoordination/pgliteTarget";
import {
  FrameworkMigrationDecisionUncertainIssue,
  FrameworkMigrationSessionResourceIssue,
  FrameworkMigrationTargetCompositionError,
  frameworkMigrationTargetSnapshot,
  frameworkMigrationTransactionSessionIdentity,
  makeFrameworkMigrationSessionDriver,
  makeFrameworkMigrationTargetEffect,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
  type FrameworkMigrationDriverTransactionRequest,
  type FrameworkMigrationSessionIdentity,
  type FrameworkMigrationSessionDriver,
  type FrameworkMigrationTarget,
  type FrameworkMigrationTransactionRequest,
  type FrameworkMigrationTransaction,
  type RunFrameworkMigrationDriverTransaction,
} from "../src/migrationCoordination/targetSession";
import type { ScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 30_000;
const PHYSICAL_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "framework-target-session-db",
  schemaName: "public",
} satisfies ScopePhysicalLocator);
const ORDINARY_REQUEST = Object.freeze({
  kind: "ordinary",
  lockTimeoutMilliseconds: 1_250,
  statementTimeoutMilliseconds: 8_500,
} as const);

type PGliteDatabase = PGliteFlarexPersistence["drizzle"];

interface ProbeSqlFailure {
  readonly _tag: "ProbeSqlFailure";
  readonly cause: unknown;
}

const executeProbeSqlEffect = Effect.fn(
  "FrameworkCoordinatorTargetSessionTest.executeSql",
)(
  (
    transaction: FlarexMetadataTransaction,
    statement: string,
  ): Effect.Effect<unknown, ProbeSqlFailure> => Effect.tryPromise({
    try: () => transaction.execute(sql.raw(statement)),
    catch: cause => Object.freeze({
      _tag: "ProbeSqlFailure",
      cause,
    } satisfies ProbeSqlFailure),
  }),
);

describe("private framework migration target sessions", () => {
  it("keeps target, session, and PGlite composition capabilities source-private", async () => {
    expect("makeFrameworkMigrationTargetEffect" in persistenceRoot).toBe(false);
    expect(
      "runFrameworkMigrationTargetTransactionEffect" in persistenceRoot,
    ).toBe(false);
    expect("withFrameworkMigrationRawTransactionEffect" in persistenceRoot)
      .toBe(false);
    expect("makePGliteFrameworkMigrationTargetEffect" in persistenceRoot)
      .toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const exportedPaths = Object.values(packageJson.default.exports);
    expect(exportedPaths).not.toContain(
      "./src/migrationCoordination/targetSession.ts",
    );
    expect(exportedPaths).not.toContain(
      "./src/migrationCoordination/pgliteTarget.ts",
    );
  });

  it("captures an opaque target snapshot and rejects a conflicting database identity", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const database = persistence.drizzle;
    const driver = makeFrameworkMigrationSessionDriver(
      database,
      unexpectedDriverTransaction,
    );
    const targetInputReads = {
      database: 0,
      driver: 0,
      deploymentId: 0,
      databaseIdentity: 0,
      physicalLocator: 0,
      locatorKind: 0,
      locatorDatabaseKey: 0,
      locatorSchemaName: 0,
    };
    const accessorLocator = {
      get kind(): "shared_database" {
        targetInputReads.locatorKind += 1;
        return "shared_database";
      },
      get databaseKey(): string {
        targetInputReads.locatorDatabaseKey += 1;
        return PHYSICAL_LOCATOR.databaseKey;
      },
      get schemaName(): string {
        targetInputReads.locatorSchemaName += 1;
        return PHYSICAL_LOCATOR.schemaName;
      },
    } satisfies ScopePhysicalLocator;
    const target = await runEffect(makeFrameworkMigrationTargetEffect({
      get database(): FlarexMetadataDatabase {
        targetInputReads.database += 1;
        return database;
      },
      get driver(): FrameworkMigrationSessionDriver {
        targetInputReads.driver += 1;
        return driver;
      },
      get deploymentId(): string {
        targetInputReads.deploymentId += 1;
        return "target-snapshot-deployment";
      },
      get canonicalPhysicalDatabaseIdentity(): string {
        targetInputReads.databaseIdentity += 1;
        return "pglite://target-snapshot";
      },
      get physicalLocator(): ScopePhysicalLocator {
        targetInputReads.physicalLocator += 1;
        return accessorLocator;
      },
    }));

    expect(targetInputReads).toEqual({
      database: 1,
      driver: 1,
      deploymentId: 1,
      databaseIdentity: 1,
      physicalLocator: 1,
      locatorKind: 1,
      locatorDatabaseKey: 1,
      locatorSchemaName: 1,
    });

    const snapshot = frameworkMigrationTargetSnapshot(target);
    expect(snapshot).toMatchObject({
      capability: "postgres-transactional-relational-structure",
      physicalLocator: PHYSICAL_LOCATOR,
      namespace: {
        frame: {
          deploymentId: "target-snapshot-deployment",
          physicalDatabaseIdentity: "pglite://target-snapshot",
          schemaName: "public",
        },
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.physicalLocator)).toBe(true);
    expect(snapshot?.physicalLocator).not.toBe(accessorLocator);

    const conflict = await runEffectFailure(makeFrameworkMigrationTargetEffect({
      database,
      driver,
      deploymentId: "target-snapshot-deployment",
      canonicalPhysicalDatabaseIdentity: "pglite://different-database",
      physicalLocator: PHYSICAL_LOCATOR,
    }));
    expect(conflict).toMatchObject({
      _tag: "FrameworkMigrationTargetCompositionError",
      reason: "databaseIdentityConflict",
    } satisfies Partial<FrameworkMigrationTargetCompositionError>);

    const differentlyBoundDriver = makeFrameworkMigrationSessionDriver(
      new Proxy(database, {}),
      unexpectedDriverTransaction,
    );
    const invalidDriver = await runEffectFailure(
      makeFrameworkMigrationTargetEffect({
        database,
        driver: differentlyBoundDriver,
        deploymentId: "target-snapshot-deployment",
        canonicalPhysicalDatabaseIdentity: "pglite://target-snapshot",
        physicalLocator: PHYSICAL_LOCATOR,
      }),
    );
    expect(invalidDriver).toMatchObject({
      _tag: "FrameworkMigrationTargetCompositionError",
      reason: "invalidDriver",
    } satisfies Partial<FrameworkMigrationTargetCompositionError>);
    expect(frameworkMigrationTargetSnapshot(target)).toEqual(snapshot);
  }, PGLITE_TEST_TIMEOUT);

  it("allows exactly one of two concurrent conflicting database identities", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const database = persistence.drizzle;
    const driver = makeFrameworkMigrationSessionDriver(
      database,
      unexpectedDriverTransaction,
    );
    const [left, right] = await Promise.all([
      runEffect(Effect.exit(makeFrameworkMigrationTargetEffect({
        database,
        driver,
        deploymentId: "concurrent-target-deployment",
        canonicalPhysicalDatabaseIdentity: "pglite://concurrent-left",
        physicalLocator: PHYSICAL_LOCATOR,
      }))),
      runEffect(Effect.exit(makeFrameworkMigrationTargetEffect({
        database,
        driver,
        deploymentId: "concurrent-target-deployment",
        canonicalPhysicalDatabaseIdentity: "pglite://concurrent-right",
        physicalLocator: PHYSICAL_LOCATOR,
      }))),
    ]);
    const exits = [left, right] as const;
    const successes = exits.filter(Exit.isSuccess);
    const conflicts = exits.flatMap(exit => Exit.isFailure(exit)
      ? typedFailures(exit.cause).filter(
        failure => failure instanceof FrameworkMigrationTargetCompositionError &&
          failure.reason === "databaseIdentityConflict",
      )
      : []);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
  }, PGLITE_TEST_TIMEOUT);

  it("forwards budgets and recovery exclusion through fresh, bounded session authorities", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const database = persistence.drizzle;
    const rawTransaction = await database.transaction(
      async transaction => transaction,
    );
    const requests: FrameworkMigrationDriverTransactionRequest[] = [];
    const runTransactionEffect: RunFrameworkMigrationDriverTransaction =
      (request, work) => Effect.suspend(() => {
        requests.push(request);
        return work(rawTransaction);
      });
    const driver = makeFrameworkMigrationSessionDriver(
      database,
      runTransactionEffect,
    );
    const target = await makeTarget(
      database,
      driver,
      "session-deployment",
      "pglite://session-authority",
    );
    const otherTarget = await makeTarget(
      database,
      driver,
      "other-session-deployment",
      "pglite://session-authority",
    );
    const ordinaryRequestReads = {
      kind: 0,
      lockTimeout: 0,
      statementTimeout: 0,
    };
    const ordinaryRequest = {
      get kind(): "ordinary" {
        ordinaryRequestReads.kind += 1;
        return "ordinary";
      },
      get lockTimeoutMilliseconds(): number {
        ordinaryRequestReads.lockTimeout += 1;
        return ORDINARY_REQUEST.lockTimeoutMilliseconds;
      },
      get statementTimeoutMilliseconds(): number {
        ordinaryRequestReads.statementTimeout += 1;
        return ORDINARY_REQUEST.statementTimeoutMilliseconds;
      },
    } satisfies FrameworkMigrationTransactionRequest;

    const first = await runEffect(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ordinaryRequest,
        (transaction, sessionIdentity) =>
          withFrameworkMigrationRawTransactionEffect(
            transaction,
            target,
            observedRawTransaction => Effect.succeed(Object.freeze({
              transaction,
              sessionIdentity,
              activeSessionIdentity:
                frameworkMigrationTransactionSessionIdentity(transaction),
              rawTransactionMatches:
                observedRawTransaction === rawTransaction,
            })),
          ),
      ),
    );
    expect(first.activeSessionIdentity).toBe(first.sessionIdentity);
    expect(first.rawTransactionMatches).toBe(true);
    expect(ordinaryRequestReads).toEqual({
      kind: 1,
      lockTimeout: 1,
      statementTimeout: 1,
    });
    expect(frameworkMigrationTransactionSessionIdentity(first.transaction))
      .toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests.at(0)).toMatchObject({
      kind: "ordinary",
      lockTimeoutMilliseconds: 1_250,
      statementTimeoutMilliseconds: 8_500,
      sessionIdentity: first.sessionIdentity,
      excludedSessionIdentity: null,
    });
    expect(Object.isFrozen(requests.at(0))).toBe(true);

    const recoveryRequestReads = {
      kind: 0,
      lockTimeout: 0,
      statementTimeout: 0,
      excludedSession: 0,
    };
    const recoveryRequest = {
      get kind(): "recovery" {
        recoveryRequestReads.kind += 1;
        return "recovery";
      },
      get lockTimeoutMilliseconds(): number {
        recoveryRequestReads.lockTimeout += 1;
        return 2_500;
      },
      get statementTimeoutMilliseconds(): number {
        recoveryRequestReads.statementTimeout += 1;
        return 9_750;
      },
      get excludedSessionIdentity(): FrameworkMigrationSessionIdentity {
        recoveryRequestReads.excludedSession += 1;
        return first.sessionIdentity;
      },
    } satisfies FrameworkMigrationTransactionRequest;
    const second = await runEffect(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        recoveryRequest,
        (transaction, sessionIdentity) => Effect.succeed(Object.freeze({
          transaction,
          sessionIdentity,
        })),
      ),
    );
    expect(second.sessionIdentity).not.toBe(first.sessionIdentity);
    expect(recoveryRequestReads).toEqual({
      kind: 1,
      lockTimeout: 1,
      statementTimeout: 1,
      excludedSession: 1,
    });
    expect(requests).toHaveLength(2);
    expect(requests.at(1)).toMatchObject({
      kind: "recovery",
      lockTimeoutMilliseconds: 2_500,
      statementTimeoutMilliseconds: 9_750,
      sessionIdentity: second.sessionIdentity,
      excludedSessionIdentity: first.sessionIdentity,
    });

    let crossTargetWorkInvoked = false;
    const crossTarget = await runEffect(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        transaction => Effect.exit(
          withFrameworkMigrationRawTransactionEffect(
            transaction,
            otherTarget,
            () => Effect.sync(() => {
              crossTargetWorkInvoked = true;
            }),
          ),
        ),
      ),
    );
    expectCompositionFailure(crossTarget, "targetMismatch");
    expect(crossTargetWorkInvoked).toBe(false);

    const closed = await runEffect(Effect.exit(
      withFrameworkMigrationRawTransactionEffect(
        first.transaction,
        target,
        () => Effect.die("closed transaction callback must not run"),
      ),
    ));
    expectCompositionFailure(closed, "targetMismatch");

    // This adversarial assertion deliberately bypasses the compile-time brand
    // so the WeakMap-backed runtime capability boundary is exercised.
    const forgedTransaction = Object.freeze({}) as FrameworkMigrationTransaction;
    const forged = await runEffect(Effect.exit(
      withFrameworkMigrationRawTransactionEffect(
        forgedTransaction,
        target,
        () => Effect.die("forged transaction callback must not run"),
      ),
    ));
    expectCompositionFailure(forged, "targetMismatch");

    const wrongExclusion = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        otherTarget,
        {
          kind: "recovery",
          lockTimeoutMilliseconds: 1_000,
          statementTimeoutMilliseconds: 2_000,
          excludedSessionIdentity: first.sessionIdentity,
        },
        () => Effect.die("cross-target recovery callback must not run"),
      ),
    );
    expect(wrongExclusion).toMatchObject({
      _tag: "FrameworkMigrationTargetCompositionError",
      reason: "sessionMismatch",
    } satisfies Partial<FrameworkMigrationTargetCompositionError>);

    const invalidBudget = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        {
          kind: "ordinary",
          lockTimeoutMilliseconds: 0,
          statementTimeoutMilliseconds: 1_000,
        },
        () => Effect.die("invalid-budget callback must not run"),
      ),
    );
    expect(invalidBudget).toMatchObject({
      _tag: "FrameworkMigrationTargetCompositionError",
      reason: "invalidInput",
    } satisfies Partial<FrameworkMigrationTargetCompositionError>);
    expect(requests).toHaveLength(3);

    const callbackDefect = new Error("synchronous callback construction defect");
    let defectTransaction: FrameworkMigrationTransaction | undefined;
    const synchronousThrow = await runEffect(Effect.exit(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        transaction => {
          defectTransaction = transaction;
          throw callbackDefect;
        },
      ),
    ));
    expect(Exit.isFailure(synchronousThrow)).toBe(true);
    if (Exit.isFailure(synchronousThrow)) {
      expect(
        synchronousThrow.cause.reasons
          .filter(Cause.isDieReason)
          .map(reason => reason.defect),
      ).toContain(callbackDefect);
    }
    expect(requests).toHaveLength(4);
    expect(defectTransaction).toBeDefined();
    if (defectTransaction === undefined) {
      throw new Error("synchronous callback did not receive a transaction");
    }
    expect(frameworkMigrationTransactionSessionIdentity(defectTransaction))
      .toBeUndefined();
    const closedAfterDefect = await runEffect(Effect.exit(
      withFrameworkMigrationRawTransactionEffect(
        defectTransaction,
        target,
        () => Effect.die("defect-closed transaction callback must not run"),
      ),
    ));
    expectCompositionFailure(closedAfterDefect, "targetMismatch");
  }, PGLITE_TEST_TIMEOUT);

  it("commits successful PGlite work and rolls back the full typed callback failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await persistence.drizzle.execute(sql.raw(
      "create table framework_target_session_probe (value text primary key)",
    ));
    const target = await makePGliteTarget(
      persistence.drizzle,
      "pglite://commit-and-rollback",
    );

    await runEffect(runFrameworkMigrationTargetTransactionEffect(
      target,
      ORDINARY_REQUEST,
      transaction => withFrameworkMigrationRawTransactionEffect(
        transaction,
        target,
        rawTransaction => executeProbeSqlEffect(
          rawTransaction,
          "insert into framework_target_session_probe (value) values ('committed')",
        ),
      ),
    ));

    const callbackFailure = Object.freeze({
      _tag: "DeliberateTargetSessionCallbackFailure",
    } as const);
    const rollbackExit = await runEffect(Effect.exit(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        transaction => withFrameworkMigrationRawTransactionEffect(
          transaction,
          target,
          rawTransaction => executeProbeSqlEffect(
            rawTransaction,
            "insert into framework_target_session_probe (value) values ('rolled-back')",
          ).pipe(Effect.flatMap(() => Effect.fail(callbackFailure))),
        ),
      ),
    ));
    expect(Exit.isFailure(rollbackExit)).toBe(true);
    if (Exit.isFailure(rollbackExit)) {
      expect(typedFailures(rollbackExit.cause)).toContain(callbackFailure);
    }

    const stored = await persistence.drizzle.execute<{ readonly value: string }>(
      sql.raw(
        "select value from framework_target_session_probe order by value",
      ),
    );
    expect(stored.rows).toEqual([{ value: "committed" }]);
  }, PGLITE_TEST_TIMEOUT);

  it("maps a synchronous transaction-construction throw to begin-or-configure failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const beginCause = new Error("synchronous begin failure");
    const beginFailureTransaction: typeof persistence.drizzle.transaction =
      () => {
        throw beginCause;
      };
    const database = replaceTransaction(
      persistence.drizzle,
      beginFailureTransaction,
    );
    const target = await makePGliteTarget(
      database,
      "pglite://synchronous-begin-failure",
    );
    let callbackInvoked = false;

    const exit = await runEffect(Effect.exit(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        () => Effect.sync(() => {
          callbackInvoked = true;
        }),
      ),
    ));
    const resourceIssue = findFailure(
      exit,
      FrameworkMigrationSessionResourceIssue,
    );
    expect(resourceIssue).toMatchObject({ phase: "beginOrConfigure" });
    expect(resourceIssue?.cause).toBe(beginCause);
    expect(callbackInvoked).toBe(false);
  }, PGLITE_TEST_TIMEOUT);

  it("maps a synchronous configuration-statement throw to begin-or-configure failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const configurationCause = new Error("synchronous configuration failure");
    const configurationFailureTransaction:
      typeof persistence.drizzle.transaction = (transaction, config) =>
        persistence.drizzle.transaction(
          rawTransaction => transaction(replaceExecuteWithFailure(
            rawTransaction,
            configurationCause,
          )),
          config,
        );
    const database = replaceTransaction(
      persistence.drizzle,
      configurationFailureTransaction,
    );
    const target = await makePGliteTarget(
      database,
      "pglite://synchronous-configuration-failure",
    );
    let callbackInvoked = false;

    const exit = await runEffect(Effect.exit(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        () => Effect.sync(() => {
          callbackInvoked = true;
        }),
      ),
    ));
    const resourceIssue = findFailure(
      exit,
      FrameworkMigrationSessionResourceIssue,
    );
    expect(resourceIssue).toMatchObject({ phase: "beginOrConfigure" });
    expect(resourceIssue?.cause).toBe(configurationCause);
    expect(callbackInvoked).toBe(false);
  }, PGLITE_TEST_TIMEOUT);

  it("combines the original callback Cause with rollback-or-cleanup failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const cleanupCause = new Error("rollback settlement failed");
    const cleanupFailureTransaction: typeof persistence.drizzle.transaction =
      async (transaction, config) => {
        try {
          return await persistence.drizzle.transaction(transaction, config);
        } catch {
          throw cleanupCause;
        }
      };
    const database = replaceTransaction(
      persistence.drizzle,
      cleanupFailureTransaction,
    );
    const target = await makePGliteTarget(
      database,
      "pglite://rollback-cleanup-failure",
    );
    const callbackFailure = Object.freeze({
      _tag: "DeliberateRollbackCallbackFailure",
    } as const);

    const exit = await runEffect(Effect.exit(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        () => Effect.fail(callbackFailure),
      ),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures = typedFailures(exit.cause);
      expect(failures).toContain(callbackFailure);
      const resourceIssue = failures.find(
        (failure): failure is FrameworkMigrationSessionResourceIssue =>
          failure instanceof FrameworkMigrationSessionResourceIssue,
      );
      expect(resourceIssue).toMatchObject({ phase: "rollbackOrCleanup" });
      expect(resourceIssue?.cause).toBe(cleanupCause);
      expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
    }
  }, PGLITE_TEST_TIMEOUT);

  it("classifies a post-callback settlement rejection as decision-uncertain", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const settlementCause = new Error("commit acknowledgement lost");
    const uncertainTransaction: typeof persistence.drizzle.transaction =
      async (transaction, config) => {
        await persistence.drizzle.transaction(transaction, config);
        throw settlementCause;
      };
    const database = replaceTransaction(
      persistence.drizzle,
      uncertainTransaction,
    );
    const target = await makePGliteTarget(
      database,
      "pglite://decision-uncertain",
    );
    let callbackSession: FrameworkMigrationSessionIdentity | undefined;

    const exit = await runEffect(Effect.exit(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        ORDINARY_REQUEST,
        (_transaction, sessionIdentity) => Effect.sync(() => {
          callbackSession = sessionIdentity;
          return sessionIdentity;
        }),
      ),
    ));
    const uncertain = findFailure(
      exit,
      FrameworkMigrationDecisionUncertainIssue,
    );
    expect(uncertain?.cause).toBe(settlementCause);
    expect(callbackSession).toBeDefined();
    expect(uncertain?.sessionIdentity).toBe(callbackSession);
  }, PGLITE_TEST_TIMEOUT);
});

const unexpectedDriverTransaction: RunFrameworkMigrationDriverTransaction =
  () => Effect.die("framework migration driver must not run");

function makeTarget(
  database: FlarexMetadataDatabase,
  driver: FrameworkMigrationSessionDriver,
  deploymentId: string,
  physicalDatabaseIdentity: string,
): Promise<FrameworkMigrationTarget> {
  return runEffect(makeFrameworkMigrationTargetEffect({
    database,
    driver,
    deploymentId,
    canonicalPhysicalDatabaseIdentity: physicalDatabaseIdentity,
    physicalLocator: PHYSICAL_LOCATOR,
  }));
}

function makePGliteTarget(
  database: PGliteDatabase,
  physicalDatabaseIdentity: string,
): Promise<FrameworkMigrationTarget> {
  return runEffect(makePGliteFrameworkMigrationTargetEffect({
    persistence: { drizzle: database },
    deploymentId: "pglite-target-session-deployment",
    canonicalPhysicalDatabaseIdentity: physicalDatabaseIdentity,
    physicalLocator: PHYSICAL_LOCATOR,
  }));
}

function replaceTransaction<Database extends FlarexMetadataDatabase>(
  database: Database,
  transaction: Database["transaction"],
): Database {
  return new Proxy(database, {
    get: (target, property, receiver) => property === "transaction"
      ? transaction
      : Reflect.get(target, property, receiver),
  });
}

function replaceExecuteWithFailure<
  Transaction extends FlarexMetadataTransaction,
>(
  transaction: Transaction,
  cause: unknown,
): Transaction {
  return new Proxy(transaction, {
    get: (target, property, receiver) => property === "execute"
      ? () => {
        throw cause;
      }
      : Reflect.get(target, property, receiver),
  });
}

function typedFailures<Failure>(cause: Cause.Cause<Failure>): Failure[] {
  return cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
}

function expectCompositionFailure(
  exit: Exit.Exit<unknown, unknown>,
  reason: FrameworkMigrationTargetCompositionError["reason"],
): void {
  const failure = findFailure(exit, FrameworkMigrationTargetCompositionError);
  expect(failure).toMatchObject({ reason });
}

function findFailure<Failure extends object>(
  exit: Exit.Exit<unknown, unknown>,
  ErrorClass: abstract new (...arguments_: never[]) => Failure,
): Failure | undefined {
  return Exit.isFailure(exit)
    ? typedFailures(exit.cause).find(
      (failure): failure is Failure => failure instanceof ErrorClass,
    )
    : undefined;
}
