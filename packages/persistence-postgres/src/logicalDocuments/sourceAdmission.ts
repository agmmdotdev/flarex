import { Data, Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
  type LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema, type ScopeId } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { readApplicationBindingTargetProtection, isPreparedApplicationBinding, requireAcceptedApplicationBindingObservation,
  captureFiniteApplicationBindingCorrelation, type FiniteApplicationBindingCorrelation,
  type AcceptedApplicationBinding, type ApplicationBindingInput } from "../applicationActivation";
import { withApplicationBindingEvidenceInTransaction, withPreparedApplicationBindingEvidenceInTransaction, withFiniteApplicationBindingEvidenceInTransaction,
  type ApplicationBindingEvidence } from "../applicationBindingProjection";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { readBindingSelectedEvidence, readBindingSelectedProjection, readUnprotectedBindingSelectedProjection,
  prepareBindingSelectedStructure, retainBindingSelectedStructure, type PreparedBindingSelectedStructure } from "../frameworkSchema/binding/repository";
import { verifyLogicalSchemaBindingInTransaction, verifyLogicalSchemaReadBindingInTransaction,
  verifyPreparedLogicalSchemaBinding,
  type SelectedLogicalStorageReadiness } from "../frameworkSchema/binding/logicalSchema";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import { publishedPhysicalDefinitionMatchesLocated } from "../indexBuildReconciliation";
