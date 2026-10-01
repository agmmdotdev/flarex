import { Data, Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
  type LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema, type ScopeId } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { readApplicationBindingTargetProtection, type ApplicationBindingInput } from "../applicationActivation";
import { withApplicationBindingEvidenceInTransaction } from "../applicationBindingProjection";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { readBindingSelectedEvidence, prepareBindingSelectedStructure, type PreparedBindingSelectedStructure } from "../frameworkSchema/binding/repository";
import { verifyLogicalSchemaBindingInTransaction, verifyLogicalSchemaReadBindingInTransaction,
  type SelectedLogicalStorageReadiness } from "../frameworkSchema/binding/logicalSchema";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import { publishedPhysicalDefinitionMatchesLocated } from "../indexBuildReconciliation";
import { prepareLogicalStorageReadiness, requirePreparedLogicalStorageCatalog, type PreparedLogicalStorageCatalog } from "../logicalStorageReadiness";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { chargeHostPreparation, captureHostPreparationCharge } from "../preparedHostRuntime";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";

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
  head: DataBindingHeadToken;
}>;
const checkedBindings = new WeakMap<FlarexMetadataTransaction, SharedCheckedBinding[]>();
const readSourceKeys = new WeakMap<FlarexMetadataTransaction, readonly string[]>();
export type LogicalSourceConstruction = Readonly<{ kind: "standalone" }> |
  Readonly<{ kind: "prepared"; catalog: PreparedLogicalStorageCatalog }>;

/** Scope common candidate/readiness IO to one checked historical-read transaction.
 * Each source still compares its own pinned head and source contract. The next
 * read opens a new transaction and must authenticate the binding again. */
