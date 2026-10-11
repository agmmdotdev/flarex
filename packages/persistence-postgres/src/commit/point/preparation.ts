import {
  Effect,
  Result,
  Exit,
  Encoding,
} from "effect";
import type {
  PreparedFiniteCommitCommand,
  PreparedFiniteAttemptResolutionCommand,
  PreparedPointCommitTransactionCommandV1,
  FiniteCommitSource,
  PreparedPointCommitPublicationCommandV1,
} from "./preparedCommands";
import type {
  StoredCommitAuthorityEvidenceLoaderPortsV1,
} from "../authority/postgresLoader";
import type {
  PointCommitTransactionProofOptionsV1,
} from "./constructionContracts";
import {
  readOriginalFiniteExecutionAuthority,
} from "../../execution/journal/finiteEntry";
import {
  corruption,
  type PointCommitCorruptionV1Error,
  type PointCommitStaleAuthorityV1Error,
} from "./errors";
import {
  projectOriginalFinitePublicationSession,
} from "../../execution/journal/finiteEntryPublication";
import {
  selectPreparedPublicationDefinitions,
} from "../publication/definitionPreparation";
import type {
  CatalogIndexDefinitionId,
  CatalogUniqueConstraintDefinitionId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  type LocatedAppIndexDefinitionV1,
  isLocatedAppIndexDefinitionV1,
} from "../../storage/indexes/appIndexDefinitions";
import {
  type LocatedAppUniqueConstraintDefinitionV1,
  isLocatedAppUniqueConstraintDefinitionV1,
} from "../../storage/unique/appUniqueConstraintDefinitions";
import type {
  CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
} from "../../storage/materialization/limits";
import {
  validateApplicationUniqueTransitionBudget,
  pointDependenciesEqual,
  prepareDeveloperIndexDefinitions,
  prepareUniqueConstraintDefinitions,
} from "../../storage/materialization/materialization";
import {
  prepareApplicationDocumentSettlementEffect,
  preparedApplicationDocumentSettlementHasFailure,
} from "../../storage/materialization/settlementPlan";
import type {
  PreparedPointCommitApplicationRelations,
  PreparedPointCommitCandidateSchemaWriteGuard,
  PointCommitDependencyV1,
  PreparedPointCommitRowIntentV1,
  PreparedLivePointCommitRowIntentV1,
} from "../../storage/materialization/model";
import {
  hasApplicationRelationCommitAuthorityForPointCommit,
  ApplicationRelationCommitUnavailableError,
  prepareApplicationRelationDefinitionsFromLocatedBindingResult,
} from "../../application/relations/applicationRelationCommit";
import {
  hasAppSchemaCandidateWriteGuardComposition,
  prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect,
} from "../../storage/catalog/appSchemaCandidateValidation";
import {
  AppSchemaCandidateWriteGuardError,
} from "../../storage/catalog/appSchemaCandidateWriteGuardErrors";
import {
  observeExecution,
} from "../../execution/diagnostics/operation";
import {
  prepareFiniteSourceAcceptance,
} from "./participantProof";
import {
  preparedApplicationRelationsForFiniteCommit,
} from "./attemptAcceptance";
import {
  commitEventsDigest,
} from "../events/digest";
import {
  finiteCommitSqlFailure,
} from "./sqlFailures";
import type {
  ScopePublicationContribution,
} from "../publication/scopePublicationModel";
import type {
  PointFiniteAttemptResolutionCommand,
  PointCommitTransactionCommandV1,
  PointFiniteCommitCommand,
  PointCommitPublicationCommandV1,
} from "./contracts";
import {
  readFrozenFiniteAttemptOrigin,
  readOwnedFrozenFiniteAttempt,
} from "../../execution/journal/frozenAttempt";
import {
  captureAuthorityPinsResult,
  captureSessionScalarsResult,
  captureExecutionClaimPinResult,
  commandExecutionAuthorityConsistent,
  compareRowIds,
  capturePointCommitCommandResult,
  decodePointCommitMetadataDependenciesEffect,
  decodePointCommitEventEnvelope,
  isCanonicalDocumentForIntent,
  requireCanonicalDependencyOrderResult,
  selectLogicalOperationProfileResult,
  captureSuccessfulResultResult,
} from "./capture";
import {
  findFiniteSettlementRefusal,
} from "./capabilities";
import {
  projectScopeIdUuidV1Result,
} from "flarex-protocol/storage-authority";
import {
  type SessionJournal,
  type AdmittedParticipantOperation,
  type LogicalMetadataReadDependency,
  decodeCanonicalSessionJournalEffect,
  logicalMetadataDependencyIdentity,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  CanonicalSuccessfulResultBytesV1Schema,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  authenticatedGeneratedInsertionsResult,
  decodeLogicalParticipantDependencyEvidence,
} from "../../storage/documents/logicalDocuments/journalEvidence";
import type {
  CommittedEvent,
} from "../events/model";
import {
  encodeBytesToLowercaseHex,
  bytesEqualFullScan as bytesEqual,
  copyBytes,
} from "@flarex/utils/bytes";
import {
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import {
  canonicalizeFlarexValueV1,
  FlarexValueCodecV1Error,
  FLAREX_VALUE_CODEC_VERSION_V1,
} from "flarex-protocol/value";
import {
  projectLogicalPointExpectation,
} from "../../storage/documents/logicalDocuments/pointEvidence";
import {
  inspectLogicalParticipantAdmissionBundle,
  inspectFiniteOperationCommitAuthority,
  inspectLogicalParticipantCommitAuthority,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import {
  validateAdmittedCommerceEventIntents,
  admittedCommerceEventGroup,
  validateAdmittedOperationEventIntents,
} from "../../frameworks/atomicCommerce/events";
import {
  indexApplicationDocumentRowIntents,
} from "../../storage/materialization/settlementPlan";

export const prepareFiniteCommitDefinitions = Effect.fnUntraced(function* (
  command: PreparedFiniteCommitCommand, ports: StoredCommitAuthorityEvidenceLoaderPortsV1, options: PointCommitTransactionProofOptionsV1,
) {
  const originalEntry = readOriginalFiniteExecutionAuthority(command.frozen.originalEntry, ports);
  if (originalEntry === undefined) return yield* Effect.fail(corruption("commandInvalid"));
  const expectedSession = yield* Effect.fromResult(projectOriginalFinitePublicationSession(command.frozen.originalEntry,
    ports).pipe(Result.mapError(() => corruption("commandInvalid"))));
  const applicationTables = new Set(command.rowIntents.filter(row => !command.participantMaterialDocumentIds.has(row.documentId))
    .map(row => row.tableId));
  const prepared = command.frozen.applicationPublicationDefinitions;
  const selectedApplicationDefinitions = selectPreparedPublicationDefinitions(prepared.prepared, applicationTables);
  if (selectedApplicationDefinitions === null) return yield* Effect.fail(corruption("commandInvalid"));
  const indexes = new Map<CatalogIndexDefinitionId, LocatedAppIndexDefinitionV1>();
  const unique = new Map<CatalogUniqueConstraintDefinitionId, LocatedAppUniqueConstraintDefinitionV1>();
  for (const index of selectedApplicationDefinitions.indexes) {
    if (!isLocatedAppIndexDefinitionV1(index) || index.scopeId !== command.authorityPins.scopeId ||
      index.deploymentId !== command.authorityPins.deploymentId) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    indexes.set(index.indexDefinitionId, index);
  }
  for (const constraint of selectedApplicationDefinitions.unique) {
    if (!isLocatedAppUniqueConstraintDefinitionV1(constraint) || constraint.scopeId !== command.authorityPins.scopeId ||
      constraint.deploymentId !== command.authorityPins.deploymentId || constraint.schemaVersionId !== command.authorityPins.schemaVersionId)
      return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
    unique.set(constraint.uniqueConstraintDefinitionId, constraint);
  }
  const sourceSchemaVersionByTable = new Map<CatalogTableId, CatalogSchemaVersionId>();
  for (const source of command.sources) {
    const selectedDefinitions = selectPreparedPublicationDefinitions(source.selected.publicationDefinitions, new Set(source.touchedTables));
    if (selectedDefinitions === null) return yield* Effect.fail(corruption("commandInvalid"));
    for (const tableId of source.touchedTables) {
      const prior = sourceSchemaVersionByTable.get(tableId);
      if (prior !== undefined && prior !== source.selected.schemaVersionId) return yield* Effect.fail(corruption("commandInvalid"));
      sourceSchemaVersionByTable.set(tableId, source.selected.schemaVersionId);
    }
    for (const index of selectedDefinitions.indexes) {
      if (!isLocatedAppIndexDefinitionV1(index) || index.scopeId !== command.authorityPins.scopeId ||
        index.deploymentId !== command.authorityPins.deploymentId) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
      const prior = indexes.get(index.indexDefinitionId);
      if (prior !== undefined && prior.physicalSpecSha256Hex !== index.physicalSpecSha256Hex)
        return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
      indexes.set(index.indexDefinitionId, index);
    }
    for (const constraint of selectedDefinitions.unique) {
      if (!isLocatedAppUniqueConstraintDefinitionV1(constraint) || constraint.scopeId !== command.authorityPins.scopeId ||
        constraint.deploymentId !== command.authorityPins.deploymentId || constraint.schemaVersionId !== source.selected.schemaVersionId)
        return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
      const prior = unique.get(constraint.uniqueConstraintDefinitionId);
      if (prior !== undefined && prior.physicalSpecSha256Hex !== constraint.physicalSpecSha256Hex)
        return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
      unique.set(constraint.uniqueConstraintDefinitionId, constraint);
    }
  }
  const mixedCommand = Object.freeze({ ...command, sourceSchemaVersionByTable });
  const intrinsicDefinitions = Object.freeze([...indexes.values()].filter(index => index.access.kind === "by_creation_time")
    .toSorted((a, b) => a.indexDefinitionId - b.indexDefinitionId));
  for (const tableId of new Set(command.rowIntents.map(row => row.tableId)))
    if (intrinsicDefinitions.filter(index => index.access.tableId === tableId).length !== 1)
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
  const developerDefinitions = Object.freeze([...indexes.values()].filter(index => index.access.kind === "developer")
    .toSorted((a, b) => a.indexDefinitionId - b.indexDefinitionId));
  const uniqueDefinitions = Object.freeze([...unique.values()].toSorted((a, b) => a.uniqueConstraintDefinitionId - b.uniqueConstraintDefinitionId));
  if (uniqueDefinitions.length > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1)
    return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
  yield* Effect.fromResult(validateApplicationUniqueTransitionBudget(command.rowIntents, uniqueDefinitions));
  let applicationRelations: PreparedPointCommitApplicationRelations | null = null;
  let candidateSchemaWriteGuard: PreparedPointCommitCandidateSchemaWriteGuard | null = null;
  if (command.rowIntents.length > 0) {
    const relationPort = options.applicationRelations;
    if (relationPort !== undefined) {
      if (!hasApplicationRelationCommitAuthorityForPointCommit(relationPort, ports))
        return yield* Effect.fail(new ApplicationRelationCommitUnavailableError({ reason: "compositionMissing" }));
      const definitions = prepared.relations === null ? null : yield* Effect.fromResult(
        prepareApplicationRelationDefinitionsFromLocatedBindingResult(relationPort, prepared.relations, command.authorityPins.deploymentId))
        .pipe(Effect.mapError(() => corruption("relationBindingInvalid")));
      if (definitions !== null && definitions.schemaVersionId !== command.authorityPins.schemaVersionId)
        return yield* Effect.fail(corruption("relationBindingInvalid"));
      applicationRelations = Object.freeze({ port: relationPort, definitions });
    } else if (prepared.relations !== null) return yield* Effect.fail(corruption("relationBindingInvalid"));
    const guard = options.candidateSchemaWriteGuard;
    if (guard !== undefined) {
      if (!hasAppSchemaCandidateWriteGuardComposition(guard, ports))
        return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch" }));
      const planned = yield* prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard,
        command.frozen.candidatePlanningHead, command.authorityPins);
      candidateSchemaWriteGuard = Object.freeze({ guard, prepared: planned });
    }
  }
  return { mixedCommand, intrinsicDefinitions, developerDefinitions, uniqueDefinitions, applicationRelations, candidateSchemaWriteGuard,
    originalIssuer: ports, expectedSession };
}, work => observeExecution("PointCommitTransaction.prepareFiniteDefinitions", work));

export const prepareFiniteCommitSettlement = Effect.fnUntraced(function* (
  definitions: Effect.Success<ReturnType<typeof prepareFiniteCommitDefinitions>>,
) {
  const command = definitions.mixedCommand;
  const sources = yield* prepareFiniteSourceAcceptance(command, definitions.developerDefinitions, definitions.uniqueDefinitions);
  const sourcePreparationSucceeded = sources.every(source => source.documentResults.every(Exit.isSuccess) && source.definitionResults.every(Exit.isSuccess));
  const documentSettlement = sourcePreparationSucceeded ? yield* prepareApplicationDocumentSettlementEffect(command,
    command.frozen.originalRows, definitions.developerDefinitions, definitions.uniqueDefinitions,
    preparedApplicationRelationsForFiniteCommit(definitions.applicationRelations), definitions.intrinsicDefinitions) : null;
  const publicationContribution = documentSettlement !== null && !preparedApplicationDocumentSettlementHasFailure(documentSettlement)
    ? yield* Effect.exit(Effect.gen(function* () {
      const eventSha = command.events.length === 0 ? null : yield* commitEventsDigest(command.events).pipe(Effect.mapError(error =>
        error.reason === "resourceFailure" ? finiteCommitSqlFailure("writeCommitChange", error.cause ?? error) : corruption("commandInvalid")));
      const resultDigest = yield* Effect.fromResult(Encoding.decodeHex(command.successfulResult.sha256Hex)
        .pipe(Result.mapError(() => corruption("successfulResultInvalid"))));
      return { authorityPins: command.authorityPins, rowIntents: command.rowIntents,
        identityAccessPolicySha256: command.session.identityAccessPolicySha256, requestSha256: command.session.requestSha256,
        resultSha256: resultDigest, successfulResult: { ...command.successfulResult, encoding: "application-value" },
        ...(command.events.length === 0 ? {} : { events: { values: command.events, sha256: eventSha } }) } satisfies ScopePublicationContribution;
    })) : null;
  return Object.freeze({ ...definitions, sourceAcceptance: sources, documentSettlement, publicationContribution });
}, work => observeExecution("PointCommitTransaction.prepareFiniteSettlement", work));

export const requireFrozenFiniteAttemptOrigin = Effect.fnUntraced(function* (
  input: PointFiniteAttemptResolutionCommand, command: PreparedFiniteAttemptResolutionCommand,
) {
  if (input.frozenAttempt === undefined) return yield* Effect.fail(corruption("commandInvalid"));
  const origin = readFrozenFiniteAttemptOrigin(input.frozenAttempt);
  if (origin === undefined || origin.selector.deploymentId !== command.authorityPins.deploymentId ||
    origin.selector.scopeId !== command.authorityPins.scopeId || origin.selector.sessionId !== command.authorityPins.sessionId ||
    origin.selector.attemptFence !== command.authorityPins.attemptFence)
    return yield* Effect.fail(corruption("commandInvalid"));
  return origin;
}, work => observeExecution("PointCommitTransaction.requireFrozenOrigin", work));

export const prepareFiniteAttemptResolutionCommand = Effect.fn("PointCommitTransaction.prepareFiniteResolution")(function* (
  input: PointFiniteAttemptResolutionCommand,
) {
  const authorityPins = yield* Effect.fromResult(captureAuthorityPinsResult(input.authorityPins));
  const session = yield* Effect.fromResult(captureSessionScalarsResult(input.session));
  const executionClaim = yield* Effect.fromResult(captureExecutionClaimPinResult(input.executionClaim));
  if (input.terminalRefusal !== undefined) {
    const emitted = findFiniteSettlementRefusal(input.terminalRefusal);
    if (emitted === undefined || emitted.command.authorityPins !== input.authorityPins || emitted.command.session !== input.session ||
      emitted.command.executionClaim !== input.executionClaim ||
      (emitted.kind === "replacement" ? emitted.proof !== input.terminalRefusalProof : input.terminalRefusalProof !== undefined))
      return yield* Effect.fail(corruption("commandInvalid"));
  } else if (input.terminalRefusalProof !== undefined) {
    return yield* Effect.fail(corruption("commandInvalid"));
  }
  if (session.lifecycle !== "running" || authorityPins.storageGeneration !== session.storageGeneration ||
    authorityPins.storageGenerationFence !== session.storageGenerationFence || !commandExecutionAuthorityConsistent(authorityPins, session) ||
    authorityPins.functionPath !== session.functionPath || authorityPins.functionKind !== session.functionKind ||
    authorityPins.schemaVersionId !== session.schemaVersionId || authorityPins.policyVersion !== session.policyVersion ||
    authorityPins.authorizationRevocationEpoch !== session.authorizationRevocationEpoch || authorityPins.requestKey !== session.requestKey)
    return yield* Effect.fail(corruption("commandInvalid"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authorityPins.scopeId).pipe(Result.mapError(() => corruption("commandInvalid"))));
  return Object.freeze({ authorityPins, session, executionClaim, scopeUuid: scope.scopeUuid,
    ...(input.terminalRefusal === undefined ? {} : { terminalRefusal: input.terminalRefusal }),
    ...(input.terminalRefusalProof === undefined ? {} : { terminalRefusalProof: input.terminalRefusalProof }) }) satisfies PreparedFiniteAttemptResolutionCommand;
});

/** Physical planning guards are derived only after canonical journal authentication.
 * Generated guards never enter the genuine read verdict or replacement OCC set. */
export function authenticatedPublicationPointsResult(journal: SessionJournal,
  dependencies: readonly PointCommitDependencyV1[], expectedPhysicalCount: number,
): Result.Result<readonly PointCommitDependencyV1[], PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const insertionOrigins = yield* authenticatedGeneratedInsertionsResult(journal.participantOperations)
      .pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    const genuinePoints = journal.readDependencies.filter(dependency => dependency.kind === "appRowPoint");
    if (genuinePoints.length !== dependencies.length || dependencies.some(point =>
      !genuinePoints.some(read => read.documentId === point.documentId && read.observed.kind === point.dependency.observed.kind &&
        (read.observed.kind === "present" && point.dependency.observed.kind === "present"
          ? read.observed.revisionCommitSeq === point.dependency.observed.revisionCommitSeq
          : read.observed.kind === "missing" && point.dependency.observed.kind === "missing" &&
            read.observed.basis.kind === point.dependency.observed.basis.kind &&
            (read.observed.basis.kind === "noVisibleRevision" || point.dependency.observed.basis.kind === "tombstone" &&
              read.observed.basis.revisionCommitSeq === point.dependency.observed.basis.revisionCommitSeq)))))
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    const genuineReadIds = new Set(genuinePoints.map(point => point.documentId));
    const points = Object.freeze([...dependencies, ...[...insertionOrigins.values()]
      .filter(intent => !genuineReadIds.has(intent.documentId)).map(intent => ({ documentId: intent.documentId,
        tableId: intent.tableId, rowId: intent.rowId, dependency: { kind: "appRowPoint" as const,
          documentId: intent.documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } }))]
      .toSorted((left, right) => left.tableId - right.tableId || compareRowIds(left.rowId, right.rowId)));
    if (points.length !== expectedPhysicalCount) return yield* Result.fail(corruption("occEvidenceInvalid"));
    return points;
  });
}

