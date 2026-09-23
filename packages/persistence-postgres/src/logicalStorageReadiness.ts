import { Data, Effect } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "./indexBuildReconciliation";
import { readRequiredEnabledIndexBuildsInTransactionEffect, decodeIndexBuildStateRowResult,
  readIndexCoverageContextInTransactionEffect, isIndexBuildSnapshotCoveredInTransactionEffect,
  validateIndexBuildStateFrontierResult } from "./indexBuildStates";
import { hasAppUniqueConstraintSetEligibilityCompositionV1, prepareAppUniqueConstraintSet, acceptPreparedAppUniqueConstraintSet,
  chargeUniqueConstraintPreparation,
  type AppUniqueConstraintSetEligibilityPortV1, type AppUniqueConstraintSetBuildPortsV1 } from "./appUniqueConstraintSetBuildV1";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect, type ScopeClockRecord } from "./scopeClock";
import type { AppRowTransaction } from "./appRows";
import { chargeHostPreparation } from "./preparedHostRuntime";

export class LogicalStorageReadinessError extends Data.TaggedError("LogicalStorageReadinessError")<{
  readonly reason: "invalidComposition" | "notLogicalCandidate" | "scopeMismatch";
}> {}

/** Immutable catalog preparation, using the complete candidate's existing
 * index and closed-unique owners. No per-framework builder, durable receipt,
 * activation head or serving capability is created here. */
export const prepareLogicalStorageReadiness = Effect.fn("LogicalStorageReadiness.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
) {
  if (!hasAppUniqueConstraintSetEligibilityCompositionV1(unique, ports.controlDb, ports.authority))
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  const captured = Object.freeze({ ...input });
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(ports.controlDb, captured);
  if (requirements === null) return Object.freeze({ status: "not_ready" as const, reason: "schemaMissing" as const });
  yield* chargeHostPreparation(JSON.stringify({ manifest: requirements.manifest, definitions: requirements.definitions },
    (_, member: unknown) => typeof member === "bigint" ? member.toString() : member));
  if (requirements.manifest.kind !== "logicalSchemaCandidate")
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "notLogicalCandidate" }));
  if (requirements.manifest.scopeId !== captured.scopeId)
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
  const constraints = yield* prepareAppUniqueConstraintSet(unique, captured);
  if (constraints.status === "not_ready") return Object.freeze({ status: "not_ready" as const, reason: "uniqueSetNotClosed" as const });
  yield* chargeUniqueConstraintPreparation(constraints.preparation);
  const definitionIds = Object.freeze(requirements.definitions.map(definition => definition.indexDefinitionId));
  const manifestSha256Hex = encodeBytesToLowercaseHex(requirements.manifestSha256);

  /** Call inside the accepting owner's transaction after it locks the scope
   * clock. This observes fresh structural coverage; the outer binding owner
   * must still select this exact schema/digest and authenticate semantic gates. */
  const inspect = Effect.fn("LogicalStorageReadiness.inspect")(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  ) {
    if (authority.deploymentId !== captured.deploymentId || authority.scopeId !== captured.scopeId || clock.scopeId !== authority.scopeId ||
      clock.epoch !== authority.epoch || clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
    // KEY SHARE protects lifecycle identity while ordinary publication may
    // advance coverage. Re-read the clock after the build rows so a concurrent
    // committed advance cannot look like a frontier ahead of the clock.
    const builds = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, clock, definitionIds, "key share");
    if (builds.status === "not_ready") return Object.freeze({ ...builds, kind: "index" as const });
    const observedClock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, clock.scopeId);
    if (observedClock.storageGeneration !== clock.storageGeneration || observedClock.storageGenerationFence !== clock.storageGenerationFence ||
      observedClock.epoch !== clock.epoch || observedClock.lastCommitSeq < clock.lastCommitSeq)
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
    const coverage = yield* readIndexCoverageContextInTransactionEffect(tx, observedClock);
    for (const definition of requirements.definitions) {
      const row = builds.rows.find(build => build.indexDefinitionId === definition.indexDefinitionId);
      if (row === undefined) return yield* Effect.die("Complete required build set lost a member");
      const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row, clock.scopeId, definition.indexDefinitionId));
      yield* Effect.fromResult(validateIndexBuildStateFrontierResult(state, observedClock.lastCommitSeq));
      if (!(yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, state, definition, clock.lastCommitSeq, coverage)))
        return Object.freeze({ status: "not_ready" as const, kind: "index" as const, reason: "notCovered" as const, indexDefinitionId: definition.indexDefinitionId });
    }
    const eligibility = yield* acceptPreparedAppUniqueConstraintSet(unique, constraints.preparation, tx, authority, clock, "concurrentProgress");
    if (eligibility.status === "not_ready") return Object.freeze({ ...eligibility, kind: "unique" as const });
    return Object.freeze({ status: "ready" as const, schemaVersionId: captured.schemaVersionId, manifestSha256Hex,
      snapshotCommitSeq: clock.lastCommitSeq, indexDefinitionIds: definitionIds, unique: eligibility });
  });
  return Object.freeze({ status: "prepared" as const, inspect,
    reference: Object.freeze({ schemaVersionId: captured.schemaVersionId, manifestSha256: manifestSha256Hex }),
    applicationAnalysis: requirements.manifest.applicationAnalysis });
});
