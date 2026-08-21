import {
  InvalidTaskRunCreationRequestError,
  InvalidTaskRunInitialAggregateError,
  TaskRunCreationIdempotencyConflictError,
  decodeTaskRunCreationReceiptV1,
  decodeTaskRunCreationRequestV1,
  encodeTaskRunCreationRequestKeyPreimageV1,
  encodeTaskRunCreationRequestPreimageV1,
  makeTaskRunCreationInitialAggregateV1,
  type TaskInputSha256V1,
  type TaskRunCreationAuthoritySha256V1,
  type TaskRunCreationReceiptV1,
  type TaskRunCreationRequestKeySha256V1,
  type TaskRunCreationRequestSha256V1,
  type TaskRunCreationRequestV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decodeTaskDatabaseTimeMsV1,
  decodeTaskDurationMsV1,
  decodeTaskRunIdV1,
  encodePersistedTaskRunAttemptAggregateJsonV1,
  projectTaskRunAttemptPersistenceV1,
  type TaskDatabaseTimeMsV1,
  type TaskDurationMsV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  InvalidStandardApplicationTaskDefinitionV1Error,
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRunCreationAuthorityReceiptPreimageV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  encodeTaskRunCreationAuthorityReceiptPreimageV1,
  hashTaskDefinitionRuntimeBindingV1,
  hashTaskRunCreationAuthorityReceiptV1,
  type StandardApplicationTaskSha256V1,
  type StandardApplicationTaskSha256V1Error,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskRunCreationAuthorityReceiptV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { and, eq, sql } from "drizzle-orm";
import { Brand, Cause, Data, Effect, Exit, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
  type TaskSystemScopeAuthorityMismatchV1,
} from "./taskSystemScopeAuthorityV1";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const MAX_TRANSACTION_EXECUTIONS = 3;
const RUN_REQUEST_PRIMARY_KEY = "fx_task_run_request_v1_pk";
const RUN_PRIMARY_KEY = "fx_task_run_v1_pk";
const RUN_REQUEST_RUN_UNIQUE = "fx_task_run_request_v1_run_unique";

const requestKeyDigest = Brand.nominal<TaskRunCreationRequestKeySha256V1>();
const requestDigest = Brand.nominal<TaskRunCreationRequestSha256V1>();
const creationAuthorityDigest =
  Brand.nominal<TaskRunCreationAuthoritySha256V1>();
const inputDigest = Brand.nominal<TaskInputSha256V1>();

type TaskDefinitionRow =
  typeof fxSystemDurableTaskDefinitionRevisionsV1.$inferSelect;
type TaskRunRequestRow = typeof fxSystemDurableTaskRunRequestsV1.$inferSelect;
type TaskRunRow = typeof fxSystemDurableTaskRunsV1.$inferSelect;

export class TaskSystemRunCreationBindingError extends Data.TaggedError(
  "TaskSystemRunCreationBindingError",
)<{
  readonly operation: "create_run";
  readonly reason:
    | "request_authority_mismatch"
    | "authority_binding_mismatch"
    | "definition_unavailable"
    | "stored_binding_mismatch";
}> {}

export class TaskSystemRunCreationCorruptionError extends Data.TaggedError(
  "TaskSystemRunCreationCorruptionError",
)<{
  readonly operation: "create_run";
  readonly reason:
    | "idempotency_row_invalid"
    | "run_row_invalid"
    | "creation_authority_invalid"
    | "database_clock_invalid";
}> {}

export class TaskSystemRunCreationStaleScopeAuthorityError
  extends Data.TaggedError("TaskSystemRunCreationStaleScopeAuthorityError")<{
    readonly operation: "create_run";
    readonly authority: TaskSystemScopeAuthorityMismatchV1;
  }> {}

export class TaskSystemRunCreationTransientStoreError extends Data.TaggedError(
  "TaskSystemRunCreationTransientStoreError",
)<{
  readonly operation: "create_run";
  readonly reason:
    | "transaction_conflict"
    | "connection_unavailable"
    | "timeout"
    | "driver_failure";
  readonly cause: unknown;
}> {}

export class TaskSystemRunCreationTerminalStoreError extends Data.TaggedError(
  "TaskSystemRunCreationTerminalStoreError",
)<{
  readonly operation: "create_run";
  readonly reason: "identity_allocation_exhausted" | "unsupported_integration";
  readonly cause: unknown;
}> {}

export type TaskSystemRunCreationErrorV1 =
  | InvalidTaskRunCreationRequestError
  | InvalidTaskRunInitialAggregateError
  | TaskRunCreationIdempotencyConflictError
  | InvalidStandardApplicationTaskDefinitionV1Error
  | StandardApplicationTaskSha256V1Error
  | TaskSystemRunCreationBindingError
  | TaskSystemRunCreationCorruptionError
  | TaskSystemRunCreationStaleScopeAuthorityError
  | TaskSystemRunCreationTransientStoreError
  | TaskSystemRunCreationTerminalStoreError;

export interface TaskSystemRunCreationStoreOptionsV1 {
  readonly sha256: StandardApplicationTaskSha256V1;
  /** Trusted immutable result of the upstream active task-selection owner. */
  readonly runtimeBinding: TaskDefinitionRuntimeBindingV1;
  /** Audit evidence captured with that trusted selection; not a capability. */
  readonly creationAuthority: TaskRunCreationAuthorityReceiptV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
  readonly randomUuid?: () => string;
}

export interface TaskSystemRunCreationStoreShapeV1 {
  readonly createRun: (
    request: TaskRunCreationRequestV1,
  ) => Effect.Effect<TaskRunCreationReceiptV1, TaskSystemRunCreationErrorV1>;
}

interface CapturedTaskSystemRunCreationOptionsV1 {
  readonly sha256: StandardApplicationTaskSha256V1;
  readonly runtimeBinding: TaskDefinitionRuntimeBindingV1;
  readonly creationAuthority: TaskRunCreationAuthorityReceiptV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}

interface PreparedCreationV1 {
  readonly request: TaskRunCreationRequestV1;
  readonly binding: TaskDefinitionRuntimeBindingV1;
  readonly authority: TaskRunCreationAuthorityReceiptV1;
  readonly requestKeySha256: TaskRunCreationRequestKeySha256V1;
  readonly requestSha256: TaskRunCreationRequestSha256V1;
  readonly bindingBytes: Uint8Array;
  readonly bindingSha256: TaskDefinitionSha256V1;
  readonly authorityBytes: Uint8Array;
  readonly authoritySha256: TaskRunCreationAuthoritySha256V1;
  readonly maximumDurationMs: TaskDurationMsV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}

interface CreationTransactionResultV1 {
  readonly receipt: TaskRunCreationReceiptV1;
  readonly authorityBytes: Uint8Array;
  readonly authoritySha256: TaskRunCreationAuthoritySha256V1;
}

/**
 * Creates one scope-bound operation capability. Multiple located tenant scopes
 * intentionally receive distinct instances rather than one global service.
 */
export function makeTaskSystemRunCreationStoreV1(
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  options: TaskSystemRunCreationStoreOptionsV1,
): TaskSystemRunCreationStoreShapeV1 {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  const capturedOptions = captureCreationOptions(options);
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  return Object.freeze({
    createRun: (request: TaskRunCreationRequestV1) => createRun(
      authority,
      target,
      capturedOptions,
      randomUuid,
      request,
    ),
  });
}

const createRun = Effect.fn("TaskSystemRunCreation.createRun")(
  function* (
    authority: TrustedScopeAuthority,
    target: LocatedReadCommittedAttemptTargetV1,
    capturedOptions: Result.Result<
      CapturedTaskSystemRunCreationOptionsV1,
      TaskSystemRunCreationErrorV1
    >,
    randomUuid: () => string,
    request: TaskRunCreationRequestV1,
  ): Effect.fn.Return<
    TaskRunCreationReceiptV1,
    TaskSystemRunCreationErrorV1
  > {
    const options = yield* Effect.fromResult(capturedOptions);
    const prepared = yield* prepareCreation(request, options);
    for (
      let execution = 1;
      execution <= MAX_TRANSACTION_EXECUTIONS;
      execution += 1
    ) {
      const settled = yield* Effect.exit(awaitLocatedTransaction(
        target[RUN_LOCATED_READ_COMMITTED_V1](tx => transactCreationOnce(
          tx,
          authority,
          target,
          randomUuid,
          prepared,
        )),
      ));
      if (Exit.isSuccess(settled)) {
        const observedAuthorityDigest = yield* hashBytes(
          settled.value.authorityBytes,
          options.sha256,
        );
        if (!bytesEqual(
          observedAuthorityDigest,
          settled.value.authoritySha256,
        )) {
          return yield* new TaskSystemRunCreationCorruptionError({
            operation: "create_run",
            reason: "creation_authority_invalid",
          });
        }
        return yield* Effect.fromResult(
          decodeTaskRunCreationReceiptV1(settled.value.receipt).pipe(
            Result.mapError(() => new TaskSystemRunCreationCorruptionError({
              operation: "create_run",
              reason: "run_row_invalid",
            })),
          ),
        );
      }
      const failure = Cause.findError(settled.cause);
      if (Result.isFailure(failure)) {
        return yield* Effect.failCause(failure.failure);
      }
      const classified = classifyTransactionFailure(
        failure.success,
        execution,
      );
      if (classified.kind === "retry") continue;
      if (classified.kind === "fail") return yield* classified.error;
      if (classified.kind === "cleanup") {
        return yield* Effect.failCause(Cause.combine(
          Cause.fail(classified.callback),
          Cause.die(classified.cause),
        ));
      }
      return yield* Effect.die(classified.cause);
    }
    return yield* new TaskSystemRunCreationTransientStoreError({
      operation: "create_run",
      reason: "transaction_conflict",
      cause: null,
    });
  },
);

const prepareCreation = Effect.fn("TaskSystemRunCreation.prepareCreation")(
  function* (
    rawRequest: TaskRunCreationRequestV1,
    options: CapturedTaskSystemRunCreationOptionsV1,
  ): Effect.fn.Return<PreparedCreationV1, TaskSystemRunCreationErrorV1> {
    const request = yield* Effect.fromResult(
      decodeTaskRunCreationRequestV1(rawRequest),
    );
    const binding = options.runtimeBinding;
    const authority = options.creationAuthority;
    if (request.taskDefinitionRevisionId !== authority.taskDefinitionRevisionId) {
      return yield* new TaskSystemRunCreationBindingError({
        operation: "create_run",
        reason: "request_authority_mismatch",
      });
    }
    if (
      authority.applicationRevisionId !== binding.applicationRevisionId
      || !bytesEqual(authority.candidateSha256, binding.candidateSha256)
      || !bytesEqual(
        authority.applicationRevisionTaskBindingSha256,
        binding.applicationRevisionTaskBindingSha256,
      )
    ) {
      return yield* new TaskSystemRunCreationBindingError({
        operation: "create_run",
        reason: "authority_binding_mismatch",
      });
    }
    const maximumDurationMs = yield* durationOrInitialAggregateError(
      binding.manifest.maximumDurationInSeconds * 1_000,
    );
    const leaseDurationMs = options.leaseDurationMs;
    const immediateRetryThresholdMs = options.immediateRetryThresholdMs;
    const requestKeyBytes = yield* Effect.fromResult(
      encodeTaskRunCreationRequestKeyPreimageV1(request.requestKey),
    );
    const requestBytes = yield* Effect.fromResult(
      encodeTaskRunCreationRequestPreimageV1(request),
    );
    const bindingBytes = yield* Effect.fromResult(
      encodeTaskDefinitionRuntimeBindingPreimageV1(binding),
    );
    const authorityBytes = yield* Effect.fromResult(
      encodeTaskRunCreationAuthorityReceiptPreimageV1(authority),
    );
    const requestKeySha256 = requestKeyDigest(yield* hashBytes(
      requestKeyBytes,
      options.sha256,
    ));
    const requestSha256 = requestDigest(yield* hashBytes(
      requestBytes,
      options.sha256,
    ));
    const bindingSha256 = yield* hashTaskDefinitionRuntimeBindingV1(
      binding,
      options.sha256,
    );
    const authorityDefinitionDigest =
      yield* hashTaskRunCreationAuthorityReceiptV1(
        authority,
        options.sha256,
      );
    return Object.freeze({
      request,
      binding,
      authority,
      requestKeySha256,
      requestSha256,
      bindingBytes: copyBytes(bindingBytes),
      // SAFETY: bindingSha256 is a validated 32-byte task definition
      // digest.
      bindingSha256: copyBytes(bindingSha256) as TaskDefinitionSha256V1,
      authorityBytes: copyBytes(authorityBytes),
      authoritySha256: creationAuthorityDigest(
        copyBytes(authorityDefinitionDigest),
      ),
      maximumDurationMs,
      leaseDurationMs,
      immediateRetryThresholdMs,
    });
  },
);

function captureCreationOptions(
  options: TaskSystemRunCreationStoreOptionsV1,
): Result.Result<
  CapturedTaskSystemRunCreationOptionsV1,
  TaskSystemRunCreationErrorV1
> {
  const sha256 = options.sha256;
  const runtimeBinding = options.runtimeBinding;
  const creationAuthority = options.creationAuthority;
  const leaseDurationMs = options.leaseDurationMs;
  const immediateRetryThresholdMs = options.immediateRetryThresholdMs;
  return Result.gen(function* () {
    const binding = yield* decodeTaskDefinitionRuntimeBindingV1(runtimeBinding);
    const authority = yield* decodeTaskRunCreationAuthorityReceiptV1(
      creationAuthority,
    );
    const lease = yield* decodeTaskDurationMsV1(leaseDurationMs).pipe(
      Result.mapError(cause => new InvalidTaskRunInitialAggregateError({
        operation: "make_initial_aggregate",
        reason: "invalid_initial_aggregate",
        cause,
      })),
    );
    const immediateRetryThreshold = yield* decodeTaskDurationMsV1(
      immediateRetryThresholdMs,
    ).pipe(Result.mapError(cause => new InvalidTaskRunInitialAggregateError({
      operation: "make_initial_aggregate",
      reason: "invalid_initial_aggregate",
      cause,
    })));
    return Object.freeze({
      sha256,
      runtimeBinding: binding,
      creationAuthority: authority,
      leaseDurationMs: lease,
      immediateRetryThresholdMs: immediateRetryThreshold,
    });
  });
}

function durationOrInitialAggregateError(
  input: unknown,
): Effect.Effect<TaskDurationMsV1, InvalidTaskRunInitialAggregateError> {
  return Effect.fromResult(decodeTaskDurationMsV1(input).pipe(
    Result.mapError((cause) => new InvalidTaskRunInitialAggregateError({
      operation: "make_initial_aggregate",
      reason: "invalid_initial_aggregate",
      cause,
    })),
  ));
}

async function transactCreationOnce(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  randomUuid: () => string,
  prepared: PreparedCreationV1,
): Promise<CreationTransactionResultV1> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => creationRollback(new TaskSystemRunCreationStaleScopeAuthorityError({
      operation: "create_run",
      authority: mismatch,
    })),
  );
  const definition = await loadDefinition(
    tx,
    authority.scopeId,
    prepared.request.taskDefinitionRevisionId,
  );
  if (definition === null) {
    throw creationRollback(new TaskSystemRunCreationBindingError({
      operation: "create_run",
      reason: "definition_unavailable",
    }));
  }
  if (!definitionMatches(definition, prepared)) {
    throw creationRollback(new TaskSystemRunCreationBindingError({
      operation: "create_run",
      reason: "stored_binding_mismatch",
    }));
  }

  const existing = await loadCreationRequest(
    tx,
    authority.scopeId,
    prepared.requestKeySha256,
  );
  if (existing !== null) {
    return replayExistingCreation(
      tx,
      authority.scopeId,
      existing,
      definition,
      prepared,
    );
  }

  const runId = allocateRunId(randomUuid);
  const createdAtMs = await readCreationDatabaseNow(tx, authority.scopeId);
  const aggregate = Result.getOrThrowWith(
    makeTaskRunCreationInitialAggregateV1({
      runId,
      taskDefinitionRevisionId: prepared.request.taskDefinitionRevisionId,
      createdAtMs,
      runAttemptPolicy: prepared.binding.manifest.runAttemptPolicy,
      maximumDurationMs: prepared.maximumDurationMs,
      initialComputeProfile: prepared.binding.manifest.computeProfile,
      leaseDurationMs: prepared.leaseDurationMs,
      immediateRetryThresholdMs: prepared.immediateRetryThresholdMs,
    }),
    creationRollback,
  );
  const aggregateJson = Result.getOrThrowWith(
    encodePersistedTaskRunAttemptAggregateJsonV1(aggregate),
    cause => creationRollback(new InvalidTaskRunInitialAggregateError({
      operation: "make_initial_aggregate",
      reason: "invalid_initial_aggregate",
      cause,
    })),
  );
  const projection = projectTaskRunAttemptPersistenceV1(aggregate);
  await tx.insert(fxSystemDurableTaskRunsV1).values({
    scopeId: authority.scopeId,
    runId,
    definitionGeneration: "legacy_definition_v1",
    taskDefinitionRevisionId: prepared.request.taskDefinitionRevisionId,
    applicationRevisionId: null,
    applicationTaskRuntimeTargetSha256: null,
    createdAtMs: BigInt(createdAtMs),
    inputCodec: prepared.request.input.codec,
    inputStore: prepared.request.input.store,
    inputValueCodec: prepared.request.input.valueCodec,
    inputObjectKey: prepared.request.input.objectKey,
    inputByteLength: BigInt(prepared.request.input.byteLength),
    inputSha256: inputDigest(copyBytes(prepared.request.input.sha256)),
    inputRetention: prepared.request.input.retention.kind,
    executionPrincipalGeneration: "not_applicable",
    creationAuthorityCodecVersion: 1,
    creationAuthorityByteLength: BigInt(prepared.authorityBytes.byteLength),
    creationAuthoritySha256: creationAuthorityDigest(
      copyBytes(prepared.authoritySha256),
    ),
    creationAuthorityBytes: copyBytes(prepared.authorityBytes),
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
    requestKeySha256: requestKeyDigest(
      copyBytes(prepared.requestKeySha256),
    ),
    requestCodecVersion: 1,
    requestSha256: requestDigest(copyBytes(prepared.requestSha256)),
    runId,
    receiptVersion: 1,
  });
  return creationTransactionResult({
    status: "created",
    version: 1,
    runId,
    taskDefinitionRevisionId: prepared.request.taskDefinitionRevisionId,
    createdAtMs,
    requestKeySha256: prepared.requestKeySha256,
    requestSha256: prepared.requestSha256,
    creationAuthoritySha256: prepared.authoritySha256,
  }, prepared.authorityBytes);
}

