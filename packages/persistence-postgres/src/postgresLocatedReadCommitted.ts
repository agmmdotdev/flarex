import { drizzle } from "drizzle-orm/node-postgres";
import type { Client, Pool, PoolClient } from "pg";

import type { AppRowTransaction } from "./appRows";
import { flarexSchema } from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedTransactionFailureIssueV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

export type PostgresLocatedReadCommittedPhaseV1 =
  | "beforeCallback"
  | "configuring"
  | "runningCallback"
  | "callbackRejected"
  | "callbackCompleted";

/**
 * Package-internal fault seam. It exists only so the isolated PostgreSQL proof
 * can decorate a genuinely acquired client and its real release operation.
 * This module is deliberately absent from package exports.
 */
export interface PostgresLocatedReadCommittedRunnerOptionsV1 {
  readonly afterAcquire?: (client: PoolClient) => void | Promise<void>;
  readonly release?: (
    client: PoolClient,
    discardError: Error | undefined,
  ) => void;
}

/**
 * The request owner retains Client lifecycle. This callback is the only signal
 * that a transaction outcome left the connected client unsafe for later work.
 */
export interface PostgresClientLocatedReadCommittedRunnerOptionsV1 {
  readonly quarantine: (discardError: Error) => void | Promise<void>;
}

export type PostgresLocatedReadCommittedTransactionResultV1<Value> =
  | Readonly<{ readonly kind: "succeeded"; readonly value: Value }>
  | Readonly<{ readonly kind: "failed"; readonly cause: unknown }>;

export type PostgresLocatedReadCommittedReleaseResultV1 =
  | Readonly<{ readonly kind: "released" }>
  | Readonly<{
      readonly kind: "failed";
      readonly cause: unknown;
      readonly quarantineCause?: unknown;
    }>;

export function createPostgresLocatedReadCommittedTransactionRunnerV1(
  pool: Pick<Pool, "connect">,
  options: PostgresLocatedReadCommittedRunnerOptionsV1 = {},
): RunLocatedReadCommittedTransactionV1 {
  return async <Result>(work: (
    tx: AppRowTransaction,
  ) => Promise<Result>): Promise<Result> => {
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (cause) {
      throw locatedFailure({
        kind: "infrastructureFailure",
        phase: "acquire",
        cause,
      });
    }

    const state: {
      phase: PostgresLocatedReadCommittedPhaseV1;
      callbackCause: unknown;
    } = { phase: "beforeCallback", callbackCause: undefined };
    let databaseResult:
      | Readonly<{
          readonly kind: "succeeded";
          readonly database: ReturnType<typeof createConnectedDatabase>;
        }>
      | Readonly<{ readonly kind: "failed"; readonly cause: unknown }>;
    try {
      await options.afterAcquire?.(client);
      databaseResult = Object.freeze({
        kind: "succeeded",
        database: createConnectedDatabase(client),
      });
    } catch (cause) {
      databaseResult = Object.freeze({ kind: "failed", cause });
    }
    if (databaseResult.kind === "failed") {
      const cause = databaseResult.cause;
      const release = releaseClient(client, discardError(cause), options);
      throw locatedFailure({
        kind: "infrastructureFailure",
        phase: "beginOrConfigure",
        cause,
        ...(release.kind === "failed"
          ? {
              releaseCause: release.cause,
              ...(release.quarantineCause === undefined
                ? {}
                : { quarantineCause: release.quarantineCause }),
            }
          : {}),
      });
    }
    const database = databaseResult.database;

    const transaction = await settlePromise(database.transaction(
      async (tx): Promise<Result> => {
        state.phase = "configuring";
        await tx.setTransaction({ isolationLevel: "read committed" });
        state.phase = "runningCallback";
        try {
          const result = await work(tx);
          state.phase = "callbackCompleted";
          return result;
        } catch (cause) {
          state.phase = "callbackRejected";
          state.callbackCause = cause;
          throw cause;
        }
      },
    ));

    const discard = transaction.kind === "failed" &&
        state.phase !== "callbackRejected"
      ? discardError(transaction.cause)
      : transaction.kind === "failed" &&
          state.phase === "callbackRejected" &&
          transaction.cause !== state.callbackCause
      ? discardError(transaction.cause)
      : undefined;
    const release = releaseClient(client, discard, options);

    return classifyPostgresLocatedReadCommittedSettlementV1(
      state.phase,
      state.callbackCause,
      transaction,
      release,
    );
  };
}

