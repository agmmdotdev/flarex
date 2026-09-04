import { Cause, Clock, Effect, Exit } from "effect";
import type { Pool, PoolClient } from "pg";

import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { PostgresFlarexPersistence } from "../postgres";
import type { ScopePhysicalLocator } from "../scopeMetadataTypes";
import { makePostgresMigrationConnection, type PostgresMigrationConnection,
  type PostgresMigrationConnectionOptions, type PostgresMigrationPhase } from "./postgresTargetConnection";
import { FrameworkMigrationDecisionUncertainIssue, FrameworkMigrationSessionResourceIssue,
  makeFrameworkMigrationSessionDriver, makeFrameworkMigrationTargetEffect,
  type FrameworkMigrationDriverTransactionRequest, type FrameworkMigrationSessionIdentity,
  type FrameworkMigrationSessionFailure, type RunFrameworkMigrationDriverTransaction } from "./targetSession";

export interface PostgresFrameworkMigrationOptions {
  readonly acquisitionTimeoutMilliseconds?: number;
  readonly transactionTimeoutMilliseconds?: number;
  readonly cleanupTimeoutMilliseconds?: number;
  readonly maximumStatementsPerTransaction?: number;
  readonly observe?: PostgresMigrationConnectionOptions["observe"];
}
export interface MakePostgresFrameworkMigrationTargetInput {
  readonly persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">;
  readonly deploymentId: string;
  readonly canonicalPhysicalDatabaseIdentity: string;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly options?: PostgresFrameworkMigrationOptions;
}

/** Source-private harness composition. The caller owns database/locator identity;
 * this is not a production resolver or an adapter-facing target issuer. */
export const makePostgresFrameworkMigrationTargetEffect = Effect.fn(
  "FrameworkMigrationPostgresTarget.make",
)(function* (input: MakePostgresFrameworkMigrationTargetInput) {
  const options = input.options ?? {};
  const acquisition = options.acquisitionTimeoutMilliseconds ?? 5_000;
  const transaction = options.transactionTimeoutMilliseconds ?? 60_000;
  const cleanup = options.cleanupTimeoutMilliseconds ?? 5_000;
  const statements = options.maximumStatementsPerTransaction ?? 8_192;
  if (!validBudget(acquisition, 60_000) || !validBudget(transaction, 300_000) ||
      !validBudget(cleanup, 60_000) || !validBudget(statements, 65_536)) {
    return yield* Effect.fail(resource("beginOrConfigure", new Error("Invalid PostgreSQL migration lifecycle budget.")));
  }
  const normalized = { acquisition, transaction, cleanup,
    maximumStatementsPerTransaction: statements,
    ...(options.observe === undefined ? {} : { observe: options.observe }),
  };
  return yield* makeFrameworkMigrationTargetEffect({
    database: input.persistence.drizzle,
    driver: makeFrameworkMigrationSessionDriver(input.persistence.drizzle,
      makeRunTransaction(input.persistence.pool, normalized)),
    deploymentId: input.deploymentId,
    canonicalPhysicalDatabaseIdentity: input.canonicalPhysicalDatabaseIdentity,
    physicalLocator: input.physicalLocator,
  });
});

interface Options extends PostgresMigrationConnectionOptions {
  readonly acquisition: number;
  readonly transaction: number;
  readonly cleanup: number;
}

