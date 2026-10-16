import { bytesEqualFullScan, copyBytes, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import {
  decodeTaskExecutionPrincipalReferenceV1, decodeTaskExecutionPrincipalObjectV1, inspectTrustedWorkflowTaskBinding,
  trustedWorkflowPrincipalMatches, type TaskExecutionPrincipalReferenceV1,
  type TrustedWorkflowTaskBinding, type TrustedWorkflowTaskBindingState, type TaskExecutionPrincipalObjectV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  TaskRunIdV1Schema, TaskAttemptIdV1Schema, TaskAttemptNumberV1Schema,
  TaskExecutionFenceV1Schema,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  FLAREX_GENERAL_VALUE_LIMITS_V1, FlarexValueRuntimeCoreV1Error,
  normalizeFlarexRuntimeValueWithLimitsV1,
} from "flarex-protocol/internal/value-runtime-core";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { decodeCanonicalFlarexValueEvidenceV1Effect } from "flarex-protocol/value";
import { fxSystemDurableTaskRunsV1, fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemTrustedWorkflowTaskBindings, fxSystemScopeClocks } from "../database/schema";
import { runLocatedEffectQuery } from "../database/locatedEffectTransaction";
import { requireDeadlineOwnedTaskPersistenceTarget, runDeadlineOwnedTaskPersistenceTransaction,
  type DeadlineOwnedTaskPersistenceTarget } from "./taskPersistenceTransaction";
import type { AppRowTransaction } from "../storage/documents/appRows";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import { scopePhysicalLocatorsEqual } from "../scope/scopePhysicalLocator";
import { captureTaskSystemTrustedScopeAuthorityV1, requireLockedTaskSystemScopeAuthorityV1 } from "./taskSystemScopeAuthorityV1";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";

const IdentitySchema = Schema.Struct({ runId: TaskRunIdV1Schema,
  attemptId: TaskAttemptIdV1Schema, attemptNumber: TaskAttemptNumberV1Schema,
  executionFence: Schema.toType(TaskExecutionFenceV1Schema) });
const decodeIdentity = Schema.decodeUnknownResult(IdentitySchema, { onExcessProperty: "error" });
const canonicalPolicy = (value: TrustedWorkflowTaskBindingState["definition"]["boundPolicy"]) => encodeCanonicalJson(value,
  issue => { throw new Error(`Invalid established bound policy: ${issue.reason}`); });
type Identity = typeof IdentitySchema.Type;

export class TrustedWorkflowExecutionSubjectError extends Data.TaggedError("TrustedWorkflowExecutionSubjectError")<{
  readonly reason: "invalidTarget" | "invalidInput" | "invalidBinding" | "notIssued" | "staleAuthority" |
    "staleAttempt" | "notExecuting" | "leaseExpired" | "storedCorruption" | "storeFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: TrustedWorkflowExecutionSubjectError["reason"], cause?: unknown) =>
  new TrustedWorkflowExecutionSubjectError({ reason, ...(cause === undefined ? {} : { cause }) });

export interface TrustedWorkflowExecutionSubject { readonly _TrustedWorkflowExecutionSubject: unique symbol }
interface SubjectState {
  readonly identity: Identity;
  readonly authority: TrustedScopeAuthority;
  readonly binding: TrustedWorkflowTaskBindingState;
  readonly principal: TaskExecutionPrincipalReferenceV1;
  readonly executionPrincipal: TaskExecutionPrincipalObjectV1;
}
const subjects = new WeakMap<object, SubjectState>();

export interface LiveTrustedWorkflowExecutionPins extends Identity {
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly definition: TrustedWorkflowTaskBindingState["definition"];
  /** Owned copies: modifying a returned digest cannot modify the subject. */
  readonly bindingSha256: Uint8Array;
  readonly principal: TaskExecutionPrincipalReferenceV1;
  readonly executionPrincipal: TaskExecutionPrincipalObjectV1;
  readonly leaseExpiresAtMs: number;
  readonly remainingLeaseMs: number;
}

/** Trusted construction authenticates actual principal bytes and decodes them
 * through the shared Task principal owner, not an arbitrary principal label. */
export const issueTrustedWorkflowExecutionSubject = Effect.fn("TrustedWorkflowExecutionSubject.issue")(
  function* <HashFailure>(rawIdentity: unknown, input: {
    readonly authority: TrustedScopeAuthority;
    readonly target: DeadlineOwnedTaskPersistenceTarget;
    readonly binding: TrustedWorkflowTaskBinding;
    readonly principal: unknown;
    readonly principalCanonicalBytes: Uint8Array;
    readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashFailure>;
  }) {
    yield* Effect.fromResult(requireDeadlineOwnedTaskPersistenceTarget(input.target)).pipe(
      Effect.mapError(cause => failure("invalidTarget", cause)));
    const captured = yield* Effect.fromResult(Result.try({
      try: () => normalizeFlarexRuntimeValueWithLimitsV1(rawIdentity, {
        ...FLAREX_GENERAL_VALUE_LIMITS_V1, maxSemanticBytes: 2048, maxNesting: 2,
        maxArrayItems: 0, maxObjectFields: 4,
      }),
      catch: cause => { if (cause instanceof FlarexValueRuntimeCoreV1Error) return failure("invalidInput", cause); throw cause; },
    }));
    const identity = yield* Effect.fromResult(decodeIdentity(captured.value))
      .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    Object.freeze(identity);
    const binding = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(input.binding))
      .pipe(Effect.mapError(cause => failure("invalidBinding", cause)));
    const authority = captureTaskSystemTrustedScopeAuthorityV1(input.authority);
    if (binding.definition.scopeId !== authority.scopeId) return yield* failure("staleAuthority");
    const principal = yield* Effect.fromResult(decodeTaskExecutionPrincipalReferenceV1(input.principal))
      .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    if (!trustedWorkflowPrincipalMatches(binding, principal.sha256)) return yield* failure("invalidBinding");
    if (!isUint8ArrayWithByteLength(input.principalCanonicalBytes, principal.byteLength)) return yield* failure("invalidInput");
    const principalBytes = yield* Effect.try({ try: () => copyBytes(input.principalCanonicalBytes),
      catch: cause => failure("invalidInput", cause) });
    if (principalBytes.byteLength !== principal.byteLength) return yield* failure("invalidInput");
    const canonicalPrincipal = yield* decodeCanonicalFlarexValueEvidenceV1Effect({ canonicalBytes: principalBytes, sha256: principal.sha256 })
      .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    const executionPrincipal = yield* Effect.fromResult(decodeTaskExecutionPrincipalObjectV1(canonicalPrincipal.value))
      .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    if (executionPrincipal.scopeId !== authority.scopeId) return yield* failure("staleAuthority");
    const digest = yield* input.sha256(copyBytes(binding.canonicalBytes));
    if (!isUint8ArrayWithByteLength(digest, 32) || !bytesEqualFullScan(digest, binding.sha256))
      return yield* failure("invalidBinding");
    const state: SubjectState = Object.freeze({ identity, authority, binding, principal, executionPrincipal });
    yield* runDeadlineOwnedTaskPersistenceTransaction(input.target, "trustedWorkflowSubject.issue", tx => Effect.gen(function* () {
      yield* Effect.tryPromise({ try: () => requireLockedTaskSystemScopeAuthorityV1(tx, authority, input.target,
        mismatch => failure("staleAuthority", mismatch)), catch: cause => cause instanceof TrustedWorkflowExecutionSubjectError
        ? cause : failure("storeFailure", cause) });
      yield* requireLiveState(tx, state, authority);
    }), cause => failure(cause.reason, cause));
    return yield* Effect.sync(() => {
      // SAFETY: only this module's WeakMap membership authenticates the handle.
      const subject = Object.freeze({}) as TrustedWorkflowExecutionSubject;
      subjects.set(subject, state);
      return subject;
    });
  },
);

export function revokeTrustedWorkflowExecutionSubject(subject: TrustedWorkflowExecutionSubject): void {
  subjects.delete(subject);
}

/** Authentic identity inspection only; this receipt makes NO live-lease claim.
 * Child entry and settlement must use the transaction-borrowed operation. */
export function inspectTrustedWorkflowExecutionSubject(subject: unknown) {
  if (typeof subject !== "object" || subject === null) return Result.fail(failure("notIssued"));
  const state = subjects.get(subject);
  return state === undefined ? Result.fail(failure("notIssued")) :
    decodeTaskExecutionPrincipalReferenceV1(state.principal).pipe(
      Result.mapError(cause => failure("storedCorruption", cause)),
      Result.map(principal => Object.freeze({ ...state.identity, scopeId: state.authority.scopeId,
        definition: state.binding.definition, bindingSha256: copyBytes(state.binding.sha256),
        principal, executionPrincipal: state.executionPrincipal })),
    );
}

/** INTERNAL transaction loan. The trusted host must already hold its scope
 * authority/clock locks. This operation never settles or exposes a transaction;
 * it locks run then attempt and MUST run again immediately before settlement. */
export const requireLiveTrustedWorkflowExecutionSubject = Effect.fn("TrustedWorkflowExecutionSubject.requireLive")(
  function* (tx: AppRowTransaction, subject: unknown, expectedAuthority: TrustedScopeAuthority) {
    if (typeof subject !== "object" || subject === null) return yield* failure("notIssued");
    const state = subjects.get(subject);
    if (state === undefined) return yield* failure("notIssued");
    const pins = yield* requireLiveState(tx, state, expectedAuthority);
    if (subjects.get(subject) !== state) return yield* failure("notIssued");
    return pins;
  },
);

const requireLiveState = Effect.fn("TrustedWorkflowExecutionSubject.requireLiveState")(
  function* (tx: AppRowTransaction, state: SubjectState, authority: TrustedScopeAuthority): Effect.fn.Return<
    LiveTrustedWorkflowExecutionPins, TrustedWorkflowExecutionSubjectError
  > {
    const expected = state.authority;
    if (expected.scopeId !== authority.scopeId || expected.deploymentId !== authority.deploymentId ||
      expected.epoch !== authority.epoch || expected.storageGeneration !== authority.storageGeneration ||
      expected.storageGenerationFence !== authority.storageGenerationFence ||
      !scopePhysicalLocatorsEqual(expected.physicalLocator, authority.physicalLocator)) return yield* failure("staleAuthority");
    const identity = state.identity;
    const row = (yield* query(tx.select().from(fxSystemDurableTaskRunsV1).where(and(
      eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId), eq(fxSystemDurableTaskRunsV1.runId, identity.runId),
    )).for("update").limit(1)))[0];
    if (row === undefined) return yield* failure("staleAttempt");
    const decoded = yield* Effect.fromResult(decodeAndCorrelateTaskSystemRunRowV1(row))
      .pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    if (decoded.generation !== "trusted_workflow" || row.trustedWorkflowBindingSha256 === null ||
      !bytesEqualFullScan(row.trustedWorkflowBindingSha256, state.binding.sha256)) return yield* failure("invalidBinding");
    const stored = (yield* query(tx.select().from(fxSystemTrustedWorkflowTaskBindings).where(and(
      eq(fxSystemTrustedWorkflowTaskBindings.scopeId, authority.scopeId),
      eq(fxSystemTrustedWorkflowTaskBindings.bindingSha256, state.binding.sha256),
    )).for("share").limit(1)))[0];
    if (stored === undefined || stored.codecVersion !== 1 || stored.byteLength !== state.binding.canonicalBytes.byteLength ||
      !bytesEqualFullScan(stored.canonicalBytes, state.binding.canonicalBytes)) return yield* failure("storedCorruption");
    const principal = state.principal;
    if (row.executionPrincipalGeneration !== "present_v1" || row.executionPrincipalKind !== principal.principalKind ||
      row.executionPrincipalCodec !== principal.codec || row.executionPrincipalStore !== principal.store ||
      row.executionPrincipalValueCodec !== principal.valueCodec || row.executionPrincipalObjectKey !== principal.objectKey ||
      row.executionPrincipalByteLength !== BigInt(principal.byteLength) || row.executionPrincipalRetention !== principal.retention.kind ||
      row.executionPrincipalSha256 === null || !bytesEqualFullScan(row.executionPrincipalSha256, principal.sha256))
      return yield* failure("storedCorruption");
    if (canonicalPolicy(decoded.aggregate.boundPolicy) !== canonicalPolicy(state.binding.definition.boundPolicy))
      return yield* failure("storedCorruption");
    if (decoded.aggregate.phase !== "executing" || decoded.aggregate.cancellation.kind !== "not_requested")
      return yield* failure("notExecuting");
    const active = decoded.aggregate.currentAttempt;
    if (active.attemptId !== identity.attemptId || active.attemptNumber !== identity.attemptNumber ||
      active.executionFence !== identity.executionFence) return yield* failure("staleAttempt");
    const attempt = (yield* query(tx.select().from(fxSystemDurableTaskAttemptIdentitiesV1).where(and(
      eq(fxSystemDurableTaskAttemptIdentitiesV1.scopeId, authority.scopeId),
      eq(fxSystemDurableTaskAttemptIdentitiesV1.attemptId, identity.attemptId),
    )).for("share").limit(1)))[0];
    if (attempt === undefined || attempt.runId !== identity.runId || attempt.attemptNumber !== identity.attemptNumber ||
      attempt.executionFence !== identity.executionFence) return yield* failure("staleAttempt");
    const time = (yield* query(tx.select({ milliseconds: sql<string>`floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text` })
      .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, authority.scopeId)).limit(1)))[0];
    const now = Number(time?.milliseconds);
    if (!Number.isSafeInteger(now) || now < 0) return yield* failure("storedCorruption");
    const leaseExpiresAtMs = active.lease.expiresAtMs;
    const remainingLeaseMs = Math.min(leaseExpiresAtMs - now,
      state.binding.definition.boundPolicy.maximumDurationMs - (now - active.grantedAtMs));
    if (remainingLeaseMs <= 0) return yield* failure("leaseExpired");
    const ownedPrincipal = yield* Effect.fromResult(decodeTaskExecutionPrincipalReferenceV1(principal))
      .pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    return Object.freeze({ ...identity, scopeId: authority.scopeId, definition: state.binding.definition,
      bindingSha256: copyBytes(state.binding.sha256), principal: ownedPrincipal,
      executionPrincipal: state.executionPrincipal, leaseExpiresAtMs, remainingLeaseMs });
  },
);

function query<Row>(value: PromiseLike<ReadonlyArray<Row>>) {
  return runLocatedEffectQuery(value, "trustedWorkflowSubject", (_operation, cause) => failure("storeFailure", cause));
}
