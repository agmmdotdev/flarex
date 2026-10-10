import type {
  FiniteCommitSource,
  PreparedFiniteCommitCommand,
  PreparedPointCommitTransactionCommandV1,
} from "./preparedCommands";
import type {
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  Exit,
  Effect,
  Result,
  Data,
  Cause,
} from "effect";
import {
  type PointCommitCorruptionV1Error,
  corruption,
  PointCommitStaleAuthorityV1Error,
  PointCommitConflictV1Error,
} from "./errors";
import type {
  LocatedAppIndexDefinitionV1,
} from "../../storage/indexes/appIndexDefinitions";
import type {
  LocatedAppUniqueConstraintDefinitionV1,
} from "../../storage/unique/appUniqueConstraintDefinitions";
import {
  type LogicalParticipantCommitAuthority,
  inspectLogicalParticipantCommitMetadataProjection,
  withLogicalParticipantCommitApplicationBindingInTransaction,
  requireLogicalParticipantCommitAuthorityEffect,
  requireFiniteLogicalParticipantCommitAuthorityEffect,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import {
  compareRowIds,
  decodePointCommitEncodedTableIdResult,
  type SelectedLogicalOperationProfile,
  selectLogicalOperationProfileResult,
  decodePointCommitMetadataDependenciesEffect,
  decodePointCommitEventEnvelope,
} from "./capture";
import {
  observeExecution,
} from "../../execution/diagnostics/operation";
import {
  type AdmittedParticipantOperation,
  canonicalizeAdmittedSourceBundleResult,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  type ParticipantPointCorrelation,
  verifyParticipantPointCorrelationEffect,
  type SourceContribution,
  logicalMetadataDependencyIdentity,
  canonicalizeAdmittedParticipantBindingV1Result,
} from "flarex-protocol/commit-protocol";
import {
  encodeBytesToLowercaseHex,
  bytesEqualFullScan as bytesEqual,
} from "@flarex/utils/bytes";
import {
  type AppRowTransaction,
  consumeAppRowSnapshotRevisionsInTransactionEffect,
  AppRowReadPersistenceError,
} from "../../storage/documents/appRows";
import {
  fxSystemTransactionJournalPoints,
} from "../../database/schema";
import {
  and,
  eq,
} from "drizzle-orm";
import {
  runDrizzleStatementEffect,
} from "../../database/drizzleStatementEffect";
import {
  pointCommitSqlCallFailure,
  PointCommitSqlFailureMarkerV1,
} from "./sqlFailures";
import {
  appRowIdHexV1FromBytesResult,
  appDocumentIdV1FromRowIdentity,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import {
  decodePointCommitRetainedFloorResult,
} from "./attemptAcceptance";
import {
  canonicalizeFlarexValueV1Effect,
} from "flarex-protocol/value";
import type {
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type {
  ScopeClockRecord,
} from "../../scope/scopeClock";
import type {
  PointCommitTransactionProofOptionsV1,
} from "./constructionContracts";
import type {
  FiniteMetadataReservation,
} from "../../execution/finiteMetadataReservation";
import type {
  LogicalSearchDefinition,
} from "../../storage/documents/logicalDocuments/searchEntries";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
} from "./promiseBoundary";
import {
  withSharedLogicalSourceBindingChecks,
} from "../../storage/documents/logicalDocuments/sourceAdmission";
import type {
  AcceptedApplicationBinding,
} from "../../application/activation/contracts";
import {
  decodeLogicalParticipantDependencyEvidence,
} from "../../storage/documents/logicalDocuments/journalEvidence";
import {
  finiteMetadataTableKey,
  finiteMetadataContractKey,
  captureFiniteMetadataDependency,
} from "../../execution/finiteMetadataDependencies";
import {
  LogicalParticipantAdmissionError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import {
  validateLogicalParticipantDependencyEvidence,
} from "../../storage/documents/logicalDocuments/commitEvidence";
import type {
  CommittedEvent,
} from "../events/model";
import {
  admittedCommerceEventGroup,
  validateAdmittedCommerceEventIntents,
  validateAdmittedOperationEventIntents,
} from "../../frameworks/atomicCommerce/events";

export interface PreparedFiniteSourceAcceptance {
  readonly source: FiniteCommitSource;
  readonly touchedTables: readonly CatalogTableId[];
  readonly documentResults: readonly Exit.Exit<void, PointCommitCorruptionV1Error>[];
  readonly definitionResults: readonly Exit.Exit<void, PointCommitCorruptionV1Error>[];
}

/** Retained outcomes belong to this publication's genuine frozen graph. They
 * prove no current binding, permission, maintenance state or data dependency. */
export const prepareFiniteSourceAcceptance = Effect.fnUntraced(function* (
  command: PreparedFiniteCommitCommand,
  developerDefinitions: readonly LocatedAppIndexDefinitionV1[],
  uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
) {
  const grouped = new Map<LogicalParticipantCommitAuthority, { source: FiniteCommitSource; touchedTables: Set<CatalogTableId> }>();
  for (const source of command.sources) {
    const prior = grouped.get(source.token);
    if (prior === undefined) grouped.set(source.token, { source, touchedTables: new Set(source.touchedTables) });
    else for (const tableId of source.touchedTables) prior.touchedTables.add(tableId);
  }
  const plans: PreparedFiniteSourceAcceptance[] = [];
  for (const { source, touchedTables } of grouped.values()) {
    const documentResults: Exit.Exit<void, PointCommitCorruptionV1Error>[] = [];
    const definitionResults: Exit.Exit<void, PointCommitCorruptionV1Error>[] = [];
    const sourceRows = [...source.selected.tableIds].flatMap(tableId => command.rowIntentsByTable.get(tableId) ?? [])
      .toSorted((a, b) => a.tableId - b.tableId || compareRowIds(a.rowId, b.rowId));
    for (const intent of sourceRows) {
      if (intent.kind !== "live") continue;
      const outcome = yield* Effect.exit(Effect.sync(() => source.selected.validateDocument(intent.tableId, intent.document))
        .pipe(Effect.flatMap(result => Effect.fromResult(result.pipe(Result.mapError(() => corruption("rowWriteInvalid"))))), Effect.asVoid));
      documentResults.push(outcome);
      if (Exit.isFailure(outcome)) break;
    }
    if (documentResults.every(Exit.isSuccess)) {
      const indexes = yield* Effect.exit(Effect.sync(() => {
        const actual = developerDefinitions.filter(index => touchedTables.has(index.access.tableId));
        const expected = source.selected.indexes.filter(index => index.access.kind === "developer" && touchedTables.has(index.access.tableId));
        return actual.length !== expected.length || expected.some(index => !actual.some(member =>
          member.indexDefinitionId === index.indexDefinitionId && member.physicalSpecSha256Hex === index.physicalSpecSha256Hex))
          ? Result.fail(corruption("developerIndexBuildInvalid")) : Result.succeed(undefined);
      }).pipe(Effect.flatMap(Effect.fromResult)));
      definitionResults.push(indexes);
      if (Exit.isSuccess(indexes)) {
        definitionResults.push(yield* Effect.exit(Effect.sync(() => {
          const actual = uniqueDefinitions.filter(constraint => touchedTables.has(constraint.tableId));
          const expected = source.selected.unique.filter(constraint => touchedTables.has(constraint.tableId));
          return actual.length !== expected.length || expected.some(constraint => !actual.some(member =>
            member.uniqueConstraintDefinitionId === constraint.uniqueConstraintDefinitionId && member.tableId === constraint.tableId &&
            member.logicalUniqueConstraintId === constraint.logicalUniqueConstraintId && member.physicalSpecSha256Hex === constraint.physicalSpecSha256Hex))
            ? Result.fail(corruption("uniqueConstraintDefinitionInvalid")) : Result.succeed(undefined);
        }).pipe(Effect.flatMap(Effect.fromResult))));
      }
    }
    plans.push(Object.freeze({ source, touchedTables: Object.freeze([...touchedTables]),
      documentResults: Object.freeze(documentResults), definitionResults: Object.freeze(definitionResults) }));
    // A later source has no genuine stage before this retained refusal.
    if (documentResults.some(Exit.isFailure) || definitionResults.some(Exit.isFailure)) break;
  }
  return Object.freeze(plans);
}, work => observeExecution("PointCommitTransaction.prepareFiniteSourceAcceptance", work));

export class PointCommitAdmissionDigestProviderError extends Data.TaggedError("PointCommitAdmissionDigestProviderError")<{
  readonly cause: unknown;
}> {}

export const requireAdmittedOperationBundleDigest = Effect.fn("PointCommit.requireAdmissionBundleDigest")(function* (
  operation: AdmittedParticipantOperation,
) {
  const bundle = yield* Effect.fromResult(canonicalizeAdmittedSourceBundleResult({
    participant: operation.participant, method: operation.method,
    profileRevision: operation.profileRevision,
    sources: operation.sourceContributions.map(source => ({
      sourceKey: source.sourceKey, sourceSha256Hex: source.sourceSha256Hex,
      bindingHead: source.bindingHead, sourceBindingSha256Hex: source.sourceBindingSha256Hex,
      methods: source.methods,
    })),
  }).pipe(Result.mapError(() => corruption("commandInvalid"))));
  const bytes = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new Uint8Array(bundle.bytes).buffer),
    // A provider rejection is not a malformed stored digest; preserve it at
    // this foreign boundary for the outer transaction failure owner.
    catch: cause => new PointCommitAdmissionDigestProviderError({ cause }),
  });
  if (encodeBytesToLowercaseHex(new Uint8Array(bytes)) !== operation.admissionBundleSha256Hex)
    return yield* Effect.fail(corruption("commandInvalid"));
});

