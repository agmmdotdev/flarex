import {
  InvalidTaskRunInitialAggregateError,
  decodeApplicationTaskRunCreationReceiptV1,
  decodeApplicationTaskRunCreationRequestV1,
  encodeApplicationTaskRunCreationRequestPreimageV1,
  encodeTaskRunCreationRequestKeyPreimageV1,
  makeApplicationTaskRunCreationInitialAggregateV1,
  type ApplicationTaskRunCreationReceiptV1,
  type ApplicationTaskRunCreationRequestV1,
  type ApplicationTaskRuntimeTargetSha256V1,
  type TaskInputSha256V1,
  type TaskRunCreationAuthoritySha256V1,
  type TaskRunCreationRequestKeySha256V1,
  type TaskRunCreationRequestSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decodeTaskDatabaseTimeMsV1,
  decodeTaskDurationMsV1,
  decodeTaskRunIdV1,
  encodeApplicationTaskRunAttemptAggregateJsonV1,
  projectApplicationTaskRunAttemptPersistenceV1,
  type TaskDatabaseTimeMsV1,
  type TaskDurationMsV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  type StandardApplicationTaskSha256V1,
  type TaskDefinitionSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  decodeApplicationTaskRunCreationAuthorityPreimageV1,
  encodeApplicationTaskRunCreationAuthorityPreimageV1,
  type ApplicationTaskRunCreationAuthorityV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { bytesEqual, copyBytes } from "@flarex/utils/bytes";
import { and, eq, sql } from "drizzle-orm";
import { Brand, Cause, Effect, Exit, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  type ApplicationTaskSelection,
  type SelectApplicationTaskError,
  claimApplicationTaskSelection,
  validateApplicationTaskSelectionInTransaction,
} from "./applicationTaskSelection";
import {
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import {
  TaskRunCreationIdempotencyConflictError,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  TaskSystemRunCreationBindingError,
  TaskSystemRunCreationCorruptionError,
  TaskSystemRunCreationStaleScopeAuthorityError,
  TaskSystemRunCreationTerminalStoreError,
  TaskSystemRunCreationTransientStoreError,
  type TaskSystemRunCreationErrorV1,
} from "./taskSystemRunCreationV1";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
} from "./taskSystemScopeAuthorityV1";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const MAX_TRANSACTION_EXECUTIONS = 3;
const requestKeyDigest = Brand.nominal<TaskRunCreationRequestKeySha256V1>();
const requestDigest = Brand.nominal<TaskRunCreationRequestSha256V1>();
const authorityDigest = Brand.nominal<TaskRunCreationAuthoritySha256V1>();
const inputDigest = Brand.nominal<TaskInputSha256V1>();
const runtimeTargetDigest = Brand.nominal<ApplicationTaskRuntimeTargetSha256V1>();

type RunRequestRow = typeof fxSystemDurableTaskRunRequestsV1.$inferSelect;
type RunRow = typeof fxSystemDurableTaskRunsV1.$inferSelect;

export type ApplicationTaskSystemRunCreationError =
  | TaskSystemRunCreationErrorV1
  | SelectApplicationTaskError;

export interface ApplicationTaskSystemRunCreationOptions {
  readonly sha256: StandardApplicationTaskSha256V1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
  readonly randomUuid?: () => string;
}

export interface ApplicationTaskSystemRunCreationStore {
  readonly createRun: (
    selection: ApplicationTaskSelection,
    request: ApplicationTaskRunCreationRequestV1,
  ) => Effect.Effect<
    ApplicationTaskRunCreationReceiptV1,
    ApplicationTaskSystemRunCreationError
  >;
}

interface CapturedApplicationTaskSystemRunCreationOptions {
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}

interface PreparedCreation {
  readonly selection: ApplicationTaskSelection;
  readonly request: ApplicationTaskRunCreationRequestV1;
  readonly requestKeySha256: TaskRunCreationRequestKeySha256V1;
  readonly requestSha256: TaskRunCreationRequestSha256V1;
}

export function makeApplicationTaskSystemRunCreationStore(
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  options: ApplicationTaskSystemRunCreationOptions,
): ApplicationTaskSystemRunCreationStore {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  const sha256 = options.sha256;
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const capturedOptions = captureCreationOptions(options);
  return Object.freeze({
    createRun: (
      selection: ApplicationTaskSelection,
      request: ApplicationTaskRunCreationRequestV1,
    ) => createApplicationRun(
      authority,
      target,
      sha256,
      capturedOptions,
      randomUuid,
      selection,
      request,
    ),
  });
}

const createApplicationRun = Effect.fn(
  "ApplicationTaskSystemRunCreation.createRun",
)(function* (
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  sha256: StandardApplicationTaskSha256V1,
  capturedOptions: Result.Result<
    CapturedApplicationTaskSystemRunCreationOptions,
    InvalidTaskRunInitialAggregateError
  >,
  randomUuid: () => string,
  selection: ApplicationTaskSelection,
  rawRequest: ApplicationTaskRunCreationRequestV1,
): Effect.fn.Return<
  ApplicationTaskRunCreationReceiptV1,
  ApplicationTaskSystemRunCreationError
> {
  const options = yield* Effect.fromResult(capturedOptions);
  const request = yield* Effect.fromResult(
    decodeApplicationTaskRunCreationRequestV1(rawRequest),
  );
  const claimed = yield* Effect.fromResult(claimApplicationTaskSelection(selection));
  if (!sameTrustedAuthority(claimed.basis.authority, authority)
    || !bytesEqual(
      claimed.runtimeTargetSha256,
      request.applicationTaskRuntimeTargetSha256,
    )) return yield* new TaskSystemRunCreationBindingError({
    operation: "create_run",
    reason: "request_authority_mismatch",
  });
  const requestKeyBytes = yield* Effect.fromResult(
    encodeTaskRunCreationRequestKeyPreimageV1(request.requestKey),
  );
  const requestBytes = yield* Effect.fromResult(
    encodeApplicationTaskRunCreationRequestPreimageV1(request),
  );
  const prepared: PreparedCreation = Object.freeze({
    selection,
    request,
    requestKeySha256: requestKeyDigest(
      yield* hashBytes(requestKeyBytes, sha256),
    ),
    requestSha256: requestDigest(yield* hashBytes(requestBytes, sha256)),
  });
  for (let execution = 1; execution <= MAX_TRANSACTION_EXECUTIONS; execution += 1) {
    const settled = yield* Effect.exit(awaitTransaction(
      target[RUN_LOCATED_READ_COMMITTED_V1](tx => transactApplicationCreation(
        tx,
        authority,
        target,
        sha256,
        options.leaseDurationMs,
        options.immediateRetryThresholdMs,
        randomUuid,
        prepared,
      )),
    ));
    if (Exit.isSuccess(settled)) {
      return yield* Effect.fromResult(decodeApplicationTaskRunCreationReceiptV1(
        settled.value,
      ));
    }
    const cause = yield* Result.match(Cause.findError(settled.cause), {
      onFailure: Effect.failCause,
      onSuccess: Effect.succeed,
    });
    if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
      if (cause.issue.kind === "callbackRolledBack") {
        const rollback = cause.issue.callbackCause;
        if (rollback instanceof ApplicationCreationRollback) {
          return yield* Effect.fail(rollback.error);
        }
        if (rollback instanceof ApplicationCreationCauseRollback) {
          return yield* Effect.failCause(rollback.cause);
        }
        if (execution < MAX_TRANSACTION_EXECUTIONS && isRetryable(cause.issue.callbackCause)) {
          continue;
        }
      }
      return yield* new TaskSystemRunCreationTransientStoreError({
        operation: "create_run",
        reason: cause.issue.kind === "infrastructureFailure"
          ? "connection_unavailable"
          : "driver_failure",
        cause,
      });
    }
    return yield* Effect.die(cause);
  }
  return yield* new TaskSystemRunCreationTransientStoreError({
    operation: "create_run",
    reason: "transaction_conflict",
    cause: null,
  });
});