export const preparePointCommitCommand = Effect.fn(
  "PointCommitTransaction.prepareCommand",
)(function* (
  input: PointCommitTransactionCommandV1,
): Effect.fn.Return<
  PreparedPointCommitTransactionCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  const captured = yield* Effect.fromResult(
    capturePointCommitCommandResult(input),
  );
  let attemptedTableIds: ReadonlyArray<CatalogTableId> | null = null;
  let participantOperations: readonly AdmittedParticipantOperation[] = Object.freeze([]);
  let participantJournal: SessionJournal | null = null;
  let generatedInsertions: ReadonlySet<string> = new Set();
  let generatedOnlyPoints: ReadonlySet<string> = new Set();
  let publicationPoints = captured.dependencies;
  let finiteMetadataReservationSha256Hex: string | null = null;
  const metadataDependencies: LogicalMetadataReadDependency[] = [];
  let participantMaterialDocumentIds: ReadonlySet<string> = new Set();
  const participantEventIntents: CommittedEvent[] = [];
  if (captured.journalBytes !== undefined) {
    const journal = yield* decodeCanonicalSessionJournalEffect({ canonicalBytes: captured.journalBytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(captured.sealIdentity.journalSha256) }).pipe(
      Effect.mapError(() => corruption("commandInvalid")));
    const tables = new Set<CatalogTableId>();
    for (const write of journal.journal.writes) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(write.documentId).pipe(
        Result.mapError(() => corruption("commandInvalid"))));
      tables.add(identity.tableId);
    }
    attemptedTableIds = Object.freeze([...tables]);
    participantOperations = journal.journal.participantOperations;
    participantJournal = journal.journal;
    const insertionOrigins = yield* Effect.fromResult(authenticatedGeneratedInsertionsResult(participantOperations)
      .pipe(Result.mapError(() => corruption("commandInvalid"))));
    generatedInsertions = new Set(insertionOrigins.keys());
    const genuineReadIds = new Set(journal.journal.readDependencies.filter(dependency => dependency.kind === "appRowPoint").map(dependency => dependency.documentId));
    generatedOnlyPoints = new Set([...insertionOrigins.keys()].filter(id => !genuineReadIds.has(id)));
    publicationPoints = yield* Effect.fromResult(authenticatedPublicationPointsResult(
      journal.journal, captured.dependencies, captured.sealIdentity.pointDependencyCount).pipe(
      Result.mapError(() => corruption("commandInvalid"))));
    finiteMetadataReservationSha256Hex = journal.journal.finiteMetadataReservationSha256Hex ?? null;
    metadataDependencies.push(...journal.journal.readDependencies.filter(dependency => dependency.kind === "metadata"));
    for (const operation of participantOperations) for (const contribution of operation.sourceContributions) {
      const evidence = yield* Effect.fromResult(decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence)
        .pipe(Result.mapError(() => corruption("commandInvalid"))));
      if (evidence.version === 2) {
        if (finiteMetadataReservationSha256Hex === null) return yield* Effect.fail(corruption("commandInvalid"));
        const sourceMetadataDependencies = yield* decodePointCommitMetadataDependenciesEffect(
          evidence.metadataDependencies).pipe(Effect.mapError(() => corruption("commandInvalid")));
        for (const dependency of sourceMetadataDependencies) {
          const retained = metadataDependencies.find(member => logicalMetadataDependencyIdentity(member) === logicalMetadataDependencyIdentity(dependency));
          if (retained === undefined || retained.capturedWatermark !== dependency.capturedWatermark || retained.observed.kind !== dependency.observed.kind ||
            retained.observed.kind === "present" && dependency.observed.kind === "present" && retained.observed.semanticSha256Hex !== dependency.observed.semanticSha256Hex)
            return yield* Effect.fail(corruption("commandInvalid"));
        }
      } else if (finiteMetadataReservationSha256Hex !== null) return yield* Effect.fail(corruption("commandInvalid"));
    }
    if (metadataDependencies.length > 0 && finiteMetadataReservationSha256Hex === null)
      return yield* Effect.fail(corruption("commandInvalid"));
    if (finiteMetadataReservationSha256Hex !== null && captured.relationDependencies.length > 0)
      return yield* Effect.fail(corruption("commandInvalid"));
    const documents = new Set<string>();
    const appDocuments = new Set(journal.journal.writes.map(write => write.documentId));
    for (const operation of participantOperations) for (const contribution of operation.sourceContributions)
      for (const effect of contribution.effects) {
      if (appDocuments.has(effect.documentId) || tables.has(effect.tableId))
        return yield* Effect.fail(corruption("commandInvalid"));
      documents.add(effect.documentId);
    }
    for (const operation of participantOperations) for (const event of operation.eventIntents)
      participantEventIntents.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent)
        .pipe(Result.mapError(() => corruption("commandInvalid")))));
    participantMaterialDocumentIds = documents;
  }
  const rowIntents: PreparedPointCommitRowIntentV1[] = [];
  for (const rowIntent of captured.rowIntents) {
    if (!publicationPoints.some(point => pointDependenciesEqual(point, rowIntent)))
      return yield* Effect.fail(corruption("commandInvalid"));
    if (rowIntent.kind === "deleted") {
      rowIntents.push(rowIntent);
      continue;
    }
    const document = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueV1(
        rowIntent.value,
        "appDocument",
      ),
      catch: (cause): unknown => cause,
    }).pipe(
      // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: protocol - classify the foreign canonical codec rejection once; malformed values fail command validation and unexpected provider failures remain defects.
      Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueCodecV1Error
        ? Effect.fail(corruption("commandInvalid"))
        : Effect.die(cause)
    ));
    if (
      !bytesEqual(document.canonicalBytes, rowIntent.canonicalBytes) ||
      document.semanticSizeBytes !== rowIntent.semanticSizeBytes ||
      !isCanonicalDocumentForIntent(document, rowIntent)
    ) {
      return yield* Effect.fail(corruption("commandInvalid"));
    }
    rowIntents.push(Object.freeze({
      documentId: rowIntent.documentId,
      tableId: rowIntent.tableId,
      rowId: rowIntent.rowId,
      dependency: rowIntent.dependency,
      kind: "live",
      creationTime: rowIntent.creationTime,
      document,
    } satisfies PreparedLivePointCommitRowIntentV1));
  }
  return Object.freeze({
    ...captured,
    dependencies: publicationPoints,
    attemptedTableIds,
    participantOperations,
    generatedInsertions, generatedOnlyPoints,
    participantJournal,
    metadataDependencies: Object.freeze([...new Map(metadataDependencies.map(dependency => [logicalMetadataDependencyIdentity(dependency), dependency])).values()]),
    finiteMetadataReservationSha256Hex,
    participantMaterialDocumentIds,
    participantEventIntents: Object.freeze(participantEventIntents),
    rowIntents: Object.freeze(rowIntents),
  });
});

