import type { SQLWrapper } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Data, Effect, Exit } from "effect";

import type {
  FlarexPersistenceTx,
  FlarexSqlClient,
  QueryResult,
} from "./index";
import {
  rowsFromDriver,
  type FlarexRuntimePersistenceTransaction,
} from "./runtimePersistence";
import { flarexSchema } from "./schema";

export interface PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface RunPostgresTransactionOptions {
  onRollbackError?(error: unknown): void;
}

export interface RunPostgresTransactionEffectOptions {
  /**
   * Observe a rollback failure so the connection owner can discard or report
   * the connection without replacing the primary transaction Cause.
   */
  onRollbackError(error: unknown): void;
}

export class PostgresTransactionBeginError extends Data.TaggedError(
  "PostgresTransactionBeginError",
)<{
  readonly cause: unknown;
}> {}

export class PostgresTransactionCommitError extends Data.TaggedError(
  "PostgresTransactionCommitError",
)<{
  readonly cause: unknown;
}> {}

class PostgresTransactionPromiseCallbackError extends Data.TaggedError(
  "PostgresTransactionPromiseCallbackError",
)<{
  readonly cause: unknown;
}> {}

export function createPostgresSqlClient(
  database: NodePgDatabase<typeof flarexSchema>,
  client: PostgresQueryClient,
): FlarexSqlClient {
  return {
    async execute<Row extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): Promise<QueryResult<Row>> {
      const result = await database.execute<Row>(query);
      return { rows: rowsFromDriver<Row>(result.rows) };
    },
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<Row>> {
      const result = await client.query<Row>(
        sql,
        params === undefined ? [] : [...params],
      );
      return { rows: result.rows };
    },
  };
}

/**
 * Effect-native transaction demarcation for an already-connected client.
 *
 * The callback is interruptible, but BEGIN, COMMIT, and rollback settlement
 * are not. A callback failure, defect, or interruption remains authoritative;
 * rollback failure is reported only through the secondary observer. Query
 * timeout and connection-abort policy belong to the connection owner: this
 * adapter must not return while a driver operation has an unknown outcome.
 */
export const runPostgresTransactionEffect = Effect.fn(
  "PostgresRuntime.transaction",
)(<T, E, R>(
  client: PostgresQueryClient,
  database: NodePgDatabase<typeof flarexSchema>,
  run: (
    transaction: FlarexRuntimePersistenceTransaction,
  ) => Effect.Effect<T, E, R>,
  options: RunPostgresTransactionEffectOptions,
): Effect.Effect<
  T,
  E | PostgresTransactionBeginError | PostgresTransactionCommitError,
  R
> =>
  Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => client.query("BEGIN"),
      catch: (cause) => new PostgresTransactionBeginError({ cause }),
    });

    const transaction = {
      drizzle: database,
      sql: createPostgresSqlClient(
        database,
        client,
      ) satisfies FlarexPersistenceTx,
    } satisfies FlarexRuntimePersistenceTransaction;
    const callbackExit = yield* Effect.exit(
      restore(Effect.suspend(() => run(transaction))),
    );
    if (Exit.isFailure(callbackExit)) {
      yield* rollbackPostgresTransaction(client, options);
      return yield* Effect.failCause(callbackExit.cause);
    }

    const commitExit = yield* Effect.exit(Effect.tryPromise({
      try: () => client.query("COMMIT"),
      catch: (cause) => new PostgresTransactionCommitError({ cause }),
    }));
    if (Exit.isFailure(commitExit)) {
      yield* rollbackPostgresTransaction(client, options);
      return yield* Effect.failCause(commitExit.cause);
    }

    return callbackExit.value;
  })),
);

/**
 * Promise compatibility boundary for FlarexRuntimePersistenceDriver.
 *
 * Delete this facade when that driver and the public persistence transaction
 * contract accept Effect callbacks. Until then, preserve its historical raw
 * Promise rejection identity for callback and driver failures, including its
 * optional rollback observer.
 */
export function runPostgresTransaction<T>(
  client: PostgresQueryClient,
  database: NodePgDatabase<typeof flarexSchema>,
  run: (transaction: FlarexRuntimePersistenceTransaction) => Promise<T>,
  options: RunPostgresTransactionOptions = {},
): Promise<T> {
  return Effect.runPromise(
    runPostgresTransactionEffect(
      client,
      database,
      (transaction) => Effect.tryPromise({
        try: () => run(transaction),
        catch: (cause) => new PostgresTransactionPromiseCallbackError({
          cause,
        }),
      }),
      {
        onRollbackError: (error) => options.onRollbackError?.(error),
      },
    ).pipe(
      Effect.catch((failure) =>
        failure instanceof PostgresTransactionPromiseCallbackError
          || failure instanceof PostgresTransactionBeginError
          || failure instanceof PostgresTransactionCommitError
          ? Effect.fail(failure.cause)
          : Effect.fail(failure)
      ),
    ),
  );
}

function rollbackPostgresTransaction(
  client: PostgresQueryClient,
  options: RunPostgresTransactionEffectOptions,
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => client.query("ROLLBACK"),
    catch: (cause) => cause,
  }).pipe(
    Effect.asVoid,
    Effect.catch((rollbackError) =>
      Effect.sync(() => options.onRollbackError?.(rollbackError)).pipe(
        Effect.exit,
        Effect.asVoid,
      )
    ),
  );
}
