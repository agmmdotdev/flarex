import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import type { ClientBase } from "pg";
import { CorePersistenceError } from "../../core/contracts";
import { observePostgresClientErrors } from "../postgresClientLifetime";

export type CoreSqlParameter = string | number | bigint | boolean | Uint8Array | null;

export interface CoreSqlConnection {
  readonly query: (
    statement: string,
    parameters?: readonly CoreSqlParameter[],
  ) => Effect.Effect<readonly unknown[], CorePersistenceError>;
}

/** Physical transport only. No global installation/session protocol is entered. */
export interface CoreSqlDriver extends CoreSqlConnection {
  readonly transaction: <A, E>(
    run: (connection: CoreSqlConnection) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | CorePersistenceError>;
}

function unavailable(cause: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "unavailable", cause });
}

export interface CorePostgresClient extends Pick<ClientBase, "on" | "removeListener"> {
  readonly query: <Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: unknown[],
  ) => Promise<{ readonly rows: readonly Row[] }>;
  readonly release: (failed?: boolean) => void;
}

export interface CorePostgresPool {
  /** Bound SQL with server statement_timeout; a client-side early query timeout
   * is not a settled operation and is outside this transport contract. */
  readonly connect: () => Promise<CorePostgresClient>;
}

function pgConnection(client: CorePostgresClient): CoreSqlConnection {
  return Object.freeze({
    // pg query rejection is the documented foreign operation boundary. Waiting
    // uninterruptibly drains the actual query before the checkout can be reused.
    query: Effect.fn("CorePostgres.query")((statement: string, parameters: readonly CoreSqlParameter[] = []) =>
      Effect.uninterruptible(Effect.tryPromise({
        try: () => client.query<Record<string, unknown>>(statement, [...parameters]),
        catch: unavailable,
      }).pipe(Effect.map(result => result.rows))),
    ),
  });
}

function releasePostgresCheckout(owned: Readonly<{
  client: CorePostgresClient;
  errors: ReturnType<typeof observePostgresClientErrors>;
  quarantine: boolean;
}>) {
  return Effect.sync(() => {
    const failed = owned.quarantine || owned.errors.failure() !== undefined;
    owned.errors.close();
    owned.client.release(failed);
  });
}

/** The caller owns the pool; each operation owns and releases its checkout. */
export function makeCorePostgresDriver(pool: CorePostgresPool): CoreSqlDriver {
  const acquire = Effect.tryPromise({ try: () => pool.connect(), catch: unavailable }).pipe(
    Effect.map(client => ({ client, errors: observePostgresClientErrors(client), quarantine: false })),
  );
  return Object.freeze({
    query: Effect.fn("CorePostgres.read")((statement: string, parameters: readonly CoreSqlParameter[] = []) =>
      Effect.acquireUseRelease(acquire, owned => Effect.gen(function* () {
        const rows = yield* pgConnection(owned.client).query(statement, parameters);
        const failure = owned.errors.failure();
        if (failure !== undefined) return yield* Effect.fail(unavailable(failure));
        return rows;
      }), releasePostgresCheckout),
    ),
    transaction: <A, E>(run: (connection: CoreSqlConnection) => Effect.Effect<A, E>) =>
      Effect.acquireUseRelease(acquire, owned => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const connection = pgConnection(owned.client);
        const began = yield* Effect.exit(connection.query("BEGIN"));
        if (Exit.isFailure(began)) {
          const rollback = yield* Effect.exit(connection.query("ROLLBACK"));
          if (Exit.isFailure(rollback)) owned.quarantine = true;
          return yield* Effect.failCause(Exit.isFailure(rollback)
            ? Cause.combine(began.cause, rollback.cause) : began.cause);
        }
        const result = yield* Effect.exit(restore(Effect.suspend(() => run(connection))));
        if (Exit.isFailure(result)) {
          const rollback = yield* Effect.exit(connection.query("ROLLBACK"));
          if (Exit.isFailure(rollback)) owned.quarantine = true;
          return yield* Effect.failCause(Exit.isFailure(rollback)
            ? Cause.combine(result.cause, rollback.cause) : result.cause);
        }
        // A failed COMMIT acknowledgement is uncertain even if a later ROLLBACK
        // succeeds: it must be reconciled through the logical outcome owner.
        const committed = yield* Effect.exit(Effect.tryPromise({
          try: () => owned.client.query("COMMIT"),
          catch: cause => new CorePersistenceError({ reason: "uncertainWrite", cause }),
        }));
        if (Exit.isFailure(committed)) {
          const rollback = yield* Effect.exit(connection.query("ROLLBACK"));
          if (Exit.isFailure(rollback)) owned.quarantine = true;
          return yield* Effect.failCause(Exit.isFailure(rollback)
            ? Cause.combine(committed.cause, rollback.cause) : committed.cause);
        }
        const failure = owned.errors.failure();
        if (failure !== undefined) return yield* Effect.fail(new CorePersistenceError({
          reason: "uncertainWrite", cause: failure,
        }));
        return result.value;
      })), releasePostgresCheckout),
  });
}