export const prepareFiniteCommitCommand = Effect.fnUntraced(function* (
  input: PointFiniteCommitCommand, options: PointCommitTransactionProofOptionsV1,
) {
  const authorityPins = yield* Effect.fromResult(captureAuthorityPinsResult(input.authorityPins));
  const session = yield* Effect.fromResult(captureSessionScalarsResult(input.session));
  if (authorityPins.storageGeneration !== session.storageGeneration || authorityPins.storageGenerationFence !== session.storageGenerationFence ||
    !commandExecutionAuthorityConsistent(authorityPins, session) || authorityPins.functionPath !== session.functionPath ||
    authorityPins.functionKind !== session.functionKind || authorityPins.schemaVersionId !== session.schemaVersionId ||
    authorityPins.policyVersion !== session.policyVersion || authorityPins.authorizationRevocationEpoch !== session.authorizationRevocationEpoch ||
    authorityPins.requestKey !== session.requestKey) return yield* Effect.fail(corruption("commandInvalid"));
  const executionClaim = yield* Effect.fromResult(captureExecutionClaimPinResult(input.executionClaim));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authorityPins.scopeId)
    .pipe(Result.mapError(() => corruption("commandInvalid"))));
  const frozen = readOwnedFrozenFiniteAttempt(input.frozenAttempt);
  if (frozen === undefined || session.lifecycle !== "running" ||
    frozen.attemptState.selector.scopeId !== authorityPins.scopeId || frozen.attemptState.selector.deploymentId !== authorityPins.deploymentId ||
    frozen.attemptState.selector.sessionId !== authorityPins.sessionId || frozen.attemptState.selector.attemptFence !== authorityPins.attemptFence ||
    frozen.attemptState.snapshotToken.epoch !== authorityPins.snapshotToken.epoch ||
    frozen.attemptState.snapshotToken.commitSeq !== authorityPins.snapshotToken.commitSeq ||
    frozen.attemptState.schemaVersionId !== authorityPins.schemaVersionId ||
    frozen.attemptState.executionClaim.claimOwner !== executionClaim.claimOwner || frozen.attemptState.executionClaim.claimFence !== executionClaim.claimFence ||
    frozen.attemptState.executionProfile !== "finiteRoot") return yield* Effect.fail(corruption("commandInvalid"));
  const dependencies = frozen.graph.dependencies.map(projectLogicalPointExpectation);
  if (dependencies.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) return yield* Effect.fail(corruption("commandInvalid"));
  yield* Effect.fromResult(requireCanonicalDependencyOrderResult(dependencies));
  const dependenciesByDocumentId = new Map(dependencies.map(dependency => [dependency.documentId, dependency]));
  const generatedInsertions = new Set(frozen.graph.dependencies.filter(point => point.dependency.kind === "generatedInsertion").map(point => point.documentId));
  const generatedOnlyPoints = generatedInsertions;
  const rowIntents = frozen.rowIntents;
  if (rowIntents.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) return yield* Effect.fail(corruption("commandInvalid"));
  yield* Effect.fromResult(requireCanonicalDependencyOrderResult(rowIntents));
  for (const row of rowIntents) {
    const dependency = dependenciesByDocumentId.get(row.documentId);
    if (dependency === undefined || !pointDependenciesEqual(dependency, row)) return yield* Effect.fail(corruption("dependencySetInvalid"));
    if (row.kind === "live" && !isCanonicalDocumentForIntent(row.document, row))
      return yield* Effect.fail(corruption("commandInvalid"));
  }
  const applicationTables = new Set<CatalogTableId>();
  const sources: FiniteCommitSource[] = [];
  const nativeTables = new Set<CatalogTableId>();
  const events: CommittedEvent[] = [];
  const attributedAttempts = new Set<number>();
  for (const operation of frozen.operations) {
    if (operation.kind !== "participant") {
      if (operation.write !== undefined) applicationTables.add(yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(operation.write.documentId)
        .pipe(Result.map(identity => identity.tableId), Result.mapError(() => corruption("commandInvalid")))));
      continue;
    }
    const profiles = (options.logicalOperationProfiles ?? []).filter(profile => profile.participant === operation.participant &&
      profile.operationMethods.includes(operation.method) && profile.profileRevision === operation.profileRevision);
    const bundle = inspectLogicalParticipantAdmissionBundle(operation.admission, frozen.attempt, operation.participant, operation.method, operation.profileRevision);
    const profile = profiles[0];
    if (profiles.length !== 1 || profile === undefined || bundle === null || profile.sources.length !== bundle.admissions.length ||
      operation.sourceRefs.length !== bundle.admissions.length || operation.attemptStart < 0 || operation.attemptEnd < operation.attemptStart ||
      operation.attemptEnd > frozen.graph.attempts.length) return yield* Effect.fail(corruption("commandInvalid"));
    if (operation.eventIntents.some(intent => intent.sourceKey !== null &&
      !operation.sourceRefs.some(reference => reference.sourceKey === intent.sourceKey)))
      return yield* Effect.fail(corruption("commandInvalid"));
    const eventIntentsBySource = new Map<string | null, typeof operation.eventIntents[number][]>();
    const preparedEvents = new Map<typeof operation.eventIntents[number], CommittedEvent>();
    for (const intent of operation.eventIntents) {
      const group = eventIntentsBySource.get(intent.sourceKey);
      if (group === undefined) eventIntentsBySource.set(intent.sourceKey, [intent]);
      else group.push(intent);
    }
    for (const [ordinal, admission] of bundle.admissions.entries()) {
      const token = profile.sources[ordinal]!, methods = bundle.sourceMethods[ordinal]!;
      const selected = inspectFiniteOperationCommitAuthority(token, admission, frozen.attempt, operation.participant, methods);
      const reference = operation.sourceRefs[ordinal];
      if (selected === null || reference === undefined || reference.sourceKey !== selected.sourceKey ||
        reference.sourceSha256Hex !== selected.sourceSha256 || reference.bindingHead.sequence !== selected.head.sequence ||
        reference.bindingHead.sha256 !== selected.head.sha256 || selected.root.principalDigest !== encodeBytesToLowercaseHex(session.identityAccessPolicySha256) ||
        selected.root.sessionId !== authorityPins.sessionId || selected.root.attemptFence !== authorityPins.attemptFence)
        return yield* Effect.fail(corruption("commandInvalid"));
      const touchedTables = new Set<CatalogTableId>();
      for (let index = operation.attemptStart; index < operation.attemptEnd; index++) {
        const attempted = frozen.graph.attempts[index]!;
        if (selected.tableIds.has(attempted.tableId)) { touchedTables.add(attempted.tableId); attributedAttempts.add(index); }
      }
      for (const tableId of selected.tableIds) nativeTables.add(tableId);
      sources.push({ token, operation, admission, methods, selected, touchedTables: Object.freeze([...touchedTables]) });
      const selectedEvents: CommittedEvent[] = [];
      for (const event of eventIntentsBySource.get(selected.sourceKey) ?? []) {
        const prepared = yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent).pipe(Result.mapError(() => corruption("commandInvalid"))));
        selectedEvents.push(prepared);
        preparedEvents.set(event, prepared);
      }
      const policies = (options.logicalParticipantEvents ?? []).filter(policy => policy.authority === token);
      if (policies.length > 1 || selectedEvents.length > 0 && policies.length !== 1) return yield* Effect.fail(corruption("commandInvalid"));
      const policy = policies[0];
      if (policy !== undefined) yield* validateAdmittedCommerceEventIntents(policy.policy, policy.selection, selectedEvents,
        admittedCommerceEventGroup({ scopeUuid: scope.scopeUuid, sessionId: authorityPins.sessionId, attemptFence: authorityPins.attemptFence }))
        .pipe(Effect.mapError(() => corruption("commandInvalid")));
    }
    const operationEvents: CommittedEvent[] = [];
    for (const event of eventIntentsBySource.get(null) ?? []) {
      const prepared = yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent).pipe(Result.mapError(() => corruption("commandInvalid"))));
      operationEvents.push(prepared);
      preparedEvents.set(event, prepared);
    }
    if (operationEvents.length > 0 && profile.operationEvents === undefined) return yield* Effect.fail(corruption("commandInvalid"));
    if (profile.operationEvents !== undefined) yield* validateAdmittedOperationEventIntents(profile.operationEvents.policy,
      profile.operationEvents.selection, operationEvents, admittedCommerceEventGroup({ scopeUuid: scope.scopeUuid,
        sessionId: authorityPins.sessionId, attemptFence: authorityPins.attemptFence })).pipe(Effect.mapError(() => corruption("commandInvalid")));
    // Source and operation policies validate their own selections above. The
    // publication preserves the producer's original interleaving across them.
    for (const intent of operation.eventIntents) {
      const prepared = preparedEvents.get(intent);
      if (prepared === undefined) return yield* Effect.fail(corruption("commandInvalid"));
      events.push(prepared);
    }
  }
  if (frozen.graph.attempts.some((attempt, ordinal) => !attributedAttempts.has(ordinal) && !applicationTables.has(attempt.tableId)))
    return yield* Effect.fail(corruption("commandInvalid"));
  const successfulResult = Object.freeze({ valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1, value: frozen.successfulResultValue,
    semanticSizeBytes: frozen.successfulResult.semanticSizeBytes, sha256Hex: frozen.successfulResult.evidence.sha256Hex,
    canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(frozen.successfulResult.canonicalBytes) });
  return Object.freeze({ authorityPins, session, executionClaim, scopeUuid: scope.scopeUuid, frozen,
    dependencies, generatedInsertions, generatedOnlyPoints, rowIntents, rowIntentsByTable: indexApplicationDocumentRowIntents({ rowIntents }), sources: Object.freeze(sources), events: Object.freeze(events),
    attemptedTableIds: Object.freeze([...applicationTables]),
    participantMaterialDocumentIds: new Set(rowIntents.filter(row => nativeTables.has(row.tableId)).map(row => row.documentId)),
    indexRangeDependencies: frozen.applicationIndexRanges, relationDependencies: frozen.applicationRelationDependencies,
    successfulResult }) satisfies PreparedFiniteCommitCommand;
}, work => observeExecution("PointCommitTransaction.prepareFiniteCommand", work));

