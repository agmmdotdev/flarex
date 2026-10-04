import { Data, Effect, Exit, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, type Json, type JsonObject } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, logicalTableKey,
  type LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { CatalogSchemaVersionIdSchema, type CatalogSchemaVersionId,
  type SchemaManifestAppDocumentDefinitionV1 } from "flarex-protocol/schema-manifest";
import type { MetadataSequence } from "flarex-protocol/commit-protocol";
import { ReplacementScopeIdV1Schema, type ScopeId } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { readApplicationBindingTargetProtection, isPreparedApplicationBinding, requireAcceptedApplicationBindingObservation,
  captureFiniteApplicationMetadata, inspectFiniteApplicationMetadata, readFiniteApplicationMetadata, type FiniteApplicationMetadata,
  readCapturedFiniteApplicationMetadata,
  prepareApplicationExecutionMetadataProjection, prepareFiniteApplicationSchemaMetadataProjection,
  type AcceptedApplicationBinding, type ApplicationBindingInput } from "../applicationActivation";
import { withApplicationBindingEvidenceInTransaction, withPreparedApplicationBindingEvidenceInTransaction,
  type ApplicationBindingEvidence } from "../applicationBindingProjection";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { readBindingSelectedEvidence,
  prepareBindingSelectedStructure, retainBindingSelectedStructure, type PreparedBindingSelectedStructure } from "../frameworkSchema/binding/repository";
import { verifyLogicalSchemaBindingInTransaction, verifyLogicalSchemaReadBindingInTransaction,
  verifyPreparedLogicalSchemaBinding,
  type SelectedLogicalStorageReadiness } from "../frameworkSchema/binding/logicalSchema";
