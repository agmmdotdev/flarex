import { Cause, Clock, Effect, Exit } from "effect";
import { capturePostgresMigrationPolicy, type PostgresMigrationPolicy } from "./policy";
import type { Client, ClientConfig } from "pg";
import type { FlarexMetadataDatabase } from "../../application/deployments";

import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { ScopePhysicalLocator } from "../../scope/scopeMetadataTypes";
import { protectPostgresMigrationTransaction } from "./postgresTargetProtection";
import { makePostgresMigrationConnection, type PostgresMigrationConnection,
  type PostgresMigrationConnectionOptions, type PostgresMigrationPhase } from "./postgresTargetConnection";
import { FrameworkMigrationDecisionUncertainIssue, FrameworkMigrationSessionResourceIssue,
  makeFrameworkMigrationSessionDriver, makeFrameworkMigrationTargetEffect,
  type FrameworkMigrationDriverTransactionRequest,
  type FrameworkMigrationSessionFailure, type RunFrameworkMigrationDriverTransaction } from "./targetSession";

export interface PostgresFrameworkMigrationOptions extends Partial<PostgresMigrationPolicy> {
  readonly observe?: PostgresMigrationConnectionOptions["observe"];
}
/** Only the installation owner composes this source-private execution profile.
 * The dedicated Client is never replaced for in-generation recovery. */
export const makePostgresMaintenanceFrameworkMigrationTargetEffect = Effect.fn(
  "FrameworkMigrationPostgresTarget.makeMaintenance",
)(function* (input: Readonly<{
  database: FlarexMetadataDatabase; client: Client; config: ClientConfig;
  deploymentId: string; canonicalPhysicalDatabaseIdentity: string;
  physicalLocator: ScopePhysicalLocator; options?: PostgresFrameworkMigrationOptions;
  assertOwner: () => Effect.Effect<void, FrameworkMigrationSessionResourceIssue>;
  protectNewTables: () => Effect.Effect<void, FrameworkMigrationSessionResourceIssue>;
  readOnly?: true;
}>) {
  const policy = yield* Effect.fromResult(capturePostgresMigrationPolicy(input.options ?? {})).pipe(
    Effect.mapError(cause => resource("beginOrConfigure", cause)));
  const options: Options = {
    transaction: policy.transactionTimeoutMilliseconds, cleanup: policy.cleanupTimeoutMilliseconds,
    maximumStatementsPerTransaction: policy.maximumStatementsPerTransaction,
    ...(input.readOnly === true ? { readOnly: true } : {}),
    ...(input.options?.observe === undefined ? {} : { observe: input.options.observe }) };
  return yield* makeFrameworkMigrationTargetEffect({ database: input.database,
    driver: makeFrameworkMigrationSessionDriver(input.database, makeRunTransaction(options, input)),
    deploymentId: input.deploymentId,
    canonicalPhysicalDatabaseIdentity: input.canonicalPhysicalDatabaseIdentity,
    physicalLocator: input.physicalLocator });
});

interface Options extends PostgresMigrationConnectionOptions {
  readonly transaction: number;
  readonly cleanup: number;
  readonly readOnly?: true;
}

function makeRunTransaction(options: Options,
  dedicated: Readonly<{ client: Client; config: ClientConfig;
    assertOwner: () => Effect.Effect<void, FrameworkMigrationSessionResourceIssue>;
    protectNewTables: () => Effect.Effect<void, FrameworkMigrationSessionResourceIssue> }>): RunFrameworkMigrationDriverTransaction {
  return Effect.fn("FrameworkMigrationPostgresTarget.runTransaction")(<Value, Failure>(
    request: FrameworkMigrationDriverTransactionRequest,
    work: (transaction: FlarexMetadataTransaction) => Effect.Effect<Value, Failure, never>,
  ): Effect.Effect<Value, Failure | FrameworkMigrationSessionFailure> =>
    Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      if (request.kind === "recovery") return yield* Effect.fail(resource(
        "beginOrConfigure", new Error("Uncertain maintenance settlement requires a successor generation after the predecessor closes.")));
      yield* dedicated.assertOwner();
      const connection = makePostgresMigrationConnection(dedicated.client, dedicated.config, options);
      return yield* Effect.gen(function* () {
      const expiresAt = (yield* Clock.currentTimeMillis) + options.transaction;
      const prepared = yield* Effect.exit(restore(Effect.gen(function* () {
        yield* command(connection, expiresAt, "begin", options.readOnly === true
          ? "begin isolation level read committed read only" : "begin isolation level read committed", "BEGIN");
        yield* bounded(Effect.tryPromise({
          try: () => connection.query("configure",
            "select pg_catalog.set_config('lock_timeout', $1, true), pg_catalog.set_config('statement_timeout', $2, true)",
            [`${Math.min(request.lockTimeoutMilliseconds, options.transaction)}ms`,
              `${Math.min(request.statementTimeoutMilliseconds, options.transaction)}ms`]),
          catch: cause => resource("beginOrConfigure", cause),
        }), expiresAt, "beginOrConfigure");
        yield* dedicated.assertOwner();
        yield* bounded(protectPostgresMigrationTransaction(connection), expiresAt, "beginOrConfigure");
      })));
      if (Exit.isFailure(prepared)) {
        return yield* failWithCleanup(prepared.cause, connection, options);
      }
      const callback = yield* Effect.exit(restore(bounded(
        Effect.suspend(() => work(connection.transaction)), expiresAt, "work",
      )));
      connection.close();
      if (Exit.isFailure(callback)) {
        return yield* failWithCleanup(callback.cause, connection, options);
      }
      // A callback may have launched promises it did not await. Drain them and
      // preserve their failures before any COMMIT can be sent.
      const drained = yield* Effect.exit(bounded(Effect.tryPromise({
        try: connection.drain,
        catch: cause => resource("work", cause),
      }), expiresAt, "work"));
      if (Exit.isFailure(drained)) return yield* failWithCleanup(drained.cause, connection, options);
      const failure = connection.failure();
      if (failure !== undefined) {
        return yield* failWithCleanup(Cause.fail(resource("work", failure.cause)), connection, options);
      }
      {
        const protectedTables = yield* Effect.exit(Effect.gen(function* () {
          yield* dedicated.assertOwner();
          yield* dedicated.protectNewTables();
        }));
        if (Exit.isFailure(protectedTables)) return yield* failWithCleanup(protectedTables.cause, connection, options);
      }
      // From this point onward a lost response is not evidence of rollback.
      // A successor maintenance generation reconstructs the canonical durable state.
      const committed = yield* Effect.exit(command(connection, expiresAt, "commit", "commit", "COMMIT"));
      if (Exit.isFailure(committed)) {
        const cleanup = yield* Effect.exit(quarantine(connection, options));
        return yield* Effect.fail(new FrameworkMigrationDecisionUncertainIssue({
          sessionIdentity: request.sessionIdentity,
          cause: Exit.isFailure(cleanup) ? Cause.combine(committed.cause, cleanup.cause) : committed.cause,
        }));
      }
      const released = yield* Effect.exit(Effect.try({
        try: () => connection.release(), catch: cause => resource("rollbackOrCleanup", cause),
      }));
      if (Exit.isFailure(released)) {
        return yield* Effect.fail(new FrameworkMigrationDecisionUncertainIssue({
          sessionIdentity: request.sessionIdentity, cause: released.cause,
        }));
      }
      return callback.value;
      }).pipe(Effect.onExit(() => connection.isReleased()
        ? Effect.void : quarantine(connection, options)));
    })));
}