export function withSharedLogicalSourceBindingChecks<Value, Failure, Requirements>(
  tx: FlarexMetadataTransaction, work: () => Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<Value, Failure, Requirements> {
  return Effect.suspend(() => {
    const previous = checkedBindings.get(tx);
    checkedBindings.set(tx, []);
    return Effect.suspend(work).pipe(Effect.ensuring(Effect.sync(() => {
      if (previous === undefined) checkedBindings.delete(tx);
      else checkedBindings.set(tx, previous);
    })));
  });
}

/** Only the participant bundle owner supplies its complete issued source set.
 * The common proof covers that union; each source must still check its own pin. */
export function withSharedLogicalSourceReadBindingChecks<Value, Failure, Requirements>(
  tx: FlarexMetadataTransaction, sourceKeys: readonly string[],
  work: () => Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<Value, Failure, Requirements> {
  return Effect.suspend(() => {
    const previous = readSourceKeys.get(tx);
    readSourceKeys.set(tx, Object.freeze(sourceKeys.toSorted()));
    return withSharedLogicalSourceBindingChecks(tx, work).pipe(Effect.ensuring(Effect.sync(() => {
      if (previous === undefined) readSourceKeys.delete(tx);
      else readSourceKeys.set(tx, previous);
    })));
  });
}

/** Shared immutable catalog checks for a trusted source-specific admission.
 * This grants no serving token, business profile, transaction or settlement. */
export const prepareLogicalSourceEvidence = Effect.fn("LogicalSourceAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  sourceInput: unknown, expectedOwner: LogicalSchemaSource["owner"], expectedKind: LogicalSchemaSource["definition"]["kind"],
  construction: LogicalSourceConstruction,
) {
  const capturedPorts = Object.freeze({ controlDb: ports.controlDb, authority: ports.authority });
  const captured = Object.freeze({ ...input });
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
  const indexes: readonly LocatedAppIndexDefinitionV1[] = Object.freeze(yield* Effect.forEach(
    snapshot.definitions.filter(definition => tableIds.has(definition.access.tableId)), definition =>
      locateAppIndexDefinitionByIdEffect(capturedPorts.controlDb, captured.scopeId, definition.indexDefinitionId).pipe(
        Effect.flatMap(located => located === null ? Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" })) :
          located.deploymentId !== captured.deploymentId || !publishedPhysicalDefinitionMatchesLocated(definition, located)
            ? Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" })) : Effect.succeed(located)))));
  const deploymentId = yield* decodeDeploymentId(captured.deploymentId).pipe(Effect.mapError(cause =>
    new LogicalSourceAdmissionError({ reason: "sourceMismatch", cause })));
  const scopeId = yield* decodeScopeId(captured.scopeId).pipe(Effect.mapError(cause =>
    new LogicalSourceAdmissionError({ reason: "sourceMismatch", cause })));
  const uniqueDefinitions = yield* createAppUniqueConstraintDefinitionPortV1(capturedPorts.controlDb).locate({
    deploymentId, scopeId, schemaVersionId: captured.schemaVersionId,
    tableIds: [...tableIds], maximumDefinitions: requirements.unique.filter(definition => tableIds.has(definition.tableId)).length,
  });
  if (uniqueDefinitions === null) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
  const selectedUnique: readonly LocatedAppUniqueConstraintDefinitionV1[] = Object.freeze([...uniqueDefinitions]);
  yield* chargeHostPreparation(JSON.stringify({ tables: selectedTables, indexes, unique: selectedUnique },
    (_, member: unknown) => typeof member === "bigint" ? member.toString() : member));
  const chargePrepared = yield* captureHostPreparationCharge();
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
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    yield* requirePrepared;
    const sourceKeys = readSourceKeys.get(tx) ?? [source.key];
    if (selection === "read" && !sourceKeys.includes(source.key))
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    // An exact root set under the same authenticated candidate determines one
    // exact closure. No subset, superset or full proof can satisfy this key.
    const selectionKey = selection === "full" ? "full" : JSON.stringify(sourceKeys);
    const shared = checkedBindings.get(tx)?.find(checked =>
      checked.selectionKey === selectionKey && checked.application === application && checked.controlDb === capturedPorts.controlDb &&
      checked.authorityPort === capturedPorts.authority && checked.unique === unique &&
      checked.deploymentId === captured.deploymentId && checked.scopeId === captured.scopeId &&
      checked.authority === authority &&
      checked.clock === clock && checked.schemaVersionId === captured.schemaVersionId &&
      checked.manifestSha256 === readiness.reference.manifestSha256);
    if (shared !== undefined) return yield* work(Object.freeze({ tx, authority, clock,
      schemaVersionId: captured.schemaVersionId, source, frame: shared.frame, head: shared.head }));
    const selectedReadiness: SelectedLogicalStorageReadiness | undefined = selection === "full"
      ? undefined : yield* (sourceKeys.length === 1 && sourceKeys[0] === source.key
        ? selectSingletonReadiness() : readiness.selectSources(sourceKeys));
    const protection = readApplicationBindingTargetProtection(application);
    let targetPreparation = targetPreparations.get(application);
    if (protection !== undefined && targetPreparation === undefined) {
      targetPreparation = prepareBindingSelectedStructure(authority, protection, chargePrepared);
      targetPreparations.set(application, targetPreparation);
    }
    const selected = yield* readBindingSelectedEvidence(tx, authority, targetPreparation);
    if (Option.isNone(selected)) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "bindingMissing" }));
    const { head: current, candidate } = selected.value;
    yield* withApplicationBindingEvidenceInTransaction(application, tx, clock, applicationEvidence =>
      selectedReadiness === undefined
        ? verifyLogicalSchemaBindingInTransaction(readiness, candidate.frame, applicationEvidence,
          tx, authority, clock, applicationEvidence.checkedActive).pipe(Effect.asVoid)
        : verifyLogicalSchemaReadBindingInTransaction(selectedReadiness, candidate.frame, applicationEvidence,
          tx, authority, clock, applicationEvidence.checkedActive).pipe(Effect.asVoid));
    const head = Object.freeze({ sequence: current.frame.sequence, sha256: current.sha256 });
    checkedBindings.get(tx)?.push(Object.freeze({ selectionKey, application, controlDb: capturedPorts.controlDb,
      authorityPort: capturedPorts.authority, unique, deploymentId: captured.deploymentId,
      scopeId: captured.scopeId, authority, clock,
      schemaVersionId: captured.schemaVersionId, manifestSha256: readiness.reference.manifestSha256,
      frame: candidate.frame, head }));
    return yield* work(Object.freeze({ tx, authority, clock, schemaVersionId: captured.schemaVersionId, source,
      frame: candidate.frame, head }));
  });
  const withBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("full", application, tx, authority, clock, work);
  const withReadBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("read", application, tx, authority, clock, work);
  return Object.freeze({ source, tables: selectedTables, indexes, unique: selectedUnique, withBinding, withReadBinding,
    requirements, catalog: readiness, requirePrepared });
});