/** Reconstruct participant authority from trusted publisher composition. This
 * runs for both live settlement and finish-only recovery under the same scope
 * and journal locks, without invoking any framework callback. */
const validateParticipantPointCorrelation = Effect.fnUntraced(function* (
  tx: AppRowTransaction, command: PreparedPointCommitTransactionCommandV1,
) {
  const journal = command.participantJournal;
  if (journal === null) return yield* Effect.fail(corruption("commandInvalid"));
  if (journal.operationUsage.receiptEvidenceBytes !== command.sealIdentity.receiptEvidenceBytes ||
    journal.operationUsage.participantWorkBytes !== command.sealIdentity.participantWorkBytes ||
    journal.operationUsage.participantWorkCalls !== command.sealIdentity.participantWorkCalls)
    return yield* Effect.fail(corruption("occEvidenceInvalid"));
  const query = tx.select().from(fxSystemTransactionJournalPoints).where(and(
    eq(fxSystemTransactionJournalPoints.scopeUuid, command.sealIdentity.scopeUuid),
    eq(fxSystemTransactionJournalPoints.sessionId, command.authorityPins.sessionId),
    eq(fxSystemTransactionJournalPoints.attemptFence, command.authorityPins.attemptFence),
  )).limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1);
  const rows = yield* runDrizzleStatementEffect(query, cause => pointCommitSqlCallFailure("validateParticipantEvidence", cause));
  if (rows.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) return yield* Effect.fail(corruption("occEvidenceInvalid"));
  const points: ParticipantPointCorrelation[] = [];
  for (const row of rows) {
    const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(row.rowId)
      .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
    const tableId = yield* Effect.fromResult(decodePointCommitEncodedTableIdResult(row.tableId)
      .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const revision = row.dependencyRevisionCommitSeq === null ? null : yield* Effect.fromResult(
      decodePointCommitRetainedFloorResult(row.dependencyRevisionCommitSeq)
        .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
    let observed: ParticipantPointCorrelation["observed"];
    if (row.dependencyKind === "present" && revision !== null) observed = { kind: "present", revisionCommitSeq: revision };
    else if (row.dependencyKind === "missing_tombstone" && revision !== null)
      observed = { kind: "missing", basis: { kind: "tombstone", revisionCommitSeq: revision } };
    else if (row.dependencyKind === "missing_no_visible_revision" && revision === null)
      observed = { kind: "missing", basis: { kind: "noVisibleRevision" } };
    else if (row.dependencyKind === "generated_insertion" && revision === null && command.generatedOnlyPoints.has(documentId))
      observed = { kind: "generatedInsertion" };
    else return yield* Effect.fail(corruption("occEvidenceInvalid"));
    points.push(Object.freeze({ documentId, tableId, observed, overlayKind: row.overlayKind,
      overlayValueJson: row.overlayValueJson }));
  }
  yield* verifyParticipantPointCorrelationEffect(journal, points)
    .pipe(Effect.mapError(() => corruption("occEvidenceInvalid")));
  const pointById = new Map(points.map(point => [point.documentId, point] as const));
  const firstBefore = new Map<SourceContribution["effects"][number]["documentId"], SourceContribution["effects"][number]>();
  for (const operation of journal.participantOperations)
    for (const effect of operation.sourceContributions.flatMap(source => source.effects)
      .toSorted((left, right) => left.effectOrdinal - right.effectOrdinal))
      if (!firstBefore.has(effect.documentId)) firstBefore.set(effect.documentId, effect);
  const rowById = new Map(command.rowIntents.map(row => [row.documentId, row] as const));
  const verifyFinal = Effect.fnUntraced(function* (documentId: AppDocumentIdV1, point: ParticipantPointCorrelation) {
    const intent = rowById.get(documentId);
    if (point.overlayKind === "deleted" && command.generatedInsertions.has(documentId)) {
      if (intent !== undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      return;
    }
    if (intent === undefined || intent.tableId !== point.tableId) return yield* Effect.fail(corruption("occEvidenceInvalid"));
    if (point.overlayKind === "live") {
      if (intent.kind !== "live" || point.overlayValueJson === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      const final = yield* canonicalizeFlarexValueV1Effect(point.overlayValueJson, "appDocument")
        .pipe(Effect.mapError(() => corruption("occEvidenceInvalid")));
      if (!bytesEqual(final.canonicalBytes, intent.document.canonicalBytes)) return yield* Effect.fail(corruption("occEvidenceInvalid"));
    } else if (point.overlayKind !== "deleted" || intent.kind !== "deleted") return yield* Effect.fail(corruption("occEvidenceInvalid"));
  });
  for (const [documentId] of firstBefore) {
    const point = pointById.get(documentId);
    if (point?.observed.kind === "generatedInsertion") yield* verifyFinal(documentId, point);
  }
  const selected = [...firstBefore].filter(([documentId]) => pointById.get(documentId)?.observed.kind !== "generatedInsertion");
  for (let offset = 0; offset < selected.length;) {
    const firstEntry = selected[offset];
    if (firstEntry === undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
    const tableId = firstEntry[1].tableId;
    const batch: typeof selected = [];
    const rowIds: AppRowIdHexV1[] = [];
    while (offset < selected.length && batch.length < 32) {
      const entry = selected[offset];
      if (entry === undefined || entry[1].tableId !== tableId) break;
      const point = pointById.get(entry[0]);
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(entry[0])
        .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
      if (point === undefined || point.tableId !== tableId || identity.tableId !== tableId)
        return yield* Effect.fail(corruption("occEvidenceInvalid"));
      batch.push(entry); rowIds.push(identity.rowId); offset++;
    }
    let ordinal = 0;
    yield* consumeAppRowSnapshotRevisionsInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId, tableId, rowIds,
      snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
    }, error => error instanceof AppRowReadPersistenceError
      ? new PointCommitSqlFailureMarkerV1("validateParticipantEvidence", error.cause ?? error)
      : corruption("occEvidenceInvalid"), (_rowId, historical) => Effect.gen(function* () {
      const entry = batch[ordinal++];
      if (entry === undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      const [documentId, first] = entry;
      const point = pointById.get(documentId);
      if (point === undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      if (point.observed.kind === "present") {
        if (historical.kind !== "live" || historical.commitSeq !== point.observed.revisionCommitSeq || first.before === null)
          return yield* Effect.fail(corruption("occEvidenceInvalid"));
        const prior = yield* canonicalizeFlarexValueV1Effect(first.before, "appDocument")
          .pipe(Effect.mapError(() => corruption("occEvidenceInvalid")));
        if (!bytesEqual(prior.canonicalBytes, historical.document.canonicalBytes)) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      } else if (point.observed.kind === "missing" && point.observed.basis.kind === "tombstone") {
        if (historical.kind !== "tombstone" || historical.commitSeq !== point.observed.basis.revisionCommitSeq)
          return yield* Effect.fail(corruption("occEvidenceInvalid"));
      } else if (historical.kind !== "missing") return yield* Effect.fail(corruption("occEvidenceInvalid"));
      yield* verifyFinal(documentId, point);
    }));
  }
}, work => observeExecution("PointCommit.validateParticipantPointCorrelation", work));

export async function validateAdmittedParticipantOperations(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  clock: ScopeClockRecord,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  options: PointCommitTransactionProofOptionsV1,
  finiteReservation: FiniteMetadataReservation | null = null,
): Promise<readonly Readonly<{ search: readonly LogicalSearchDefinition[] }>[]> {
  if (command.participantOperations.length === 0) return [];
  // The existing Promise transaction owns this single Effect bridge. Source
  // evidence is shared only within the already locked publication transaction.
  return projectPointCommitTransactionResult((await runPointCommitInTransactionEffect(
    validateParticipantPointCorrelation(tx, command).pipe(Effect.andThen(
      withSharedLogicalSourceBindingChecks(tx, () => validateAdmittedParticipantOperationsInTransaction(
        tx, authority, command, clock, developerDefinitions, uniqueDefinitions, options, finiteReservation)))),
  )).pipe(Result.mapError(error => error instanceof PointCommitAdmissionDigestProviderError ? error.cause : error)));
}

const validateAdmittedParticipantOperationsInTransaction = Effect.fnUntraced(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  clock: ScopeClockRecord,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  options: PointCommitTransactionProofOptionsV1,
  finiteReservation: FiniteMetadataReservation | null,
){
  const operations = command.participantOperations;
  const principalDigest = encodeBytesToLowercaseHex(command.session.identityAccessPolicySha256);
  const validated: Array<Readonly<{ search: readonly LogicalSearchDefinition[] }>> = [];
  // Open the genuine Application callback at the first Application-owning
  // source's authority barrier, after its digest; retain it through later sources.
  const validateFrom = Effect.fnUntraced(function* (initialOperation: number, initialOrdinal: number,
    borrowed?: AcceptedApplicationBinding,
    resumed?: { readonly profile: SelectedLogicalOperationProfile }): Effect.fn.Return<void,
      PointCommitCorruptionV1Error | PointCommitSqlFailureMarkerV1 | PointCommitStaleAuthorityV1Error |
      PointCommitConflictV1Error | PointCommitAdmissionDigestProviderError> {
    for (let operationIndex = initialOperation; operationIndex < operations.length; operationIndex++) {
      const operation = operations[operationIndex]!;
      const selectedProfile = resumed !== undefined && operationIndex === initialOperation ? resumed.profile
        : yield* Effect.fromResult(selectLogicalOperationProfileResult(options, operation));
      for (let ordinal = operationIndex === initialOperation ? initialOrdinal : 0; ordinal < operation.sourceContributions.length; ordinal++) {
      const contribution = operation.sourceContributions[ordinal]!;
      const token = selectedProfile.authorities[ordinal]!;
      if (!(resumed !== undefined && operationIndex === initialOperation && ordinal === initialOrdinal)) {
        const dependencyEvidence = yield* Effect.fromResult(decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence)
          .pipe(Result.mapError(() => corruption("dependencySetInvalid"))));
        if (finiteReservation === null ? dependencyEvidence.version !== 1 : dependencyEvidence.version !== 2 ||
          dependencyEvidence.metadataWatermark !== finiteReservation.metadataWatermark.toString())
          return yield* Effect.fail(corruption("dependencySetInvalid"));
        if (finiteReservation !== null && dependencyEvidence.version === 2) {
          const projection = inspectLogicalParticipantCommitMetadataProjection(token, operation, contribution);
          if (projection === null) return yield* Effect.fail(corruption("dependencySetInvalid"));
          const metadata = yield* decodePointCommitMetadataDependenciesEffect(dependencyEvidence.metadataDependencies)
            .pipe(Effect.mapError(() => corruption("dependencySetInvalid")));
          for (const tableId of new Set(contribution.effects.map(effect => effect.tableId))) {
            const table = finiteMetadataTableKey(projection, tableId, "table"), closure = finiteMetadataTableKey(projection, tableId, "writeClosure");
            if (table === null || closure === null) return yield* Effect.fail(corruption("dependencySetInvalid"));
            for (const key of [table, closure, { namespace: table.namespace, ownerKey: table.ownerKey, contractKey: finiteMetadataContractKey("sourcePolicy") }]) {
              const expected = yield* Effect.fromResult(captureFiniteMetadataDependency(projection, key, finiteReservation.metadataWatermark)
                .pipe(Result.mapError(() => corruption("dependencySetInvalid"))));
              if (expected.observed.kind !== "present") return yield* Effect.fail(corruption("dependencySetInvalid"));
              const semanticSha256Hex = expected.observed.semanticSha256Hex;
              if (!metadata.some(member =>
                logicalMetadataDependencyIdentity(member) === logicalMetadataDependencyIdentity(expected) && member.observed.kind === "present" &&
                member.capturedWatermark === expected.capturedWatermark && member.observed.semanticSha256Hex === semanticSha256Hex))
                return yield* Effect.fail(corruption("dependencySetInvalid"));
            }
          }
        }
        const binding = yield* Effect.fromResult(canonicalizeAdmittedParticipantBindingV1Result({
          scopeId: command.authorityPins.scopeId,
          sessionId: command.authorityPins.sessionId,
          attemptFence: command.authorityPins.attemptFence,
          snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
          schemaVersionId: command.authorityPins.schemaVersionId,
          principalDigest,
          participant: operation.participant,
          method: operation.method,
          sourceKey: contribution.sourceKey,
          sourceSha256Hex: contribution.sourceSha256Hex,
          bindingHead: contribution.bindingHead,
        }).pipe(Result.mapError(() => corruption("commandInvalid"))));
        const bindingBytes = yield* Effect.tryPromise({
          try: () => crypto.subtle.digest("SHA-256", new Uint8Array(binding.bytes).buffer),
          catch: cause => new PointCommitAdmissionDigestProviderError({ cause }),
        });
        if (encodeBytesToLowercaseHex(new Uint8Array(bindingBytes)) !== contribution.sourceBindingSha256Hex)
          return yield* Effect.fail(corruption("commandInvalid"));
      }
      if (finiteReservation === null && borrowed === undefined &&
        selectedProfile.applicationBindings[ordinal] === true)
        return yield* withLogicalParticipantCommitApplicationBindingInTransaction(token, tx, clock,
          binding => validateFrom(operationIndex, ordinal, binding, { profile: selectedProfile })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
            error instanceof LogicalParticipantAdmissionError ? error.reason === "resourceFailure"
              ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
              : error.reason === "storedCorruption" ? corruption("activeApplicationHeadInvalid")
                : new PointCommitStaleAuthorityV1Error({ reason: "activeSchemaChanged" }) : error))));
      const admittedEffect = (finiteReservation === null
        ? requireLogicalParticipantCommitAuthorityEffect(token, operation, contribution, tx, authority, clock, borrowed)
        : requireFiniteLogicalParticipantCommitAuthorityEffect(token, operation, contribution, tx, authority, clock)).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error.reason === "resourceFailure"
          ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
          : error.reason === "storedCorruption" ? corruption("activeApplicationHeadInvalid")
            : new PointCommitStaleAuthorityV1Error({ reason: "activeSchemaChanged" })))));
      const admitted = yield* admittedEffect;
      const touched = new Set(contribution.effects.map(effect => effect.tableId));
      const expectedIndexes = admitted.indexes.filter(definition => definition.access.kind === "developer" &&
        touched.has(definition.access.tableId));
      const actualIndexes = developerDefinitions.filter(definition => touched.has(definition.access.tableId));
      if (expectedIndexes.length !== actualIndexes.length || expectedIndexes.some(expected =>
        !actualIndexes.some(actual => actual.indexDefinitionId === expected.indexDefinitionId &&
          actual.physicalSpecSha256Hex === expected.physicalSpecSha256Hex)))
        return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
      const expectedUnique = admitted.unique.filter(definition => touched.has(definition.tableId));
      const actualUnique = uniqueDefinitions.filter(definition => touched.has(definition.tableId));
      if (expectedUnique.length !== actualUnique.length || expectedUnique.some(expected =>
        !actualUnique.some(actual => actual.uniqueConstraintDefinitionId === expected.uniqueConstraintDefinitionId &&
          actual.physicalSpecSha256Hex === expected.physicalSpecSha256Hex)))
        return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
      for (const row of command.rowIntents) {
        if (!command.participantMaterialDocumentIds.has(row.documentId) || !touched.has(row.tableId) || row.kind === "deleted")
          continue;
        yield* Effect.fromResult(admitted.validateDocument(row.tableId, row.document)
          .pipe(Result.mapError(() => corruption("rowWriteInvalid"))));
      }
      validated.push(Object.freeze({ search: admitted.search.filter(definition => touched.has(definition.tableId)) }));
      const dependencyEffect = validateLogicalParticipantDependencyEvidence(
        tx, command.authorityPins.scopeId, operation, contribution,
        { tableIds: admitted.tableIds, ...admitted.readDefinitions }, options.publicationObservation).pipe(
          Effect.mapError(error => error.reason === "writeConflict"
            ? new PointCommitConflictV1Error({ conflict: { kind: "logicalParticipant",
              participant: operation.participant, syscallSequence: operation.syscallSequence },
              snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
              currentCommitSeq: clock.lastCommitSeq })
            : error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("validateIndexRanges", error.cause ?? error)
              : corruption("dependencySetInvalid")));
      yield* dependencyEffect;
      const events: CommittedEvent[] = [];
      for (const event of operation.eventIntents.filter(intent => intent.sourceKey === contribution.sourceKey))
        events.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent)
          .pipe(Result.mapError(() => corruption("commandInvalid")))));
      const eventBindings = (options.logicalParticipantEvents ?? []).filter(member => member.authority === token);
      if (eventBindings.length > 1 || (events.length > 0 && eventBindings.length !== 1))
        return yield* Effect.fail(corruption("commandInvalid"));
      const eventBinding = eventBindings[0];
      if (eventBinding !== undefined) {
        const group = admittedCommerceEventGroup({ scopeUuid: command.sealIdentity.scopeUuid,
          sessionId: command.authorityPins.sessionId, attemptFence: command.authorityPins.attemptFence });
        const eventEvidence = validateAdmittedCommerceEventIntents(
          eventBinding.policy, eventBinding.selection, events, group).pipe(
          Effect.mapError(() => corruption("commandInvalid")));
        yield* eventEvidence;
      }
      }
      yield* requireAdmittedOperationBundleDigest(operation);
      const workflowEvents: CommittedEvent[] = [];
      for (const event of operation.eventIntents.filter(intent => intent.sourceKey === null))
        workflowEvents.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent)
          .pipe(Result.mapError(() => corruption("commandInvalid")))));
      const operationEventBinding = selectedProfile.profile.operationEvents;
      if (workflowEvents.length > 0 && operationEventBinding === undefined)
        return yield* Effect.fail(corruption("commandInvalid"));
      if (operationEventBinding !== undefined) {
        const group = admittedCommerceEventGroup({ scopeUuid: command.sealIdentity.scopeUuid,
          sessionId: command.authorityPins.sessionId, attemptFence: command.authorityPins.attemptFence });
        yield* validateAdmittedOperationEventIntents(operationEventBinding.policy,
          operationEventBinding.selection, workflowEvents, group)
          .pipe(Effect.mapError(() => corruption("commandInvalid")));
      }
    }
  });
  yield* validateFrom(0, 0);
  return Object.freeze(validated);
}, work => observeExecution("PointCommit.validateAdmittedParticipants", work));
