import { Data, Effect, Option, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, logicalTableKey,
  type LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema, type ScopeId } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { ApplicationBindingInput } from "../applicationActivation";
import { readApplicationBindingEvidenceInTransaction } from "../applicationBindingProjection";
import type { AppUniqueConstraintSetBuildPortsV1, AppUniqueConstraintSetEligibilityPortV1 } from "../appUniqueConstraintSetBuildV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { verifyLogicalSchemaBindingInTransaction } from "../frameworkSchema/binding/logicalSchema";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import { loadPublishedPhysicalRequirementSnapshotV1, publishedPhysicalDefinitionMatchesLocated } from "../indexBuildReconciliation";
import { readLogicalStorageRequirements } from "../logicalStorageDefinitions";
import { prepareLogicalStorageReadiness } from "../logicalStorageReadiness";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { chargeHostPreparation } from "../preparedHostRuntime";
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

/** Shared immutable catalog checks for a trusted source-specific admission.
 * This grants no serving token, business profile, transaction or settlement. */
export const prepareLogicalSourceEvidence = Effect.fn("LogicalSourceAdmission.prepare")(function* (
  ports: AppUniqueConstraintSetBuildPortsV1, unique: AppUniqueConstraintSetEligibilityPortV1,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  sourceInput: unknown, expectedOwner: LogicalSchemaSource["owner"], expectedKind: LogicalSchemaSource["definition"]["kind"],
) {
  const capturedPorts = Object.freeze({ controlDb: ports.controlDb, authority: ports.authority });
  const captured = Object.freeze({ ...input });
  const owned = yield* Effect.fromResult(capturePrivateJsonData(sourceInput, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES,
    (reason, cause) => new LogicalSourceAdmissionError({ reason: "invalidInput", cause: { reason, cause } })));
  yield* chargeHostPreparation(owned.value);
  const expected = yield* decodeContract(owned.value).pipe(Effect.mapError(cause =>
    new LogicalSourceAdmissionError({ reason: "invalidInput", cause })));
  const readiness = yield* prepareLogicalStorageReadiness(capturedPorts, unique, captured);
  if (readiness.status !== "prepared") return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "notReady" }));
  const requirements = yield* readLogicalStorageRequirements(capturedPorts.controlDb, captured.deploymentId, captured.schemaVersionId);
  const { evidence } = requirements;
  yield* chargeHostPreparation(JSON.stringify(evidence));
  if (encodeBytesToLowercaseHex(requirements.artifact.manifestSha256) !== readiness.reference.manifestSha256)
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const source = evidence.candidate.sources.find(member => member.key === expected.sourceKey);
  if (source === undefined || source.owner !== expectedOwner || source.definition.kind !== expectedKind ||
      source.writeProfile !== expected.writeProfile || canonical(source.definition) !== canonical(expected.definition) ||
      canonical(source.evidence) !== canonical(expected.evidence))
    return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
  const tableNames = source.definition.kind === "documents"
    ? source.definition.tables.map(table => table.logicalName)
    : source.definition.schema.tables.map(table => table.identity.tableId);
  const tables: Readonly<{ localName: string; tableId: CatalogTableId }>[] = [];
  for (const localName of tableNames) {
    const binding = source.bindings.find(member => member.kind === "definition" && member.localName === localName);
    const stable = binding === undefined ? undefined : evidence.tableBindings.find(member =>
      logicalTableKey(member.table) === logicalTableKey(binding.table));
    if (stable === undefined) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "sourceMismatch" }));
    tables.push(Object.freeze({ localName, tableId: stable.tableId }));
  }
  const selectedTables = Object.freeze(tables);
  const tableIds = new Set(selectedTables.map(table => table.tableId));
  const ownedTableKeys = new Set(source.bindings.filter(binding => binding.kind === "definition")
    .map(binding => logicalTableKey(binding.table)));
  const hasRelationships = (source.definition.kind === "documents" && source.definition.relations.length !== 0) ||
    evidence.candidate.extensions.some(extension => ownedTableKeys.has(logicalTableKey(extension.source.table)) ||
      ownedTableKeys.has(logicalTableKey(extension.target.table)));
  // No current scalar or relational participant enforces cross-source edges.
  // Refuse at the shared token owner so every affected framework stays closed.
  if (hasRelationships) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "unsupportedProfile" }));
  const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(capturedPorts.controlDb, captured);
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

  const withBinding = Effect.fn("LogicalSourceAdmission.withBinding")(function* <Value, Failure, Requirements>(
    application: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (state: LogicalSourceBindingState) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    const current = yield* readBindingHead(tx, authority, "share");
    if (Option.isNone(current)) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "bindingMissing" }));
    const candidate = yield* readBindingCandidate(tx, authority, current.value.frame.candidateSha256);
    if (Option.isNone(candidate)) return yield* Effect.fail(new LogicalSourceAdmissionError({ reason: "bindingMissing" }));
    const applicationEvidence = yield* readApplicationBindingEvidenceInTransaction(application, tx, clock);
    yield* verifyLogicalSchemaBindingInTransaction(readiness, candidate.value.frame, applicationEvidence, tx, authority, clock);
    return yield* work(Object.freeze({ tx, authority, clock, schemaVersionId: captured.schemaVersionId, source,
      frame: candidate.value.frame,
      head: Object.freeze({ sequence: current.value.frame.sequence, sha256: current.value.sha256 }) }));
  });
  return Object.freeze({ source, tables: selectedTables, indexes, unique: selectedUnique, withBinding });
});