import type { DataBindingActivationFrame, DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import type { StoredBindingValue } from "../frameworkSchema/binding/repository";
import { publishedPhysicalDefinitionMatchesLocated, loadPublishedPhysicalRequirementSnapshotV1,
  type PublishedPhysicalRequirementSnapshotV1 } from "../indexBuildReconciliation";
import { prepareLogicalStorageReadiness, requirePreparedLogicalStorageCatalog, type PreparedLogicalStorageCatalog } from "../logicalStorageReadiness";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runEffectTransaction } from "../effectTransaction";
import { chargeHostPreparation, captureHostPreparationCharge, captureHostPreparationLifetime } from "../preparedHostRuntime";
import { capturePrivateJsonData } from "../privateJsonData";
import { requireFiniteExecutionAuthorityObservation, type FiniteExecutionAuthorityObservation, type ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { LogicalStorageReadDemand } from "./model";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import type { LogicalParticipantAttemptRoot } from "./participantAdmission";
import { prepareFiniteMetadataProjection, mergeFiniteMetadataProjections, mergeFiniteMetadataContractProjections,
  finiteMetadataTableKey, finiteMetadataContractKey, requireCurrentFiniteMetadataProjection,
  type PreparedFiniteMetadataProjection } from "../finiteMetadataDependencies";
import { readRequiredEnabledIndexBuildsInTransactionEffect, decodeIndexBuildStateRowResult,
  isFiniteIndexBuildSnapshotCoveredInTransactionEffect } from "../indexBuildStates";
import type { CatalogIndexDefinitionId, CatalogTableId } from "flarex-protocol/catalog";
import type { LogicalMetadataKey } from "flarex-protocol/commit-protocol";

export class LogicalSourceAdmissionError extends Data.TaggedError("LogicalSourceAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "unsupportedProfile";
  readonly cause?: unknown;
}> {}

const SourceContract = Schema.Struct({
  sourceKey: Schema.NonEmptyString, writeProfile: Schema.NonEmptyString,
  definition: Schema.Json, evidence: Schema.Json,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeContract = Schema.decodeUnknownEffect(SourceContract);
const decodeDeploymentId = Schema.decodeUnknownEffect(TransactionGrantDeploymentIdV1Schema);
const decodeScopeId = Schema.decodeUnknownEffect(ReplacementScopeIdV1Schema);
const decodeSchemaVersionId = Schema.decodeUnknownEffect(CatalogSchemaVersionIdSchema);
const canonical = (value: Json) => encodeCanonicalJson(value, () => { throw new Error("Owned logical source is not JSON"); });

export interface LogicalSourceBindingState {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly source: LogicalSchemaSource;
  readonly frame: DataBindingSetFrame;
  readonly head: DataBindingHeadToken;
}
export type LogicalSourceFiniteReadBindingState = Pick<LogicalSourceBindingState,
  "tx" | "authority" | "schemaVersionId" | "head"> & Readonly<{
    hasPayloadContent: boolean; hasPayloadLifecycle: boolean;
  }>;

declare const finiteAttemptMetadataBrand: unique symbol;
export interface FiniteAttemptMetadata { readonly [finiteAttemptMetadataBrand]: true }
export type FiniteMetadataEntry = Readonly<{ kind: "capture"; metadataWatermark: MetadataSequence;
  borrowedApplicationBinding?: AcceptedApplicationBinding }> | Readonly<{ kind: "derive"; metadata: FiniteAttemptMetadata }>;
type FiniteAttemptMetadataState = Readonly<{
  root: SessionJournalAttempt; owner: LogicalParticipantAttemptRoot; application: ApplicationBindingInput;
  entryTx: FlarexMetadataTransaction; authority: TrustedScopeAuthority; entryClock: ScopeClockRecord;
  applicationMetadata: FiniteApplicationMetadata; controlDb?: AppUniqueConstraintSetBuildPortsV1["controlDb"];
  authorityPort?: AppUniqueConstraintSetBuildPortsV1["authority"]; unique?: AppUniqueConstraintSetEligibilityPortV1;
  frame?: DataBindingSetFrame; head?: DataBindingHeadToken; manifestSha256?: string; metadataWatermark: MetadataSequence;
  bindingSelection?: Readonly<{ candidateSha256: string; activationSha256: string }>;
  sourceProjection?: PreparedFiniteMetadataProjection;
  boundApplicationProjection?: PreparedFiniteMetadataProjection;
  nativeApplicationProjection?: PreparedFiniteMetadataProjection;
  nativeApplicationCatalog?: PublishedPhysicalRequirementSnapshotV1;
  applicationCatalog?: PublishedPhysicalRequirementSnapshotV1;
  applicationCatalogOpen?: Effect.Effect<void, Effect.Error<ReturnType<typeof requirePreparedLogicalStorageCatalog>>>;
}>;
const finiteAttemptMetadata = new WeakMap<FiniteAttemptMetadata, FiniteAttemptMetadataState>();
const finiteAttemptProjections = new WeakMap<FiniteAttemptMetadata, PreparedFiniteMetadataProjection>();

export const getFiniteAttemptMetadataProjection = (metadata: FiniteAttemptMetadata, root: SessionJournalAttempt) =>
  finiteAttemptMetadata.get(metadata)?.root === root ? finiteAttemptProjections.get(metadata) ?? null : null;

/** Both actual schema profiles retain their own immutable Application tables. */
function applicationTables(snapshot: PublishedPhysicalRequirementSnapshotV1): readonly Readonly<{
  tableId: CatalogTableId; logicalName: string; definition: SchemaManifestAppDocumentDefinitionV1;
}>[] | null {
  if (snapshot.manifest.kind === "appSchema") return snapshot.manifest.tableDefinitions.tables;
  const requirements = snapshot.logicalRequirements;
  if (requirements === undefined) return null;
  const tables: { tableId: CatalogTableId; logicalName: string; definition: SchemaManifestAppDocumentDefinitionV1 }[] = [];
  for (const source of requirements.evidence.candidate.sources) {
    if (source.owner !== "application") continue;
    if (source.definition.kind !== "documents") return null;
    for (const table of source.definition.tables) {
      const binding = source.bindings.find(member => member.kind === "definition" && member.localName === table.logicalName);
      const located = binding === undefined ? undefined : requirements.evidence.tableBindings.find(member =>
        logicalTableKey(member.table) === logicalTableKey(binding.table));
      if (located === undefined || located.table.namespace !== "app") return null;
      tables.push({ tableId: located.tableId, logicalName: table.logicalName, definition: table.definition });
    }
  }
  return tables;
}

function applicationCatalogMatches(original: PublishedPhysicalRequirementSnapshotV1,
  bound: PublishedPhysicalRequirementSnapshotV1): boolean {
  const originalTables = applicationTables(original);
  const boundTables = applicationTables(bound);
  if (originalTables === null || boundTables === null || originalTables.length !== boundTables.length) return false;
  const owned = new Set(originalTables.map(table => table.tableId));
  return originalTables.every(table => boundTables.some(member => member.tableId === table.tableId &&
    member.logicalName === table.logicalName && canonical(member.definition) === canonical(table.definition))) &&
    original.definitions.filter(member => owned.has(member.tableId)).every(definition =>
      bound.definitions.some(member => publishedPhysicalDefinitionMatchesLocated(definition, member)));
}

/** Charged entry work under the authenticated sequencer; no request-time repair. */
export const prepareFiniteAttemptMetadataProjection = Effect.fn("LogicalSourceAdmission.prepareFiniteAttemptProjection")(function* (
  metadata: FiniteAttemptMetadata, root: SessionJournalAttempt, tx: FlarexMetadataTransaction,
) {
  const state = finiteAttemptMetadata.get(metadata);
  if (state === undefined || state.root !== root || state.entryTx !== tx)
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const retained = finiteAttemptProjections.get(metadata);
  if (retained !== undefined) return retained;
  const validated = yield* Effect.fromResult(readCapturedFiniteApplicationMetadata(state.applicationMetadata, root));
  const basis = validated.basis;
  const applicationProjection = yield* prepareApplicationExecutionMetadataProjection(basis);
  const inputs = [applicationProjection];
  if (state.boundApplicationProjection !== undefined) {
    if (state.applicationCatalog === undefined || !applicationCatalogMatches(basis.physicalRequirements, state.applicationCatalog))
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    inputs.push(state.boundApplicationProjection);
  }
  const nativeApplicationProjection = yield* prepareFiniteApplicationSchemaMetadataProjection(state.applicationMetadata, root);
  inputs.push(nativeApplicationProjection);
  if (state.sourceProjection !== undefined) inputs.push(state.sourceProjection);
  const projection = yield* Effect.fromResult(mergeFiniteMetadataContractProjections(inputs));
  yield* requireCurrentFiniteMetadataProjection(tx, state.owner.scopeId, state.metadataWatermark, projection);
  finiteAttemptMetadata.set(metadata, Object.freeze({ ...state, nativeApplicationProjection,
    nativeApplicationCatalog: basis.physicalRequirements }));
  finiteAttemptProjections.set(metadata, projection);
  return projection;
});

/** Native calls consume their schema; bound writes additionally consume the
 * independently authenticated source owner's complete closure and policy. */
export function getFiniteApplicationDemandMetadataKeys(metadata: FiniteAttemptMetadata, root: SessionJournalAttempt,
  tableId: CatalogTableId, purpose: "read" | "write", indexDefinitionId?: CatalogIndexDefinitionId):
  Result.Result<readonly LogicalMetadataKey[], LogicalSourceAdmissionError> {
  const state = finiteAttemptMetadata.get(metadata);
  const native = state?.nativeApplicationProjection;
  if (state === undefined || state.root !== root || native === undefined || state.nativeApplicationCatalog === undefined)
    return Result.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const table = finiteMetadataTableKey(native, tableId, "table");
  if (table === null) return Result.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const keys: LogicalMetadataKey[] = [table];
  if (purpose === "write") {
    const closure = finiteMetadataTableKey(state.boundApplicationProjection ?? native, tableId, "writeClosure");
    if (closure === null) return Result.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    keys.push(closure, { ...closure, contractKey: finiteMetadataContractKey("sourcePolicy") });
  }
  if (indexDefinitionId !== undefined) {
    if (!state.nativeApplicationCatalog.definitions.some(member => member.indexDefinitionId === indexDefinitionId && member.tableId === tableId))
      return Result.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    keys.push({ ...table, contractKey: finiteMetadataContractKey("index", indexDefinitionId) });
  }
  return Result.succeed(Object.freeze(keys));
}

/** Native Application demand uses the same retained entry tuple as framework sources. */
export const requireFiniteApplicationAttemptReadDemandInTransactionEffect = Effect.fn("LogicalSourceAdmission.requireFiniteApplicationDemand")(function* (
  metadata: FiniteAttemptMetadata, root: SessionJournalAttempt, tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority, observation: FiniteExecutionAuthorityObservation, demand: LogicalStorageReadDemand,
) {
  const live = yield* Effect.fromResult(requireFiniteExecutionAuthorityObservation(tx, observation));
  const state = finiteAttemptMetadata.get(metadata);
  if (state === undefined || state.root !== root || state.owner.sessionId !== live.sessionId ||
    state.owner.attemptFence !== live.attemptFence || state.owner.snapshotCommitSeq !== live.snapshotToken.commitSeq ||
    state.owner.scopeId !== live.scopeId || authority.scopeId !== live.scopeId ||
    authority.deploymentId !== state.authority.deploymentId || authority.epoch !== live.epoch ||
    authority.storageGeneration !== live.storageGeneration || authority.storageGenerationFence !== live.storageGenerationFence)
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const captured = yield* Effect.fromResult(readFiniteApplicationMetadata(state.applicationMetadata, state.application, root, tx, observation));
  if (state.applicationCatalogOpen !== undefined) yield* state.applicationCatalogOpen;
  const requirements = captured.basis.physicalRequirements;
  if (demand.kind === "clock") return;
  const ownedTables = applicationTables(requirements);
  if (ownedTables === null || !ownedTables.some(table => table.tableId === demand.tableId) || demand.kind === "search" || demand.kind === "unique")
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "unsupportedProfile" }));
  if (demand.kind === "index") {
    const definition = requirements.definitions.find(member => member.indexDefinitionId === demand.indexDefinitionId && member.tableId === demand.tableId);
    if (definition === undefined) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    const builds = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, observation, [definition.indexDefinitionId], "key share");
    if (builds.status !== "ready" || builds.rows[0] === undefined)
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady", cause: builds }));
    const build = yield* Effect.fromResult(decodeIndexBuildStateRowResult(builds.rows[0], live.scopeId, definition.indexDefinitionId));
    if (!(yield* isFiniteIndexBuildSnapshotCoveredInTransactionEffect(tx, build, definition, observation, state.applicationMetadata, state.application, root)))
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
  }
});

