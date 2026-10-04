import { Data, Effect, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { loadPublishedPhysicalRequirementSnapshotV1, type PhysicalDefinitionRequirementV1, type PublishedPhysicalRequirementSnapshotV1 } from "./indexBuildReconciliation";
import { verifyApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import { prepareFiniteMetadataProjection } from "./finiteMetadataDependencies";
import { canonicalAppIndexPhysicalSpecBytesHexV1ToBytes } from "flarex-protocol/index-definition";
import { decodeAppOrderedIndexPhysicalSpecV1Result } from "flarex-protocol/ordered-index";
import { canonicalizeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import type { AppUniqueConstraintSetMemberV1 } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import type { JsonObject } from "flarex-protocol/json";
import { readRequiredEnabledIndexBuildsInTransactionEffect, decodeIndexBuildStateRowResult,
  readIndexCoverageContextInTransactionEffect, readIndexCoverageTableFrontiersInTransactionEffect,
  isIndexBuildSnapshotCoveredInTransactionEffect,
  isFiniteIndexBuildSnapshotCoveredInTransactionEffect,
  validateIndexBuildStateFrontierResult } from "./indexBuildStates";
import { hasAppUniqueConstraintSetEligibilityCompositionV1, prepareAppUniqueConstraintSet, acceptPreparedAppUniqueConstraintSet, selectPreparedAppUniqueConstraintSet, inspectSelectedAppUniqueConstraintDefinitions,
  chargeUniqueConstraintPreparation,
  inspectFiniteAppUniqueConstraintDefinitions,
  type AppUniqueConstraintSetEligibilityPortV1, type AppUniqueConstraintSetBuildPortsV1 } from "./appUniqueConstraintSetBuildV1";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect, requireFiniteExecutionAuthorityObservation,
  type FiniteExecutionAuthorityObservation, type ScopeClockRecord } from "./scopeClock";
import { readFiniteApplicationMetadata, type FiniteApplicationMetadata, type ApplicationBindingInput } from "./applicationActivation";
import type { SessionJournalAttempt } from "./sessionJournalStore";
import type { AppRowTransaction } from "./appRows";
import type { CheckedApplicationActiveHead } from "./applicationActiveHeadRead";
import type { IndexCoverageContext } from "./indexBuildStates";
import { chargeHostPreparation, captureHostPreparationLifetime } from "./preparedHostRuntime";
import { prepareLogicalSearchBuild, makeLogicalSearchReadinessInspector } from "./logicalSearchBuild";
import { prepareLogicalStrongReferenceProjections } from "./logicalStrongReferenceProjection";
import { prepareLogicalRelationalTableMechanics } from "./logicalDocuments/relationalRows";
import type { LogicalStorageReadDemand } from "./logicalDocuments/model";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "./appUniqueConstraintDefinitions";
import { prepareLogicalReadMechanics } from "./logicalDocuments/workingSet";
import { requirePreparedLogicalReadMetadata, type PreparedLogicalReadMetadata } from "./logicalReadMetadata";

/** Selected metadata supplies exact definitions; the established index,
 * unique and search owners retain their physical/coverage proof semantics. */
export const prepareLogicalReadDemand = Effect.fn("LogicalStorageReadiness.prepareReadDemand")(function* (
  metadata: PreparedLogicalReadMetadata,
) {
  yield* requirePreparedLogicalReadMetadata(metadata);
  const input = { deploymentId: metadata.root.deploymentId, scopeId: metadata.root.scopeId,
    schemaVersionId: metadata.root.schemaVersionId };
  const lifetime = yield* captureHostPreparationLifetime();
  const mechanics = yield* prepareLogicalReadMechanics(metadata);
  const inspectIndexes = makeLogicalIndexReadinessInspector(input, lifetime);
  const inspectSearch = makeLogicalSearchReadinessInspector(input.deploymentId);
  const inspectDemand = Effect.fn("LogicalStorageReadiness.inspectReadDemand")(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    demand: LogicalStorageReadDemand, checkedActive?: CheckedApplicationActiveHead,
  ) {
    yield* metadata.checkOpen;
    if (authority.deploymentId !== input.deploymentId || authority.scopeId !== input.scopeId || clock.scopeId !== authority.scopeId ||
      clock.epoch !== authority.epoch || clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence ||
      (demand.kind !== "clock" && metadata.selectedTable(demand.tableId) === undefined)) return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
    if (demand.kind === "index") {
      const located = metadata.selectedIndex(demand.indexDefinitionId);
      if (located === undefined || located.access.tableId !== demand.tableId) return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      const verdict = yield* inspectIndexes(tx, authority, clock, [{ ...located, tableId: located.access.tableId }], [], checkedActive);
      if (verdict.status !== "ready") return verdict;
    } else if (demand.kind === "unique") {
      const located = metadata.selectedUnique(demand.uniqueConstraintDefinitionId);
      if (located === undefined || located.tableId !== demand.tableId) return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      const verdict = yield* inspectSelectedAppUniqueConstraintDefinitions(input, [located], tx, authority, clock);
      if (verdict.status !== "ready") return Object.freeze({ ...verdict, kind: "unique" as const });
    } else if (demand.kind === "search") {
      const located = metadata.selectedSearch(demand.logicalIndexId);
      if (located === undefined || located.tableId !== demand.tableId) return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      const verdict = yield* inspectSearch([located], tx, authority, clock);
      if (verdict.status !== "ready") return Object.freeze({ ...verdict, kind: "search" as const });
    }
    return Object.freeze({ status: "ready" as const, readiness: "queryRequired" as const,
      schemaVersionId: input.schemaVersionId, tableId: demand.kind === "clock" ? undefined : demand.tableId, snapshotCommitSeq: clock.lastCommitSeq });
  });
  return Object.freeze({ mechanics, inspectDemand });
});

export class LogicalStorageReadinessError extends Data.TaggedError("LogicalStorageReadinessError")<{
  readonly reason: "invalidComposition" | "notLogicalCandidate" | "scopeMismatch" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const preparedCatalogs = new WeakMap<object, Readonly<{
  ports: AppUniqueConstraintSetBuildPortsV1; unique: AppUniqueConstraintSetEligibilityPortV1;
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>;
  lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
}>>();
const decodePublishedIndexEnvelope = Schema.decodeUnknownEffect(Schema.Struct({
  format: Schema.Literal("flarexdb-app-index-physical-spec"), physicalSpecCodecVersion: Schema.Literal(1),
  physicalSpec: Schema.Unknown,
}));

/** Activation/backfill projects the authenticated complete immutable catalog. */
export const prepareLogicalStorageMetadataProjection = Effect.fn("LogicalStorageReadiness.prepareMetadataProjection")(function* (
  input: Readonly<{ deploymentId: string; schemaVersionId: CatalogSchemaVersionId;
    profile: "binding" | "nativeApplication" }>,
  snapshot: PublishedPhysicalRequirementSnapshotV1, uniqueMembers: readonly AppUniqueConstraintSetMemberV1[],
) {
  const requirements = snapshot.logicalRequirements;
  if (snapshot.deploymentId !== input.deploymentId || snapshot.schemaVersionId !== input.schemaVersionId ||
    uniqueMembers.length !== (requirements?.unique.length ?? 0))
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  const indexes = yield* Effect.forEach(snapshot.definitions, definition => Effect.gen(function* () {
    const body = yield* Effect.try({ try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(definition.physicalSpecBytesHex))),
    catch: cause => new LogicalStorageReadinessError({ reason: "invalidComposition", cause }) });
    const envelope = yield* decodePublishedIndexEnvelope(body).pipe(
      Effect.mapError(cause => new LogicalStorageReadinessError({ reason: "invalidComposition", cause })));
    const physicalSpec = yield* Effect.fromResult(decodeAppOrderedIndexPhysicalSpecV1Result(envelope.physicalSpec)).pipe(
      Effect.mapError(cause => new LogicalStorageReadinessError({ reason: "invalidComposition", cause })));
    return { indexDefinitionId: definition.indexDefinitionId, access: definition.access,
      physicalSpec, physicalSpecSha256Hex: definition.physicalSpecSha256Hex };
  }));
  if (snapshot.manifest.kind === "appSchema") {
    if (input.profile !== "nativeApplication") return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    return yield* prepareFiniteMetadataProjection({ applicationSchema: { manifest: snapshot.manifest }, indexes, unique: [],
    }).pipe(Effect.mapError(cause => new LogicalStorageReadinessError({
      reason: cause.reason === "resourceFailure" ? "resourceFailure" : "invalidComposition", cause })));
  }
  if (requirements === undefined) return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  const uniqueSpecifications = yield* Effect.forEach(requirements.unique, declaration => Effect.tryPromise({
    try: () => canonicalizeAppUniqueConstraintPhysicalSpecV1(declaration.physicalSpec),
    catch: cause => new LogicalStorageReadinessError({ reason: "resourceFailure", cause }),
  }).pipe(Effect.catchTag("LogicalStorageReadinessError", failure =>
    typeof DOMException !== "undefined" && failure.cause instanceof DOMException ? Effect.fail(failure) : Effect.die(failure.cause)),
  Effect.map(canonical => ({ tableId: declaration.tableId, physicalSpec: declaration.physicalSpec,
    physicalSpecSha256Hex: canonical.sha256Hex }))));
  if (uniqueSpecifications.some(specification => !uniqueMembers.some(member => member.tableId === specification.tableId &&
    member.physicalSpecSha256Hex === specification.physicalSpecSha256Hex)))
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  const unique = yield* Effect.forEach(uniqueMembers, member => {
    const specification = uniqueSpecifications.find(candidate => candidate.tableId === member.tableId &&
      candidate.physicalSpecSha256Hex === member.physicalSpecSha256Hex);
    return specification === undefined ? Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" })) :
      Effect.succeed({ ...member, physicalSpec: specification.physicalSpec });
  });
  const sourcePolicies: { sourceKey: string; semantic: JsonObject }[] = [];
  for (const source of requirements.evidence.candidate.sources) {
    if (source.owner !== "payload") continue;
    if (source.definition.kind !== "documents") return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    const policy = yield* verifyApplicationWritePolicies(source.evidence, source.definition.tables.map(table => table.logicalName)).pipe(
      Effect.mapError(cause => new LogicalStorageReadinessError({ reason: cause.reason === "digestUnavailable" ? "resourceFailure" : "invalidComposition", cause })));
    const first = policy.policies.tables[0];
    if (first === undefined || first.owner !== "payload") return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    sourcePolicies.push({ sourceKey: source.key, semantic: { owner: source.owner, writeProfile: source.writeProfile,
      configSha256: first.configSha256, provenanceSha256: first.provenanceSha256 } });
  }
  return yield* prepareFiniteMetadataProjection({ requirements, requirementsProfile: input.profile, indexes, unique, sourcePolicies }).pipe(
    Effect.mapError(cause => new LogicalStorageReadinessError({ reason: cause.reason === "resourceFailure" ? "resourceFailure" : "invalidComposition", cause })));
});

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
  const lifetime = yield* captureHostPreparationLifetime();
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
  const sourceRequirements = requirements.logicalRequirements;
  if (sourceRequirements === undefined)
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  const search = yield* prepareLogicalSearchBuild(ports.controlDb, captured.deploymentId, captured.schemaVersionId,
    { kind: "prepared", requirements: sourceRequirements });
  yield* chargeUniqueConstraintPreparation(constraints.preparation);
  const definitionIds = Object.freeze(requirements.definitions.map(definition => definition.indexDefinitionId));
  const manifestSha256Hex = encodeBytesToLowercaseHex(requirements.manifestSha256);
  if (encodeBytesToLowercaseHex(sourceRequirements.artifact.manifestSha256) !== manifestSha256Hex)
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  // Search reads every selected requirement table at its original frontier
  // cut. Unique readiness keeps its lazy, freshly derived needed-table set.
  // Charge only this newly retained immutable array, not its catalog.
  const additionalSearchFrontierTableIds = Object.freeze([...new Set(
    sourceRequirements.search.map(requirement => requirement.tableId),
  )].toSorted((left, right) => left - right));
  yield* chargeHostPreparation(additionalSearchFrontierTableIds);
  const strongReferences = yield* prepareLogicalStrongReferenceProjections(ports.controlDb,
    captured.deploymentId, captured.scopeId, sourceRequirements, requirements.definitions)
    .pipe(Effect.mapError(cause => new LogicalStorageReadinessError({
      reason: cause.reason === "resourceFailure" ? "resourceFailure" : "invalidComposition", cause,
    })));
  yield* chargeHostPreparation(JSON.stringify(strongReferences));
  const sources = sourceRequirements.evidence.candidate.sources;
  const sourceByKey = new Map(sources.map(source => [source.key, source]));
  const stableTableByKey = new Map(sourceRequirements.evidence.tableBindings
    .map(binding => [logicalTableKey(binding.table), binding]));
  const sourceTables = Object.freeze(sources.map(source => {
    const bindings = source.bindings.map(binding => stableTableByKey.get(logicalTableKey(binding.table))?.tableId);
    return Object.freeze({ source, missing: bindings.some(table => table === undefined),
      tables: Object.freeze(bindings.filter((table): table is CatalogTableId => table !== undefined)) });
  }));
  const sourceDefinitionTables = new Map(sources.map(source => {
    const bindings = new Map(source.bindings.filter(binding => binding.kind === "definition").map(binding => [binding.localName, binding]));
    const names = source.definition.kind === "documents" ? source.definition.tables.map(table => table.logicalName) :
      source.definition.schema.tables.map(table => table.identity.tableId);
    const tables = names.map(localName => {
      const binding = bindings.get(localName);
      const tableId = binding === undefined ? undefined : stableTableByKey.get(logicalTableKey(binding.table))?.tableId;
      return tableId === undefined ? undefined : Object.freeze({ localName, tableId });
    });
    return [source.key, tables.some(table => table === undefined) ? undefined :
      Object.freeze(tables.filter((table): table is NonNullable<typeof table> => table !== undefined))] as const;
  }));
  const invalidNormalizedReference = sources.some(source => {
    if (source.definition.kind !== "relational") return false;
    const schema = source.definition.schema;
    return schema.tables.some(table => table.constraints.some(constraint => constraint.kind === "foreignKey" &&
      constraint.targetColumns.some(column => column.owner !== table.identity.owner ||
        column.lineageId !== table.identity.lineageId || !schema.tables.some(target => target.identity.tableId === column.tableId))));
  });
  const relationalMechanics = new Map<CatalogTableId, ReturnType<typeof prepareLogicalRelationalTableMechanics>>();
  for (const source of sources) {
    if (source.definition.kind !== "relational") continue;
    const bindings = new Map(source.bindings.filter(binding => binding.kind === "definition").map(binding => [binding.localName, binding]));
    for (const table of source.definition.schema.tables) {
      const binding = bindings.get(table.identity.tableId);
      const tableId = binding === undefined ? undefined : stableTableByKey.get(logicalTableKey(binding.table))?.tableId;
      if (tableId !== undefined) relationalMechanics.set(tableId, prepareLogicalRelationalTableMechanics(table,
        source.definition.schema.capabilities));
    }
  }
  yield* chargeHostPreparation([...relationalMechanics].map(([tableId, mechanics]) => ({ tableId,
    table: mechanics.table, capabilities: mechanics.capabilities })));

  const inspectIndexes = makeLogicalIndexReadinessInspector(captured, lifetime);
  const definitionById = new Map(requirements.definitions.map(definition => [definition.indexDefinitionId, definition]));
  const sourceTableIds = new Map(sourceTables.map(member => [member.source.key, new Set(member.tables)]));
  // Definition bodies belong to the catalog charge. These are additional
  // retained lookup wrappers and keys, including each source's membership set.
  yield* chargeHostPreparation({
    definitionLookup: { keys: [...definitionById.keys()], entryCount: definitionById.size },
    sourceTableLookups: [...sourceTableIds].map(([sourceKey, tableIds]) => ({
      sourceKey, keys: [...tableIds], entryCount: tableIds.size,
    })),
  });
  const inspectDemand = Effect.fn("LogicalStorageReadiness.inspectFiniteDemand")(function* (
    sourceKey: string, selectedUnique: ReadonlyMap<LocatedAppUniqueConstraintDefinitionV1["uniqueConstraintDefinitionId"], LocatedAppUniqueConstraintDefinitionV1>,
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    demand: LogicalStorageReadDemand, checkedActive?: CheckedApplicationActiveHead,
  ) {
    if (lifetime !== undefined) yield* Effect.fromResult(lifetime.checkOpen());
    const tables = sourceTableIds.get(sourceKey);
    if (tables === undefined || authority.deploymentId !== captured.deploymentId || authority.scopeId !== captured.scopeId ||
      clock.scopeId !== authority.scopeId || clock.epoch !== authority.epoch ||
      clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence ||
      (demand.kind !== "clock" && !tables.has(demand.tableId)))
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
    if (demand.kind === "index") {
      const definition = definitionById.get(demand.indexDefinitionId);
      if (definition === undefined || definition.tableId !== demand.tableId)
        return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      return yield* inspectIndexes(tx, authority, clock, [definition], [], checkedActive);
    }
    if (demand.kind === "unique") {
      const definition = selectedUnique.get(demand.uniqueConstraintDefinitionId);
      if (definition === undefined || definition.tableId !== demand.tableId)
        return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      return yield* inspectSelectedAppUniqueConstraintDefinitions(captured, [definition], tx, authority, clock);
    }
    if (demand.kind === "search") {
      const definition = search.selectedDefinition(demand.logicalIndexId);
      if (definition === undefined || definition.tableId !== demand.tableId)
        return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
      return yield* makeLogicalSearchReadinessInspector(captured.deploymentId)([definition], tx, authority, clock);
    }
    return Object.freeze({ status: "ready" as const });
  });
  const inspect = Effect.fn("LogicalStorageReadiness.inspect")(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    checkedActive?: CheckedApplicationActiveHead,
  ) {
    const indexes = yield* inspectIndexes(tx, authority, clock, requirements.definitions,
      additionalSearchFrontierTableIds, checkedActive);
    if (indexes.status === "not_ready") return indexes;
    const latestCoverage = indexes.coverage;
    const eligibility = yield* acceptPreparedAppUniqueConstraintSet(unique, constraints.preparation, tx, authority, clock,
      "concurrentProgress", latestCoverage);
    if (eligibility.status === "not_ready") return Object.freeze({ ...eligibility, kind: "unique" as const });
    const searchReadiness = yield* search.inspect(tx, authority, clock, latestCoverage);
    if (searchReadiness.status === "not_ready")
      return Object.freeze({ ...searchReadiness, kind: "search" as const });
    return Object.freeze({ status: "ready" as const, readiness: "full" as const, schemaVersionId: captured.schemaVersionId, manifestSha256Hex,
      snapshotCommitSeq: clock.lastCommitSeq, indexDefinitionIds: definitionIds, unique: eligibility });
  });
  /** Source-complete closure is derived here, never supplied by adapters or
   * method allowlists. Incoming edges include reverse/delete obligations and
   * outgoing edges include target identities. Repeat for each added source. */
  const selectSources = Effect.fn("LogicalStorageReadiness.selectSources")(function* (requestedSourceKeys: readonly string[]) {
    if (requestedSourceKeys.length === 0 || requestedSourceKeys.length > sources.length)
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    const selectedSources = new Set(requestedSourceKeys);
    if (selectedSources.size !== requestedSourceKeys.length ||
      [...selectedSources].some(key => !sourceByKey.has(key)))
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    // The canonical candidate decoder proves declared-name cardinality and
    // definition/view shape; admission proves the complete stable binding set.
    if (sourceTables.some(member => member.missing))
      return yield* Effect.die("Authenticated source lost its stable table binding");
    // Normalized foreign keys are admitted only within their owning source.
    // A cross-source normalized target is not proved by this source closure.
    if (invalidNormalizedReference)
      return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
    const selectedTables = new Set(sourceTables.filter(member => selectedSources.has(member.source.key))
      .flatMap(member => member.tables.filter((table): table is CatalogTableId => table !== undefined)));
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
            for (const tableId of member.tables) if (tableId !== undefined) selectedTables.add(tableId);
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
      const indexes = yield* inspectIndexes(tx, authority, clock, definitions,
        additionalSearchFrontierTableIds.filter(tableId => selectedTables.has(tableId)), checkedActive);
      if (indexes.status === "not_ready") return indexes;
      const eligibility = yield* selectedUnique.inspectSelected(tx, authority, clock, indexes.coverage);
      if (eligibility.status === "not_ready") return Object.freeze({ ...eligibility, kind: "unique" as const });
      const searchReadiness = yield* selectedSearch.inspectSelected(tx, authority, clock, indexes.coverage);
      if (searchReadiness.status === "not_ready") return Object.freeze({ ...searchReadiness, kind: "search" as const });
      return Object.freeze({ status: "ready" as const, readiness: "selected" as const,
        schemaVersionId: captured.schemaVersionId, manifestSha256Hex, sourceKeys, tableIds,
        snapshotCommitSeq: clock.lastCommitSeq, indexDefinitionIds: Object.freeze(definitions.map(definition => definition.indexDefinitionId)) });
    });
    return Object.freeze({ inspectSelected, sourceKeys, tableIds,
      reference: Object.freeze({ schemaVersionId: captured.schemaVersionId, manifestSha256: manifestSha256Hex }),
      applicationAnalysis });
  });
  const prepared = Object.freeze({ status: "prepared" as const, inspect, selectSources, advanceEmptySearch: search.advanceEmpty,
    requirements: sourceRequirements, snapshot: requirements,
    relationalTableMechanics: (tableId: CatalogTableId) => relationalMechanics.get(tableId),
    source: (key: string) => sourceByKey.get(key), sourceDefinitionTables: (key: string) => sourceDefinitionTables.get(key),
    sourceBoundTableIds: (key: string) => sourceTables.find(member => member.source.key === key)?.tables,
    prepareSourceDemand: Effect.fn("LogicalStorageReadiness.prepareSourceDemand")(function* (
      sourceKey: string, sourceUnique: readonly LocatedAppUniqueConstraintDefinitionV1[],
    ) {
      const sourceLifetime = yield* captureHostPreparationLifetime();
      const byId = new Map(sourceUnique.map(member => [member.uniqueConstraintDefinitionId, member]));
      yield* chargeHostPreparation({ uniqueLookup: { keys: [...byId.keys()], entryCount: byId.size } });
      return (tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
        demand: LogicalStorageReadDemand, checkedActive?: CheckedApplicationActiveHead) =>
        (sourceLifetime === undefined ? Effect.void : Effect.fromResult(sourceLifetime.checkOpen())).pipe(
          Effect.andThen(inspectDemand(sourceKey, byId, tx, authority, clock, demand, checkedActive)));
    }),
    prepareFiniteSourceDemand: Effect.fn("LogicalStorageReadiness.prepareFiniteSourceDemand")(function* (
      sourceKey: string, sourceUnique: readonly LocatedAppUniqueConstraintDefinitionV1[],
    ) {
      const sourceLifetime = yield* captureHostPreparationLifetime();
      const uniqueById = new Map(sourceUnique.map(member => [member.uniqueConstraintDefinitionId, member]));
      yield* chargeHostPreparation({ finiteUniqueLookup: [...uniqueById.keys()] });
      return Effect.fn("LogicalStorageReadiness.inspectFiniteSourceDemand")(function* (
        tx: AppRowTransaction, authority: TrustedScopeAuthority, observation: FiniteExecutionAuthorityObservation,
        applicationMetadata: FiniteApplicationMetadata, application: ApplicationBindingInput, root: SessionJournalAttempt,
        demand: LogicalStorageReadDemand,
      ) {
        if (sourceLifetime !== undefined) yield* Effect.fromResult(sourceLifetime.checkOpen());
        const live = yield* Effect.fromResult(requireFiniteExecutionAuthorityObservation(tx, observation));
        yield* Effect.fromResult(readFiniteApplicationMetadata(applicationMetadata, application, root, tx, observation));
        const tables = sourceTableIds.get(sourceKey);
        if (tables === undefined || authority.deploymentId !== captured.deploymentId || live.scopeId !== captured.scopeId ||
          authority.scopeId !== live.scopeId || (demand.kind !== "clock" && !tables.has(demand.tableId)))
          return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "scopeMismatch" }));
        if (demand.kind === "search")
          return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition", cause: "finiteHistoricalSearchUnsupported" }));
        if (demand.kind === "index") {
          const definition = definitionById.get(demand.indexDefinitionId);
          if (definition === undefined || definition.tableId !== demand.tableId)
            return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
          const builds = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, live, [definition.indexDefinitionId], "key share");
          if (builds.status !== "ready") return builds;
          const row = builds.rows[0];
          if (row === undefined) return yield* Effect.die("Required finite build disappeared");
          const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row, live.scopeId, definition.indexDefinitionId));
          if (!(yield* isFiniteIndexBuildSnapshotCoveredInTransactionEffect(tx, state, definition,
            observation, applicationMetadata, application, root)))
            return Object.freeze({ status: "not_ready" as const, reason: "notCovered" as const, indexDefinitionId: definition.indexDefinitionId });
        } else if (demand.kind === "unique") {
          const definition = uniqueById.get(demand.uniqueConstraintDefinitionId);
          if (definition === undefined || definition.tableId !== demand.tableId)
            return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
          return yield* inspectFiniteAppUniqueConstraintDefinitions(captured, [definition], tx, authority, observation,
            applicationMetadata, application, root);
        }
        return Object.freeze({ status: "ready" as const });
      });
    }),
    reference: Object.freeze({ schemaVersionId: captured.schemaVersionId, manifestSha256: manifestSha256Hex }),
    applicationAnalysis, strongReferences });
  preparedCatalogs.set(prepared, { ports: Object.freeze({ ...ports }), unique, input: captured, lifetime });
  return prepared;
});