export function createPostgresClientLocatedReadCommittedTransactionRunnerV1(
  client: Client,
  options: PostgresClientLocatedReadCommittedRunnerOptionsV1,
): RunLocatedReadCommittedTransactionV1 {
  const database = createConnectedClientDatabase(client);
  let tail: Promise<void> = Promise.resolve();
  let unusable:
    | Readonly<{ readonly cause: unknown }>
    | undefined;

  return async <Result>(work: (
    tx: AppRowTransaction,
  ) => Promise<Result>): Promise<Result> => {
    const previous = tail;
    let releaseTurn: (() => void) | undefined;
    tail = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    await previous;
    try {
      if (unusable !== undefined) {
        throw locatedFailure({
          kind: "infrastructureFailure",
          phase: "acquire",
          cause: unusable.cause,
        });
      }

      const state: {
        phase: PostgresLocatedReadCommittedPhaseV1;
        callbackCause: unknown;
      } = { phase: "beforeCallback", callbackCause: undefined };
      const transaction = await settleOperation(() => database.transaction(
        async (tx): Promise<Result> => {
          state.phase = "configuring";
          await tx.setTransaction({ isolationLevel: "read committed" });
          state.phase = "runningCallback";
          try {
            const result = await work(tx);
            state.phase = "callbackCompleted";
            return result;
          } catch (cause) {
            state.phase = "callbackRejected";
            state.callbackCause = cause;
            throw cause;
          }
        },
      ));

      const requiresQuarantine = transaction.kind === "failed" &&
        !(
          state.phase === "callbackRejected" &&
          transaction.cause === state.callbackCause
        );
      if (requiresQuarantine && transaction.kind === "failed") {
        unusable = Object.freeze({ cause: transaction.cause });
      }
      const lifecycle = requiresQuarantine
        ? await quarantineConnectedClient(transaction.cause, options)
        : Object.freeze({ kind: "released" as const });

      return classifyPostgresLocatedReadCommittedSettlementV1(
        state.phase,
        state.callbackCause,
        transaction,
        lifecycle,
      );
    } finally {
      releaseTurn?.();
    }
  };
}

export function classifyPostgresLocatedReadCommittedSettlementV1<Result>(
  phase: PostgresLocatedReadCommittedPhaseV1,
  callbackCause: unknown,
  transaction: PostgresLocatedReadCommittedTransactionResultV1<Result>,
  release: PostgresLocatedReadCommittedReleaseResultV1,
): Result {
  if (transaction.kind === "succeeded") {
    if (release.kind === "released") return transaction.value;
    throw locatedFailure({
      kind: "decisionUncertain",
      settlementCause: release.cause,
      ...(release.quarantineCause === undefined
        ? {}
        : { quarantineCause: release.quarantineCause }),
    });
  }

  if (
    phase === "callbackRejected" &&
    transaction.cause === callbackCause &&
    release.kind === "released"
  ) {
    throw locatedFailure({
      kind: "callbackRolledBack",
      callbackCause,
    });
  }

  if (phase === "callbackRejected") {
    throw locatedFailure({
      kind: "callbackCleanupFailed",
      callbackCause,
      transactionCause: transaction.cause,
      ...(release.kind === "failed"
        ? {
            releaseCause: release.cause,
            ...(release.quarantineCause === undefined
              ? {}
              : { quarantineCause: release.quarantineCause }),
          }
        : {}),
    });
  }

  if (phase === "callbackCompleted") {
    throw locatedFailure({
      kind: "decisionUncertain",
      settlementCause: transaction.cause,
      ...(release.kind === "failed"
        ? {
            releaseCause: release.cause,
            ...(release.quarantineCause === undefined
              ? {}
              : { quarantineCause: release.quarantineCause }),
          }
        : {}),
    });
  }

  throw locatedFailure({
    kind: "infrastructureFailure",
    phase: "beginOrConfigure",
    cause: transaction.cause,
    ...(release.kind === "failed"
      ? {
          releaseCause: release.cause,
          ...(release.quarantineCause === undefined
            ? {}
            : { quarantineCause: release.quarantineCause }),
        }
      : {}),
  });
}

function createConnectedDatabase(client: PoolClient) {
  return drizzle(client, { schema: flarexSchema });
}

function createConnectedClientDatabase(client: Client) {
  return drizzle(client, { schema: flarexSchema });
}

async function settlePromise<Value>(
  promise: Promise<Value>,
): Promise<PostgresLocatedReadCommittedTransactionResultV1<Value>> {
  try {
    return Object.freeze({ kind: "succeeded", value: await promise });
  } catch (cause) {
    return Object.freeze({ kind: "failed", cause });
  }
}

async function settleOperation<Value>(
  operation: () => Promise<Value>,
): Promise<PostgresLocatedReadCommittedTransactionResultV1<Value>> {
  try {
    return Object.freeze({ kind: "succeeded", value: await operation() });
  } catch (cause) {
    return Object.freeze({ kind: "failed", cause });
  }
}

function releaseClient(
  client: PoolClient,
  discard: Error | undefined,
  options: PostgresLocatedReadCommittedRunnerOptionsV1,
): PostgresLocatedReadCommittedReleaseResultV1 {
  try {
    if (options.release === undefined) {
      client.release(discard);
    } else {
      options.release(client, discard);
    }
    return Object.freeze({ kind: "released" });
  } catch (cause) {
    try {
      client.release(true);
      return Object.freeze({ kind: "failed", cause });
    } catch (quarantineCause) {
      return Object.freeze({
        kind: "failed",
        cause,
        quarantineCause,
      });
    }
  }
}

async function quarantineConnectedClient(
  cause: unknown,
  options: PostgresClientLocatedReadCommittedRunnerOptionsV1,
): Promise<PostgresLocatedReadCommittedReleaseResultV1> {
  const discard = discardError(cause);
  try {
    await options.quarantine(discard);
    return Object.freeze({ kind: "failed", cause: discard });
  } catch (quarantineCause) {
    return Object.freeze({
      kind: "failed",
      cause: discard,
      quarantineCause,
    });
  }
}

function discardError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error("Discard the unsettled PostgreSQL connection.", { cause });
}

function locatedFailure(
  issue: LocatedReadCommittedTransactionFailureIssueV1,
): LocatedReadCommittedTransactionFailureV1 {
  return new LocatedReadCommittedTransactionFailureV1(Object.freeze(issue));
}