async function replayExistingCreation(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  requestRow: TaskRunRequestRow,
  definition: TaskDefinitionRow,
  prepared: PreparedCreationV1,
): Promise<CreationTransactionResultV1> {
  if (
    requestRow.requestKeyCodecVersion !== 1
    || requestRow.requestCodecVersion !== 1
    || requestRow.receiptVersion !== 1
    || !bytesEqual(requestRow.requestKeySha256, prepared.requestKeySha256)
  ) {
    throw creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "idempotency_row_invalid",
    }));
  }
  if (!bytesEqual(requestRow.requestSha256, prepared.requestSha256)) {
    throw creationRollback(new TaskRunCreationIdempotencyConflictError({
      requestKey: prepared.request.requestKey,
      reason: "request_digest_mismatch",
    }));
  }
  const runId = Result.getOrThrowWith(
    decodeTaskRunIdV1(requestRow.runId),
    () => creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "idempotency_row_invalid",
    })),
  );
  const run = await loadRun(tx, scopeId, runId);
  if (run === null || !runMatchesCreationRequest(run, prepared)) {
    throw creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "run_row_invalid",
    }));
  }
  const decodedRun = Result.getOrThrowWith(
    decodeAndCorrelateTaskSystemRunRowV1(run),
    () => creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "run_row_invalid",
    })),
  );
  if (decodedRun.generation !== "legacy_definition_v1") {
    throw creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "run_row_invalid",
    }));
  }
  const storedAuthority = Result.getOrThrowWith(
    decodeTaskRunCreationAuthorityReceiptPreimageV1(
      run.creationAuthorityBytes,
    ),
    () => creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "creation_authority_invalid",
    })),
  );
  if (
    storedAuthority.taskDefinitionRevisionId !== run.taskDefinitionRevisionId
    || storedAuthority.applicationRevisionId !== definition.applicationRevisionId
    || !bytesEqual(storedAuthority.candidateSha256, definition.candidateSha256)
    || !bytesEqual(
      storedAuthority.applicationRevisionTaskBindingSha256,
      definition.applicationRevisionTaskBindingSha256,
    )
  ) {
    throw creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "creation_authority_invalid",
    }));
  }
  const createdAtMs = Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(run.createdAtMs)),
    () => creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "run_row_invalid",
    })),
  );
  return creationTransactionResult({
    status: "created",
    version: 1,
    runId,
    taskDefinitionRevisionId: prepared.request.taskDefinitionRevisionId,
    createdAtMs,
    requestKeySha256: prepared.requestKeySha256,
    requestSha256: prepared.requestSha256,
    creationAuthoritySha256: creationAuthorityDigest(
      copyBytes(run.creationAuthoritySha256),
    ),
  }, run.creationAuthorityBytes);
}

