import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  type ExtractTablesWithRelations,
  type RelationalSchemaConfig,
} from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  NodePgSession,
  NodePgTransaction,
} from "drizzle-orm/node-postgres/session";
import { Cause, Duration, Effect, Exit } from "effect";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import type { FlarexMetadataDatabase } from "../../deployments";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { flarexSchema } from "../../schema";
import {
  failFrameworkSchemaArtifactControlDeadline,
  FrameworkSchemaArtifactControlSessionCleanupDefect,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  makeFrameworkSchemaArtifactControlConnectionIdentity,
  remainingFrameworkSchemaArtifactControlMilliseconds,
  startFrameworkSchemaArtifactControlDeadline,
  type FrameworkSchemaArtifactControlConnectionIdentity,
  type FrameworkSchemaArtifactControlDeadline,
  type FrameworkSchemaArtifactControlInitialSettlement,
  type FrameworkSchemaArtifactControlRecoverySettlement,
  type FrameworkSchemaArtifactControlRestore,
  type FrameworkSchemaArtifactControlSessionDriver,
  type FrameworkSchemaArtifactControlSessionPhase,
  type FrameworkSchemaArtifactControlSessionQuarantine,
} from "./controlSession";
import {
  fxControlFrameworkSchemaArtifactDependencies,
  fxControlFrameworkSchemaArtifacts,
} from "./schema";

