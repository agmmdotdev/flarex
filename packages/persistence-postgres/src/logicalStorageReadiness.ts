import { Data, Effect, Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "./indexBuildReconciliation";
import { readRequiredEnabledIndexBuildsInTransactionEffect, decodeIndexBuildStateRowResult,
  readIndexCoverageContextInTransactionEffect, readIndexCoverageTableFrontiersInTransactionEffect,
  isIndexBuildSnapshotCoveredInTransactionEffect,
  validateIndexBuildStateFrontierResult } from "./indexBuildStates";
import { hasAppUniqueConstraintSetEligibilityCompositionV1, prepareAppUniqueConstraintSet, acceptPreparedAppUniqueConstraintSet, selectPreparedAppUniqueConstraintSet,
  chargeUniqueConstraintPreparation,
  type AppUniqueConstraintSetEligibilityPortV1, type AppUniqueConstraintSetBuildPortsV1 } from "./appUniqueConstraintSetBuildV1";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect, type ScopeClockRecord } from "./scopeClock";
import type { AppRowTransaction } from "./appRows";
import type { CheckedApplicationActiveHead } from "./applicationActiveHeadRead";
import type { IndexCoverageContext } from "./indexBuildStates";
import { chargeHostPreparation } from "./preparedHostRuntime";
import { prepareLogicalSearchBuild } from "./logicalSearchBuild";
import { readLogicalStorageRequirements } from "./logicalStorageDefinitions";
import { prepareLogicalStrongReferenceProjections } from "./logicalStrongReferenceProjection";

export class LogicalStorageReadinessError extends Data.TaggedError("LogicalStorageReadinessError")<{
  readonly reason: "invalidComposition" | "notLogicalCandidate" | "scopeMismatch" | "resourceFailure";
  readonly cause?: unknown;
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
  const applicationAnalysis = requirements.manifest.applicationAnalysis;
  if (requirements.manifest.scopeId !== captured.scopeId)
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
  const constraints = yield* prepareAppUniqueConstraintSet(unique, captured);
  if (constraints.status === "not_ready") return Object.freeze({ status: "not_ready" as const, reason: "uniqueSetNotClosed" as const });
  const search = yield* prepareLogicalSearchBuild(ports.controlDb, captured.deploymentId, captured.schemaVersionId);
  yield* chargeUniqueConstraintPreparation(constraints.preparation);
  const definitionIds = Object.freeze(requirements.definitions.map(definition => definition.indexDefinitionId));
  const manifestSha256Hex = encodeBytesToLowercaseHex(requirements.manifestSha256);
  const sourceRequirements = yield* readLogicalStorageRequirements(ports.controlDb,
    captured.deploymentId, captured.schemaVersionId);
  if (encodeBytesToLowercaseHex(sourceRequirements.artifact.manifestSha256) !== manifestSha256Hex)
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  const strongReferences = yield* prepareLogicalStrongReferenceProjections(ports.controlDb,
    captured.deploymentId, captured.scopeId, sourceRequirements, requirements.definitions)
    .pipe(Effect.mapError(cause => new LogicalStorageReadinessError({
      reason: cause.reason === "resourceFailure" ? "resourceFailure" : "invalidComposition", cause,
    })));
  yield* chargeHostPreparation(JSON.stringify(strongReferences));