function creationTransactionResult(
  receipt: TaskRunCreationReceiptV1,
  authorityBytes: Uint8Array,
): CreationTransactionResultV1 {
  return Object.freeze({
    receipt,
    authorityBytes: copyBytes(authorityBytes),
    authoritySha256: creationAuthorityDigest(
      copyBytes(receipt.creationAuthoritySha256),
    ),
  });
}

async function loadDefinition(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  taskDefinitionRevisionId: TaskRunCreationRequestV1["taskDefinitionRevisionId"],
): Promise<TaskDefinitionRow | null> {
  const rows = await tx.select().from(
    fxSystemDurableTaskDefinitionRevisionsV1,
  ).where(and(
    eq(fxSystemDurableTaskDefinitionRevisionsV1.scopeId, scopeId),
    eq(
      fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      taskDefinitionRevisionId,
    ),
  )).limit(1).for("share");
  return rows[0] ?? null;
}

async function loadCreationRequest(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  requestKeySha256: TaskRunCreationRequestKeySha256V1,
): Promise<TaskRunRequestRow | null> {
  const rows = await tx.select().from(
    fxSystemDurableTaskRunRequestsV1,
  ).where(and(
    eq(fxSystemDurableTaskRunRequestsV1.scopeId, scopeId),
    eq(
      fxSystemDurableTaskRunRequestsV1.requestKeySha256,
      requestKeySha256,
    ),
  )).limit(1).for("update");
  return rows[0] ?? null;
}