/** Detached identity for reservation/seal encoding; it grants no serving authority. */
export function inspectFiniteAttemptMetadata(metadata: FiniteAttemptMetadata, root: SessionJournalAttempt) {
  const state = finiteAttemptMetadata.get(metadata);
  return state === undefined || state.root !== root ? null : Object.freeze({
    owner: Object.freeze({ ...state.owner }), metadataWatermark: state.metadataWatermark,
    application: inspectFiniteApplicationMetadata(state.applicationMetadata, root),
    ...(state.head === undefined ? {} : { head: Object.freeze({ ...state.head }),
      binding: Object.freeze({ ...state.head, ...state.bindingSelection }) }),
    ...(state.frame === undefined ? {} : { frame: structuredClone(state.frame) }),
    ...(state.manifestSha256 === undefined ? {} : { manifestSha256: state.manifestSha256 }) });
}

/** Application-only entry uses the same genuine issuer and outer reservation. */
export function captureFiniteApplicationAttemptMetadata(binding: AcceptedApplicationBinding, application: ApplicationBindingInput,
  root: SessionJournalAttempt, tx: FlarexMetadataTransaction, clock: ScopeClockRecord, authority: TrustedScopeAuthority,
  owner: LogicalParticipantAttemptRoot, metadataWatermark: MetadataSequence) {
  return captureFiniteApplicationMetadata(binding, application, tx, clock, root, owner.snapshotCommitSeq).pipe(Result.map(applicationMetadata => {
    // SAFETY: genuine accepted Application evidence owns this opaque tuple;
    // it grants no source or binding admission and the root owns activation.
    const metadata = Object.freeze({}) as FiniteAttemptMetadata;
    finiteAttemptMetadata.set(metadata, Object.freeze({ root, owner: Object.freeze({ ...owner }), application, applicationMetadata,
      entryTx: tx, authority, entryClock: clock, metadataWatermark }));
    return metadata;
  }));
}