async function transactApplicationCreation(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  sha256: StandardApplicationTaskSha256V1,
  leaseDurationMs: TaskDurationMsV1,
  immediateRetryThresholdMs: TaskDurationMsV1,
  randomUuid: () => string,
  prepared: PreparedCreation,
): Promise<ApplicationTaskRunCreationReceiptV1> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => rollback(new TaskSystemRunCreationStaleScopeAuthorityError({
      operation: "create_run",
      authority: mismatch,
    })),
  );
  const existing = await loadRequest(
    tx, authority.scopeId, prepared.requestKeySha256,
  );
  if (existing !== null) return replayCreation(
    tx, authority.scopeId, existing, prepared, sha256,
  );

  const metadata = await runEffectInTransaction(
    validateApplicationTaskSelectionInTransaction(
      prepared.selection,
      tx,
      authority,
    ),
  );
  if (metadata.basis.authority.scopeId !== authority.scopeId
    || !bytesEqual(
      metadata.runtimeTargetSha256,
      prepared.request.applicationTaskRuntimeTargetSha256,
    )) throw rollback(new TaskSystemRunCreationBindingError({
      operation: "create_run",
      reason: "authority_binding_mismatch",
    }));
  const creationAuthority: ApplicationTaskRunCreationAuthorityV1 = {
    version: 1,
    scopeId: authority.scopeId,
    activationSequence: metadata.basis.activationSequence,
    activeHeadSha256: copyBytes(metadata.basis.headSha256) as TaskDefinitionSha256V1,
    readinessSha256: copyBytes(metadata.basis.readinessSha256) as TaskDefinitionSha256V1,
    applicationTaskRuntimeTargetSha256: copyBytes(
      metadata.runtimeTargetSha256,
    ) as TaskDefinitionSha256V1,
  };
  const authorityBytes = Result.getOrThrowWith(
    encodeApplicationTaskRunCreationAuthorityPreimageV1(creationAuthority),
    cause => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "creation_authority_invalid",
    })),
  );
  const creationAuthoritySha256 = authorityDigest(
    await runEffectInTransaction(hashBytes(authorityBytes, sha256)),
  );
  const runId = allocateRunId(randomUuid);
  const createdAtMs = await readDatabaseNow(tx, authority.scopeId);
  const maximumDurationMs = Result.getOrThrowWith(
    decodeTaskDurationMsV1(metadata.manifest.maximumDurationInSeconds * 1_000),
    cause => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "run_row_invalid",
    })),
  );
  const aggregate = Result.getOrThrowWith(
    makeApplicationTaskRunCreationInitialAggregateV1({
      runId,
      applicationTaskRuntimeTargetSha256: runtimeTargetDigest(
        copyBytes(metadata.runtimeTargetSha256),
      ),
      createdAtMs,
      runAttemptPolicy: metadata.manifest.runAttemptPolicy,
      maximumDurationMs,
      initialComputeProfile: metadata.manifest.computeProfile,
      leaseDurationMs,
      immediateRetryThresholdMs,
    }),
    rollback,
  );
  const aggregateJson = Result.getOrThrowWith(
    encodeApplicationTaskRunAttemptAggregateJsonV1(aggregate),
    cause => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "run_row_invalid",
    })),
  );
  const projection = projectApplicationTaskRunAttemptPersistenceV1(aggregate);
  await tx.insert(fxSystemDurableTaskRunsV1).values({
    scopeId: authority.scopeId,
    runId,
    definitionGeneration: "application_v1",
    taskDefinitionRevisionId: null,
    applicationTaskRuntimeTargetSha256: runtimeTargetDigest(
      copyBytes(metadata.runtimeTargetSha256),
    ),
    createdAtMs: BigInt(createdAtMs),
    inputCodec: prepared.request.input.codec,
    inputStore: prepared.request.input.store,
    inputValueCodec: prepared.request.input.valueCodec,
    inputObjectKey: prepared.request.input.objectKey,
    inputByteLength: BigInt(prepared.request.input.byteLength),
    inputSha256: inputDigest(copyBytes(prepared.request.input.sha256)),
    inputRetention: prepared.request.input.retention.kind,
    creationAuthorityCodecVersion: 1,
    creationAuthorityByteLength: BigInt(authorityBytes.byteLength),
    creationAuthoritySha256,
    creationAuthorityBytes: copyBytes(authorityBytes),
    aggregateCodecVersion: 1,
    aggregateByteLength: encodedJsonByteLength(aggregateJson),
    aggregateJson,
    runVersion: projection.runVersion,
    phase: projection.phase,
    dueKind: projection.dueKind,
    dueAtMs: nullableNumberAsBigInt(projection.dueAtMs),
    currentAttemptId: projection.currentAttemptId,
    executionFenceBasis: projection.executionFenceBasis,
    currentLeaseVersion: projection.currentLeaseVersion,
    currentLeaseExpiresAtMs: nullableNumberAsBigInt(
      projection.currentLeaseExpiresAtMs,
    ),
    cancellationGeneration: projection.cancellationGeneration,
    requestedEffectSequence: projection.requestedEffectSequence,
  });
  await tx.insert(fxSystemDurableTaskRunRequestsV1).values({
    scopeId: authority.scopeId,
    requestKeyCodecVersion: 1,
    requestKeySha256: requestKeyDigest(copyBytes(prepared.requestKeySha256)),
    requestCodecVersion: 1,
    requestSha256: requestDigest(copyBytes(prepared.requestSha256)),
    runId,
    receiptVersion: 1,
  });
  return receipt(prepared, runId, createdAtMs, creationAuthoritySha256);
}