async function loadRun(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
): Promise<TaskRunRow | null> {
  const rows = await tx.select().from(fxSystemDurableTaskRunsV1).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, runId),
  )).limit(1).for("share");
  return rows[0] ?? null;
}

async function readCreationDatabaseNow(
  tx: AppRowTransaction,
  scopeId: ScopeId,
): Promise<TaskDatabaseTimeMsV1> {
  const rows = await tx.select({
    milliseconds: sql<string>`
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
    `,
  }).from(fxSystemScopeClocks).where(
    eq(fxSystemScopeClocks.scopeId, scopeId),
  ).limit(1);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string" || !/^(0|[1-9][0-9]*)$/.test(text)) {
    throw creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "database_clock_invalid",
    }));
  }
  return Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(text)),
    () => creationRollback(new TaskSystemRunCreationCorruptionError({
      operation: "create_run",
      reason: "database_clock_invalid",
    })),
  );
}

function definitionMatches(
  row: TaskDefinitionRow,
  prepared: PreparedCreationV1,
): boolean {
  const binding = prepared.binding;
  return row.taskDefinitionRevisionId
      === prepared.request.taskDefinitionRevisionId
    && row.taskId === binding.taskId
    && row.applicationRevisionId === binding.applicationRevisionId
    && row.bindingCodecVersion === 1
    && row.bindingByteLength === BigInt(prepared.bindingBytes.byteLength)
    && bytesEqual(row.bindingSha256, prepared.bindingSha256)
    && bytesEqual(row.bindingBytes, prepared.bindingBytes)
    && bytesEqual(row.candidateSha256, binding.candidateSha256)
    && bytesEqual(
      row.applicationRevisionTaskBindingSha256,
      binding.applicationRevisionTaskBindingSha256,
    )
    && bytesEqual(
      row.canonicalTaskManifestSha256,
      binding.canonicalTaskManifestSha256,
    )
    && bytesEqual(row.taskRuntimeEntrySha256, binding.taskRuntimeEntrySha256)
    && bytesEqual(row.taskCatalogSha256, binding.taskCatalogSha256)
    && bytesEqual(row.taskEntryRootSha256, binding.taskEntryRootSha256)
    && bytesEqual(
      row.taskRuntimeProjectionSha256,
      binding.taskRuntimeProjectionSha256,
    )
    && bytesEqual(
      row.taskRuntimeGroupManifestSha256,
      binding.taskRuntimeGroupManifestSha256,
    )
    && bytesEqual(
      row.taskRuntimeMaterializationSpecSha256,
      binding.taskRuntimeMaterializationSpecSha256,
    )
    && bytesEqual(row.packageSha256, binding.packageSha256)
    && bytesEqual(row.artifactSha256, binding.artifactSha256)
    && bytesEqual(row.sourceRootSha256, binding.sourceRootSha256)
    && bytesEqual(row.semanticRootSha256, binding.semanticRootSha256);
}