interface FrameworkSchemaArtifactPostgresPool {
  connect(
    callback: (
      error: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): void;
}

interface PostgresControlSessionOptions {
  readonly lifecycleFault?: (input: Readonly<{
    readonly phase: FrameworkSchemaArtifactControlSessionPhase;
    readonly edge: "before" | "after";
    readonly client: PoolClient;
  }>) => void;
  readonly quarantineDrainTimeoutMilliseconds?: number;
}

interface NormalizedPostgresControlSessionOptions {
  readonly lifecycleFault: PostgresControlSessionOptions["lifecycleFault"];
  readonly quarantineDrainTimeoutMilliseconds: number;
}

type CheckedOutConnectionDrain =
  | Readonly<{ readonly kind: "settled" }>
  | Readonly<{ readonly kind: "failed"; readonly cause: unknown }>;

interface CheckedOutConnectionWorkFailure {
  readonly cause: unknown;
}

interface CheckedOutConnection {
  readonly client: PoolClient;
  readonly database: FlarexMetadataDatabase;
  readonly transaction: FlarexMetadataTransaction;
  readonly identity: FrameworkSchemaArtifactControlConnectionIdentity;
  readonly trackPromise: <Value>(promise: Promise<Value>) => Promise<Value>;
  readonly runQuery: <Row extends QueryResultRow>(
    phase: FrameworkSchemaArtifactControlSessionPhase,
    text: string,
    values?: readonly unknown[],
  ) => Promise<QueryResult<Row>>;
  readonly closeWorkFence: () => void;
  readonly drain: () => Promise<CheckedOutConnectionDrain>;
  readonly workFailure: () => CheckedOutConnectionWorkFailure | undefined;
  readonly connectionError: () => unknown | undefined;
  readonly detachConnectionErrorObserver: () => void;
  readonly isReleased: () => boolean;
  readonly markReleased: () => void;
}

type ReleaseResult =
  | Readonly<{ readonly kind: "released" }>
  | Readonly<{ readonly kind: "failed"; readonly cause: unknown }>;

type QuarantineResult =
  | Readonly<{ readonly kind: "confirmed" }>
  | Readonly<{ readonly kind: "failed"; readonly cause: unknown }>;

const fullSchema = {
  ...flarexSchema,
  fxControlFrameworkSchemaArtifacts,
  fxControlFrameworkSchemaArtifactDependencies,
};
type FullSchema = typeof fullSchema;
type RelationalTables = ExtractTablesWithRelations<FullSchema>;

const extractedSchema = extractTablesRelationalConfig<RelationalTables>(
  fullSchema,
  createTableRelationsHelpers,
);
const relationalSchema = {
  fullSchema,
  schema: extractedSchema.tables,
  tableNamesMap: extractedSchema.tableNamesMap,
} satisfies RelationalSchemaConfig<RelationalTables>;
const dialect = new PgDialect();
const DEFAULT_QUARANTINE_DRAIN_TIMEOUT_MILLISECONDS = 5_000;
const MAXIMUM_QUARANTINE_DRAIN_TIMEOUT_MILLISECONDS = 60_000;

const connectionIdentities = new WeakMap<
  PoolClient,
  FrameworkSchemaArtifactControlConnectionIdentity
>();

/**
 * Build the artifact-private node-postgres control-session adapter.
 *
 * Pool acquisition uses node-postgres' callback API because its Promise API
 * cannot abandon an already queued waiter. If acquisition expires, a later
 * callback destroys the late client with `release(true)`. The public Pool API
 * cannot prove that discard synchronously, so no node-postgres internals are
 * inspected or mutated here.
 */
export function makePostgresFrameworkSchemaArtifactControlSessionDriver(
  pool: FrameworkSchemaArtifactPostgresPool,
  optionInput: PostgresControlSessionOptions = {},
): FrameworkSchemaArtifactControlSessionDriver {
  const options = normalizePostgresControlSessionOptions(optionInput);
  const runReadEffect: FrameworkSchemaArtifactControlSessionDriver[
    "runReadEffect"
  ] = Effect.fn(
    "FrameworkSchemaArtifactPostgresControlSession.read",
  )(<Value, Failure>(
    input: {
      readonly deadline: FrameworkSchemaArtifactControlDeadline;
    },
    work: (
      database: FlarexMetadataDatabase,
    ) => Effect.Effect<Value, Failure, never>,
  ): Effect.Effect<
    Value,
    Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
    never
  > => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const acquisition = yield* Effect.exit(restore(acquireConnection(
        pool,
        input.deadline,
        options,
      )));
      if (Exit.isFailure(acquisition)) {
        return yield* Effect.failCause(acquisition.cause);
      }
      const connection = acquisition.value;

      const snapshot = yield* Effect.exit(restore(runRawQueryEffect<{
        readonly statement_timeout: string;
      }>(
        connection,
        input.deadline,
        "configureReadBudget",
        "show statement_timeout",
      )));
      if (Exit.isFailure(snapshot)) {
        return yield* failAfterQuarantine(
          connection,
          snapshot.cause,
          options,
        );
      }
      const priorStatementTimeout = snapshot.value.rows[0]?.statement_timeout;
      if (typeof priorStatementTimeout !== "string") {
        return yield* failAfterQuarantine(
          connection,
          Cause.fail(resourceIssue(
            "configureReadBudget",
            new Error("PostgreSQL returned no statement_timeout setting."),
          )),
          options,
        );
      }

      const remaining = yield* remainingResourceMilliseconds(
        input.deadline,
        "configureReadBudget",
      ).pipe(Effect.exit);
      if (Exit.isFailure(remaining)) {
        return yield* failAfterQuarantine(
          connection,
          remaining.cause,
          options,
        );
      }
      const configure = yield* Effect.exit(restore(runRawQueryEffect(
        connection,
        input.deadline,
        "configureReadBudget",
        "select set_config('statement_timeout', $1, false)",
        [`${remaining.value}ms`],
      )));
      if (Exit.isFailure(configure)) {
        return yield* failAfterQuarantine(
          connection,
          configure.cause,
          options,
        );
      }

      let callbackSettlement: Exit.Exit<Value, Failure> | undefined;
      const callback = yield* Effect.exit(restore(runCallbackEffect(
        connection,
        input.deadline,
        "read",
        connection.database,
        work,
        settlement => {
          callbackSettlement = settlement;
        },
      )));
      if (Exit.isFailure(callback)) {
        const trackedWorkCause = checkedOutConnectionCurrentWorkCause(
          connection,
          "read",
        );
        const quarantined = yield* quarantineConnectionEffect(
          connection,
          options,
        );
        const completedCallbackCause = completeCallbackBoundaryCause(
          callback.cause,
          callbackSettlement,
        );
        const callbackCause = trackedWorkCause === undefined
          ? completedCallbackCause
          : Cause.combine(completedCallbackCause, trackedWorkCause);
        return yield* Effect.failCause(quarantined.kind === "confirmed"
          ? callbackCause
          : Cause.combine(
            callbackCause,
            cleanupDefectCause("quarantine", quarantined.cause),
          ));
      }

      connection.closeWorkFence();
      const drain = yield* Effect.exit(runDrainEffect(
        connection,
        input.deadline,
        "read",
      ));
      if (Exit.isFailure(drain)) {
        const boundaryCause = Exit.isFailure(callback.value)
          ? Cause.combine(callback.value.cause, drain.cause)
          : drain.cause;
        const trackedWorkCause = checkedOutConnectionCurrentWorkCause(
          connection,
          "read",
        );
        const primary = trackedWorkCause === undefined
          ? boundaryCause
          : Cause.combine(boundaryCause, trackedWorkCause);
        return yield* failAfterQuarantine(
          connection,
          primary,
          options,
        );
      }
      const trackedWorkCause = checkedOutConnectionDrainCause(
        drain.value,
        "read",
      );
      if (Exit.isSuccess(callback.value) && trackedWorkCause !== undefined) {
        return yield* failAfterQuarantine(
          connection,
          trackedWorkCause,
          options,
        );
      }
      const callbackCause = Exit.isFailure(callback.value)
        ? trackedWorkCause === undefined
          ? callback.value.cause
          : Cause.combine(callback.value.cause, trackedWorkCause)
        : undefined;

      const reset = yield* Effect.exit(runRawQueryEffect(
        connection,
        input.deadline,
        "resetReadBudget",
        "select set_config('statement_timeout', $1, false)",
        [priorStatementTimeout],
      ));
      if (Exit.isFailure(reset)) {
        const primary = callbackCause === undefined
          ? reset.cause
          : Cause.combine(callbackCause, reset.cause);
        return yield* failAfterQuarantine(
          connection,
          primary,
          options,
        );
      }

      const observedConnectionError = connection.connectionError();
      if (observedConnectionError !== undefined) {
        const primary = Cause.fail(resourceIssue(
          "resetReadBudget",
          observedConnectionError,
        ));
        return yield* failAfterQuarantine(
          connection,
          callbackCause === undefined
            ? primary
            : Cause.combine(callbackCause, primary),
          options,
        );
      }

      const release = yield* releaseConnectionEffect(
        connection,
        false,
        "release",
        options,
      );
      if (release.kind === "failed") {
        const releaseCause = Cause.fail(resourceIssue(
          "release",
          release.cause,
        ));
        return yield* failAfterQuarantine(
          connection,
          callbackCause === undefined
            ? releaseCause
            : Cause.combine(callbackCause, releaseCause),
          options,
        );
      }
      return Exit.isFailure(callback.value)
        ? yield* Effect.failCause(callbackCause ?? callback.value.cause)
        : callback.value.value;
    })));

  const runInitialTransactionEffect: FrameworkSchemaArtifactControlSessionDriver[
    "runInitialTransactionEffect"
  ] = Effect.fn(
    "FrameworkSchemaArtifactPostgresControlSession.initialTransaction",
  )(function*<Value, Failure>(
    input: {
      readonly deadline: FrameworkSchemaArtifactControlDeadline;
      readonly lockTimeoutMilliseconds: number;
      readonly recoveryTimeoutMilliseconds: number;
    },
    restore: FrameworkSchemaArtifactControlRestore,
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ): Effect.fn.Return<
    FrameworkSchemaArtifactControlInitialSettlement<Value, Failure>,
    never
  > {
    const acquisition = yield* Effect.exit(restore(acquireConnection(
      pool,
      input.deadline,
      options,
    )));
    if (Exit.isFailure(acquisition)) {
      return initialNotCommitted(acquisition.cause);
    }
    const connection = acquisition.value;

    const begin = yield* Effect.exit(restore(runRawQueryEffect(
      connection,
      input.deadline,
      "begin",
      "begin",
    )));
    if (Exit.isFailure(begin)) {
      return yield* notCommittedAfterQuarantine(
        connection,
        begin.cause,
        options,
      );
    }

    const isolation = yield* Effect.exit(restore(runRawQueryEffect(
      connection,
      input.deadline,
      "isolation",
      "set transaction isolation level read committed",
    )));
    if (Exit.isFailure(isolation)) {
      return yield* rollbackNotCommitted(
        connection,
        input.deadline,
        isolation.cause,
        options,
      );
    }

    const configured = yield* Effect.exit(restore(configureTransactionEffect(
      connection,
      input.deadline,
      input.lockTimeoutMilliseconds,
    )));
    if (Exit.isFailure(configured)) {
      return yield* rollbackNotCommitted(
        connection,
        input.deadline,
        configured.cause,
        options,
      );
    }

    let callbackSettlement: Exit.Exit<Value, Failure> | undefined;
    const callback = yield* Effect.exit(restore(runCallbackEffect(
      connection,
      input.deadline,
      "callback",
      connection.transaction,
      work,
      settlement => {
        callbackSettlement = settlement;
      },
    )));
    if (Exit.isFailure(callback)) {
      connection.closeWorkFence();
      const callbackDrain = yield* Effect.exit(
        runDrainEffect(connection, input.deadline, "callback"),
      );
      if (Exit.isFailure(callbackDrain)) {
        const trackedWorkCause = checkedOutConnectionCurrentWorkCause(
          connection,
          "callback",
        );
        const quarantined = yield* quarantineConnectionEffect(
          connection,
          options,
        );
        const completedCallbackCause = completeCallbackBoundaryCause(
          callback.cause,
          callbackSettlement,
        );
        const completeCallbackCause = trackedWorkCause === undefined
          ? completedCallbackCause
          : Cause.combine(completedCallbackCause, trackedWorkCause);
        return Object.freeze({
          kind: "callbackCleanupFailed" as const,
          callbackCause: completeCallbackCause,
          cleanupCause: quarantined.kind === "confirmed"
            ? cleanupDefectCause("quarantine", callbackDrain.cause)
            : Cause.combine(
              cleanupDefectCause("quarantine", callbackDrain.cause),
              cleanupDefectCause("quarantine", quarantined.cause),
          ),
        });
      }
      const completeCallbackCause = completeCallbackBoundaryCause(
        callback.cause,
        callbackSettlement,
      );
      const trackedWorkCause = checkedOutConnectionDrainCause(
        callbackDrain.value,
        "callback",
      );
      const completeWorkCause = trackedWorkCause === undefined
        ? completeCallbackCause
        : Cause.combine(completeCallbackCause, trackedWorkCause);
      if (
        hasOnlyInterruptReasons(callback.cause) ||
        (callbackSettlement !== undefined &&
          Exit.isFailure(callbackSettlement))
      ) {
        return yield* settleCallbackFailure(
          connection,
          input.deadline,
          completeWorkCause,
          options,
        );
      }
      return yield* notCommittedAfterQuarantine(
        connection,
        trackedWorkCause === undefined
          ? callback.cause
          : Cause.combine(callback.cause, trackedWorkCause),
        options,
      );
    }

    connection.closeWorkFence();
    const drain = yield* Effect.exit(runDrainEffect(
      connection,
      input.deadline,
      "callback",
    ));
    if (Exit.isFailure(drain)) {
      const trackedWorkCause = checkedOutConnectionCurrentWorkCause(
        connection,
        "callback",
      );
      if (Exit.isFailure(callback.value)) {
        const quarantined = yield* quarantineConnectionEffect(
          connection,
          options,
        );
        return Object.freeze({
          kind: "callbackCleanupFailed" as const,
          callbackCause: trackedWorkCause === undefined
            ? callback.value.cause
            : Cause.combine(callback.value.cause, trackedWorkCause),
          cleanupCause: quarantined.kind === "confirmed"
            ? cleanupDefectCause("quarantine", drain.cause)
            : Cause.combine(
              cleanupDefectCause("quarantine", drain.cause),
              cleanupDefectCause("quarantine", quarantined.cause),
            ),
        });
      }
      return yield* notCommittedAfterQuarantine(
        connection,
        trackedWorkCause === undefined
          ? drain.cause
          : Cause.combine(drain.cause, trackedWorkCause),
        options,
      );
    }

    const trackedWorkCause = checkedOutConnectionDrainCause(
      drain.value,
      "callback",
    );

    if (Exit.isFailure(callback.value)) {
      return yield* settleCallbackFailure(
        connection,
        input.deadline,
        trackedWorkCause === undefined
          ? callback.value.cause
          : Cause.combine(callback.value.cause, trackedWorkCause),
        options,
      );
    }
    if (trackedWorkCause !== undefined) {
      return yield* rollbackNotCommitted(
        connection,
        input.deadline,
        trackedWorkCause,
        options,
      );
    }

    const commit = yield* Effect.exit(runRawQueryEffect(
      connection,
      input.deadline,
      "commit",
      "commit",
    ));
    const commitCause = Exit.isFailure(commit)
      ? commit.cause
      : unexpectedCommandCause(commit.value, "COMMIT", "commit");
    if (commitCause !== undefined) {
      return yield* initialUncertain(
        connection,
        callback.value.value,
        commitCause,
        input.recoveryTimeoutMilliseconds,
        options,
      );
    }

    const observedConnectionError = connection.connectionError();
    if (observedConnectionError !== undefined) {
      return yield* initialUncertain(
        connection,
        callback.value.value,
        observedConnectionError,
        input.recoveryTimeoutMilliseconds,
        options,
      );
    }

    const release = yield* releaseConnectionEffect(
      connection,
      false,
      "release",
      options,
    );
    if (release.kind === "failed") {
      return yield* initialUncertain(
        connection,
        callback.value.value,
        release.cause,
        input.recoveryTimeoutMilliseconds,
        options,
      );
    }
    return Object.freeze({
      kind: "committed",
      value: callback.value.value,
    });
  });

  const runRecoveryTransactionEffect: FrameworkSchemaArtifactControlSessionDriver[
    "runRecoveryTransactionEffect"
  ] = Effect.fn(
    "FrameworkSchemaArtifactPostgresControlSession.recoveryTransaction",
  )(function*<Value, Failure>(
    input: {
      readonly deadline: FrameworkSchemaArtifactControlDeadline;
      readonly lockTimeoutMilliseconds: number;
      readonly excludedConnectionIdentity:
        FrameworkSchemaArtifactControlConnectionIdentity;
    },
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ): Effect.fn.Return<
    FrameworkSchemaArtifactControlRecoverySettlement<Value, Failure>,
    never
  > {
    const acquisition = yield* Effect.exit(acquireRecoveryConnection(
      pool,
      input.deadline,
      input.excludedConnectionIdentity,
      options,
    ));
    if (Exit.isFailure(acquisition)) {
      return recoveryLifecycleUnresolved(acquisition.cause);
    }
    const connection = acquisition.value;

    const begin = yield* Effect.exit(runRawQueryEffect(
      connection,
      input.deadline,
      "begin",
      "begin",
    ));
    if (Exit.isFailure(begin)) {
      return yield* recoveryLifecycleAfterQuarantine(
        connection,
        begin.cause,
        options,
      );
    }

    const isolation = yield* Effect.exit(runRawQueryEffect(
      connection,
      input.deadline,
      "isolation",
      "set transaction isolation level read committed",
    ));
    if (Exit.isFailure(isolation)) {
      return yield* rollbackRecoveryLifecycle(
        connection,
        input.deadline,
        isolation.cause,
        options,
      );
    }

    const configured = yield* Effect.exit(configureTransactionEffect(
      connection,
      input.deadline,
      input.lockTimeoutMilliseconds,
    ));
    if (Exit.isFailure(configured)) {
      return yield* rollbackRecoveryLifecycle(
        connection,
        input.deadline,
        configured.cause,
        options,
      );
    }

    let callbackSettlement: Exit.Exit<Value, Failure> | undefined;
    const callback = yield* Effect.exit(runCallbackEffect(
      connection,
      input.deadline,
      "callback",
      connection.transaction,
      work,
      settlement => {
        callbackSettlement = settlement;
      },
    ));
    if (Exit.isFailure(callback)) {
      connection.closeWorkFence();
      const callbackDrain = yield* Effect.exit(
        runDrainEffect(connection, input.deadline, "callback"),
      );
      if (Exit.isFailure(callbackDrain)) {
        const trackedWorkCause = checkedOutConnectionCurrentWorkCause(
          connection,
          "callback",
        );
        const quarantined = yield* quarantineConnectionEffect(
          connection,
          options,
        );
        const completedCallbackCause = completeCallbackBoundaryCause(
          callback.cause,
          callbackSettlement,
        );
        const completeCallbackCause = trackedWorkCause === undefined
          ? completedCallbackCause
          : Cause.combine(completedCallbackCause, trackedWorkCause);
        const cleanupCause = quarantined.kind === "confirmed"
          ? cleanupDefectCause("quarantine", callbackDrain.cause)
          : Cause.combine(
            cleanupDefectCause("quarantine", callbackDrain.cause),
            cleanupDefectCause("quarantine", quarantined.cause),
          );
        return callbackSettlement !== undefined &&
          Exit.isFailure(callbackSettlement)
          ? Object.freeze({
            kind: "unresolved" as const,
            resolution: Object.freeze({
              kind: "callback" as const,
              cause: Cause.combine(completeCallbackCause, cleanupCause),
            }),
          })
          : recoveryLifecycleUnresolved(Cause.combine(
            trackedWorkCause === undefined
              ? callback.cause
              : Cause.combine(callback.cause, trackedWorkCause),
            cleanupCause,
          ));
      }
      const completeCallbackCause = completeCallbackBoundaryCause(
        callback.cause,
        callbackSettlement,
      );
      const trackedWorkCause = checkedOutConnectionDrainCause(
        callbackDrain.value,
        "callback",
      );
      const completeWorkCause = trackedWorkCause === undefined
        ? completeCallbackCause
        : Cause.combine(completeCallbackCause, trackedWorkCause);
      if (callbackSettlement !== undefined &&
        Exit.isFailure(callbackSettlement)) {
        return yield* settleRecoveryCallbackFailure(
          connection,
          input.deadline,
          completeWorkCause,
          options,
        );
      }
      return yield* recoveryLifecycleAfterQuarantine(
        connection,
        trackedWorkCause === undefined
          ? callback.cause
          : Cause.combine(callback.cause, trackedWorkCause),
        options,
      );
    }

    connection.closeWorkFence();
    const drain = yield* Effect.exit(runDrainEffect(
      connection,
      input.deadline,
      "callback",
    ));
    if (Exit.isFailure(drain)) {
      const trackedWorkCause = checkedOutConnectionCurrentWorkCause(
        connection,
        "callback",
      );
      if (Exit.isFailure(callback.value)) {
        const quarantined = yield* quarantineConnectionEffect(
          connection,
          options,
        );
        const cleanupCause = quarantined.kind === "confirmed"
          ? cleanupDefectCause("quarantine", drain.cause)
          : Cause.combine(
            cleanupDefectCause("quarantine", drain.cause),
            cleanupDefectCause("quarantine", quarantined.cause),
          );
        return Object.freeze({
          kind: "unresolved" as const,
          resolution: Object.freeze({
            kind: "callback" as const,
            cause: Cause.combine(
              trackedWorkCause === undefined
                ? callback.value.cause
                : Cause.combine(callback.value.cause, trackedWorkCause),
              cleanupCause,
            ),
          }),
        });
      }
      return yield* recoveryLifecycleAfterQuarantine(
        connection,
        trackedWorkCause === undefined
          ? drain.cause
          : Cause.combine(drain.cause, trackedWorkCause),
        options,
      );
    }

    const trackedWorkCause = checkedOutConnectionDrainCause(
      drain.value,
      "callback",
    );

    if (Exit.isFailure(callback.value)) {
      const settled = yield* settleRecoveryCallbackFailure(
        connection,
        input.deadline,
        trackedWorkCause === undefined
          ? callback.value.cause
          : Cause.combine(callback.value.cause, trackedWorkCause),
        options,
      );
      return settled;
    }
    if (trackedWorkCause !== undefined) {
      return yield* rollbackRecoveryLifecycle(
        connection,
        input.deadline,
        trackedWorkCause,
        options,
      );
    }

    const commit = yield* Effect.exit(runRawQueryEffect(
      connection,
      input.deadline,
      "commit",
      "commit",
    ));
    const commitCause = Exit.isFailure(commit)
      ? commit.cause
      : unexpectedCommandCause(commit.value, "COMMIT", "commit");
    if (commitCause !== undefined) {
      return yield* recoveryLifecycleAfterQuarantine(
        connection,
        commitCause,
        options,
      );
    }
    const observedConnectionError = connection.connectionError();
    if (observedConnectionError !== undefined) {
      return yield* recoveryLifecycleAfterQuarantine(
        connection,
        Cause.fail(resourceIssue("commit", observedConnectionError)),
        options,
      );
    }
    const release = yield* releaseConnectionEffect(
      connection,
      false,
      "release",
      options,
    );
    if (release.kind === "failed") {
      return yield* recoveryLifecycleAfterQuarantine(
        connection,
        Cause.fail(resourceIssue("release", release.cause)),
        options,
      );
    }
    return Object.freeze({
      kind: "committed",
      value: callback.value.value,
    });
  });

  return Object.freeze({
    runReadEffect,
    runInitialTransactionEffect,
    runRecoveryTransactionEffect,
  } satisfies FrameworkSchemaArtifactControlSessionDriver);
}