export type PreparedLogicalStorageCatalog = Extract<Effect.Success<ReturnType<typeof prepareLogicalStorageReadiness>>,
  { readonly status: "prepared" }>;

/** Private issuer provenance pins construction to its exact catalog owners.
 * A host lease proves mechanics lifetime only, never attempt authority. */
export const requirePreparedLogicalStorageCatalog = Effect.fn("LogicalStorageReadiness.requireCatalog")(function* (
  catalog: PreparedLogicalStorageCatalog, ports: AppUniqueConstraintSetBuildPortsV1,
  unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
) {
  const issued = preparedCatalogs.get(catalog);
  if (issued === undefined || issued.ports.controlDb !== ports.controlDb || issued.ports.authority !== ports.authority ||
    issued.unique !== unique || issued.input.deploymentId !== input.deploymentId || issued.input.scopeId !== input.scopeId ||
    issued.input.schemaVersionId !== input.schemaVersionId)
    return yield* Effect.fail(new LogicalStorageReadinessError({ reason: "invalidComposition" }));
  if (issued.lifetime !== undefined) yield* Effect.fromResult(issued.lifetime.checkOpen());
  return catalog;
});

/** One index coverage owner serves full and exact demanded definitions. */
export function makeLogicalIndexReadinessInspector(
  captured: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>,
) {
  /** Call inside the accepting owner's transaction after it locks the scope
   * clock. This observes fresh structural coverage; the outer binding owner
   * must still select this exact schema/digest and authenticate semantic gates. */
  const inspectIndexes = Effect.fn("LogicalStorageReadiness.inspectIndexes")(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    definitions: readonly PhysicalDefinitionRequirementV1[], selectedAdditionalSearchFrontierTableIds: ReadonlyArray<CatalogTableId>,
    checkedActive?: CheckedApplicationActiveHead,
  ) {
    if (lifetime !== undefined) yield* Effect.fromResult(lifetime.checkOpen());
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
      const buildByDefinitionId = new Map(builds.rows.map(build => [build.indexDefinitionId, build]));
      const selected = definitions.map(definition => {
        const row = buildByDefinitionId.get(definition.indexDefinitionId);
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
          // Retain search Results without consuming them here. Later owners
          // borrow only complete maps at their original frontier verdict.
          // No ordered frontier need means no early query.
          yield* readIndexCoverageTableFrontiersInTransactionEffect(tx, coverage,
            [...new Set([...tableIds, ...selectedAdditionalSearchFrontierTableIds])]);
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
  return inspectIndexes;
}