function runMatchesCreationRequest(
  row: TaskRunRow,
  prepared: PreparedCreationV1,
): boolean {
  const input = prepared.request.input;
  return row.taskDefinitionRevisionId
      === prepared.request.taskDefinitionRevisionId
    && row.inputCodec === input.codec
    && row.inputStore === input.store
    && row.inputValueCodec === input.valueCodec
    && row.inputObjectKey === input.objectKey
    && row.inputByteLength === BigInt(input.byteLength)
    && bytesEqual(row.inputSha256, input.sha256)
    && row.inputRetention === input.retention.kind
    && row.creationAuthorityCodecVersion === 1
    && row.creationAuthorityByteLength
      === BigInt(row.creationAuthorityBytes.byteLength)
    && row.creationAuthoritySha256.byteLength === 32;
}

function allocateRunId(randomUuid: () => string): TaskRunIdV1 {
  let uuid: string;
  try {
    uuid = randomUuid();
  } catch (cause) {
    throw creationRollback(new TaskSystemRunCreationTerminalStoreError({
      operation: "create_run",
      reason: "identity_allocation_exhausted",
      cause,
    }));
  }
  return Result.getOrThrowWith(
    decodeTaskRunIdV1(`run_${uuid}`),
    cause => creationRollback(new TaskSystemRunCreationTerminalStoreError({
      operation: "create_run",
      reason: "identity_allocation_exhausted",
      cause,
    })),
  );
}