/** Application and selected native sources may have different logical schema
 * revisions. Gather their trusted definitions before taking publication locks;
 * the locked kernel revalidates every participant binding and definition. */
export const preparePointCommitMixedDefinitions = Effect.fn("PointCommitTransaction.prepareMixedDefinitions")(
  function* (command: PreparedPointCommitTransactionCommandV1, options: PointCommitTransactionProofOptionsV1) {
    const applicationRows = command.rowIntents.filter(row => !command.participantMaterialDocumentIds.has(row.documentId));
    const applicationCommand = Object.freeze({ ...command, rowIntents: applicationRows });
    const applicationIndexes = yield* prepareDeveloperIndexDefinitions(applicationCommand, options);
    const applicationUnique = yield* prepareUniqueConstraintDefinitions(applicationCommand, options);
    const indexes = new Map(applicationIndexes.map(definition => [definition.indexDefinitionId, definition] as const));
    const unique = new Map(applicationUnique.map(definition => [definition.uniqueConstraintDefinitionId, definition] as const));
    const sourceSchemaVersionByTable = new Map<CatalogTableId, CatalogSchemaVersionId>();
    for (const operation of command.participantOperations) {
      const selectedProfile = yield* Effect.fromResult(selectLogicalOperationProfileResult(options, operation));
      for (const [ordinal, contribution] of operation.sourceContributions.entries()) {
      const selected = inspectLogicalParticipantCommitAuthority(
        selectedProfile.authorities[ordinal]!, operation, contribution);
      if (selected === null) return yield* Effect.fail(corruption("commandInvalid"));
      const touched = new Set(contribution.effects.map(effect => effect.tableId));
      const selectedDefinitions = selectPreparedPublicationDefinitions(selected.publicationDefinitions, touched);
      if (selectedDefinitions === null) return yield* Effect.fail(corruption("commandInvalid"));
      for (const tableId of touched) {
        const prior = sourceSchemaVersionByTable.get(tableId);
        if (prior !== undefined && prior !== selected.schemaVersionId) return yield* Effect.fail(corruption("commandInvalid"));
        sourceSchemaVersionByTable.set(tableId, selected.schemaVersionId);
      }
      for (const definition of selectedDefinitions.indexes) {
        if (definition.access.kind !== "developer" || !touched.has(definition.access.tableId)) continue;
        const prior = indexes.get(definition.indexDefinitionId);
        if (prior !== undefined && (prior.access.tableId !== definition.access.tableId ||
          prior.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex))
          return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
        indexes.set(definition.indexDefinitionId, definition);
      }
      for (const definition of selectedDefinitions.unique) {
        if (!touched.has(definition.tableId)) continue;
        const prior = unique.get(definition.uniqueConstraintDefinitionId);
        if (prior !== undefined && (prior.tableId !== definition.tableId ||
          prior.schemaVersionId !== definition.schemaVersionId ||
          prior.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex))
          return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
        unique.set(definition.uniqueConstraintDefinitionId, definition);
      }
      }
    }
    const developerDefinitions = Object.freeze([...indexes.values()].toSorted((a, b) => a.indexDefinitionId - b.indexDefinitionId));
    const uniqueDefinitions = Object.freeze([...unique.values()].toSorted((a, b) =>
      a.uniqueConstraintDefinitionId - b.uniqueConstraintDefinitionId));
    if (uniqueDefinitions.length > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1)
      return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
    yield* Effect.fromResult(validateApplicationUniqueTransitionBudget(command.rowIntents, uniqueDefinitions));
    return Object.freeze({ developerDefinitions, uniqueDefinitions, sourceSchemaVersionByTable });
  });

