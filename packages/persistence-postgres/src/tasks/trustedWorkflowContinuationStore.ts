import { bytesEqualFullScan, uint8ArrayByteLength, isUint8Array } from "@flarex/utils/bytes";
import type { TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import {
  RegisterTrustedWorkflowContinuationCommandSchema, ResolveTrustedWorkflowContinuationCommandSchema,
  decideTrustedWorkflowRegisterContinuation, decideTrustedWorkflowConfirmContinuation,
  decideTrustedWorkflowExpireContinuation, decideTrustedWorkflowRequestCancellation,
  decodeRunAttemptCommandV1, decodeTaskRunIdV1, type CurrentRunAttemptMutationOperation, type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Data, Effect, Option, Result, Schema } from "effect";
import {
  FLAREX_GENERAL_VALUE_LIMITS_V1, FlarexValueRuntimeCoreV1Error,
  normalizeFlarexRuntimeValueWithLimitsV1,
} from "flarex-protocol/internal/value-runtime-core";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../storage/documents/appRows";
import { requireLockedTaskSystemScopeAuthorityV1 } from "./taskSystemScopeAuthorityV1";
import { borrowTrustedWorkflowTaskRunInTransaction, inspectTrustedWorkflowTaskRunInTransaction } from "./taskSystemRunAttemptStoreV1";
import {
  requireDeadlineOwnedTaskPersistenceTarget, runDeadlineOwnedTaskPersistenceTransaction,
  type DeadlineOwnedTaskPersistenceTarget,
} from "./taskPersistenceTransaction";
import {
  captureTrustedWorkflowExecutionAuthority, requireTrustedWorkflowRunAuthority, requireTrustedWorkflowRunAuthoritySnapshot,
  requireLiveTrustedWorkflowExecutionSubject, type TrustedWorkflowExecutionSubject,
} from "./trustedWorkflowExecutionSubject";
import {
  inspectPreparedTrustedWorkflowCheckpoint, persistPreparedTrustedWorkflowCheckpointInTransaction, readTrustedWorkflowCheckpointInTransaction,
  TrustedWorkflowCheckpointError, type PreparedTrustedWorkflowCheckpoint,
} from "./trustedWorkflowCheckpoint";

export class TrustedWorkflowContinuationStoreError extends Data.TaggedError("TrustedWorkflowContinuationStoreError")<{
  readonly reason: "invalidTarget" | "invalidInput" | "invalidCheckpoint" | "staleAuthority" | "storeFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: TrustedWorkflowContinuationStoreError["reason"], cause?: unknown) =>
  new TrustedWorkflowContinuationStoreError({ reason, ...(cause === undefined ? {} : { cause }) });
const decodeRegistration = Schema.decodeUnknownResult(RegisterTrustedWorkflowContinuationCommandSchema, { onExcessProperty: "error" });
const decodeResolution = Schema.decodeUnknownResult(ResolveTrustedWorkflowContinuationCommandSchema, { onExcessProperty: "error" });

/** A fresh authenticated principal constructs this scope/binding-bound facade.
 * Confirmation is a durable decision, not an active execution capability.
 * Every operation uses the existing Task run/ledger owner in one short SQL
 * transaction; neither a connection nor an attempt survives the native wait. */
export const makeTrustedWorkflowContinuationStore = Effect.fn("TrustedWorkflowContinuation.makeStore")(
  function* <HashFailure>(input: {
    readonly authority: TrustedScopeAuthority;
    readonly target: DeadlineOwnedTaskPersistenceTarget;
    readonly binding: TrustedWorkflowTaskBinding;
    readonly principal: unknown;
    readonly principalCanonicalBytes: Uint8Array;
    readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashFailure>;
  }) {
    const target = yield* Effect.fromResult(requireDeadlineOwnedTaskPersistenceTarget(input.target))
      .pipe(Effect.mapError(cause => failure("invalidTarget", cause)));
    const authority = yield* captureTrustedWorkflowExecutionAuthority(input);
    const hash = input.sha256;
    const lockedScope = (tx: AppRowTransaction) => Effect.tryPromise({
      try: () => requireLockedTaskSystemScopeAuthorityV1(tx, authority.authority, target,
        mismatch => failure("staleAuthority", mismatch)),
      catch: cause => cause instanceof TrustedWorkflowContinuationStoreError ? cause : failure("storeFailure", cause),
    });
    const transact = Effect.fn("TrustedWorkflowContinuation.transact")(<A, E>(operation: CurrentRunAttemptMutationOperation, runId: TaskRunIdV1,
      work: Parameters<typeof borrowTrustedWorkflowTaskRunInTransaction<A, E>>[4]) =>
      runDeadlineOwnedTaskPersistenceTransaction(target, `trustedWorkflowContinuation.${operation}`, tx =>
        lockedScope(tx).pipe(Effect.andThen(() => requireTrustedWorkflowRunAuthority(tx, authority, runId)),
          Effect.andThen(() => borrowTrustedWorkflowTaskRunInTransaction(tx, authority.authority.scopeId, operation, runId, work))),
        cause => failure(cause.reason, cause)));

    const register = Effect.fn("TrustedWorkflowContinuation.register")(function* (
      subject: TrustedWorkflowExecutionSubject, prepared: PreparedTrustedWorkflowCheckpoint, raw: unknown,
    ) {
      const command = yield* Effect.fromResult(captureRegistration(raw).pipe(Result.flatMap(decodeRegistration)))
        .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
      const checkpoint = yield* Effect.fromResult(inspectPreparedTrustedWorkflowCheckpoint(prepared));
      if (checkpoint.scopeId !== authority.authority.scopeId || !bytesEqualFullScan(checkpoint.bindingSha256, authority.binding.sha256) ||
        command.checkpoint.revision !== checkpoint.expectedRevision + 1n || command.checkpoint.byteLength !== checkpoint.byteLength ||
        !bytesEqualFullScan(command.checkpoint.sha256, checkpoint.sha256)) return yield* failure("invalidCheckpoint");
      // Registration needs the checkpoint loan, so retain the one existing
      // deadline-owned transaction instead of routing through generic transact.
      return yield* runDeadlineOwnedTaskPersistenceTransaction(target, "trustedWorkflowContinuation.register", tx => Effect.gen(function* () {
        yield* lockedScope(tx);
        yield* requireTrustedWorkflowRunAuthority(tx, authority, command.runId);
        return yield* borrowTrustedWorkflowTaskRunInTransaction(tx, authority.authority.scopeId, command.type, command.runId, loan => Effect.gen(function* () {
          const context = { current: loan.current, databaseNowMs: loan.databaseNowMs, attemptGrantCandidate: null };
          const decision = yield* Effect.fromResult(decideTrustedWorkflowRegisterContinuation(command, context));
          // Authenticated receipt replay must survive retirement of the old
          // lease. It neither rewrites a checkpoint nor recreates the wait.
          if (decision.kind === "no_change") return yield* loan.apply(decision);
          const pins = yield* requireLiveTrustedWorkflowExecutionSubject(tx, subject, authority.authority);
          if (pins.runId !== command.runId || pins.attemptId !== command.attemptId || pins.executionFence !== command.executionFence ||
            !bytesEqualFullScan(pins.bindingSha256, authority.binding.sha256)) return yield* failure("invalidCheckpoint");
          const saved = yield* persistPreparedTrustedWorkflowCheckpointInTransaction(tx, pins, prepared, hash);
          if (saved.checkpoint.revision !== command.checkpoint.revision || saved.checkpoint.byteLength !== command.checkpoint.byteLength ||
            !bytesEqualFullScan(saved.checkpoint.sha256, command.checkpoint.sha256)) return yield* failure("invalidCheckpoint");
          yield* requireLiveTrustedWorkflowExecutionSubject(tx, subject, authority.authority);
          return yield* loan.apply(decision);
        }));
      }), cause => failure(cause.reason, cause));
    });
    const resolve = Effect.fn("TrustedWorkflowContinuation.resolve")(function* (raw: unknown, operation: "confirm_continuation" | "expire_continuation") {
      const command = yield* Effect.fromResult(capture(raw).pipe(Result.flatMap(decodeResolution)))
        .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
      if (command.type !== operation) return yield* failure("invalidInput");
      return yield* transact(operation, command.runId, loan => Effect.gen(function* () {
        const context = { current: loan.current, databaseNowMs: loan.databaseNowMs, attemptGrantCandidate: null };
        const decision = yield* Effect.fromResult(operation === "confirm_continuation"
          ? decideTrustedWorkflowConfirmContinuation(command, context) : decideTrustedWorkflowExpireContinuation(command, context));
        return yield* loan.apply(decision);
      }));
    });
    const cancel = Effect.fn("TrustedWorkflowContinuation.cancel")(function* (raw: unknown) {
      const command = yield* Effect.fromResult(capture(raw).pipe(Result.flatMap(value => decodeRunAttemptCommandV1("request_cancellation", value))))
        .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
      if (command.type !== "request_cancellation") return yield* failure("invalidInput");
      return yield* transact(command.type, command.runId, loan => Effect.gen(function* () {
        const decision = yield* Effect.fromResult(decideTrustedWorkflowRequestCancellation(command,
          { current: loan.current, databaseNowMs: loan.databaseNowMs, attemptGrantCandidate: null }));
        return yield* loan.apply(decision);
      }));
    });
    const inspect = Effect.fn("TrustedWorkflowContinuation.inspect")(function* (rawRunId: unknown) {
      const runId = yield* Effect.fromResult(decodeTaskRunIdV1(rawRunId)).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
      return yield* runDeadlineOwnedTaskPersistenceTransaction(target, "trustedWorkflowContinuation.inspect", tx => Effect.gen(function* () {
        yield* lockedScope(tx);
        const authorized = yield* requireTrustedWorkflowRunAuthoritySnapshot(tx, authority, runId);
        const snapshot = yield* inspectTrustedWorkflowTaskRunInTransaction(tx, authority.authority.scopeId, "inspect_current_attempt", runId);
        const checkpoint = yield* readTrustedWorkflowCheckpointInTransaction(tx,
          { scopeId: authority.authority.scopeId, runId, bindingSha256: authority.binding.sha256 }, hash);
        const continuation = snapshot.current.continuation;
        if (continuation !== undefined) {
          if (Option.isNone(checkpoint)) return yield* new TrustedWorkflowCheckpointError({ reason: "storedCorruption" });
          const stored = checkpoint.value, pinned = continuation.checkpoint;
          const latest = continuation.resumeAfterAttempt, original = continuation.suspendedAttempt;
          const beforeResume = latest === undefined || (latest.attemptId === original.attemptId &&
            latest.attemptNumber === original.attemptNumber && latest.executionFence === original.executionFence);
          if (stored.revision < pinned.revision || (beforeResume && stored.revision !== pinned.revision) ||
            (stored.revision === pinned.revision && (stored.byteLength !== pinned.byteLength || !bytesEqualFullScan(stored.sha256, pinned.sha256))))
            return yield* new TrustedWorkflowCheckpointError({ reason: "storedCorruption" });
        }
        return Object.freeze({ current: snapshot.current, observedAtMs: snapshot.databaseNowMs, inputReference: authorized.inputReference, checkpoint });
      }), cause => failure(cause.reason, cause));
    });
    return Object.freeze({ register, inspect, confirm: (raw: unknown) => resolve(raw, "confirm_continuation"),
      expire: (raw: unknown) => resolve(raw, "expire_continuation"), cancel });
  });

function capture(raw: unknown) {
  return Result.try({
    try: () => normalizeFlarexRuntimeValueWithLimitsV1(raw, { ...FLAREX_GENERAL_VALUE_LIMITS_V1,
      maxSemanticBytes: 16_384, maxNesting: 4, maxArrayItems: 0, maxObjectFields: 24 }).value,
    catch: cause => { if (cause instanceof FlarexValueRuntimeCoreV1Error) return failure("invalidInput", cause); throw cause; },
  });
}

/** Transport capture for the one binary descriptor position. Scalar validation
 * remains with the shared command/checkpoint Schemas; no caller getter or byte
 * iterator participates in capture. Other commands use the protocol owner. */
function captureRegistration(raw: unknown) {
  return Result.try({ try: () => {
    const record = ownDataRecord(raw, 10), checkpoint = ownDataRecord(record.checkpoint, 3);
    if (!isUint8Array(checkpoint.sha256) || uint8ArrayByteLength(checkpoint.sha256) !== 32) throw failure("invalidInput");
    const sha256 = new Uint8Array(32);
    Uint8Array.prototype.set.call(sha256, checkpoint.sha256);
    checkpoint.sha256 = sha256;
    record.checkpoint = checkpoint;
    return record;
  }, catch: cause => failure("invalidInput", cause) });
}
function ownDataRecord(raw: unknown, maximumFields: number): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) throw failure("invalidInput");
  const keys = Reflect.ownKeys(raw);
  if (keys.length > maximumFields) throw failure("invalidInput");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") throw failure("invalidInput");
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw failure("invalidInput");
    result[key] = descriptor.value;
  }
  return result;
}