function acquireConnection(
  pool: FrameworkSchemaArtifactPostgresPool,
  deadline: FrameworkSchemaArtifactControlDeadline,
  options: NormalizedPostgresControlSessionOptions,
): Effect.Effect<
  CheckedOutConnection,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return remainingResourceMilliseconds(deadline, "acquire").pipe(
    Effect.flatMap(remainingMilliseconds => Effect.raceFirst(
      Effect.callback<
        CheckedOutConnection,
        FrameworkSchemaArtifactControlSessionResourceIssue
      >((resume) => {
        let abandoned = false;
        let completed = false;
        const finish = (
          effect: Effect.Effect<
            CheckedOutConnection,
            FrameworkSchemaArtifactControlSessionResourceIssue,
            never
          >,
        ) => {
          if (completed) return;
          completed = true;
          resume(effect);
        };

        try {
          pool.connect((error, client) => {
            if (abandoned) {
              if (client !== undefined) destroyLateAcquisition(client);
              return;
            }
            if (error !== undefined || client === undefined) {
              const cleanupCause = client === undefined
                ? undefined
                : destroyAcquiredAfterConstructionFailure(client);
              finish(Effect.fail(resourceIssue(
                "acquire",
                error ?? new Error("PostgreSQL returned no acquired client."),
                cleanupCause,
              )));
              return;
            }
            try {
              finish(Effect.succeed(makeCheckedOutConnection(client, options)));
            } catch (cause) {
              const cleanupCause = destroyAcquiredAfterConstructionFailure(
                client,
              );
              finish(Effect.fail(resourceIssue(
                "acquire",
                cause,
                cleanupCause,
              )));
            }
          });
        } catch (cause) {
          finish(Effect.fail(resourceIssue("acquire", cause)));
        }

        return Effect.sync(() => {
          abandoned = true;
          completed = true;
        });
      }),
      Effect.sleep(Duration.millis(remainingMilliseconds)).pipe(
        Effect.andThen(deadlineResourceFailure(deadline, "acquire")),
      ),
    )),
  );
}