async function replayCreation(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  requestRow: RunRequestRow,
  prepared: PreparedCreation,
  sha256: StandardApplicationTaskSha256V1,
): Promise<ApplicationTaskRunCreationReceiptV1> {
  if (requestRow.requestKeyCodecVersion !== 1
    || requestRow.requestCodecVersion !== 1
    || requestRow.receiptVersion !== 1
    || !bytesEqual(requestRow.requestKeySha256, prepared.requestKeySha256)) {
    throw rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "idempotency_row_invalid",
    }));
  }
  if (!bytesEqual(requestRow.requestSha256, prepared.requestSha256)) {
    throw rollback(new TaskRunCreationIdempotencyConflictError({
      requestKey: prepared.request.requestKey,
      reason: "request_digest_mismatch",
    }));
  }
  const runId = Result.getOrThrowWith(
    decodeTaskRunIdV1(requestRow.runId),
    () => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "idempotency_row_invalid",
    })),
  );
  const run = await loadRun(tx, scopeId, runId);
  if (run === null || !runMatches(run, prepared)) throw rollback(
    new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "run_row_invalid",
    }),
  );
  const decoded = Result.getOrThrowWith(
    decodeAndCorrelateTaskSystemRunRowV1(run),
    () => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "run_row_invalid",
    })),
  );
  if (decoded.generation !== "application_v1") throw rollback(
    new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "run_row_invalid",
    }),
  );
  const authority = Result.getOrThrowWith(
    decodeApplicationTaskRunCreationAuthorityPreimageV1(
      run.creationAuthorityBytes,
    ),
    cause => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "creation_authority_invalid",
    })),
  );
  const observedSha256 = authorityDigest(await runEffectInTransaction(
    hashBytes(run.creationAuthorityBytes, sha256),
  ));
  if (authority.scopeId !== scopeId
    || !bytesEqual(
      authority.applicationTaskRuntimeTargetSha256,
      prepared.request.applicationTaskRuntimeTargetSha256,
    )
    || !bytesEqual(observedSha256, run.creationAuthoritySha256)) {
    throw rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "creation_authority_invalid",
    }));
  }
  const createdAtMs = Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(run.createdAtMs)),
    () => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "run_row_invalid",
    })),
  );
  return receipt(prepared, runId, createdAtMs, observedSha256);
}