import { prepareLogicalStorageReadiness, requirePreparedLogicalStorageCatalog, type PreparedLogicalStorageCatalog } from "../logicalStorageReadiness";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runEffectTransaction } from "../effectTransaction";
import { chargeHostPreparation, captureHostPreparationCharge, captureHostPreparationLifetime } from "../preparedHostRuntime";
import { capturePrivateJsonData } from "../privateJsonData";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { LogicalStorageReadDemand } from "./model";
import type { SessionJournalAttempt } from "../sessionJournalStore";

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
  readonly acceptedApplicationBinding?: AcceptedApplicationBinding;
}
export type LogicalSourceFiniteReadBindingState = Pick<LogicalSourceBindingState,
  "tx" | "authority" | "clock" | "schemaVersionId" | "head"> & Readonly<{
    hasPayloadContent: boolean; hasPayloadLifecycle: boolean;
  }>;

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
  selectedPreparation?: PreparedBindingSelectedStructure;
}>;
const checkedBindings = new WeakMap<FlarexMetadataTransaction, SharedCheckedBinding[]>();
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
  const acquireDefinitions = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
  const indexes: readonly LocatedAppIndexDefinitionV1[] = Object.freeze(yield* Effect.forEach(
    snapshot.definitions.filter(definition => tableIds.has(definition.access.tableId)), definition =>
      locateAppIndexDefinitionByIdEffect(tx, captured.scopeId, definition.indexDefinitionId).pipe(
        Effect.flatMap(located => located === null ? Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" })) :
          located.deploymentId !== captured.deploymentId || !publishedPhysicalDefinitionMatchesLocated(definition, located)
            ? Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" })) : Effect.succeed(located)))));
  const uniqueDefinitions = yield* uniquePort.locate({
    deploymentId, scopeId, schemaVersionId: captured.schemaVersionId,
    tableIds: [...tableIds], maximumDefinitions: requirements.unique.filter(definition => tableIds.has(definition.tableId)).length,
  }, tx);
  if (uniqueDefinitions === null) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
  const selectedUnique: readonly LocatedAppUniqueConstraintDefinitionV1[] = Object.freeze([...uniqueDefinitions]);
  return { indexes, selectedUnique };
  });
  const { indexes, selectedUnique } = yield* runEffectTransaction<Effect.Success<ReturnType<typeof acquireDefinitions>>,
    Effect.Error<ReturnType<typeof acquireDefinitions>>, LogicalSourceAdmissionError, FlarexMetadataTransaction>(
    callback => capturedPorts.controlDb.transaction(callback), "Logical source definitions acquisition rolled back", acquireDefinitions,
    cause => new LogicalSourceAdmissionError({ reason: "notReady", cause }));
  const inspectSourceDemand = yield* readiness.prepareSourceDemand(source.key, selectedUnique);
  yield* chargeHostPreparation(JSON.stringify({ tables: selectedTables, indexes, unique: selectedUnique },
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
    owner: "sourceProof" | "transactionCompletion",
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>,
    borrowed?: AcceptedApplicationBinding,
  ) {
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
    const shared = isPreparedApplicationBinding(application) ? undefined : checkedBindings.get(tx)?.find(checked =>
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
      return yield* work(Object.freeze({ tx, authority, clock,
        schemaVersionId: captured.schemaVersionId, source, frame: shared.frame, head: shared.head,
        ...(borrowed === undefined ? {} : { acceptedApplicationBinding: borrowed }) }));
    }
    const selectedReadiness: SelectedLogicalStorageReadiness | undefined = selection === "read"
      ? yield* (sourceKeys.length === 1 && sourceKeys[0] === source.key
        ? selectSingletonReadiness() : readiness.selectSources(sourceKeys)) : undefined;
    const selected = yield* readBindingSelectedEvidence(tx, authority, targetPreparation);
    if (Option.isNone(selected)) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "bindingMissing" }));
    const { head: current, candidate } = selected.value;
    const admit = (applicationEvidence: ApplicationBindingEvidence, acceptedApplicationBinding?: AcceptedApplicationBinding) =>
      Effect.gen(function* () {
      yield* (selectedReadiness === undefined
        ? verifyLogicalSchemaBindingInTransaction(readiness, candidate.frame, applicationEvidence,
          tx, authority, clock, applicationEvidence.checkedActive).pipe(Effect.asVoid)
        : verifyLogicalSchemaReadBindingInTransaction(selectedReadiness, candidate.frame, applicationEvidence,
          tx, authority, clock, applicationEvidence.checkedActive).pipe(Effect.asVoid));
      const head = Object.freeze({ sequence: current.frame.sequence, sha256: current.sha256 });
      checkedBindings.get(tx)?.push(Object.freeze({ selectionKey, application, controlDb: capturedPorts.controlDb,
        authorityPort: capturedPorts.authority, unique, deploymentId: captured.deploymentId,
        scopeId: captured.scopeId, authority, clock,
        schemaVersionId: captured.schemaVersionId, manifestSha256: readiness.reference.manifestSha256,
        frame: candidate.frame, head,
        ...(targetPreparation === undefined ? {} : { selectedPreparation: targetPreparation }) }));
      return yield* Effect.suspend(() => work(Object.freeze({ tx, authority, clock,
        schemaVersionId: captured.schemaVersionId, source, frame: candidate.frame, head,
        ...(acceptedApplicationBinding === undefined ? {} : { acceptedApplicationBinding }) })));
    });
    if (owner === "transactionCompletion" && constructionKind === "standalone" && isPreparedApplicationBinding(application))
      return yield* withPreparedApplicationBindingEvidenceInTransaction(application, tx, clock, admit);
    return yield* withApplicationBindingEvidenceInTransaction(application, tx, clock, admit, borrowed);
  });
  const withBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>, borrowed?: AcceptedApplicationBinding) =>
    checkBinding("full", "sourceProof", application, tx, authority, clock, work, borrowed);
  // Only the trusted standalone host places all native work and publication in
  // this callback. Attempt pinning and commit verification use sourceProof and
  // cannot acquire the request's final guard before their outer owner settles.
  const withTransactionBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("full", "transactionCompletion", application, tx, authority, clock, work);
  const withTransactionReadBinding = <Value, Failure, Requirements>(application: ApplicationBindingInput, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>) =>
    checkBinding("read", "transactionCompletion", application, tx, authority, clock, work);
  const inspectDemand = Effect.fn("LogicalSourceAdmission.requireDemand")(function* (
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord, demand: LogicalStorageReadDemand,
    checkedActive?: ApplicationBindingEvidence["checkedActive"],
  ) {
    yield* requirePrepared;
    const verdict = yield* inspectSourceDemand(tx, authority, clock, demand, checkedActive);
    if (verdict.status !== "ready") return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady", cause: verdict }));
  });
  const withFiniteReadBinding = Effect.fn("LogicalSourceAdmission.withFiniteReadBinding")(function* <Value, Failure, Requirements>(correlation: FiniteApplicationBindingCorrelation,
    application: ApplicationBindingInput, root: SessionJournalAttempt, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceFiniteReadBindingState) => Effect.Effect<Value, Failure, Requirements>, demand: LogicalStorageReadDemand) {
    yield* requirePrepared;
    const target = yield* Effect.fromResult(readApplicationBindingTargetProtection(application));
    const preparation = targetPreparations.get(application);
    if (target.protection !== undefined && preparation === undefined)
      return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    // No-role controls have no protected immutable metadata proof and must
    // authenticate full stored evidence. Managed finite reads never fall back.
    const selected = yield* (target.protection === undefined
      ? readUnprotectedBindingSelectedProjection(tx, authority)
      : preparation === undefined ? Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }))
        : readBindingSelectedProjection(tx, authority, preparation));
    if (Option.isNone(selected)) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "bindingMissing" }));
    const observed = selected.value;
    return yield* withFiniteApplicationBindingEvidenceInTransaction(correlation, application, root, tx, clock,
      evidence => Effect.gen(function* () {
        yield* Effect.fromResult(verifyPreparedLogicalSchemaBinding(readiness, observed.reference, evidence));
        yield* inspectDemand(tx, authority, clock, demand, evidence.checkedActive);
        return yield* Effect.suspend(() => work(Object.freeze({ tx, authority, clock,
          schemaVersionId: captured.schemaVersionId, head: observed.head,
          hasPayloadContent: observed.hasPayloadContent, hasPayloadLifecycle: observed.hasPayloadLifecycle })));
      }));
  });
  return Object.freeze({ source, tables: selectedTables, indexes, unique: selectedUnique, withBinding, withTransactionBinding, withTransactionReadBinding,
    requirements, catalog: readiness, requirePrepared, inspectDemand,
    captureFiniteReadBinding: captureFiniteApplicationBindingCorrelation, withFiniteReadBinding });
});