type SharedCheckedBinding = Readonly<{
  selectionKey: string;
  application: ApplicationBindingInput;
  controlDb: AppUniqueConstraintSetBuildPortsV1["controlDb"];
  authorityPort: AppUniqueConstraintSetBuildPortsV1["authority"];
  unique: AppUniqueConstraintSetEligibilityPortV1;
  deploymentId: string;
  scopeId: ScopeId;
  authority: TrustedScopeAuthority;
  clock: ScopeClockRecord;
  schemaVersionId: CatalogSchemaVersionId;
  manifestSha256: string;
  frame: DataBindingSetFrame;
  activation: StoredBindingValue<DataBindingActivationFrame>;
  head: DataBindingHeadToken;
  bindingSelection: Readonly<{ candidateSha256: string; activationSha256: string }>;
  selectedPreparation?: PreparedBindingSelectedStructure;
}>;
type SharedCheckedBindingScope = {
  closed: boolean;
  readonly previous: SharedCheckedBindingScope | undefined;
  readonly observations: SharedCheckedBinding[];
};
const checkedBindings = new WeakMap<FlarexMetadataTransaction, SharedCheckedBindingScope>();
export type LogicalSourceConstruction = Readonly<{ kind: "standalone" }> |
  Readonly<{ kind: "prepared"; catalog: PreparedLogicalStorageCatalog }>;