function receipt(
  prepared: PreparedCreation,
  runId: TaskRunIdV1,
  createdAtMs: TaskDatabaseTimeMsV1,
  creationAuthoritySha256: TaskRunCreationAuthoritySha256V1,
): ApplicationTaskRunCreationReceiptV1 {
  return Result.getOrThrow(decodeApplicationTaskRunCreationReceiptV1({
    status: "created",
    version: 1,
    runId,
    applicationTaskRuntimeTargetSha256:
      prepared.request.applicationTaskRuntimeTargetSha256,
    createdAtMs,
    requestKeySha256: prepared.requestKeySha256,
    requestSha256: prepared.requestSha256,
    creationAuthoritySha256,
  }));
}

async function loadRequest(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  digest: TaskRunCreationRequestKeySha256V1,
): Promise<RunRequestRow | null> {
  const rows = await tx.select().from(fxSystemDurableTaskRunRequestsV1)
    .where(and(
      eq(fxSystemDurableTaskRunRequestsV1.scopeId, scopeId),
      eq(fxSystemDurableTaskRunRequestsV1.requestKeySha256, digest),
    )).limit(1).for("update");
  return rows[0] ?? null;
}

async function loadRun(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
): Promise<RunRow | null> {
  const rows = await tx.select().from(fxSystemDurableTaskRunsV1).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, runId),
  )).limit(1).for("share");
  return rows[0] ?? null;
}

function runMatches(run: RunRow, prepared: PreparedCreation): boolean {
  const input = prepared.request.input;
  return run.definitionGeneration === "application_v1"
    && run.taskDefinitionRevisionId === null
    && run.applicationTaskRuntimeTargetSha256 !== null
    && bytesEqual(
      run.applicationTaskRuntimeTargetSha256,
      prepared.request.applicationTaskRuntimeTargetSha256,
    )
    && run.inputCodec === input.codec
    && run.inputStore === input.store
    && run.inputValueCodec === input.valueCodec
    && run.inputObjectKey === input.objectKey
    && run.inputByteLength === BigInt(input.byteLength)
    && bytesEqual(run.inputSha256, input.sha256)
    && run.inputRetention === input.retention.kind;
}

