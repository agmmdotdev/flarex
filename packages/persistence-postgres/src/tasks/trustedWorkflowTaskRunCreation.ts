import { Brand, Data, Effect, Schema } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { bytesEqualFullScan, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import {
  decodeTaskExecutionPrincipalReferenceV1, decodeTaskInputReferenceV1, decodeTaskRunCreationRequestKeyV1,
  encodeTaskRunCreationRequestKeyPreimageV1, inspectTrustedWorkflowTaskBinding,
  makeTrustedWorkflowTaskRunCreationInitialAggregate, trustedWorkflowPrincipalMatches,
  TrustedWorkflowBindingSha256Schema, type TrustedWorkflowTaskBinding,
  type TaskRunCreationAuthoritySha256V1, type TaskRunCreationRequestKeySha256V1,
  type TaskRunCreationRequestSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { decodeTaskDatabaseTimeMsV1, decodeTaskRunIdV1,
  encodeTrustedWorkflowTaskRunAttemptAggregateJson, projectCurrentTaskRunAttemptPersistence,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { fxSystemScopeClocks, fxSystemDurableTaskRunsV1, fxSystemDurableTaskRunRequestsV1, fxSystemTrustedWorkflowTaskBindings } from "../database/schema";
import { runLocatedEffectQuery, runLocatedEffectTransaction } from "../database/locatedEffectTransaction";
import type { LocatedReadCommittedAttemptTargetV1 } from "../database/locatedTransactionIdentity";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import { captureTaskSystemTrustedScopeAuthorityV1, requireLockedTaskSystemScopeAuthorityV1 } from "./taskSystemScopeAuthorityV1";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";

export class TrustedWorkflowTaskRunCreationError extends Data.TaggedError("TrustedWorkflowTaskRunCreationError")<{
  readonly reason: "invalidBinding" | "invalidRequest" | "requestConflict" | "staleAuthority" | "storedCorruption" | "storeFailure";
  readonly cause?: unknown;
}> {}
const fail = (reason: TrustedWorkflowTaskRunCreationError["reason"], cause?: unknown) =>
  new TrustedWorkflowTaskRunCreationError({ reason, ...(cause === undefined ? {} : { cause }) });
const utf8 = new TextEncoder();
const keyDigest = Brand.nominal<TaskRunCreationRequestKeySha256V1>();
const requestDigest = Brand.nominal<TaskRunCreationRequestSha256V1>();
const authorityDigest = Brand.nominal<TaskRunCreationAuthoritySha256V1>();
const decodeHash = Schema.decodeUnknownResult(TrustedWorkflowBindingSha256Schema);
const canonical = (value: Json) => utf8.encode(encodeCanonicalJson(value,
  issue => { throw new Error(`Invalid trusted workflow creation canonical value: ${issue.reason}`); }));

/** One immutable binding and one located scope per instance. The caller never
 * supplies Application metadata, a database transaction or finalization port. */
export function makeTrustedWorkflowTaskRunCreationStore<HashFailure>(input: {
  readonly authority: TrustedScopeAuthority;
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly binding: TrustedWorkflowTaskBinding;
  readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashFailure>;
  readonly randomUuid?: () => string;
}) {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(input.authority);
  const target = input.target;
  const binding = input.binding;
  const sha256 = input.sha256;
  const hash = Effect.fn("TrustedWorkflowTask.hash")(function* (bytes: Uint8Array) {
    const digest = yield* sha256(copyBytes(bytes));
    return yield* Effect.fromResult(decodeHash(copyBytes(digest))).pipe(Effect.mapError(cause => fail("storedCorruption", cause)));
  });
  const randomUuid = input.randomUuid ?? (() => crypto.randomUUID());
  const createRun = Effect.fn("TrustedWorkflowTask.createRun")(function* (raw: {
    readonly requestKey: unknown; readonly input: unknown; readonly principal: unknown;
  }) {
    const selected = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(binding))
      .pipe(Effect.mapError(cause => fail("invalidBinding", cause)));
    if (selected.definition.scopeId !== authority.scopeId) return yield* fail("staleAuthority");
    const requestKey = yield* Effect.fromResult(decodeTaskRunCreationRequestKeyV1(raw.requestKey))
      .pipe(Effect.mapError(cause => fail("invalidRequest", cause)));
    const taskInput = yield* Effect.fromResult(decodeTaskInputReferenceV1(raw.input))
      .pipe(Effect.mapError(cause => fail("invalidRequest", cause)));
    const principal = yield* Effect.fromResult(decodeTaskExecutionPrincipalReferenceV1(raw.principal))
      .pipe(Effect.mapError(cause => fail("invalidRequest", cause)));
    if (!trustedWorkflowPrincipalMatches(selected, principal.sha256)) return yield* fail("invalidBinding");
    if (!bytesEqualFullScan(yield* hash(selected.canonicalBytes), selected.sha256)) return yield* fail("invalidBinding");
    const requestKeySha256 = keyDigest(yield* hash(yield* Effect.fromResult(encodeTaskRunCreationRequestKeyPreimageV1(requestKey))));
    const requestSha256 = requestDigest(yield* hash(canonical({ codec: "flarex.trusted-workflow-task-request.v1",
      bindingSha256: encodeBytesToLowercaseHex(selected.sha256),
      input: { ...taskInput, sha256: encodeBytesToLowercaseHex(taskInput.sha256) },
      principal: { ...principal, sha256: encodeBytesToLowercaseHex(principal.sha256) },
    })));
    const authorityBytes = canonical({ codec: "flarex.trusted-workflow-task-authority.v1",
      scopeId: authority.scopeId, deploymentId: authority.deploymentId, epoch: authority.epoch,
      storageGeneration: authority.storageGeneration, storageGenerationFence: authority.storageGenerationFence.toString(),
      bindingSha256: encodeBytesToLowercaseHex(selected.sha256), principalSha256: selected.definition.principalSha256,
    });
    const creationAuthoritySha256 = authorityDigest(yield* hash(authorityBytes));
    const query = <Row>(value: PromiseLike<ReadonlyArray<Row>>) => runLocatedEffectQuery(value, "trustedWorkflowTask", (_operation, cause) => fail("storeFailure", cause));
    return yield* runLocatedEffectTransaction(target, "trustedWorkflowTask.createRun", tx => Effect.gen(function* () {
      yield* Effect.tryPromise({ try: () => requireLockedTaskSystemScopeAuthorityV1(tx, authority, target,
        mismatch => fail("staleAuthority", mismatch)), catch: cause => cause instanceof TrustedWorkflowTaskRunCreationError ? cause : fail("storeFailure", cause) });
      yield* query(tx.select({ locked: sql`pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["flarex.task.creation", authority.scopeId, encodeBytesToLowercaseHex(requestKeySha256)])}, 0))` }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, authority.scopeId)).limit(1));
      yield* query(tx.insert(fxSystemTrustedWorkflowTaskBindings).values({ scopeId: authority.scopeId,
        bindingSha256: selected.sha256, codecVersion: 1, byteLength: selected.canonicalBytes.byteLength, canonicalBytes: selected.canonicalBytes }).onConflictDoNothing().returning());
      const definitions = yield* query(tx.select().from(fxSystemTrustedWorkflowTaskBindings).where(and(
        eq(fxSystemTrustedWorkflowTaskBindings.scopeId, authority.scopeId), eq(fxSystemTrustedWorkflowTaskBindings.bindingSha256, selected.sha256))));
      const definition = definitions[0];
      if (definition === undefined || (definition.codecVersion !== 1 || definition.byteLength !== selected.canonicalBytes.byteLength ||
        !bytesEqualFullScan(definition.canonicalBytes, selected.canonicalBytes))) return yield* fail("storedCorruption");
      const previous = (yield* query(tx.select().from(fxSystemDurableTaskRunRequestsV1).where(and(
        eq(fxSystemDurableTaskRunRequestsV1.scopeId, authority.scopeId), eq(fxSystemDurableTaskRunRequestsV1.requestKeySha256, requestKeySha256)))))[0];
      if (previous !== undefined && (previous.requestKeyCodecVersion !== 1 || previous.requestCodecVersion !== 1 || previous.receiptVersion !== 1)) return yield* fail("storedCorruption");
      if (previous !== undefined && !bytesEqualFullScan(previous.requestSha256, requestSha256)) return yield* fail("requestConflict");
      if (previous !== undefined) {
        const row = (yield* query(tx.select().from(fxSystemDurableTaskRunsV1).where(and(eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId), eq(fxSystemDurableTaskRunsV1.runId, previous.runId)))))[0];
        if (row === undefined || row.definitionGeneration !== "trusted_workflow" || row.trustedWorkflowBindingSha256 === null ||
          !bytesEqualFullScan(row.trustedWorkflowBindingSha256, selected.sha256) || !bytesEqualFullScan(row.creationAuthoritySha256, creationAuthoritySha256) ||
          !bytesEqualFullScan(row.creationAuthorityBytes, authorityBytes) || row.inputObjectKey !== taskInput.objectKey ||
          !bytesEqualFullScan(row.inputSha256, taskInput.sha256) || row.inputCodec !== taskInput.codec || row.inputStore !== taskInput.store ||
          row.inputValueCodec !== taskInput.valueCodec || row.inputByteLength !== BigInt(taskInput.byteLength) || row.inputRetention !== taskInput.retention.kind ||
          row.executionPrincipalGeneration !== "present_v1" || row.executionPrincipalKind !== principal.principalKind ||
          row.executionPrincipalCodec !== principal.codec || row.executionPrincipalStore !== principal.store ||
          row.executionPrincipalValueCodec !== principal.valueCodec || row.executionPrincipalObjectKey !== principal.objectKey ||
          row.executionPrincipalByteLength !== BigInt(principal.byteLength) || row.executionPrincipalRetention !== principal.retention.kind ||
          row.creationAuthorityCodecVersion !== 1 || row.creationAuthorityByteLength !== BigInt(authorityBytes.byteLength) || row.executionPrincipalSha256 === null ||
          !bytesEqualFullScan(row.executionPrincipalSha256, principal.sha256)) return yield* fail("storedCorruption");
        yield* Effect.fromResult(decodeAndCorrelateTaskSystemRunRowV1(row)).pipe(Effect.mapError(cause => fail("storedCorruption", cause)));
        return Object.freeze({ status: "created" as const, runId: row.runId, trustedWorkflowBindingSha256: selected.sha256,
          createdAtMs: yield* Effect.fromResult(decodeTaskDatabaseTimeMsV1(Number(row.createdAtMs))).pipe(Effect.mapError(cause => fail("storedCorruption", cause))),
          requestKeySha256, requestSha256, creationAuthoritySha256 });
      }
      const runId = yield* Effect.fromResult(decodeTaskRunIdV1(`run_${randomUuid()}`)).pipe(Effect.mapError(cause => fail("invalidRequest", cause)));
      const now = (yield* query(tx.select({ milliseconds: sql<string>`floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text` }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, authority.scopeId)).limit(1)))[0];
      const createdAtMs = yield* Effect.fromResult(decodeTaskDatabaseTimeMsV1(Number(now?.milliseconds))).pipe(Effect.mapError(cause => fail("storedCorruption", cause)));
      const aggregate = yield* Effect.fromResult(makeTrustedWorkflowTaskRunCreationInitialAggregate({ runId, createdAtMs,
        trustedWorkflowBindingSha256: selected.sha256, boundPolicy: selected.definition.boundPolicy })).pipe(Effect.mapError(cause => fail("invalidBinding", cause)));
      const aggregateJson = yield* Effect.fromResult(encodeTrustedWorkflowTaskRunAttemptAggregateJson(aggregate)).pipe(Effect.mapError(cause => fail("storedCorruption", cause)));
      const projection = projectCurrentTaskRunAttemptPersistence(aggregate);
      yield* query(tx.insert(fxSystemDurableTaskRunsV1).values({ scopeId: authority.scopeId, runId,
        definitionGeneration: "trusted_workflow", trustedWorkflowBindingSha256: selected.sha256,
        createdAtMs: BigInt(createdAtMs), inputCodec: taskInput.codec, inputStore: taskInput.store, inputValueCodec: taskInput.valueCodec,
        inputObjectKey: taskInput.objectKey, inputByteLength: BigInt(taskInput.byteLength), inputSha256: taskInput.sha256, inputRetention: taskInput.retention.kind,
        executionPrincipalGeneration: "present_v1", executionPrincipalKind: principal.principalKind, executionPrincipalCodec: principal.codec,
        executionPrincipalStore: principal.store, executionPrincipalValueCodec: principal.valueCodec, executionPrincipalObjectKey: principal.objectKey,
        executionPrincipalByteLength: BigInt(principal.byteLength), executionPrincipalSha256: principal.sha256, executionPrincipalRetention: principal.retention.kind,
        creationAuthorityCodecVersion: 1, creationAuthorityByteLength: BigInt(authorityBytes.byteLength), creationAuthoritySha256, creationAuthorityBytes: authorityBytes,
        aggregateCodecVersion: 1, aggregateByteLength: BigInt(utf8.encode(JSON.stringify(aggregateJson)).byteLength), aggregateJson,
        runVersion: projection.runVersion, phase: projection.phase, dueKind: projection.dueKind, dueAtMs: projection.dueAtMs === null ? null : BigInt(projection.dueAtMs),
        currentAttemptId: projection.currentAttemptId, executionFenceBasis: projection.executionFenceBasis, currentLeaseVersion: projection.currentLeaseVersion,
        currentLeaseExpiresAtMs: projection.currentLeaseExpiresAtMs === null ? null : BigInt(projection.currentLeaseExpiresAtMs),
        cancellationGeneration: projection.cancellationGeneration, requestedEffectSequence: projection.requestedEffectSequence }).returning());
      yield* query(tx.insert(fxSystemDurableTaskRunRequestsV1).values({ scopeId: authority.scopeId, requestKeyCodecVersion: 1, requestKeySha256,
        requestCodecVersion: 1, requestSha256, runId, receiptVersion: 1 }).returning());
      return Object.freeze({ status: "created" as const, runId, trustedWorkflowBindingSha256: selected.sha256, createdAtMs,
        requestKeySha256, requestSha256, creationAuthoritySha256 });
    }), (_operation, cause) => fail("storeFailure", cause), "Trusted workflow Task creation rolled back");
  });
  return Object.freeze({ createRun });
}