const failWithCleanup = Effect.fn("FrameworkMigrationPostgresTarget.failWithCleanup")(
  function* <Failure>(cause: Cause.Cause<Failure>, connection: PostgresMigrationConnection, options: Options):
    Effect.fn.Return<never, Failure | FrameworkMigrationSessionResourceIssue> {
    connection.close();
    // Active work closes its dedicated transport and drains outstanding promises.
    // An idle failed transaction can roll back on the same backend.
    const cleaned = yield* Effect.exit(connection.hasPending()
      ? quarantine(connection, options)
      : Effect.gen(function* () {
        const deadline = (yield* Clock.currentTimeMillis) + options.cleanup;
        const rollback = yield* Effect.exit(command(connection, deadline, "rollback", "rollback", "ROLLBACK"));
        if (Exit.isFailure(rollback)) {
          const discarded = yield* Effect.exit(quarantine(connection, options));
          return yield* Effect.failCause(Exit.isFailure(discarded)
            ? Cause.combine(rollback.cause, discarded.cause) : rollback.cause);
        }
        yield* Effect.try({ try: () => connection.release(),
          catch: error => resource("rollbackOrCleanup", error) });
      }));
    return yield* Effect.failCause(Exit.isFailure(cleaned) ? Cause.combine(cause, cleaned.cause) : cause);
  },
);

const quarantine = Effect.fn("FrameworkMigrationPostgresTarget.quarantine")(
  (connection: PostgresMigrationConnection, options: Options) => Effect.tryPromise({
    try: () => connection.quarantine(options.cleanup),
    catch: cause => resource("rollbackOrCleanup", cause),
  }),
);

const command = Effect.fn("FrameworkMigrationPostgresTarget.command")(
  (connection: PostgresMigrationConnection, deadline: number, phase: PostgresMigrationPhase,
    text: string, expected: string) => bounded(Effect.tryPromise({
    try: () => connection.query(phase, text).then(result => {
      if (result.command !== expected) throw new Error(`Expected ${expected}, received ${result.command}.`);
    }),
    catch: cause => resource(phase === "rollback" ? "rollbackOrCleanup" : "beginOrConfigure", cause),
  }), deadline, phase === "rollback" ? "rollbackOrCleanup" : "beginOrConfigure"),
);

const bounded = Effect.fn("FrameworkMigrationPostgresTarget.bounded")(
  function* <Value, Failure>(effect: Effect.Effect<Value, Failure>, deadline: number,
    phase: FrameworkMigrationSessionResourceIssue["phase"]):
    Effect.fn.Return<Value, Failure | FrameworkMigrationSessionResourceIssue> {
    const remaining = deadline - (yield* Clock.currentTimeMillis);
    const expired = Effect.fail(resource(phase, new Error("PostgreSQL migration transaction deadline expired.")));
    if (remaining <= 0) return yield* expired;
    return yield* Effect.raceFirst(effect, Effect.sleep(remaining).pipe(Effect.andThen(expired)));
  },
);

function resource(phase: FrameworkMigrationSessionResourceIssue["phase"], cause: unknown) {
  return new FrameworkMigrationSessionResourceIssue({ phase, cause });
}