const acquireRecoveryConnection = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.acquireRecoveryConnection",
)(function*(
  pool: FrameworkSchemaArtifactPostgresPool,
  deadline: FrameworkSchemaArtifactControlDeadline,
  excludedIdentity: FrameworkSchemaArtifactControlConnectionIdentity,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<
  CheckedOutConnection,
  FrameworkSchemaArtifactControlSessionResourceIssue
> {
  while (true) {
    const connection = yield* acquireConnection(pool, deadline, options);
    if (connection.identity !== excludedIdentity) return connection;
    const discarded = yield* quarantineConnectionEffect(
      connection,
      options,
    );
    if (discarded.kind === "failed") {
      return yield* Effect.fail(resourceIssue(
        "quarantine",
        discarded.cause,
      ));
    }
  }
});

function makeCheckedOutConnection(
  client: PoolClient,
  options: NormalizedPostgresControlSessionOptions,
): CheckedOutConnection {
  const pending = new Set<Promise<void>>();
  let trackedWorkFailure: CheckedOutConnectionWorkFailure | undefined;
  let workFenceOpen = true;
  let observedConnectionError: unknown;
  let observerAttached = true;
  let released = false;
  const observeConnectionError = (cause: Error) => {
    observedConnectionError ??= cause;
  };
  client.on("error", observeConnectionError);

  const trackPromiseLike = (promise: PromiseLike<unknown>): void => {
    const mirror = Promise.resolve(promise).then(
      () => undefined,
      cause => {
        trackedWorkFailure ??= Object.freeze({ cause });
      },
    );
    pending.add(mirror);
    void mirror.then(() => pending.delete(mirror));
  };
  const trackPromise = <Value>(promise: Promise<Value>): Promise<Value> => {
    trackPromiseLike(promise);
    return promise;
  };

  const trackedQuery = (...args: readonly unknown[]): unknown => {
    if (!workFenceOpen) {
      return trackPromise(Promise.reject(
        new Error("Framework schema artifact callback work is closed."),
      ));
    }
    const result: unknown = Reflect.apply(client.query, client, args);
    trackPromiseLike(Promise.resolve(result));
    return result;
  };
  const trackedClient = new Proxy(client, {
    get(target, property, receiver) {
      return property === "query"
        ? trackedQuery
        : Reflect.get(target, property, receiver);
    },
  });
  const session = new NodePgSession<FullSchema, RelationalTables>(
    trackedClient,
    dialect,
    relationalSchema,
  );
  const database: FlarexMetadataDatabase = new NodePgDatabase<FullSchema>(
    dialect,
    session,
    relationalSchema,
  );
  const transaction: FlarexMetadataTransaction =
    new NodePgTransaction<FullSchema, RelationalTables>(
      dialect,
      session,
      relationalSchema,
    );

  return {
    client,
    database,
    transaction,
    identity: connectionIdentity(client),
    trackPromise,
    runQuery: <Row extends QueryResultRow>(
      phase: FrameworkSchemaArtifactControlSessionPhase,
      text: string,
      values?: readonly unknown[],
    ) => {
      const promise = Promise.resolve().then(() => {
        options.lifecycleFault?.({ phase, edge: "before", client });
        if (observedConnectionError !== undefined) {
          throw observedConnectionError;
        }
        return values === undefined
          ? client.query<Row>(text)
          : client.query<Row>(text, [...values]);
      }).then(result => {
        options.lifecycleFault?.({ phase, edge: "after", client });
        if (observedConnectionError !== undefined) {
          throw observedConnectionError;
        }
        return result;
      });
      return promise;
    },
    closeWorkFence: () => {
      workFenceOpen = false;
    },
    drain: async () => {
      while (pending.size > 0) {
        await Promise.all(pending);
      }
      return trackedWorkFailure === undefined
        ? Object.freeze({ kind: "settled" })
        : Object.freeze({ kind: "failed", cause: trackedWorkFailure.cause });
    },
    workFailure: () => trackedWorkFailure,
    connectionError: () => observedConnectionError,
    detachConnectionErrorObserver: () => {
      if (!observerAttached) return;
      observerAttached = false;
      client.removeListener("error", observeConnectionError);
    },
    isReleased: () => released,
    markReleased: () => {
      released = true;
    },
  };
}

function connectionIdentity(
  client: PoolClient,
): FrameworkSchemaArtifactControlConnectionIdentity {
  const existing = connectionIdentities.get(client);
  if (existing !== undefined) return existing;
  const created = makeFrameworkSchemaArtifactControlConnectionIdentity();
  connectionIdentities.set(client, created);
  return created;
}

function configureTransactionEffect(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  lockTimeoutMilliseconds: number,
): Effect.Effect<
  void,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return remainingResourceMilliseconds(
    deadline,
    "configureTransactionBudget",
  ).pipe(Effect.flatMap(remainingMilliseconds => {
    const lockMilliseconds = Math.min(
      lockTimeoutMilliseconds,
      remainingMilliseconds,
    );
    return runRawQueryEffect(
      connection,
      deadline,
      "configureTransactionBudget",
      "select set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
      [`${lockMilliseconds}ms`, `${remainingMilliseconds}ms`],
    ).pipe(Effect.asVoid);
  }));
}