export const preparePointCommitPublicationCommand = Effect.fn(
  "PointCommitTransaction.preparePublicationCommand",
)(function* (
  input: PointCommitPublicationCommandV1,
): Effect.fn.Return<
  PreparedPointCommitPublicationCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  const command = yield* preparePointCommitCommand(input);
  const successfulResult = yield* Effect.fromResult(
    captureSuccessfulResultResult(
      input.successfulResult,
      command.sealIdentity.resultByteLength,
    ),
  );
  const canonical = yield* canonicalizeSuccessfulResultV1Effect(
    successfulResult.value,
  ).pipe(
    Effect.mapError(() => corruption("successfulResultInvalid")),
  );
  const seal = command.sealIdentity;
  if (
    successfulResult.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    canonical.evidence.valueCodecVersion !==
      successfulResult.valueCodecVersion ||
    !bytesEqual(canonical.canonicalBytes, successfulResult.canonicalBytes) ||
    canonical.semanticSizeBytes !== successfulResult.semanticSizeBytes ||
    canonical.evidence.sha256Hex !== successfulResult.sha256Hex ||
    canonical.canonicalBytes.byteLength !== seal.resultByteLength ||
    canonical.semanticSizeBytes !== seal.resultSemanticBytes ||
    canonical.evidence.sha256Hex !==
      encodeBytesToLowercaseHex(seal.resultSha256)
  ) {
    return yield* Effect.fail(corruption("successfulResultInvalid"));
  }
  const stableBytes = copyBytes(canonical.canonicalBytes);
  return Object.freeze({
    ...command,
    successfulResult: Object.freeze({
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      value: successfulResult.value,
      canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(stableBytes),
      semanticSizeBytes: canonical.semanticSizeBytes,
      sha256Hex: canonical.evidence.sha256Hex,
    }),
  });
});