export interface CorePGliteConnection {
  readonly query: (
    statement: string,
    parameters?: unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export interface CorePGliteClient extends CorePGliteConnection {
  readonly transaction: <A>(run: (connection: CorePGliteConnection) => Promise<A>) => Promise<A>;
}

function pgliteConnection(client: CorePGliteConnection): CoreSqlConnection {
  return Object.freeze({
    query: Effect.fn("CorePGlite.query")((statement: string, parameters: readonly CoreSqlParameter[] = []) =>
      Effect.uninterruptible(Effect.tryPromise({
        try: () => client.query(statement, [...parameters]),
        catch: unavailable,
      }).pipe(Effect.map(result => result.rows))),
    ),
  });
}

/** PGlite's transaction callback owns serialization of its single backend. */
export function makeCorePGliteDriver(client: CorePGliteClient): CoreSqlDriver {
  return Object.freeze({
    ...pgliteConnection(client),
    transaction: <A, E>(run: (connection: CoreSqlConnection) => Effect.Effect<A, E>): Effect.Effect<A, E | CorePersistenceError> =>
      Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const connection = yield* Deferred.make<CoreSqlConnection, CorePersistenceError>();
        const commitPermission = yield* Deferred.make<boolean>();
        const settlement = yield* Deferred.make<Exit.Exit<void, E | CorePersistenceError>>();
        // The body is a real supervised child: it inherits Context, Clock,
        // tracing and scheduler, and its factory throws remain defects. Only
        // individual physical queries and final settlement are masked.
        const body = yield* Effect.forkChild(restore(Deferred.await(connection).pipe(
          Effect.flatMap(current => Effect.suspend(() => run(current))),
        )));
        const aborted = new Error("Core PGlite transaction callback refused");
        let callbackFailure: Cause.Cause<E | CorePersistenceError> | undefined;
        let callbackSucceeded = false;
        let deniedForInterruption = false;
        // This foreign-callback runner only bridges owned latches and observes
        // the supervised child; it never executes a detached user callback.
        void Promise.resolve().then(() => client.transaction(async current => {
          const observed = await Effect.runPromiseWith(context)(Effect.gen(function* () {
            yield* Deferred.succeed(connection, pgliteConnection(current));
            const result = yield* Fiber.await(body);
            const permitted = yield* Deferred.await(commitPermission);
            return { result, permitted };
          }));
          if (Exit.isFailure(observed.result)) callbackFailure = observed.result.cause;
          if (!observed.permitted || callbackFailure !== undefined) {
            deniedForInterruption = !observed.permitted;
            throw aborted;
          }
          callbackSucceeded = true;
        })).then(
          () => Exit.succeed(undefined),
          cause => {
            const failure = new CorePersistenceError({
              reason: callbackSucceeded ? "uncertainWrite" : "unavailable", cause,
            });
            // A BEGIN/queue failure before the callback must wake the body too.
            // This is the actual low-level foreign completion edge.
            Deferred.doneUnsafe(connection, Effect.fail(failure));
            if (callbackFailure !== undefined) return Exit.failCause(cause === aborted
              ? callbackFailure : Cause.combine(callbackFailure, Cause.fail(failure)));
            if (deniedForInterruption && cause === aborted) return Exit.succeed(undefined);
            return Exit.fail(failure);
          },
        ).then(
          outcome => { Deferred.doneUnsafe(settlement, Effect.succeed(outcome)); },
          defect => {
            // This is an unexpected defect in the completion handler, after
            // the foreign transaction settled. Wake both owned waiters without
            // reclassifying an implementation bug as a provider failure.
            Deferred.doneUnsafe(connection, Effect.die(defect));
            Deferred.doneUnsafe(settlement, Effect.die(defect));
          },
        );
        const waited = yield* Effect.exit(restore(Fiber.await(body)));
        if (Exit.isFailure(waited)) {
          yield* Fiber.interrupt(body);
          yield* Deferred.succeed(commitPermission, false);
          const outcome = yield* Effect.exit(Deferred.await(settlement).pipe(Effect.flatten));
          return yield* Effect.failCause(Exit.isFailure(outcome)
            ? Cause.combine(waited.cause, outcome.cause) : waited.cause);
        }
        // The parent has accepted the body result under its settlement mask.
        // Cancellation before this point cannot race a foreign callback into
        // COMMIT; cancellation after it waits for real COMMIT/rollback drain.
        yield* Deferred.succeed(commitPermission, true);
        const outcome = yield* Effect.exit(Deferred.await(settlement).pipe(Effect.flatten));
        if (Exit.isFailure(outcome)) return yield* Effect.failCause(outcome.cause);
        if (Exit.isFailure(waited.value)) return yield* Effect.failCause(waited.value.cause);
        return waited.value.value;
      })),
  });
}