function runRawQueryEffect<Row extends QueryResultRow = QueryResultRow>(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: FrameworkSchemaArtifactControlSessionPhase,
  text: string,
  values?: readonly unknown[],
): Effect.Effect<
  QueryResult<Row>,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return runBoundedPromiseEffect(
    deadline,
    phase,
    () => connection.runQuery<Row>(phase, text, values),
    connection,
  );
}

function runCallbackEffect<Database, Value, Failure>(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: "read" | "callback",
  database: Database,
  work: (database: Database) => Effect.Effect<Value, Failure, never>,
  observeSettlement?: (settlement: Exit.Exit<Value, Failure>) => void,
): Effect.Effect<
  Exit.Exit<Value, Failure>,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return Effect.flatMap(Effect.context<never>(), context =>
    runBoundedPromiseEffect(
      deadline,
      phase,
      signal => {
        const settlement = Effect.runPromiseExitWith(context)(
          Effect.suspend(() => work(database)),
          { signal },
        );
        return observeSettlement === undefined
          ? settlement
          : settlement.then((exit) => {
            observeSettlement(exit);
            return exit;
          });
      },
      connection,
    ));
}

function drainConnectionEffect(
  connection: CheckedOutConnection,
): Effect.Effect<void, unknown, never> {
  return Effect.tryPromise({
    try: () => connection.drain().then(() => undefined),
    catch: cause => cause,
  });
}