/** Full entry and direct callers share only their accepting transaction proof. */
export function withSharedLogicalSourceBindingChecks<Value, Failure, Requirements>(
  tx: FlarexMetadataTransaction, work: () => Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<Value, Failure, Requirements> {
  return Effect.suspend(() => {
    const previous = checkedBindings.get(tx);
    const shared: SharedCheckedBindingScope = { closed: false, previous, observations: [] };
    checkedBindings.set(tx, shared);
    return Effect.suspend(work).pipe(Effect.onExit(exit => Effect.sync(() => {
      shared.closed = true;
      if (Exit.isFailure(exit)) invalidateSharedLogicalSourceBindingChecks(tx);
      shared.observations.length = 0;
      if (checkedBindings.get(tx) !== shared) return;
      let livePrevious = previous;
      while (livePrevious?.closed === true) livePrevious = livePrevious.previous;
      if (livePrevious === undefined) checkedBindings.delete(tx);
      else checkedBindings.set(tx, livePrevious);
    })));
  });
}

function invalidateSharedLogicalSourceBindingChecks(tx: FlarexMetadataTransaction): void {
  let shared = checkedBindings.get(tx);
  while (shared !== undefined) {
    shared.observations.length = 0;
    shared = shared.previous;
  }
}

/** Shared immutable catalog checks for a trusted source-specific admission.
 * This grants no serving token, business profile, transaction or settlement. */
export const prepareLogicalSourceEvidence = Effect.fn("LogicalSourceAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  sourceInput: unknown, expectedOwner: LogicalSchemaSource["owner"], expectedKind: LogicalSchemaSource["definition"]["kind"],
  construction: LogicalSourceConstruction, sourcePolicy?: JsonObject,
) {
  const capturedPorts = Object.freeze({ controlDb: ports.controlDb, authority: ports.authority });
  const captured = Object.freeze({ ...input });
  const constructionKind = construction.kind;
  const owned = yield* Effect.fromResult(capturePrivateJsonData(sourceInput, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
    (reason, cause) => new LogicalSourceAdmissionError({ reason: "invalidInput", cause: { reason, cause } })));
  yield* chargeHostPreparation(owned.value);
  const expected = yield* decodeContract(owned.value).pipe(Effect.mapError(cause =>
    new LogicalSourceAdmissionError({ reason: "invalidInput", cause })));
  const readiness = yield* (construction.kind === "standalone"
    ? prepareLogicalStorageReadiness(capturedPorts, unique, captured)
    : requirePreparedLogicalStorageCatalog(construction.catalog, capturedPorts, unique, captured));
  if (readiness.status !== "prepared") return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
  const requirements = readiness.requirements;
  if (encodeBytesToLowercaseHex(requirements.artifact.manifestSha256) !== readiness.reference.manifestSha256)
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const source = readiness.source(expected.sourceKey);
  if (source === undefined || source.owner !== expectedOwner || source.definition.kind !== expectedKind ||
      source.writeProfile !== expected.writeProfile || canonical(source.definition) !== canonical(expected.definition) ||
      canonical(source.evidence) !== canonical(expected.evidence))
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const selectedTables = readiness.sourceDefinitionTables(source.key);
  if (selectedTables === undefined) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const tableIds = new Set(selectedTables.map(table => table.tableId));
  // Built-in document relations still require their separate edge owner.
  // The common publisher maintains activated reverse indexes and enforces
  // strong references for native as well as source-bound writes.
  if (source.definition.kind === "documents" && source.definition.relations.length !== 0)
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "unsupportedProfile" }));
  const snapshot = readiness.snapshot;
  if (snapshot === null || encodeBytesToLowercaseHex(snapshot.manifestSha256) !== readiness.reference.manifestSha256)
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const deploymentId = yield* decodeDeploymentId(captured.deploymentId).pipe(Effect.mapError(cause =>
    new LogicalSourceAdmissionError({ reason: "sourceMismatch", cause })));
  const scopeId = yield* decodeScopeId(captured.scopeId).pipe(Effect.mapError(cause =>
    new LogicalSourceAdmissionError({ reason: "sourceMismatch", cause })));
  const uniquePort = createAppUniqueConstraintDefinitionPortV1(capturedPorts.controlDb);
  const applicationSources = requirements.evidence.candidate.sources.filter(member => member.owner === "application");
  const nativeTables = applicationTables(snapshot);
  if (nativeTables === null) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const catalogTableIds = new Set([...tableIds, ...nativeTables.map(table => table.tableId)]);
  const acquireDefinitions = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
  const catalogIndexes: readonly LocatedAppIndexDefinitionV1[] = Object.freeze(yield* Effect.forEach(
    snapshot.definitions.filter(definition => catalogTableIds.has(definition.access.tableId)), definition =>
      locateAppIndexDefinitionByIdEffect(tx, captured.scopeId, definition.indexDefinitionId).pipe(
        Effect.flatMap(located => located === null ? Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" })) :
          located.deploymentId !== captured.deploymentId || !publishedPhysicalDefinitionMatchesLocated(definition, located)
            ? Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" })) : Effect.succeed(located)))));
  const uniqueDefinitions = yield* uniquePort.locate({
    deploymentId, scopeId, schemaVersionId: captured.schemaVersionId,
    tableIds: [...catalogTableIds], maximumDefinitions: requirements.unique.filter(definition => catalogTableIds.has(definition.tableId)).length,
  }, tx);
  if (uniqueDefinitions === null) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
  const catalogUnique: readonly LocatedAppUniqueConstraintDefinitionV1[] = Object.freeze([...uniqueDefinitions]);
  return { catalogIndexes, catalogUnique };
  });
  const { catalogIndexes, catalogUnique } = yield* runEffectTransaction<Effect.Success<ReturnType<typeof acquireDefinitions>>,
    Effect.Error<ReturnType<typeof acquireDefinitions>>, LogicalSourceAdmissionError, FlarexMetadataTransaction>(
    callback => capturedPorts.controlDb.transaction(callback), "Logical source definitions acquisition rolled back", acquireDefinitions,
    cause => new LogicalSourceAdmissionError({ reason: "notReady", cause }));
  const indexes = Object.freeze(catalogIndexes.filter(index => tableIds.has(index.access.tableId)));
  const selectedUnique = Object.freeze(catalogUnique.filter(constraint => tableIds.has(constraint.tableId)));
  const inspectFiniteSourceDemand = yield* readiness.prepareFiniteSourceDemand(source.key, selectedUnique);
  const metadataProjection = yield* prepareFiniteMetadataProjection({ requirements, requirementsProfile: "binding", sourceKey: source.key, indexes,
    unique: selectedUnique, ...(sourcePolicy === undefined ? {} : { sourcePolicies: [{ sourceKey: source.key, semantic: sourcePolicy }] }) });
  const applicationProjections = yield* Effect.forEach(applicationSources, member => prepareFiniteMetadataProjection({
    requirements, requirementsProfile: "binding", sourceKey: member.key, indexes: catalogIndexes, unique: catalogUnique }));
  const boundApplicationProjection = applicationProjections.length === 0 ? undefined :
    yield* Effect.fromResult(mergeFiniteMetadataProjections(applicationProjections));
  yield* chargeHostPreparation(JSON.stringify({ tables: selectedTables, indexes: catalogIndexes, unique: catalogUnique },
    (_, member: unknown) => typeof member === "bigint" ? member.toString() : member));
  const chargePrepared = yield* captureHostPreparationCharge();
  const sourceLifetime = yield* captureHostPreparationLifetime();
  const targetPreparations = new WeakMap<object, PreparedBindingSelectedStructure>();
  const requirePrepared = requirePreparedLogicalStorageCatalog(readiness, capturedPorts, unique, captured).pipe(Effect.asVoid);
  const singletonSourceKeys = Object.freeze([source.key]);
  let singletonReadiness: SelectedLogicalStorageReadiness | undefined;
  const selectSingletonReadiness = Effect.fn("LogicalSourceAdmission.selectSingletonReadiness")(function* () {
    if (singletonReadiness !== undefined) return singletonReadiness;
    const selected = yield* readiness.selectSources(singletonSourceKeys);
    // Concurrent first readers may transiently compile the same immutable
    // closure. Recheck, charge and install synchronously, without waiting while
    // a storage transaction is open. Only successful retention is remembered.
    return yield* Effect.suspend(() => {
      if (singletonReadiness !== undefined) return Effect.succeed(singletonReadiness);
      return Effect.fromResult((chargePrepared?.({ sourceKeys: selected.sourceKeys,
        tableIds: selected.tableIds, reference: selected.reference }) ?? Result.succeed(undefined)).pipe(
        Result.map(() => { singletonReadiness = selected; return selected; })));
    });
  });

  const checkBinding = Effect.fn("LogicalSourceAdmission.checkBinding")(function* <Value, Failure, Requirements>(
    selection: "full" | "read",
    owner: "sourceProof" | "finiteRootPin" | "transactionCompletion",
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState, accepted: AcceptedApplicationBinding | undefined,
      bindingSelection: Readonly<{ candidateSha256: string; activationSha256: string }>) => Effect.Effect<Value, Failure, Requirements>,
    borrowed?: AcceptedApplicationBinding,
  ) {
    return yield* Effect.gen(function* () {
    yield* requirePrepared;
    // Authenticity and the actual issuer lease remain mandatory even when a
    // positive source observation is reused in this accepting transaction.
    const targetProtection = yield* Effect.fromResult(readApplicationBindingTargetProtection(application));
    if (borrowed !== undefined)
      yield* Effect.fromResult(requireAcceptedApplicationBindingObservation(borrowed, application, tx, clock));
    const protection = targetProtection.protection;
    let targetPreparation = targetPreparations.get(application);
    if (protection !== undefined && targetPreparation === undefined) {
      targetPreparation = prepareBindingSelectedStructure(authority, protection, sourceLifetime ?? targetProtection.lifetime);
      targetPreparations.set(application, targetPreparation);
    }
    const sourceKeys = singletonSourceKeys;
    if (selection === "read" && !sourceKeys.includes(source.key))
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    // An exact root set under the same authenticated candidate determines one
    // exact closure. No subset, superset or full proof can satisfy this key.
    const selectionKey = selection === "read" ? JSON.stringify(sourceKeys) : selection;
    const shared = isPreparedApplicationBinding(application) ? undefined : checkedBindings.get(tx)?.observations.find(checked =>
      checked.selectionKey === selectionKey && checked.application === application && checked.controlDb === capturedPorts.controlDb &&
      checked.authorityPort === capturedPorts.authority && checked.unique === unique &&
      checked.deploymentId === captured.deploymentId && checked.scopeId === captured.scopeId &&
      checked.authority === authority &&
      checked.clock === clock && checked.schemaVersionId === captured.schemaVersionId &&
      checked.manifestSha256 === readiness.reference.manifestSha256);
    if (shared !== undefined) {
      if (targetPreparation !== undefined) {
        if (shared.selectedPreparation === undefined)
          return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
        yield* Effect.fromResult(retainBindingSelectedStructure(tx, shared.selectedPreparation, targetPreparation, shared.head));
      }
      const acceptShared = (accepted?: AcceptedApplicationBinding) => Effect.suspend(() =>
        work(Object.freeze({ tx, authority, clock,
          schemaVersionId: captured.schemaVersionId, source, frame: shared.frame, head: shared.head }), accepted, shared.bindingSelection));
      if (owner !== "finiteRootPin") return yield* acceptShared();
      if (borrowed !== undefined) return yield* acceptShared(borrowed);
      // The preceding source's callback has released its issuer. Reuse the
      // checked frame/readiness, while finite pinning gets its own live issuer
      // from the Application owner under normal full authentication.
      return yield* withApplicationBindingEvidenceInTransaction(application, tx, clock,
        (evidence, accepted) => Effect.fromResult(verifyPreparedLogicalSchemaBinding(readiness, shared.frame, evidence,
          { kind: "activated", activation: shared.activation })).pipe(
          Effect.andThen(acceptShared(accepted))));
    }
    const selectedReadiness: SelectedLogicalStorageReadiness | undefined = selection === "read"
      ? yield* (sourceKeys.length === 1 && sourceKeys[0] === source.key
        ? selectSingletonReadiness() : readiness.selectSources(sourceKeys)) : undefined;
    const selected = yield* readBindingSelectedEvidence(tx, authority, targetPreparation);
    if (Option.isNone(selected)) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "bindingMissing" }));
    const { head: current, candidate, activation } = selected.value;
    const admit = (applicationEvidence: ApplicationBindingEvidence, accepted?: AcceptedApplicationBinding) =>
      Effect.gen(function* () {
      yield* (selectedReadiness === undefined
        ? verifyLogicalSchemaBindingInTransaction(readiness, candidate.frame, applicationEvidence,
          tx, authority, clock, { kind: "activated", activation }, applicationEvidence.checkedActive).pipe(Effect.asVoid)
        : verifyLogicalSchemaReadBindingInTransaction(selectedReadiness, candidate.frame, applicationEvidence,
          tx, authority, clock, { kind: "activated", activation }, applicationEvidence.checkedActive).pipe(Effect.asVoid));
      const head = Object.freeze({ sequence: current.frame.sequence, sha256: current.sha256 });
      const bindingSelection = Object.freeze({ candidateSha256: current.frame.candidateSha256, activationSha256: current.frame.activationSha256 });
      checkedBindings.get(tx)?.observations.push(Object.freeze({ selectionKey, application, controlDb: capturedPorts.controlDb,
        authorityPort: capturedPorts.authority, unique, deploymentId: captured.deploymentId,
        scopeId: captured.scopeId, authority, clock,
        schemaVersionId: captured.schemaVersionId, manifestSha256: readiness.reference.manifestSha256,
        frame: candidate.frame, activation, head, bindingSelection,
        ...(targetPreparation === undefined ? {} : { selectedPreparation: targetPreparation }) }));
      return yield* Effect.suspend(() => work(Object.freeze({ tx, authority, clock,
        schemaVersionId: captured.schemaVersionId, source, frame: candidate.frame, head }), accepted, bindingSelection));
    });
    if (owner === "transactionCompletion" && constructionKind === "standalone" && isPreparedApplicationBinding(application))
      return yield* withPreparedApplicationBindingEvidenceInTransaction(application, tx, clock, admit);
    return yield* withApplicationBindingEvidenceInTransaction(application, tx, clock, admit, borrowed);
    }).pipe(Effect.onExit(exit => Effect.sync(() => {
      if (Exit.isFailure(exit)) invalidateSharedLogicalSourceBindingChecks(tx);
    })));
  });
  const withBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("full", "sourceProof", application, tx, authority, clock, work);
  const pinFiniteReadBinding = Effect.fn("LogicalSourceAdmission.pinFiniteReadBinding")(function* <Failure, Requirements>(
    application: ApplicationBindingInput, root: SessionJournalAttempt, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    validatePin: (state: LogicalSourceBindingState) => Effect.Effect<void, Failure, Requirements>,
    owner: LogicalParticipantAttemptRoot, entry: FiniteMetadataEntry,
  ) {
    yield* requirePrepared;
    if (entry.kind === "derive") {
      const state = finiteAttemptMetadata.get(entry.metadata);
      if (state === undefined || state.frame === undefined || state.head === undefined || state.root !== root || state.entryTx !== tx || state.authority !== authority || state.entryClock !== clock ||
        state.application !== application || state.controlDb !== capturedPorts.controlDb ||
        state.authorityPort !== capturedPorts.authority || state.unique !== unique || state.owner.scopeId !== owner.scopeId ||
        state.owner.sessionId !== owner.sessionId || state.owner.attemptFence !== owner.attemptFence ||
        state.owner.snapshotCommitSeq !== owner.snapshotCommitSeq || state.owner.schemaVersionId !== owner.schemaVersionId ||
        state.owner.principalDigest !== owner.principalDigest || state.manifestSha256 !== readiness.reference.manifestSha256 ||
        state.frame.logicalSchema?.schemaVersionId !== captured.schemaVersionId ||
        state.frame.logicalSchema.manifestSha256 !== readiness.reference.manifestSha256 ||
        inspectFiniteApplicationMetadata(state.applicationMetadata, root)?.schemaVersionId !== owner.schemaVersionId)
        return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
      yield* Effect.fromResult(readApplicationBindingTargetProtection(application));
      yield* validatePin(Object.freeze({ tx, authority, clock, schemaVersionId: captured.schemaVersionId,
        source, frame: structuredClone(state.frame), head: Object.freeze({ ...state.head }) }));
      const combined = yield* Effect.fromResult(mergeFiniteMetadataProjections(state.sourceProjection === undefined
        ? [metadataProjection] : [state.sourceProjection, metadataProjection]));
      finiteAttemptMetadata.set(entry.metadata, Object.freeze({ ...state, sourceProjection: combined }));
      finiteAttemptProjections.delete(entry.metadata);
      return Object.freeze({ head: Object.freeze({ ...state.head }), clock, frame: structuredClone(state.frame), metadata: entry.metadata });
    }
    return yield* checkBinding("full", "finiteRootPin", application, tx, authority, clock,
      (binding, accepted, bindingSelection) => Effect.gen(function* () {
        const frame = structuredClone(binding.frame);
        // Source-local refusals precede correlation capture, as at attempt entry.
        yield* validatePin(binding);
        if (accepted === undefined) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
        const applicationMetadata = yield* Effect.fromResult(captureFiniteApplicationMetadata(accepted, application, tx, clock, root, owner.snapshotCommitSeq));
        if (inspectFiniteApplicationMetadata(applicationMetadata, root)?.schemaVersionId !== owner.schemaVersionId ||
          frame.logicalSchema?.schemaVersionId !== captured.schemaVersionId || frame.logicalSchema.manifestSha256 !== readiness.reference.manifestSha256)
          return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
        // SAFETY: only full entry acceptance issues this exact attempt tuple.
        // The root owns confirmation, reservation and its existing lifetime.
        const metadata = Object.freeze({}) as FiniteAttemptMetadata;
        finiteAttemptMetadata.set(metadata, Object.freeze({ root, owner: Object.freeze({ ...owner }), application, applicationMetadata,
          entryTx: tx, authority, entryClock: clock,
          controlDb: capturedPorts.controlDb, authorityPort: capturedPorts.authority, unique,
          frame, head: Object.freeze({ ...binding.head }), bindingSelection, manifestSha256: readiness.reference.manifestSha256,
          metadataWatermark: entry.metadataWatermark, sourceProjection: metadataProjection,
          ...(boundApplicationProjection === undefined ? {} : { boundApplicationProjection,
            applicationCatalog: snapshot, applicationCatalogOpen: requirePrepared }) }));
        return Object.freeze({ head: binding.head, clock, frame: structuredClone(frame), metadata });
      }), entry.borrowedApplicationBinding);
  });
  // Only the trusted standalone host places all native work and publication in
  // this callback. Attempt pinning and commit verification keep the full
  // source proof without acquiring the request's final guard before settlement.
  const withTransactionBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("full", "transactionCompletion", application, tx, authority, clock, work);
  const withTransactionReadBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("read", "transactionCompletion", application, tx, authority, clock, work);
  const requireFiniteMetadata = Effect.fn("LogicalSourceAdmission.requireFiniteMetadata")(function* (
    metadata: FiniteAttemptMetadata, application: ApplicationBindingInput, root: SessionJournalAttempt,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, observation: FiniteExecutionAuthorityObservation,
  ) {
    yield* requirePrepared;
    const live = yield* Effect.fromResult(requireFiniteExecutionAuthorityObservation(tx, observation));
    const state = finiteAttemptMetadata.get(metadata);
    if (state === undefined || state.frame === undefined || state.head === undefined || state.root !== root || state.application !== application ||
      state.controlDb !== capturedPorts.controlDb || state.authorityPort !== capturedPorts.authority || state.unique !== unique ||
      state.owner.sessionId !== live.sessionId || state.owner.attemptFence !== live.attemptFence ||
      state.owner.snapshotCommitSeq !== live.snapshotToken.commitSeq || state.owner.scopeId !== live.scopeId ||
      state.frame.logicalSchema?.schemaVersionId !== captured.schemaVersionId ||
      state.frame.logicalSchema.manifestSha256 !== readiness.reference.manifestSha256 || state.manifestSha256 !== readiness.reference.manifestSha256 ||
      authority.deploymentId !== captured.deploymentId || authority.scopeId !== live.scopeId || authority.epoch !== live.epoch ||
      authority.storageGeneration !== live.storageGeneration || authority.storageGenerationFence !== live.storageGenerationFence)
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    const native = yield* Effect.fromResult(readFiniteApplicationMetadata(state.applicationMetadata, application, root, tx, observation));
    if (native.basis.schemaVersionId !== state.owner.schemaVersionId)
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    return Object.freeze({ ...state, frame: state.frame, head: state.head });
  });
  const verifyFiniteReadBinding = Effect.fn("LogicalSourceAdmission.verifyFiniteReadBinding")(function* (
    metadata: FiniteAttemptMetadata, application: ApplicationBindingInput, root: SessionJournalAttempt,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, observation: FiniteExecutionAuthorityObservation,
  ) {
    const state = yield* requireFiniteMetadata(metadata, application, root, tx, authority, observation);
    return Object.freeze({ tx, authority, schemaVersionId: captured.schemaVersionId, head: Object.freeze({ ...state.head }),
      hasPayloadContent: state.frame.payloadContent !== null, hasPayloadLifecycle: state.frame.payloadLifecycle !== null });
  });
  const withFiniteReadBinding = Effect.fn("LogicalSourceAdmission.withFiniteReadBinding")(function* <Value, Failure, Requirements>(metadata: FiniteAttemptMetadata,
    application: ApplicationBindingInput, root: SessionJournalAttempt, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, observation: FiniteExecutionAuthorityObservation,
    work: (state: LogicalSourceFiniteReadBindingState) => Effect.Effect<Value, Failure, Requirements>, demand: LogicalStorageReadDemand) {
    const state = yield* requireFiniteMetadata(metadata, application, root, tx, authority, observation);
    const verdict = yield* inspectFiniteSourceDemand(tx, authority, observation, state.applicationMetadata, application, root, demand);
    if (verdict.status !== "ready") return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady", cause: verdict }));
    return yield* Effect.suspend(() => work(Object.freeze({ tx, authority,
      schemaVersionId: captured.schemaVersionId, head: Object.freeze({ ...state.head }),
      hasPayloadContent: state.frame.payloadContent !== null, hasPayloadLifecycle: state.frame.payloadLifecycle !== null })));
  });
  const readFiniteCommitClosure = Effect.fn("LogicalSourceAdmission.readFiniteCommitClosure")(function* (
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord, touchedTableIds: readonly CatalogTableId[],
  ) {
    yield* requirePrepared;
    if (authority.deploymentId !== captured.deploymentId || authority.scopeId !== captured.scopeId || clock.scopeId !== captured.scopeId ||
      authority.epoch !== clock.epoch || authority.storageGeneration !== clock.storageGeneration || authority.storageGenerationFence !== clock.storageGenerationFence ||
      touchedTableIds.some(tableId => !tableIds.has(tableId)))
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    // Read dependencies use the authenticated retained definitions. Current
    // maintenance is required only for tables with an evidenced write effect;
    // the outer publication still checks consumed metadata and live authority.
    if (touchedTableIds.length === 0)
      return Object.freeze({ indexes: Object.freeze([]), unique: Object.freeze([]) });
    // Binding activation owns framework source membership and its complete
    // closure. The independently selected native Application schema can differ.
    const current = yield* readBindingSelectedEvidence(tx, authority);
    if (Option.isNone(current) || current.value.candidate.frame.logicalSchema === null)
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
    const reference = current.value.candidate.frame.logicalSchema;
    const schemaVersionId = yield* decodeSchemaVersionId(reference.schemaVersionId).pipe(
      Effect.mapError(cause => new LogicalSourceAdmissionError({ reason: "sourceMismatch", cause })));
    const acquireCurrentClosure = (reader: FlarexMetadataTransaction) => Effect.gen(function* () {
    const currentRequirements = yield* loadPublishedPhysicalRequirementSnapshotV1(capturedPorts.controlDb,
      { deploymentId: captured.deploymentId, schemaVersionId }, reader);
    const logical = currentRequirements?.logicalRequirements;
    const currentSource = logical?.evidence.candidate.sources.find(member => member.key === source.key && member.owner === source.owner);
    if (currentRequirements === null || logical === undefined || currentSource === undefined ||
      encodeBytesToLowercaseHex(currentRequirements.manifestSha256) !== reference.manifestSha256 ||
      currentSource.writeProfile !== source.writeProfile || currentSource.definition.kind !== source.definition.kind ||
      touchedTableIds.some(tableId => !logical.evidence.tableBindings.some(binding => binding.tableId === tableId &&
        currentSource.bindings.some(member => logicalTableKey(member.table) === logicalTableKey(binding.table)))))
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    const currentIndexes = yield* Effect.forEach(currentRequirements.definitions.filter(member => touchedTableIds.includes(member.tableId)), member =>
      locateAppIndexDefinitionByIdEffect(reader, captured.scopeId, member.indexDefinitionId).pipe(Effect.flatMap(located =>
        located === null ? Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" })) :
          located.deploymentId !== captured.deploymentId || !publishedPhysicalDefinitionMatchesLocated(member, located)
            ? Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" })) : Effect.succeed(located))));
    const currentUnique = yield* uniquePort.locate({ deploymentId, scopeId,
      schemaVersionId: currentRequirements.schemaVersionId, tableIds: touchedTableIds,
      maximumDefinitions: logical.unique.filter(member => touchedTableIds.includes(member.tableId)).length }, reader);
    if (currentUnique === null) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
    return Object.freeze({ indexes: Object.freeze(currentIndexes), unique: currentUnique });
    });
    return yield* runEffectTransaction<Effect.Success<ReturnType<typeof acquireCurrentClosure>>,
      Effect.Error<ReturnType<typeof acquireCurrentClosure>>, LogicalSourceAdmissionError, FlarexMetadataTransaction>(
      callback => capturedPorts.controlDb.transaction(callback), "Current logical source closure acquisition rolled back", acquireCurrentClosure,
      cause => new LogicalSourceAdmissionError({ reason: "notReady", cause }));
  });
  return Object.freeze({ source, tables: selectedTables, indexes, unique: selectedUnique, withBinding, withTransactionBinding, withTransactionReadBinding,
    requirements, catalog: readiness, requirePrepared, metadataProjection,
    pinFiniteReadBinding, verifyFiniteReadBinding, withFiniteReadBinding, readFiniteCommitClosure });
});
