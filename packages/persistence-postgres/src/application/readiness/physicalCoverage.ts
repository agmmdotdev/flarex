import {
  MAX_RECONCILED_DEFINITIONS,
  type PublishedPhysicalRequirementSnapshotV1,
} from "../../storage/indexes/indexBuildReconciliation";
import {
  type ScopeClockRecord,
  lockScopeClockForSnapshotReadInTransactionEffect,
  ScopeAuthorizationRevocationEpochPersistenceError,
  scopeClockSelection,
  decodeScopeClockRecordResult,
} from "../../scope/scopeClock";
import {
  type IndexBuildStateRecord,
  indexMaintenanceBindingPredicate,
  readIndexCoverageContextInTransactionEffect,
  decodeIndexBuildStateRowResult,
  validateIndexBuildStateFrontierResult,
  isIndexBuildSnapshotCoveredInTransactionEffect,
} from "../../storage/indexes/indexBuildStates";
import {
  Effect,
  Result,
} from "effect";
import {
  type AppRowTransaction,
  AppRowReadPersistenceError,
} from "../../storage/documents/appRows";
import {
  type PhysicalDefinitionLifecyclePort,
  type PreparedPhysicalDefinitionLifecycleReadiness,
  type ValidatePhysicalDefinitionLifecycleReadinessError,
  validatePhysicalDefinitionLifecycleReadinessInTransactionEffect,
} from "../../installation/physicalDefinitionLifecycle";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type {
  ApplicationReadinessAuthority,
  ApplicationPhysicalReadinessResult,
} from "./contracts";
import {
  type ApplicationReadinessError,
  readinessFailureValue,
  readinessFailure,
} from "./errors";
import {
  retryableCause,
  query,
} from "./databaseBoundary";
import { requireExactAuthority } from "./bundle";
import { digestCanonicalJson } from "./frames";
import {
  fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../../database/schema";
import {
  getTableColumns,
  eq,
  and,
  inArray,
} from "drizzle-orm";
import { IndexMaintenanceError } from "../../storage/indexes/indexMaintenanceModel";

export const MAX_PHYSICAL_DEFINITIONS = MAX_RECONCILED_DEFINITIONS;

type PhysicalBuildRowsResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly reason: "physicalBuildMissing" | "physicalBuildNotEnabled" | "physicalBuildNotCovered";
      readonly detail: string;
      readonly clock: ScopeClockRecord;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly rows: ReadonlyArray<IndexBuildStateRecord>;
      readonly clock: ScopeClockRecord;
    }>;

export const loadPhysicalReadiness = Effect.fn(
  "ApplicationReadiness.loadPhysicalReadiness",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  lifecyclePort: PhysicalDefinitionLifecyclePort,
  lifecycleReadiness: PreparedPhysicalDefinitionLifecycleReadiness,
  clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
): Effect.fn.Return<
  ApplicationPhysicalReadinessResult,
  ApplicationReadinessError |
    ValidatePhysicalDefinitionLifecycleReadinessError
> {
  let observedClock = clock;
  let physicalBuilds: Extract<PhysicalBuildRowsResult, { readonly status: "ready" }> | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = yield* loadPhysicalBuildRows(
      tx, authority, requirements, observedClock, checkedActive,
    );
    if (candidate.status === "ready") {
      physicalBuilds = candidate;
      break;
    }
    const after = yield* lockScopeClockForSnapshotReadInTransactionEffect(
      tx, authority.scopeId,
    ).pipe(Effect.mapError(cause => cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? readinessFailureValue("resourceFailure", retryableCause(cause.cause), cause)
      : readinessFailureValue("storedState", false, cause)));
    yield* requireExactAuthority(authority, after);
    if (after.lastCommitSeq === candidate.clock.lastCommitSeq) {
      return Object.freeze({
        status: candidate.status,
        reason: candidate.reason,
        detail: candidate.detail,
      });
    }
    observedClock = after;
  }
  if (physicalBuilds === undefined) {
    return yield* readinessFailure("resourceFailure", true,
      new Error("Physical readiness clock advanced during bounded inspection."));
  }
  const snapshotClock = physicalBuilds.clock;
  const lifecycle = yield*
    validatePhysicalDefinitionLifecycleReadinessInTransactionEffect(
      lifecyclePort,
      lifecycleReadiness,
      tx,
      authority,
      snapshotClock,
    );
  if (lifecycle.status === "not_ready") {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "physicalDefinitionNotActive" as const,
      detail:
        `${lifecycle.definitionKind}:${lifecycle.definitionId}:${lifecycle.lifecycle}`,
    });
  }
  const physicalReadinessSha256 = yield* digestCanonicalJson({
    format: "flarex.application-physical-readiness",
    version: 1,
    scopeId: authority.scopeId,
    storageGeneration: snapshotClock.storageGeneration,
    storageGenerationFence: snapshotClock.storageGenerationFence.toString(),
    epoch: snapshotClock.epoch,
    schemaVersionId: requirements.schemaVersionId,
    schemaManifestSha256:
      encodeBytesToLowercaseHex(requirements.manifestSha256),
    requirementCount: requirements.definitions.length,
    indexes: physicalBuilds.rows.map((build, index) => {
      const requirement = requirements.definitions[index];
      if (requirement === undefined || build.firstReadableCommitSeq === null) {
        throw new Error("Application readiness physical definition or readable frontier vanished.");
      }
      return {
        indexDefinitionId: build.indexDefinitionId,
        physicalSpecCodecVersion: requirement.physicalSpecCodecVersion,
        physicalSpecSha256Hex: requirement.physicalSpecSha256Hex,
        lifecycle: build.lifecycle,
        startCommitSeq: build.startCommitSeq.toString(),
        firstReadableCommitSeq: build.firstReadableCommitSeq.toString(),
        attemptFence: build.attemptFence.toString(),
      };
    }),
    definitionLifecycles: lifecycle.entries.map(entry => ({
      definitionKind: entry.definitionKind,
      definitionId: entry.definitionId,
      physicalSpecSha256Hex: entry.physicalSpecSha256Hex,
      lifecycle: entry.lifecycle,
    })),
  });
  return Object.freeze({
    status: "ready" as const,
    physicalReadinessSha256,
  });
});