function runDrainEffect(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: "read" | "callback",
): Effect.Effect<
  CheckedOutConnectionDrain,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return runBoundedPromiseEffect(
    deadline,
    phase,
    () => connection.drain(),
  );
}

function checkedOutConnectionDrainCause(
  drain: CheckedOutConnectionDrain,
  phase: "read" | "callback",
): Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue> | undefined {
  return drain.kind === "settled"
    ? undefined
    : checkedOutConnectionWorkFailureCause(drain, phase);
}

function checkedOutConnectionCurrentWorkCause(
  connection: CheckedOutConnection,
  phase: "read" | "callback",
): Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue> | undefined {
  const failure = connection.workFailure();
  return failure === undefined
    ? undefined
    : checkedOutConnectionWorkFailureCause(failure, phase);
}

function checkedOutConnectionWorkFailureCause(
  failure: CheckedOutConnectionWorkFailure,
  phase: "read" | "callback",
): Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue> {
  return Cause.fail(resourceIssue(phase, failure.cause));
}

function runBoundedPromiseEffect<Value>(
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: FrameworkSchemaArtifactControlSessionPhase,
  start: (signal: AbortSignal) => Promise<Value>,
  connection?: CheckedOutConnection,
): Effect.Effect<
  Value,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return remainingResourceMilliseconds(deadline, phase).pipe(
    Effect.flatMap(remainingMilliseconds => Effect.raceFirst(
      Effect.callback<
        Value,
        FrameworkSchemaArtifactControlSessionResourceIssue
      >((resume) => {
        const operationController = new AbortController();
        let completed = false;
        const finish = (
          effect: Effect.Effect<
            Value,
            FrameworkSchemaArtifactControlSessionResourceIssue,
            never
          >,
        ) => {
          if (completed) return;
          completed = true;
          resume(effect);
        };

        let promise: Promise<Value>;
        try {
          const started = start(operationController.signal);
          promise = connection === undefined
            ? started
            : connection.trackPromise(started);
        } catch (cause) {
          finish(Effect.fail(resourceIssue(phase, cause)));
          return Effect.void;
        }
        void promise.then(
          value => finish(Effect.succeed(value)),
          cause => finish(Effect.fail(resourceIssue(phase, cause))),
        );

        return Effect.sync(() => {
          completed = true;
          operationController.abort();
        });
      }),
      Effect.sleep(Duration.millis(remainingMilliseconds)).pipe(
        Effect.andThen(deadlineResourceFailure(deadline, phase)),
      ),
    )),
  );
}

function remainingResourceMilliseconds(
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: FrameworkSchemaArtifactControlSessionPhase,
): Effect.Effect<
  number,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return remainingFrameworkSchemaArtifactControlMilliseconds(
    deadline,
    phase,
  ).pipe(Effect.mapError(cause => resourceIssue(phase, cause)));
}

function deadlineResourceFailure(
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: FrameworkSchemaArtifactControlSessionPhase,
): Effect.Effect<
  never,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return failFrameworkSchemaArtifactControlDeadline(deadline, phase).pipe(
    Effect.mapError(cause => resourceIssue(phase, cause)),
  );
}

function resourceIssue(
  phase: FrameworkSchemaArtifactControlSessionPhase,
  cause: unknown,
  cleanupCause?: unknown,
): FrameworkSchemaArtifactControlSessionResourceIssue {
  return new FrameworkSchemaArtifactControlSessionResourceIssue({
    phase,
    cause,
    ...(cleanupCause === undefined ? {} : { cleanupCause }),
  });
}

function unexpectedCommandCause(
  result: Readonly<{ readonly command: string }>,
  expectedCommand: "COMMIT" | "ROLLBACK",
  phase: "commit" | "rollback",
): Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue> | undefined {
  return result.command === expectedCommand
    ? undefined
    : Cause.fail(resourceIssue(
      phase,
      new Error(
        `PostgreSQL returned ${result.command} for ${expectedCommand}.`,
      ),
    ));
}

function releaseConnectionEffect(
  connection: CheckedOutConnection,
  destroy: boolean,
  phase: "release" | "quarantine",
  options: NormalizedPostgresControlSessionOptions,
): Effect.Effect<ReleaseResult, never, never> {
  return Effect.sync(() => {
    if (connection.isReleased()) {
      return Object.freeze({
        kind: "failed",
        cause: new Error("PostgreSQL control-session client was already released."),
      });
    }
    connection.detachConnectionErrorObserver();
    const causes: unknown[] = [];
    try {
      options.lifecycleFault?.({
        phase,
        edge: "before",
        client: connection.client,
      });
    } catch (cause) {
      causes.push(cause);
    }
    try {
      connection.client.release(destroy);
      connection.markReleased();
    } catch (cause) {
      causes.push(cause);
    }
    try {
      options.lifecycleFault?.({
        phase,
        edge: "after",
        client: connection.client,
      });
    } catch (cause) {
      causes.push(cause);
    }
    return causes.length === 0
      ? Object.freeze({ kind: "released" })
      : Object.freeze({
        kind: "failed",
        cause: aggregateCauses(causes, `PostgreSQL ${phase} failed.`),
      });
  });
}