async function readDatabaseNow(
  tx: AppRowTransaction,
  scopeId: ScopeId,
): Promise<TaskDatabaseTimeMsV1> {
  const rows = await tx.select({ milliseconds: sql<string>`
    floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  ` }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string" || !/^(0|[1-9][0-9]*)$/.test(text)) {
    throw rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "database_clock_invalid",
    }));
  }
  return Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(text)),
    () => rollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run", reason: "database_clock_invalid",
    })),
  );
}

function allocateRunId(randomUuid: () => string): TaskRunIdV1 {
  try {
    return Result.getOrThrow(decodeTaskRunIdV1(`run_${randomUuid()}`));
  } catch (cause) {
    throw rollback(new TaskSystemRunCreationTerminalStoreError({
      operation: "create_run",
      reason: "identity_allocation_exhausted",
      cause,
    }));
  }
}

function hashBytes(
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
) {
  return sha256(bytes, {
    maximumInputBytes: MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  }).pipe(Effect.map(copyBytes));
}

function encodedJsonByteLength(value: unknown): bigint {
  return BigInt(UTF8.encode(JSON.stringify(value)).byteLength);
}

function sameTrustedAuthority(
  left: TrustedScopeAuthority,
  right: TrustedScopeAuthority,
): boolean {
  return left.deploymentId === right.deploymentId
    && left.scopeId === right.scopeId
    && left.storageGeneration === right.storageGeneration
    && left.storageGenerationFence === right.storageGenerationFence
    && left.epoch === right.epoch
    && scopePhysicalLocatorsEqual(left.physicalLocator, right.physicalLocator);
}

function nullableNumberAsBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function captureCreationOptions(
  options: ApplicationTaskSystemRunCreationOptions,
): Result.Result<
  CapturedApplicationTaskSystemRunCreationOptions,
  InvalidTaskRunInitialAggregateError
> {
  return Result.gen(function* () {
    const leaseDurationMs = yield* decodeTaskDurationMsV1(
      options.leaseDurationMs,
    ).pipe(Result.mapError(initialAggregateError));
    const immediateRetryThresholdMs = yield* decodeTaskDurationMsV1(
      options.immediateRetryThresholdMs,
    ).pipe(Result.mapError(initialAggregateError));
    return Object.freeze({ leaseDurationMs, immediateRetryThresholdMs });
  });
}

function initialAggregateError(cause: unknown): InvalidTaskRunInitialAggregateError {
  return new InvalidTaskRunInitialAggregateError({
    operation: "make_initial_aggregate",
    reason: "invalid_initial_aggregate",
    cause,
  });
}

async function runEffectInTransaction<Value>(
  effect: Effect.Effect<Value, ApplicationTaskSystemRunCreationError>,
): Promise<Value> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw new ApplicationCreationCauseRollback(exit.cause);
}

function awaitTransaction<Value>(transaction: Promise<Value>) {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => transaction,
    catch: cause => cause,
  }));
}

class ApplicationCreationRollback {
  constructor(readonly error: ApplicationTaskSystemRunCreationError) {}
}

class ApplicationCreationCauseRollback {
  constructor(readonly cause: Cause.Cause<ApplicationTaskSystemRunCreationError>) {}
}

function rollback(error: ApplicationTaskSystemRunCreationError) {
  return new ApplicationCreationRollback(error);
}

function isRetryable(cause: unknown): boolean {
  const descriptor = sqlErrorDescriptor(cause);
  return descriptor?.code === "40001"
    || descriptor?.code === "40P01"
    || (
      descriptor?.code === "23505"
      && (
        descriptor.constraint === "fx_task_run_request_v1_pk"
        || descriptor.constraint === "fx_task_run_v1_pk"
        || descriptor.constraint === "fx_task_run_request_v1_run_unique"
      )
    );
}

function sqlErrorDescriptor(cause: unknown): Readonly<{
  readonly code: string;
  readonly constraint: string | undefined;
}> | undefined {
  let current = cause;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = Reflect.get(current, "code");
    if (typeof code === "string") {
      const constraint = Reflect.get(current, "constraint");
      return Object.freeze({
        code,
        constraint: typeof constraint === "string" ? constraint : undefined,
      });
    }
    current = Reflect.get(current, "cause");
  }
  return undefined;
}