  /** Call inside the accepting owner's transaction after it locks the scope
   * clock. This observes fresh structural coverage; the outer binding owner
   * must still select this exact schema/digest and authenticate semantic gates. */
  const inspectIndexes = Effect.fn("LogicalStorageReadiness.inspectIndexes")(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    definitions: typeof requirements.definitions, checkedActive?: CheckedApplicationActiveHead,
  ) {
    const inspectedDefinitionIds = Object.freeze(definitions.map(definition => definition.indexDefinitionId));
    if (authority.deploymentId !== captured.deploymentId || authority.scopeId !== captured.scopeId || clock.scopeId !== authority.scopeId ||
      clock.epoch !== authority.epoch || clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
    // KEY SHARE protects lifecycle identity while publication may advance
    // coverage. A commit between the clock read and a later table-frontier
    // read can make an old build look uncovered at the admitted snapshot.
    // Refresh both observations only when a post-miss clock read proves that
    // publication advanced; never waive a persistent miss.
    let previousCommitSeq = clock.lastCommitSeq;
    let latestCoverage: IndexCoverageContext | undefined;
    for (let refresh = 0; refresh < 3; refresh++) {
      const builds = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, clock, inspectedDefinitionIds, "key share");
      if (builds.status === "not_ready") return Object.freeze({ ...builds, kind: "index" as const });
      const observedClock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, clock.scopeId);
      if (observedClock.storageGeneration !== clock.storageGeneration || observedClock.storageGenerationFence !== clock.storageGenerationFence ||
        observedClock.epoch !== clock.epoch || observedClock.lastCommitSeq < clock.lastCommitSeq)
        return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
      const selected = definitions.map(definition => {
        const row = builds.rows.find(build => build.indexDefinitionId === definition.indexDefinitionId);
        if (row === undefined) return { definition, state: null } as const;
        const decoded = decodeIndexBuildStateRowResult(row, clock.scopeId, definition.indexDefinitionId);
        return { definition, state: decoded } as const;
      });
      const tableIds = selected.flatMap(({ definition, state }) => {
        if (state === null || Result.isFailure(state)) return [];
        const build = state.success;
        return build.lifecycle === "enabled" && build.maintenance === null &&
          build.coveredThroughCommitSeq !== null && build.coveredThroughCommitSeq < clock.lastCommitSeq &&
          build.firstReadableCommitSeq !== null && build.firstReadableCommitSeq <= clock.lastCommitSeq
          ? [definition.tableId] : [];
      });
      const coverage = yield* readIndexCoverageContextInTransactionEffect(tx, observedClock, checkedActive);
      latestCoverage = coverage;
      let frontierBatchReady = false;
      let uncoveredIndexDefinitionId: (typeof definitions)[number]["indexDefinitionId"] | undefined;
      for (const { definition, state: decoded } of selected) {
        if (decoded === null) return yield* Effect.die("Complete required build set lost a member");
        const state = yield* Effect.fromResult(decoded);
        yield* Effect.fromResult(validateIndexBuildStateFrontierResult(state, observedClock.lastCommitSeq));
        if (!frontierBatchReady && state.lifecycle === "enabled" && state.maintenance === null &&
          state.coveredThroughCommitSeq !== null && state.coveredThroughCommitSeq < clock.lastCommitSeq &&
          state.firstReadableCommitSeq !== null && state.firstReadableCommitSeq <= clock.lastCommitSeq) {
          yield* readIndexCoverageTableFrontiersInTransactionEffect(tx, coverage, tableIds);
          frontierBatchReady = true;
        }
        if (!(yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, state, definition, clock.lastCommitSeq, coverage))) {
          uncoveredIndexDefinitionId = definition.indexDefinitionId;
          break;
        }
      }
      if (uncoveredIndexDefinitionId === undefined) break;
      const afterMissClock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, clock.scopeId);
      if (afterMissClock.storageGeneration !== clock.storageGeneration || afterMissClock.storageGenerationFence !== clock.storageGenerationFence ||
        afterMissClock.epoch !== clock.epoch || afterMissClock.lastCommitSeq < observedClock.lastCommitSeq)
        return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
      if (refresh < 2 && afterMissClock.lastCommitSeq > previousCommitSeq) {
        previousCommitSeq = afterMissClock.lastCommitSeq;
        continue;
      }
      return Object.freeze({ status: "not_ready" as const, kind: "index" as const, reason: "notCovered" as const,
        indexDefinitionId: uncoveredIndexDefinitionId });
    }
    return Object.freeze({ status: "ready" as const, coverage: latestCoverage });
  });
  const inspect = Effect.fn("LogicalStorageReadiness.inspect")(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    checkedActive?: CheckedApplicationActiveHead,
  ) {
    const indexes = yield* inspectIndexes(tx, authority, clock, requirements.definitions, checkedActive);
    if (indexes.status === "not_ready") return indexes;
    const latestCoverage = indexes.coverage;
    const eligibility = yield* acceptPreparedAppUniqueConstraintSet(unique, constraints.preparation, tx, authority, clock,
      "concurrentProgress", latestCoverage);
    if (eligibility.status === "not_ready") return Object.freeze({ ...eligibility, kind: "unique" as const });
    const searchReadiness = yield* search.inspect(tx, authority, clock);
    if (searchReadiness.status === "not_ready")
      return Object.freeze({ ...searchReadiness, kind: "search" as const });
    return Object.freeze({ status: "ready" as const, readiness: "full" as const, schemaVersionId: captured.schemaVersionId, manifestSha256Hex,
      snapshotCommitSeq: clock.lastCommitSeq, indexDefinitionIds: definitionIds, unique: eligibility });
  });
  /** Source-complete closure is derived here, never supplied by adapters or
   * method allowlists. Incoming edges include reverse/delete obligations and
   * outgoing edges include target identities. Repeat for each added source. */
  const selectSources = Effect.fn("LogicalStorageReadiness.selectSources")(function* (requestedSourceKeys: readonly string[]) {
    const sources = sourceRequirements.evidence.candidate.sources;
    if (requestedSourceKeys.length === 0 || requestedSourceKeys.length > sources.length)
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    const selectedSources = new Set(requestedSourceKeys);
    if (selectedSources.size !== requestedSourceKeys.length ||
      [...selectedSources].some(key => !sources.some(source => source.key === key)))
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    // The canonical candidate decoder proves declared-name cardinality and
    // definition/view shape; admission proves the complete stable binding set.
    const sourceTables: Readonly<{ source: typeof sources[number]; tables: readonly CatalogTableId[] }>[] = [];
    for (const source of sources) {
      const tables: CatalogTableId[] = [];
      for (const binding of source.bindings) {
        const table = sourceRequirements.evidence.tableBindings.find(member => logicalTableKey(member.table) === logicalTableKey(binding.table));
        if (table === undefined) return yield* Effect.die("Authenticated source lost its stable table binding");
        tables.push(table.tableId);
      }
      sourceTables.push(Object.freeze({ source, tables: Object.freeze(tables) }));
    }
    // Normalized foreign keys are admitted only within their owning source.
    // A cross-source normalized target is not proved by this source closure.
    for (const { source } of sourceTables) {
      if (source.definition.kind !== "relational") continue;
      const schema = source.definition.schema;
      for (const table of schema.tables) for (const constraint of table.constraints) {
        if (constraint.kind !== "foreignKey") continue;
        if (constraint.targetColumns.some(column => column.owner !== table.identity.owner ||
          column.lineageId !== table.identity.lineageId || !schema.tables.some(target =>
            target.identity.tableId === column.tableId)))
          return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      }
    }
    const selectedTables = new Set(sourceTables.filter(member => selectedSources.has(member.source.key))
      .flatMap(member => member.tables));
    let changed = true;
    while (changed) {
      changed = false;
      // A view reads its definition owner's tables, whose complete source
      // obligations are included before following relation/delete edges.
      for (const member of sourceTables) {
        if (selectedSources.has(member.source.key) || !member.tables.some(tableId => selectedTables.has(tableId))) continue;
        selectedSources.add(member.source.key);
        for (const tableId of member.tables) selectedTables.add(tableId);
        changed = true;
      }
      for (const reference of strongReferences) {
        if (!selectedTables.has(reference.sourceTableId) && !selectedTables.has(reference.targetTableId)) continue;
        for (const member of sourceTables) {
          if (!member.tables.includes(reference.sourceTableId) && !member.tables.includes(reference.targetTableId)) continue;
          if (!selectedSources.has(member.source.key)) {
            selectedSources.add(member.source.key);
            for (const tableId of member.tables) selectedTables.add(tableId);
            changed = true;
          }
        }
      }
    }
    const sourceKeys = Object.freeze(sourceTables.filter(member => selectedSources.has(member.source.key)).map(member => member.source.key));
    const tableIds = Object.freeze([...selectedTables].toSorted((left, right) => left - right));
    const definitions = Object.freeze(requirements.definitions.filter(definition => selectedTables.has(definition.tableId)));
    const selectedUnique = yield* selectPreparedAppUniqueConstraintSet(unique, constraints.preparation, tableIds);
    const selectedSearch = search.selectTables(tableIds);
    const inspectSelected = Effect.fn("LogicalStorageReadiness.inspectSelected")(function* (
      tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
      checkedActive?: CheckedApplicationActiveHead,
    ) {
      const indexes = yield* inspectIndexes(tx, authority, clock, definitions, checkedActive);
      if (indexes.status === "not_ready") return indexes;
      const eligibility = yield* selectedUnique.inspectSelected(tx, authority, clock, indexes.coverage);
      if (eligibility.status === "not_ready") return Object.freeze({ ...eligibility, kind: "unique" as const });
      const searchReadiness = yield* selectedSearch.inspectSelected(tx, authority, clock);
      if (searchReadiness.status === "not_ready") return Object.freeze({ ...searchReadiness, kind: "search" as const });
      return Object.freeze({ status: "ready" as const, readiness: "selected" as const,
        schemaVersionId: captured.schemaVersionId, manifestSha256Hex, sourceKeys, tableIds,
        snapshotCommitSeq: clock.lastCommitSeq, indexDefinitionIds: Object.freeze(definitions.map(definition => definition.indexDefinitionId)) });
    });
    return Object.freeze({ inspectSelected, sourceKeys, tableIds,
      reference: Object.freeze({ schemaVersionId: captured.schemaVersionId, manifestSha256: manifestSha256Hex }),
      applicationAnalysis });
  });
  return Object.freeze({ status: "prepared" as const, inspect, selectSources, advanceEmptySearch: search.advanceEmpty,
    reference: Object.freeze({ schemaVersionId: captured.schemaVersionId, manifestSha256: manifestSha256Hex }),
    applicationAnalysis, strongReferences });
});