const quarantineConnectionEffect = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.quarantineConnection",
)(function*(
  connection: CheckedOutConnection,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<QuarantineResult> {
  connection.closeWorkFence();
  const release = yield* releaseConnectionEffect(
    connection,
    true,
    "quarantine",
    options,
  );
  const drain = yield* Effect.exit(Effect.raceFirst(
    drainConnectionEffect(connection),
    Effect.sleep(Duration.millis(
      options.quarantineDrainTimeoutMilliseconds,
    )).pipe(Effect.andThen(Effect.fail(
      new Error(
        "PostgreSQL quarantine drain did not settle after client destruction.",
      ),
    ))),
  ));
  if (release.kind === "released" && Exit.isSuccess(drain)) {
    return Object.freeze({ kind: "confirmed" });
  }
  const causes = [
    ...(release.kind === "failed" ? [release.cause] : []),
    ...(Exit.isFailure(drain) ? [drain.cause] : []),
  ];
  return Object.freeze({
    kind: "failed",
    cause: aggregateCauses(causes, "PostgreSQL quarantine failed."),
  });
});

function failAfterQuarantine<Failure>(
  connection: CheckedOutConnection,
  primary: Cause.Cause<Failure>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.Effect<never, Failure, never> {
  return Effect.flatMap(
    quarantineConnectionEffect(connection, options),
    quarantined => Effect.failCause(quarantined.kind === "confirmed"
      ? primary
      : Cause.combine(
        primary,
        Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
          phase: "quarantine",
          cause: quarantined.cause,
        })),
      )),
  );
}

function initialNotCommitted(
  cause: Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
): FrameworkSchemaArtifactControlInitialSettlement<never, never> {
  return Object.freeze({ kind: "notCommitted", cause });
}

function notCommittedAfterQuarantine(
  connection: CheckedOutConnection,
  primary: Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.Effect<
  FrameworkSchemaArtifactControlInitialSettlement<never, never>,
  never,
  never
> {
  return Effect.map(
    quarantineConnectionEffect(connection, options),
    quarantined => initialNotCommitted(quarantined.kind === "confirmed"
      ? primary
      : Cause.combine(
        primary,
        Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
          phase: "quarantine",
          cause: quarantined.cause,
        })),
      )),
  );
}

const rollbackNotCommitted = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.rollbackNotCommitted",
)(function*(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  primary: Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlInitialSettlement<never, never>,
  never
> {
  connection.closeWorkFence();
  const rollback = yield* Effect.exit(runRawQueryEffect(
    connection,
    deadline,
    "rollback",
    "rollback",
  ));
  const rollbackCause = Exit.isFailure(rollback)
    ? rollback.cause
    : unexpectedCommandCause(rollback.value, "ROLLBACK", "rollback");
  if (rollbackCause !== undefined) {
    const combined = Cause.combine(primary, rollbackCause);
    return yield* notCommittedAfterQuarantine(
      connection,
      combined,
      options,
    );
  }
  const release = yield* releaseConnectionEffect(
    connection,
    false,
    "release",
    options,
  );
  if (release.kind === "failed") {
    return yield* notCommittedAfterQuarantine(
      connection,
      Cause.combine(
        primary,
        Cause.fail(resourceIssue("release", release.cause)),
      ),
      options,
    );
  }
  return initialNotCommitted(primary);
});

const settleCallbackFailure = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.settleCallbackFailure",
)(function*<Failure>(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  callbackCause: Cause.Cause<Failure>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlInitialSettlement<never, Failure>,
  never
> {
  const rollback = yield* Effect.exit(runRawQueryEffect(
    connection,
    deadline,
    "rollback",
    "rollback",
  ));
  const rollbackCause = Exit.isFailure(rollback)
    ? rollback.cause
    : unexpectedCommandCause(rollback.value, "ROLLBACK", "rollback");
  if (rollbackCause !== undefined) {
    const quarantined = yield* quarantineConnectionEffect(
      connection,
      options,
    );
    return Object.freeze({
      kind: "callbackCleanupFailed",
      callbackCause,
      cleanupCause: quarantined.kind === "failed"
        ? Cause.combine(
          cleanupDefectCause("rollback", rollbackCause),
          cleanupDefectCause("quarantine", quarantined.cause),
        )
        : cleanupDefectCause("rollback", rollbackCause),
    } satisfies Extract<
      FrameworkSchemaArtifactControlInitialSettlement<never, Failure>,
      { readonly kind: "callbackCleanupFailed" }
    >);
  }
  const release = yield* releaseConnectionEffect(
    connection,
    false,
    "release",
    options,
  );
  if (release.kind === "failed") {
    const quarantined = yield* quarantineConnectionEffect(
      connection,
      options,
    );
    return Object.freeze({
      kind: "callbackCleanupFailed",
      callbackCause,
      cleanupCause: quarantined.kind === "confirmed"
        ? cleanupDefectCause("release", release.cause)
        : Cause.combine(
          cleanupDefectCause("release", release.cause),
          cleanupDefectCause("quarantine", quarantined.cause),
        ),
    } satisfies Extract<
      FrameworkSchemaArtifactControlInitialSettlement<never, Failure>,
      { readonly kind: "callbackCleanupFailed" }
    >);
  }
  return Object.freeze({ kind: "callbackRolledBack", callbackCause });
});

const initialUncertain = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.initialUncertain",
)(function*<Value>(
  connection: CheckedOutConnection,
  value: Value,
  initialSettlementCause: unknown,
  recoveryTimeoutMilliseconds: number,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlInitialSettlement<Value, never>,
  never
> {
  const recoveryDeadline = yield*
    startFrameworkSchemaArtifactControlDeadline(
      "recovery",
      recoveryTimeoutMilliseconds,
    );
  const quarantine = yield* quarantineConnectionEffect(
    connection,
    options,
  );
  const quarantineResult: FrameworkSchemaArtifactControlSessionQuarantine =
    quarantine.kind === "confirmed"
      ? Object.freeze({
        kind: "confirmed",
        excludedConnectionIdentity: connection.identity,
      })
      : Object.freeze({ kind: "failed", cause: quarantine.cause });
  return Object.freeze({
    kind: "uncertain",
    value,
    initialSettlementCause,
    recoveryDeadline,
    quarantine: quarantineResult,
  });
});

function recoveryLifecycleUnresolved(
  cause: Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
): FrameworkSchemaArtifactControlRecoverySettlement<never, never> {
  const resolution = Object.freeze({
    kind: "lifecycle",
    cause,
  } satisfies Extract<
    FrameworkSchemaArtifactControlRecoverySettlement<never, never>,
    { readonly kind: "unresolved" }
  >["resolution"]);
  return Object.freeze({
    kind: "unresolved",
    resolution,
  });
}

function recoveryLifecycleAfterQuarantine(
  connection: CheckedOutConnection,
  primary: Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.Effect<
  FrameworkSchemaArtifactControlRecoverySettlement<never, never>,
  never,
  never
> {
  return Effect.map(
    quarantineConnectionEffect(connection, options),
    quarantined => recoveryLifecycleUnresolved(
      quarantined.kind === "confirmed"
        ? primary
        : Cause.combine(
          primary,
          Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
            phase: "quarantine",
            cause: quarantined.cause,
          })),
        ),
    ),
  );
}