function hashBytes(
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
): Effect.Effect<Uint8Array, StandardApplicationTaskSha256V1Error> {
  return sha256(bytes, {
    maximumInputBytes: MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  }).pipe(Effect.map(copyBytes));
}

function awaitLocatedTransaction<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => transaction,
    catch: cause => cause,
  }));
}

class CreationRollback {
  readonly kind = "creation";
  constructor(readonly error: TaskSystemRunCreationErrorV1) {}
}

function creationRollback(error: TaskSystemRunCreationErrorV1): CreationRollback {
  return new CreationRollback(error);
}

type ClassifiedTransactionFailure =
  | Readonly<{ readonly kind: "retry" }>
  | Readonly<{
      readonly kind: "fail";
      readonly error: TaskSystemRunCreationErrorV1;
    }>
  | Readonly<{
      readonly kind: "cleanup";
      readonly callback: TaskSystemRunCreationErrorV1;
      readonly cause: LocatedReadCommittedTransactionFailureV1;
    }>
  | Readonly<{ readonly kind: "defect"; readonly cause: unknown }>;

function classifyTransactionFailure(
  cause: unknown,
  execution: number,
): ClassifiedTransactionFailure {
  if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
    return Object.freeze({ kind: "defect", cause });
  }
  switch (cause.issue.kind) {
    case "callbackRolledBack": {
      const callback = unwrapCreationRollback(cause.issue.callbackCause);
      if (callback !== null) return Object.freeze({ kind: "fail", error: callback });
      if (
        isRetryableSqlConflict(cause.issue.callbackCause)
        || isCreationRequestContention(cause.issue.callbackCause)
      ) {
        return execution < MAX_TRANSACTION_EXECUTIONS
          ? Object.freeze({ kind: "retry" })
          : Object.freeze({
              kind: "fail",
              error: new TaskSystemRunCreationTransientStoreError({
                operation: "create_run",
                reason: "transaction_conflict",
                cause,
              }),
            });
      }
      if (isRunIdentityCollision(cause.issue.callbackCause)) {
        return execution < MAX_TRANSACTION_EXECUTIONS
          ? Object.freeze({ kind: "retry" })
          : Object.freeze({
              kind: "fail",
              error: new TaskSystemRunCreationTerminalStoreError({
                operation: "create_run",
                reason: "identity_allocation_exhausted",
                cause,
              }),
            });
      }
      const known = classifyKnownSqlFailure(cause.issue.callbackCause, cause);
      return known === null
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "fail", error: known });
    }
    case "decisionUncertain":
      return Object.freeze({
        kind: "fail",
        error: new TaskSystemRunCreationTransientStoreError({
          operation: "create_run",
          reason: "driver_failure",
          cause,
        }),
      });
    case "infrastructureFailure": {
      const known = classifyKnownSqlFailure(cause.issue.cause, cause);
      if (known !== null) return Object.freeze({ kind: "fail", error: known });
      return cause.issue.phase === "beginOrConfigure"
        ? Object.freeze({
            kind: "fail",
            error: new TaskSystemRunCreationTerminalStoreError({
              operation: "create_run",
              reason: "unsupported_integration",
              cause,
            }),
          })
        : Object.freeze({ kind: "defect", cause });
    }
    case "callbackCleanupFailed": {
      const callback = unwrapCreationRollback(cause.issue.callbackCause);
      return callback === null
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "cleanup", callback, cause });
    }
  }
}