function makeRunTransaction(pool: Pool, options: Options): RunFrameworkMigrationDriverTransaction {
  const backends = new WeakMap<FrameworkMigrationSessionIdentity, PoolClient>();
  return Effect.fn("FrameworkMigrationPostgresTarget.runTransaction")(<Value, Failure>(
    request: FrameworkMigrationDriverTransactionRequest,
    work: (transaction: FlarexMetadataTransaction) => Effect.Effect<Value, Failure, never>,
  ): Effect.Effect<Value, Failure | FrameworkMigrationSessionFailure> =>
    Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      // Acquisition is bounded and masked so ownership cannot be lost between
      // the pool callback and installing cleanup. Abandoned late clients die.
      let connection = yield* acquire(pool, options);
      return yield* Effect.gen(function* () {
      if (request.kind === "recovery") {
        const excluded = backends.get(request.excludedSessionIdentity);
        if (excluded !== undefined && excluded === connection.client) {
          // A commit whose pool-release observer failed may have returned this
          // client. Destroy it, then acquire a physically distinct backend.
          yield* quarantine(connection, options);
          connection = yield* acquire(pool, options);
        }
        if (excluded === undefined || excluded === connection.client) {
          const cleanup = yield* quarantine(connection, options).pipe(Effect.exit);
          return yield* Effect.fail(resource("beginOrConfigure", {
            message: "Recovery requires a known, different physical PostgreSQL connection.", cleanup,
          }));
        }
      }
      backends.set(request.sessionIdentity, connection.client);
      const expiresAt = (yield* Clock.currentTimeMillis) + options.transaction;
      const prepared = yield* Effect.exit(restore(Effect.gen(function* () {
        yield* command(connection, expiresAt, "begin", "begin isolation level read committed", "BEGIN");
        yield* bounded(Effect.tryPromise({
          try: () => connection.query("configure",
            "select set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
            [`${Math.min(request.lockTimeoutMilliseconds, options.transaction)}ms`,
              `${Math.min(request.statementTimeoutMilliseconds, options.transaction)}ms`]),
          catch: cause => resource("beginOrConfigure", cause),
        }), expiresAt, "beginOrConfigure");
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
      // From this point onward a lost response is not evidence of rollback.
      // The coordinator reconstructs durable state on an excluded connection.
      const committed = yield* Effect.exit(command(connection, expiresAt, "commit", "commit", "COMMIT"));
      if (Exit.isFailure(committed)) {
        const cleanup = yield* Effect.exit(quarantine(connection, options));
        return yield* Effect.fail(new FrameworkMigrationDecisionUncertainIssue({
          sessionIdentity: request.sessionIdentity,
          cause: Exit.isFailure(cleanup) ? Cause.combine(committed.cause, cleanup.cause) : committed.cause,
        }));
      }
      const released = yield* Effect.exit(Effect.try({
        try: () => connection.release(false), catch: cause => resource("rollbackOrCleanup", cause),
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
    // Active work is cancelled through authenticated BackendKeyData and drained
    // before destroying its transport. An idle failed transaction can roll back.
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
        yield* Effect.try({ try: () => connection.release(false),
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

const acquire = Effect.fn("FrameworkMigrationPostgresTarget.acquire")(
  (pool: Pool, options: Options) => Effect.callback<PostgresMigrationConnection, FrameworkMigrationSessionResourceIssue>(resume => {
    // oxlint-disable-next-line flarex/no-platform-time-inside-effect -- REVIEW: host - callback-pool acquisition metrics measure real transport latency independently of the Effect clock
    const started = performance.now();
    let completed = false;
    const timer = setTimeout(() => {
      completed = true;
      resume(Effect.fail(resource("acquire", new Error("PostgreSQL migration acquisition deadline expired."))));
    }, options.acquisition);
    try {
      pool.connect((error, client) => {
        if (completed) { if (client !== undefined) discardLateClient(client); return; }
        completed = true;
        clearTimeout(timer);
        if (error !== undefined || client === undefined) {
          if (client !== undefined) client.release(true);
          resume(Effect.fail(resource("acquire", error ?? new Error("PostgreSQL returned no client."))));
          return;
        }
        try {
          options.observe?.({ phase: "acquire", edge: "after", client,
            elapsedMilliseconds: performance.now() - started });
          resume(Effect.succeed(makePostgresMigrationConnection(client, pool.options, options)));
        }
        catch (cause) { client.release(true); resume(Effect.fail(resource("acquire", cause))); }
      });
    } catch (cause) {
      completed = true;
      clearTimeout(timer);
      resume(Effect.fail(resource("acquire", cause)));
    }
  }),
);

function resource(phase: FrameworkMigrationSessionResourceIssue["phase"], cause: unknown) {
  return new FrameworkMigrationSessionResourceIssue({ phase, cause });
}
function validBudget(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function discardLateClient(client: PoolClient): void {
  try { client.release(true); }
  catch {
    // The acquisition caller has already settled. Force the exact transport
    // closed; there is no late Effect failure channel to which it can report.
    // PoolClient intentionally omits Client.end from its published surface.
    const end: unknown = Reflect.get(client, "end");
    if (typeof end === "function") {
      try {
        const ended: unknown = Reflect.apply(end, client, []);
        void Promise.resolve(ended).catch(() => undefined);
      } catch { /* No caller remains to receive late transport cleanup errors. */ }
    }
  }
}