const rollbackRecoveryLifecycle = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.rollbackRecoveryLifecycle",
)(function*(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  primary: Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlRecoverySettlement<never, never>,
  never
> {
  connection.closeWorkFence();
  const rollback = yield* Effect.exit(runRawQueryEffect(
    connection,
    deadline,
    "rollback",
    "rollback",
  ));
  const rollbackCause = Exit.isFailure(rollback)
    ? rollback.cause
    : unexpectedCommandCause(rollback.value, "ROLLBACK", "rollback");
  if (rollbackCause !== undefined) {
    return yield* recoveryLifecycleAfterQuarantine(
      connection,
      Cause.combine(primary, rollbackCause),
      options,
    );
  }
  const release = yield* releaseConnectionEffect(
    connection,
    false,
    "release",
    options,
  );
  if (release.kind === "failed") {
    return yield* recoveryLifecycleAfterQuarantine(
      connection,
      Cause.combine(
        primary,
        Cause.fail(resourceIssue("release", release.cause)),
      ),
      options,
    );
  }
  return recoveryLifecycleUnresolved(primary);
});

const settleRecoveryCallbackFailure = Effect.fn(
  "FrameworkSchemaArtifactPostgresControlSession.settleRecoveryCallbackFailure",
)(function*<Failure>(
  connection: CheckedOutConnection,
  deadline: FrameworkSchemaArtifactControlDeadline,
  callbackCause: Cause.Cause<Failure>,
  options: NormalizedPostgresControlSessionOptions,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlRecoverySettlement<never, Failure>,
  never
> {
  const rollback = yield* Effect.exit(runRawQueryEffect(
    connection,
    deadline,
    "rollback",
    "rollback",
  ));
  let resolutionCause: Cause.Cause<Failure> = callbackCause;
  const rollbackCause = Exit.isFailure(rollback)
    ? rollback.cause
    : unexpectedCommandCause(rollback.value, "ROLLBACK", "rollback");
  if (rollbackCause !== undefined) {
    resolutionCause = Cause.combine(
      callbackCause,
      Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
        phase: "rollback",
        cause: rollbackCause,
      })),
    );
    const quarantined = yield* quarantineConnectionEffect(
      connection,
      options,
    );
    if (quarantined.kind === "failed") {
      resolutionCause = Cause.combine(
        resolutionCause,
        Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
          phase: "quarantine",
          cause: quarantined.cause,
        })),
      );
    }
  } else {
    const release = yield* releaseConnectionEffect(
      connection,
      false,
      "release",
      options,
    );
    if (release.kind === "failed") {
      resolutionCause = Cause.combine(
        resolutionCause,
        Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
          phase: "release",
          cause: release.cause,
        })),
      );
      const quarantined = yield* quarantineConnectionEffect(
        connection,
        options,
      );
      if (quarantined.kind === "failed") {
        resolutionCause = Cause.combine(
          resolutionCause,
          Cause.die(new FrameworkSchemaArtifactControlSessionCleanupDefect({
            phase: "quarantine",
            cause: quarantined.cause,
          })),
        );
      }
    }
  }
  return Object.freeze({
    kind: "unresolved",
    resolution: Object.freeze({
      kind: "callback",
      cause: resolutionCause,
    }),
  });
});

function destroyLateAcquisition(client: PoolClient): void {
  try {
    client.release(true);
  } catch {
    // Acquisition already completed as abandoned. node-postgres exposes no
    // later channel through which this best-effort discard can be reported.
  }
}

function destroyAcquiredAfterConstructionFailure(
  client: PoolClient,
): unknown | undefined {
  try {
    client.release(true);
    return undefined;
  } catch (cause) {
    return cause;
  }
}

function completeCallbackBoundaryCause<Failure>(
  boundaryCause:
    Cause.Cause<FrameworkSchemaArtifactControlSessionResourceIssue>,
  settlement: Exit.Exit<unknown, Failure> | undefined,
): Cause.Cause<
  Failure | FrameworkSchemaArtifactControlSessionResourceIssue
> {
  return settlement === undefined || Exit.isSuccess(settlement)
    ? boundaryCause
    : combineCausesWithoutDuplicateInterrupts(
      settlement.cause,
      boundaryCause,
    );
}

function combineCausesWithoutDuplicateInterrupts<First, Second>(
  first: Cause.Cause<First>,
  second: Cause.Cause<Second>,
): Cause.Cause<First | Second> {
  const recordedInterruptors = new Set(
    first.reasons
      .filter(Cause.isInterruptReason)
      .map(reason => reason.fiberId),
  );
  const newReasons = second.reasons.filter(reason =>
    !Cause.isInterruptReason(reason) ||
    !recordedInterruptors.has(reason.fiberId)
  );
  return newReasons.length === 0
    ? first
    : Cause.combine(first, Cause.fromReasons(newReasons));
}

function hasOnlyInterruptReasons(cause: Cause.Cause<unknown>): boolean {
  return cause.reasons.length > 0 &&
    cause.reasons.every(Cause.isInterruptReason);
}

function cleanupDefectCause(
  phase: "rollback" | "release" | "quarantine",
  cause: unknown,
): Cause.Cause<never> {
  return Cause.die(
    new FrameworkSchemaArtifactControlSessionCleanupDefect({ phase, cause }),
  );
}

function aggregateCauses(causes: readonly unknown[], message: string): unknown {
  return causes.length === 1
    ? causes[0]
    : new AggregateError(causes, message);
}

function normalizePostgresControlSessionOptions(
  options: PostgresControlSessionOptions,
): NormalizedPostgresControlSessionOptions {
  const timeout = options.quarantineDrainTimeoutMilliseconds ??
    DEFAULT_QUARANTINE_DRAIN_TIMEOUT_MILLISECONDS;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAXIMUM_QUARANTINE_DRAIN_TIMEOUT_MILLISECONDS
  ) {
    throw new RangeError(
      "PostgreSQL quarantine drain timeout must be an integer from 1 through 60000 milliseconds.",
    );
  }
  const lifecycleFault = options.lifecycleFault;
  return Object.freeze({
    lifecycleFault,
    quarantineDrainTimeoutMilliseconds: timeout,
  });
}