function unwrapCreationRollback(cause: unknown): TaskSystemRunCreationErrorV1 | null {
  return cause instanceof CreationRollback ? cause.error : null;
}

function classifyKnownSqlFailure(
  sqlCause: unknown,
  retainedCause: unknown,
): TaskSystemRunCreationTransientStoreError | null {
  const code = sqlErrorDescriptor(sqlCause)?.code;
  if (code?.startsWith("08") !== true && code !== "57014") return null;
  return new TaskSystemRunCreationTransientStoreError({
    operation: "create_run",
    reason: code.startsWith("08") ? "connection_unavailable" : "timeout",
    cause: retainedCause,
  });
}

function isRetryableSqlConflict(cause: unknown): boolean {
  const code = sqlErrorDescriptor(cause)?.code;
  return code === "40001" || code === "40P01";
}

function isCreationRequestContention(cause: unknown): boolean {
  const descriptor = sqlErrorDescriptor(cause);
  return descriptor?.code === "23505"
    && descriptor.constraint === RUN_REQUEST_PRIMARY_KEY;
}

function isRunIdentityCollision(cause: unknown): boolean {
  const descriptor = sqlErrorDescriptor(cause);
  return descriptor?.code === "23505"
    && (
      descriptor.constraint === RUN_PRIMARY_KEY
      || descriptor.constraint === RUN_REQUEST_RUN_UNIQUE
    );
}

function sqlErrorDescriptor(cause: unknown): Readonly<{
  readonly code: string;
  readonly constraint: string | undefined;
}> | undefined {
  let current = cause;
  for (let depth = 0; depth < 8; depth += 1) {
    const code = stringProperty(current, "code");
    if (code !== undefined) {
      return Object.freeze({
        code,
        constraint: stringProperty(current, "constraint"),
      });
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

function encodedJsonByteLength(value: unknown): bigint {
  return BigInt(UTF8.encode(JSON.stringify(value)).byteLength);
}

function nullableNumberAsBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