/**
 * Narrow shared Application capability: validates the retained table/index/
 * unique physical-readiness meaning inside a caller-owned locked transaction.
 */
export const validateApplicationPhysicalReadinessInTransactionEffect =
  loadPhysicalReadiness;

const loadPhysicalBuildRows = Effect.fn(
  "ApplicationReadiness.loadPhysicalBuildRows",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
): Effect.fn.Return<PhysicalBuildRowsResult, ApplicationReadinessError> {
    yield* requireExactAuthority(authority, clock);
    const definitionIds = requirements.definitions.map(
      definition => definition.indexDefinitionId,
    );
    // The clock and mutable index coverage must come from one MVCC statement.
    // A provisional read must not wait on the index row a point commit holds.
    const unordered = definitionIds.length === 0 ? [] : yield* query(
      tx.select({ build: fxSystemIndexBuildStates, maintenanceObligation: getTableColumns(fxSystemIndexMaintenanceObligations), scopeClock: scopeClockSelection() })
        .from(fxSystemIndexBuildStates)
        .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
        .innerJoin(fxSystemScopeClocks, eq(
          fxSystemScopeClocks.scopeId,
          fxSystemIndexBuildStates.scopeId,
        )).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId)).where(and(
        eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
        inArray(fxSystemIndexBuildStates.indexDefinitionId, definitionIds),
      )),
    );
    const snapshotClock = unordered[0] === undefined ? clock : yield* Effect.fromResult(
      decodeScopeClockRecordResult(unordered[0].scopeClock).pipe(Result.mapError(cause =>
        readinessFailureValue("storedState", false, cause))),
    );
    yield* requireExactAuthority(authority, snapshotClock);
    const rowsById = new Map(
      unordered.map(row => [row.build.indexDefinitionId, { ...row.build, maintenanceObligation: row.maintenanceObligation }] as const),
    );
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, snapshotClock, checkedActive).pipe(Effect.mapError(cause =>
      readinessFailureValue(cause.reason === "resourceFailure" ? "resourceFailure" : "storedState", cause.reason === "resourceFailure" && (cause.retryable ?? retryableCause(cause.cause)), cause)));
    const rows: IndexBuildStateRecord[] = [];
    for (let index = 0; index < definitionIds.length; index += 1) {
      const definitionId = definitionIds[index];
      const build = definitionId === undefined
        ? undefined
        : rowsById.get(definitionId);
      if (definitionId === undefined || build === undefined) {
        return Object.freeze({
          status: "not_ready" as const,
          reason: "physicalBuildMissing" as const,
          detail: String(definitionId),
          clock: snapshotClock,
        });
      }
      const decoded = yield* Effect.fromResult(
        decodeIndexBuildStateRowResult(
          build,
          authority.scopeId,
          definitionId, build.maintenanceObligation,
        ).pipe(Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        ))),
      );
      yield* Effect.fromResult(
        validateIndexBuildStateFrontierResult(
          decoded,
          snapshotClock.lastCommitSeq,
        ).pipe(Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        ))),
      );
      if (decoded.storageGeneration !== snapshotClock.storageGeneration ||
        decoded.storageGenerationFence !== snapshotClock.storageGenerationFence ||
        decoded.epoch !== snapshotClock.epoch) {
        return yield* readinessFailure("authorityChanged");
      }
      const requirement = requirements.definitions[index];
      if (requirement === undefined) return yield* readinessFailure("storedState");
      const covered = yield* isIndexBuildSnapshotCoveredInTransactionEffect(
        tx, decoded, requirement, snapshotClock.lastCommitSeq, context,
      ).pipe(Effect.mapError(cause => cause instanceof AppRowReadPersistenceError || (cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure")
        ? readinessFailureValue("resourceFailure", cause instanceof IndexMaintenanceError ? (cause.retryable ?? retryableCause(cause.cause)) : retryableCause(cause.cause), cause.cause)
        : readinessFailureValue("storedState", false, cause)));
      if (!covered) {
        return Object.freeze({
          status: "not_ready" as const,
          reason: decoded.lifecycle === "enabled" ? "physicalBuildNotCovered" as const : "physicalBuildNotEnabled" as const,
          detail: `${definitionId}:${decoded.lifecycle}`,
          clock: snapshotClock,
        });
      }
      rows.push(decoded);
    }
    return Object.freeze({ status: "ready" as const, rows: Object.freeze(rows), clock: snapshotClock });
  },
);
