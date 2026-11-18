import { Schema, Result } from "effect";
import {
  CanonicalSessionJournalBytesSchema,
  LogicalMetadataReadDependencySchema,
  FiniteMetadataConflictSchema,
  LogicalIndexRangeReadDependencyV1Schema,
  LogicalApplicationRelationIncomingReadDependencyV1Schema,
  CommitSyscallSequenceV1Schema,
  CanonicalSuccessfulResultBytesV1Schema,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  normalizeLogicalIndexRangeReadDependenciesV1Result,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  SESSION_JOURNAL_FORMAT,
  MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
} from "flarex-protocol/commit-protocol";
import type {
  AdmittedParticipantOperation,
  LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
  LogicalReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import { EventEnvelope } from "../events/model";
import {
  CatalogTableIdSchema,
  CatalogEdgeDefinitionIdSchema,
  CatalogIndexDefinitionIdSchema,
  CatalogRelationIdSchema,
} from "flarex-protocol/catalog";
import {
  AppRowIdHexV1Schema,
  decodeAppDocumentIdentityV1Result,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import {
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
} from "flarex-protocol/ordered-index";
import type { PointCommitTransactionProofOptionsV1 } from "./constructionContracts";
import {
  inspectLogicalParticipantCommitAuthoritySource,
  hasLogicalParticipantCommitAuthority,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type { LogicalParticipantCommitAuthority } from "../../storage/documents/logicalDocuments/participantAdmission";
import { corruption } from "./errors";
import type {
  PointCommitCorruptionV1Error,
  PointCommitStaleAuthorityV1Error,
  PointCommitConflictEvidenceV1,
} from "./errors";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
} from "flarex-protocol/storage-authority";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type {
  PointCommitSuccessfulResultV1,
  PointCommitTransactionCommandV1,
  PointMutationAttemptReplacementCommandV1,
  RunningRelationConflictAttemptReplacementCommandV1,
  RunningRelationConflictRecoveryCommand,
  PointCommitFinishingTransitionCommandV1,
  PointCommitAuthorityPinsV1,
  PointCommitSessionScalarsV1,
  PointCommitSealIdentityV1,
} from "./contracts";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  isUint8ArrayWithByteLength,
  copyBytes,
  isUint8Array,
  bytesEqualFullScan as bytesEqual,
} from "@flarex/utils/bytes";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  isCanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { pointCommitCommandScopeUuid } from "./preparedCommands";
import type {
  PreparedPointCommitAuthorityCommandV1,
  PreparedPointMutationAttemptReplacementCommandV1,
  PreparedRunningRelationConflictAttemptReplacementCommandV1,
  PreparedRunningRelationConflictRecoveryCommand,
  PreparedPointCommitFinishingTransitionCommandV1,
} from "./preparedCommands";
import type { ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";
import {
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
} from "flarex-protocol/transaction-session";
import { stale } from "./sqlFailures";
import {
  pointDependenciesEqual,
  hasOwn,
} from "../../storage/materialization/materialization";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from "flarex-protocol/internal/application-schema-binding";
import {
  decodePointCommitSeqResult,
  decodePointCommitCreationTimeResult,
} from "../../storage/materialization/headEvidence";
import {
  decodeTransactionExecutionClaimOwnerV1,
  decodeTransactionExecutionClaimFenceV1,
} from "../../execution/claims/transactionExecutionClaimModel";
import type { TransactionExecutionClaimPinV1 } from "../../execution/claims/transactionExecutionClaimModel";
import type {
  PointCommitDependencyV1,
  PointCommitRowIntentV1,
  PreparedLivePointCommitRowIntentV1,
} from "../../storage/materialization/model";
import { snapshotApplicationExecutionAuthorityJson } from "../../application/applicationExecutionAuthoritySnapshot";

export const HASH_BYTE_LENGTH = 32;

export const decodePointCommitJournalBytesResult = Schema.decodeUnknownResult(
  CanonicalSessionJournalBytesSchema
);

export const decodePointCommitEventEnvelope = Schema.decodeUnknownResult(
  EventEnvelope,
  { onExcessProperty: "error" }
);

export const decodePointCommitTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);

export const decodePointCommitRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);

export const decodePointCommitSchemaVersionIdResult =
  Schema.decodeUnknownResult(Schema.toType(CatalogSchemaVersionIdSchema),);

export const decodePointCommitMetadataDependenciesEffect =
  Schema.decodeUnknownEffect(Schema.Array(LogicalMetadataReadDependencySchema));

export const decodePointCommitMetadataConflictResult =
  Schema.decodeUnknownResult(Schema.toType(FiniteMetadataConflictSchema));

export const decodePointCommitEdgeDefinitionIdResult =
  Schema.decodeUnknownResult(CatalogEdgeDefinitionIdSchema);

export const decodePointCommitEncodedRowIdResult =
  Schema.decodeUnknownResult(AppRowIdHexV1Schema);

export const decodePointCommitIndexRangeDependencyResult =
  Schema.decodeUnknownResult(LogicalIndexRangeReadDependencyV1Schema);

export const decodePointCommitRelationDependencyResult =
  Schema.decodeUnknownResult(
    Schema.toType(LogicalApplicationRelationIncomingReadDependencyV1Schema)
  );

export const decodePointCommitSyscallSequenceResult =
  Schema.decodeUnknownResult(Schema.toType(CommitSyscallSequenceV1Schema));

export const decodePointCommitEncodedTableIdResult =
  Schema.decodeUnknownResult(CatalogTableIdSchema);

export const decodePointCommitIndexDefinitionIdResult =
  Schema.decodeUnknownResult(CatalogIndexDefinitionIdSchema);

export const decodePointCommitOrderedKeyResult = Schema.decodeUnknownResult(
  OrderedIndexKeyBytesHexV1Schema
);

export const decodePointCommitOrderedRowIdResult = Schema.decodeUnknownResult(
  OrderedIndexRowIdHexV1Schema
);

export function capturePointCommitEvents(
  events: NonNullable<
    NonNullable<
      PointCommitTransactionProofOptionsV1["logicalOperationProfiles"]
    >[number]["operationEvents"]
  >
): typeof events {
  return Object.freeze({
    policy: Object.freeze({
      ...events.policy,
      allowed: new Map(events.policy.allowed),
      identity: structuredClone(events.policy.identity),
      subscribers: structuredClone(events.policy.subscribers)
    }),
    selection: Object.freeze({
      contracts: Object.freeze([...events.selection.contracts]),
      select: events.selection.select
    }),
  });
}

export function capturePointCommitTransactionProofOptionsV1(
  options: PointCommitTransactionProofOptionsV1,
): PointCommitTransactionProofOptionsV1 {
  const intrinsicCreationTimeIndexes = options.intrinsicCreationTimeIndexes;
  const developerIndexes = options.developerIndexes;
  const uniqueConstraints = options.uniqueConstraints;
  const uniqueConstraintEligibility = options.uniqueConstraintEligibility;
  const applicationRelations = options.applicationRelations;
  const candidateSchemaWriteGuard = options.candidateSchemaWriteGuard;
  const afterTransactionStep = options.afterTransactionStep;
  const observeQuery = options.observeQuery;
  const publicationObservation = options.publicationObservation;
  const logicalParticipantEvents = options.logicalParticipantEvents;
  const logicalOperationProfiles = options.logicalOperationProfiles;
  return Object.freeze({
    ...(logicalParticipantEvents === undefined
      ? {}
      : {
          logicalParticipantEvents: Object.freeze(
            logicalParticipantEvents.map(binding =>
              Object.freeze({
                authority: binding.authority,
                ...capturePointCommitEvents(binding)
              })
            )
          )
        }),
    ...(logicalOperationProfiles === undefined
      ? {}
      : {
          logicalOperationProfiles: Object.freeze(
            logicalOperationProfiles.map(profile =>
              Object.freeze({
                ...profile,
                operationMethods: Object.freeze([...profile.operationMethods]),
                sources: Object.freeze([...profile.sources]),
                ...(profile.operationEvents === undefined
                  ? {}
                  : {
                      operationEvents: capturePointCommitEvents(
                        profile.operationEvents
                      )
                    })
              })
            )
          )
        }),
    ...(intrinsicCreationTimeIndexes === undefined
      ? {}
      : { intrinsicCreationTimeIndexes }),
    ...(developerIndexes === undefined ? {} : { developerIndexes }),
    ...(uniqueConstraints === undefined ? {} : { uniqueConstraints }),
    ...(uniqueConstraintEligibility === undefined
      ? {}
      : { uniqueConstraintEligibility }),
    ...(applicationRelations === undefined ? {} : { applicationRelations }),
    ...(candidateSchemaWriteGuard === undefined
      ? {}
      : { candidateSchemaWriteGuard }),
    ...(afterTransactionStep === undefined ? {} : { afterTransactionStep }),
    ...(observeQuery === undefined ? {} : { observeQuery }),
    ...(publicationObservation === undefined ? {} : { publicationObservation }),
  });
}

export interface SelectedLogicalOperationProfile {
  readonly profile: NonNullable<
    PointCommitTransactionProofOptionsV1["logicalOperationProfiles"]
  >[number];
  readonly authorities: readonly LogicalParticipantCommitAuthority[];
  readonly applicationBindings: readonly boolean[];
}

export function selectLogicalOperationProfileResult(
  options: PointCommitTransactionProofOptionsV1,
  operation: AdmittedParticipantOperation,
): Result.Result<
  SelectedLogicalOperationProfile,
  PointCommitCorruptionV1Error
> {
  const matching = (options.logicalOperationProfiles ?? []).filter(
    profile =>
      profile.participant === operation.participant &&
      profile.operationMethods.includes(operation.method)
  );
  if (matching.length !== 1) return Result.fail(corruption("commandInvalid"));
  const profile = matching[0]!;
  if (
    profile.profileRevision !== operation.profileRevision ||
    profile.sources.length !== operation.sourceContributions.length ||
    profile.sources.length === 0
  )
    return Result.fail(corruption("commandInvalid"));
  const applicationBindings: boolean[] = [];
  for (const [ordinal, token] of profile.sources.entries()) {
    const source = inspectLogicalParticipantCommitAuthoritySource(token);
    const contribution = operation.sourceContributions[ordinal];
    if (
      source === null ||
      contribution === undefined ||
      source.sourceKey !== contribution.sourceKey ||
      source.sourceSha256 !== contribution.sourceSha256Hex ||
      source.methods.length !== contribution.methods.length ||
      source.methods.some(
        (method, position) => method !== contribution.methods[position]
      ) ||
      !hasLogicalParticipantCommitAuthority(
        token,
        operation.participant,
        contribution
      )
    ) {
      return Result.fail(corruption("commandInvalid"));
    }
    applicationBindings.push(source.applicationBindingAvailable);
  }
  return Result.succeed(
    Object.freeze({
      profile,
      authorities: profile.sources,
      applicationBindings: Object.freeze(applicationBindings)
    })
  );
}

export const RunningRelationConflictRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("relationIncoming"),
  syscallSequence: Schema.toType(CommitSyscallSequenceV1Schema),
  relationId: CatalogRelationIdSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  limit: Schema.Int,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
});

export const RunningRelationConflictRequestEvidenceV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("relationIncoming"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  relationId: CatalogRelationIdSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  limit: Schema.Int,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
});

export const RunningRelationConflictOutcomeEvidenceV1Schema = Schema.Struct({
  kind: Schema.Literal("relationConflict"),
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  expectedAdjacencyVersion: CommitSeqSchema,
  actualAdjacencyVersion: CommitSeqSchema,
  snapshotCommitSeq: CommitSeqSchema,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
});

export const decodeRunningRelationConflictRequestV1Result =
  Schema.decodeUnknownResult(RunningRelationConflictRequestV1Schema, {
    onExcessProperty: "error",
  });

export const decodeRunningRelationConflictRequestEvidenceV1Result =
  Schema.decodeUnknownResult(RunningRelationConflictRequestEvidenceV1Schema, {
    onExcessProperty: "error",
  });

export const decodeRunningRelationConflictOutcomeEvidenceV1Result =
  Schema.decodeUnknownResult(RunningRelationConflictOutcomeEvidenceV1Schema, {
    onExcessProperty: "error",
  });

export function captureSuccessfulResultResult(
  input: PointCommitSuccessfulResultV1,
  expectedByteLength: number,
): Result.Result<
  Readonly<PointCommitSuccessfulResultV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const canonicalBytes = yield* Result.try({
      try: () => input.canonicalBytes,
      catch: () => corruption("successfulResultInvalid"),
    });
    if (
      !isNonArrayRecord(input) ||
      !isUint8ArrayWithByteLength(canonicalBytes, expectedByteLength)
    ) {
      return yield* Result.fail(corruption("successfulResultInvalid"));
    }
    const stableBytes = copyBytes(canonicalBytes);
    const stableValue = yield* Result.try({
      try: () => structuredClone(input.value),
      catch: () => corruption("successfulResultInvalid"),
    });
    const scalars = yield* Result.try({
      try: () =>
        Object.freeze({
          valueCodecVersion: input.valueCodecVersion,
          semanticSizeBytes: input.semanticSizeBytes,
          sha256Hex: input.sha256Hex,
        }),
      catch: () => corruption("successfulResultInvalid"),
    });
    if (
      scalars.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      stableBytes.byteLength < 1 ||
      !isNonNegativeSafeInteger(scalars.semanticSizeBytes) ||
      typeof scalars.sha256Hex !== "string" ||
      !/^[0-9a-f]{64}$/.test(scalars.sha256Hex)
    ) {
      return yield* Result.fail(corruption("successfulResultInvalid"));
    }
    return Object.freeze({
      valueCodecVersion: scalars.valueCodecVersion,
      value: stableValue,
      get canonicalBytes(): PointCommitSuccessfulResultV1["canonicalBytes"] {
        return CanonicalSuccessfulResultBytesV1Schema.make(
          copyBytes(stableBytes),
        );
      },
      semanticSizeBytes: scalars.semanticSizeBytes,
      sha256Hex: scalars.sha256Hex,
    });
  });
}

export function captureCommittedOutcomeLookup(
  command: PreparedPointCommitAuthorityCommandV1,
): ResolveCommittedPointOutcomeInputV1 {
  return Object.freeze({
    scopeUuid: pointCommitCommandScopeUuid(command),
    requestKey: command.authorityPins.requestKey,
    expectedIdentityAccessPolicySha256:
      TransactionIdentityAccessPolicySha256V1Schema.make(
        copyBytes(command.session.identityAccessPolicySha256,
      )) ,
    expectedFunctionPath: command.authorityPins.functionPath,
    expectedRequestSha256: TransactionRequestSha256V1Schema.make(
      copyBytes(command.session.requestSha256,
    )) ,
  });
}

export function capturePointCommitCommandResult(
  input: PointCommitTransactionCommandV1,
): Result.Result<
  PointCommitTransactionCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const sealIdentity = yield* captureSealIdentityResult(input.sealIdentity);
    yield* requireCommandAuthorityConsistencyResult(
      authorityPins,
      session,
      sealIdentity,
    );
    const dependencies = yield* capturePointCommitDependenciesResult(
      input.dependencies,
      input.journalBytes === undefined
        ? sealIdentity.pointDependencyCount
        : undefined,
    );
    const indexRangeDependencies =
      yield* capturePointCommitIndexRangeDependenciesResult(
        input.indexRangeDependencies,
        sealIdentity.indexRangeDependencyCount,
        sealIdentity.indexRangeDependencyEvidenceBytes,
      );
    const relationDependencies =
      yield* capturePointCommitRelationDependenciesResult(
        input.relationDependencies,
        sealIdentity.relationDependencyCount,
        authorityPins.snapshotToken.commitSeq,
      );
    const rowIntents = yield* captureRowIntentsResult(input.rowIntents);
    const journalBytes =
      input.journalBytes === undefined
        ? undefined
        : yield* decodePointCommitJournalBytesResult(input.journalBytes).pipe(
            Result.map(copyBytes),
            Result.mapError(() => corruption("commandInvalid"))
          );
    for (const rowIntent of rowIntents) {
      if (
        journalBytes === undefined &&
        !dependencies.some((dependency) =>
          pointDependenciesEqual(dependency, rowIntent),
        )
      ) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
    }
    return Object.freeze({
      authorityPins,
      session,
      sealIdentity,
      dependencies,
      indexRangeDependencies,
      relationDependencies,
      rowIntents,
      ...(journalBytes === undefined ? {} : { journalBytes }),
      ...(input.candidatePlanningHead === undefined
        ? {}
        : { candidatePlanningHead: input.candidatePlanningHead }),
    });
  });
}

export function capturePointMutationAttemptReplacementCommandResult(
  input: PointMutationAttemptReplacementCommandV1,
): Result.Result<
  PreparedPointMutationAttemptReplacementCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const sealIdentity = yield* captureSealIdentityResult(input.sealIdentity);
    yield* requireCommandAuthorityConsistencyResult(
      authorityPins,
      session,
      sealIdentity,
    );
    const dependencies = yield* capturePointCommitDependenciesResult(
      input.dependencies,
      undefined,
    );
    const indexRangeDependencies =
      yield* capturePointCommitIndexRangeDependenciesResult(
        input.indexRangeDependencies,
        sealIdentity.indexRangeDependencyCount,
        sealIdentity.indexRangeDependencyEvidenceBytes,
      );
    const relationDependencies =
      yield* capturePointCommitRelationDependenciesResult(
        input.relationDependencies,
        sealIdentity.relationDependencyCount,
        authorityPins.snapshotToken.commitSeq,
      );
    const expectedConflict = yield* capturePointCommitConflictEvidenceResult(
      input.expectedConflict,
      authorityPins.snapshotToken.commitSeq,
      dependencies,
      indexRangeDependencies,
      relationDependencies,
    );
    return Object.freeze({
      authorityPins,
      session,
      sealIdentity,
      dependencies,
      indexRangeDependencies,
      relationDependencies,
      expectedConflict,
    });
  });
}

export function captureRunningRelationConflictAttemptReplacementCommandResult(
  input: RunningRelationConflictAttemptReplacementCommandV1,
): Result.Result<
  PreparedRunningRelationConflictAttemptReplacementCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  return Result.gen(function* () {
    const base =
      yield* captureRunningRelationConflictRecoveryCommandResult(input,);
    const requestInput = yield* Result.try({
      try: () => structuredClone(input.request),
      catch: () => corruption("commandInvalid"),
    });
    const request = yield* decodeRunningRelationConflictRequestV1Result(
      requestInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      request.limit < 1 ||
      request.limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const conflict = yield* Result.try({
      try: () => structuredClone(input.conflict),
      catch: () => corruption("commandInvalid"),
    });
    if (!isNonArrayRecord(conflict) || conflict.kind !== "relationConflict") {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const edgeDefinitionId = yield* decodePointCommitEdgeDefinitionIdResult(
      conflict.edgeDefinitionId
    ).pipe(Result.mapError(() => corruption("commandInvalid")),);
    const targetRowId = yield* decodePointCommitEncodedRowIdResult(
      conflict.targetRowId
    ).pipe(Result.mapError(() => corruption("commandInvalid")),);
    const expectedAdjacencyVersion = yield* decodePointCommitSeqResult(
      conflict.expectedAdjacencyVersion,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const actualAdjacencyVersion = yield* decodePointCommitSeqResult(
      conflict.actualAdjacencyVersion,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const snapshotCommitSeq = yield* decodePointCommitSeqResult(
      conflict.snapshotCommitSeq,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      snapshotCommitSeq !== base.authorityPins.snapshotToken.commitSeq ||
      expectedAdjacencyVersion > snapshotCommitSeq ||
      actualAdjacencyVersion <= snapshotCommitSeq ||
      request.edgeDefinitionId !== edgeDefinitionId ||
      request.targetRowId !== targetRowId
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return Object.freeze({
      ...base,
      request: Object.freeze({ ...request }),
      conflict: Object.freeze({
        kind: "relationConflict" as const,
        edgeDefinitionId,
        targetRowId,
        expectedAdjacencyVersion,
        actualAdjacencyVersion,
        snapshotCommitSeq,
      }),
    });
  });
}

export function captureRunningRelationConflictRecoveryCommandResult(
  input: RunningRelationConflictRecoveryCommand,
): Result.Result<
  PreparedRunningRelationConflictRecoveryCommand,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (input.session.lifecycle !== "running") {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const scopeUuid = (yield* projectScopeIdUuidV1Result(
      authorityPins.scopeId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")))).scopeUuid;
    if (
      authorityPins.storageGeneration !== session.storageGeneration ||
      authorityPins.storageGenerationFence !== session.storageGenerationFence ||
      !commandExecutionAuthorityConsistent(authorityPins, session) ||
      authorityPins.functionPath !== session.functionPath ||
      authorityPins.functionKind !== session.functionKind ||
      authorityPins.schemaVersionId !== session.schemaVersionId ||
      authorityPins.policyVersion !== session.policyVersion ||
      authorityPins.authorizationRevocationEpoch !==
        session.authorizationRevocationEpoch ||
      authorityPins.requestKey !== session.requestKey
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const claimOwner = yield* decodeTransactionExecutionClaimOwnerV1(
      input.executionClaim.claimOwner,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const claimFence = yield* decodeTransactionExecutionClaimFenceV1(
      input.executionClaim.claimFence,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    return Object.freeze({
      authorityPins,
      session: Object.freeze({ ...session, lifecycle: "running" as const }),
      scopeUuid,
      executionClaim: Object.freeze({ claimOwner, claimFence }),
    });
  });
}

export function capturePointCommitIndexRangeDependenciesResult(
  input: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  expectedCount: number,
  expectedEvidenceBytes: number,
): Result.Result<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  PointCommitCorruptionV1Error
> {
  if (
    !Array.isArray(input) ||
    input.length !== expectedCount ||
    input.length > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: LogicalIndexRangeReadDependencyV1[] = [];
    let evidenceBytes = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const dependency = yield* decodePointCommitIndexRangeDependencyResult(
        input[index]
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      captured.push(dependency);
      evidenceBytes +=
        yield* measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result(
          dependency,
        ).pipe(Result.mapError(() => corruption("commandInvalid")));
    }
    if (
      evidenceBytes !== expectedEvidenceBytes ||
      evidenceBytes > MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const normalized =
      yield* normalizeLogicalIndexRangeReadDependenciesV1Result(captured,).pipe(
        Result.mapError(() => corruption("commandInvalid"))
      );
    if (
      normalized.length !== captured.length ||
      normalized.some(
        (dependency, index) =>
          !indexRangeDependenciesEqual(dependency, captured[index])
      )
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return normalized;
  });
}

export function indexRangeDependenciesEqual(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1 | undefined,
): boolean {
  return right !== undefined &&
    left.tableId === right.tableId &&
    left.indexDefinitionId === right.indexDefinitionId &&
    left.keyCodecVersion === right.keyCodecVersion &&
    left.physicalSpecSha256Hex === right.physicalSpecSha256Hex &&
    left.direction === right.direction &&
    indexRangeLowerBoundsEqual(left.lower, right.lower) &&
    indexRangeUpperBoundsEqual(left.upper, right.upper);
}

export function capturePointCommitRelationDependenciesResult(
  input: ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  expectedCount: number,
  snapshotCommitSeq: CommitSeq,
): Result.Result<
  ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  PointCommitCorruptionV1Error
> {
  if (
    !Array.isArray(input) ||
    input.length !== expectedCount ||
    input.length > MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: LogicalApplicationRelationIncomingReadDependencyV1[] = [];
    let activeSelection:
      | Pick<
          LogicalApplicationRelationIncomingReadDependencyV1,
          "activationSequence" | "activeHeadSha256Hex"
        >
      | undefined;
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const dependency = yield* decodePointCommitRelationDependencyResult(
        input[index]
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      const previous = captured.at(-1);
      if (
        dependency.observedAdjacencyVersion > snapshotCommitSeq ||
        (activeSelection !== undefined &&
          (dependency.activationSequence !==
            activeSelection.activationSequence ||
            dependency.activeHeadSha256Hex !==
              activeSelection.activeHeadSha256Hex)) ||
        (previous !== undefined &&
          comparePointCommitRelationDependencies(previous, dependency) >= 0)
      ) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      activeSelection ??= dependency;
      captured.push(dependency);
    }
    return Object.freeze(captured);
  });
}

export function comparePointCommitRelationDependencies(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): number {
  if (left.edgeDefinitionId !== right.edgeDefinitionId) {
    return left.edgeDefinitionId - right.edgeDefinitionId;
  }
  return left.targetRowId < right.targetRowId
    ? -1
    : left.targetRowId > right.targetRowId
      ? 1
      : 0;
}

export function indexRangeLowerBoundsEqual(
  left: LogicalIndexRangeReadDependencyV1["lower"],
  right: LogicalIndexRangeReadDependencyV1["lower"],
): boolean {
  return left === null
    ? right === null
    : right !== null && left.encodedKey === right.encodedKey;
}

export function indexRangeUpperBoundsEqual(
  left: LogicalIndexRangeReadDependencyV1["upper"],
  right: LogicalIndexRangeReadDependencyV1["upper"],
): boolean {
  if (left === null) return right === null;
  if (right === null || left.kind !== right.kind) return false;
  if (left.encodedKey !== right.encodedKey) return false;
  return left.kind === "key" ||
    (right.kind === "position" && left.rowId === right.rowId);
}

export function capturePointCommitConflictEvidenceResult(
  input: PointCommitConflictEvidenceV1,
  expectedSnapshotCommitSeq: CommitSeq,
  pointDependencies: ReadonlyArray<PointCommitDependencyV1>,
  indexRangeDependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  relationDependencies: ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
): Result.Result<PointCommitConflictEvidenceV1, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const captured = yield* Result.try({
      try: () => structuredClone(input),
      catch: () => corruption("commandInvalid"),
    });
    if (
      !isNonArrayRecord(captured) ||
      captured.snapshotCommitSeq !== expectedSnapshotCommitSeq ||
      !isNonArrayRecord(captured.conflict)
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const cause = captured.conflict;
    const currentCommitSeq = yield* decodePointCommitSeqResult(
      captured.currentCommitSeq,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      currentCommitSeq < expectedSnapshotCommitSeq ||
      currentCommitSeq === expectedSnapshotCommitSeq &&
        cause.kind !== "metadata")
     {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    if (cause.kind === "appRowPoint") {
      const identity = yield* decodeAppDocumentIdentityV1Result(
        cause.documentId,
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      if (
        !pointDependencies.some(
          (dependency) => dependency.documentId === identity.id
        )
      ) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      return Object.freeze({
        conflict: Object.freeze({
          kind: "appRowPoint",
          documentId: identity.id,
        }),
        snapshotCommitSeq: expectedSnapshotCommitSeq,
        currentCommitSeq,
      });
    }
    if (cause.kind === "appRelationIncoming") {
      const edgeDefinitionId = yield* decodePointCommitEdgeDefinitionIdResult(
        cause.edgeDefinitionId
      ).pipe(Result.mapError(() => corruption("commandInvalid")),);
      const targetRowId = yield* decodePointCommitRowIdResult(
        cause.targetRowId,
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      if (
        !relationDependencies.some(
          (dependency) =>
            dependency.edgeDefinitionId === edgeDefinitionId &&
            dependency.targetRowId === targetRowId
        )
      ) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      return Object.freeze({
        conflict: Object.freeze({
          kind: "appRelationIncoming",
          edgeDefinitionId,
          targetRowId,
        }),
        snapshotCommitSeq: expectedSnapshotCommitSeq,
        currentCommitSeq,
      });
    }
    if (cause.kind === "logicalParticipant") {
      const syscallSequence = yield* decodePointCommitSyscallSequenceResult(
        cause.syscallSequence
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      if (
        typeof cause.participant !== "string" ||
        cause.participant.length === 0
      )
        return yield* Result.fail(corruption("commandInvalid"));
      return Object.freeze({
        conflict: Object.freeze({
          kind: "logicalParticipant",
          participant: cause.participant,
          syscallSequence
        }),
        snapshotCommitSeq: expectedSnapshotCommitSeq,
        currentCommitSeq
      });
    }
    if (cause.kind === "metadata") {
      const witness = yield* decodePointCommitMetadataConflictResult(
        cause
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      return Object.freeze({
        conflict: Object.freeze(witness),
        snapshotCommitSeq: expectedSnapshotCommitSeq,
        currentCommitSeq
      });
    }
    if (
      cause.kind !== "appIndexRange" ||
      (cause.reason !== "overlap" &&
        cause.reason !== "validationWindowExceeded") ||
      !isNonNegativeSafeInteger(cause.dependencyOrdinal) ||
      (cause.reason === "overlap" &&
        (typeof cause.encodedKey !== "string" ||
          typeof cause.rowId !== "string"))
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const tableId = yield* decodePointCommitEncodedTableIdResult(
      cause.tableId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const indexDefinitionId = yield* decodePointCommitIndexDefinitionIdResult(
      cause.indexDefinitionId
    ).pipe(Result.mapError(() => corruption("commandInvalid")),);
    const dependency = indexRangeDependencies[cause.dependencyOrdinal];
    if (
      dependency === undefined ||
      dependency.tableId !== tableId ||
      dependency.indexDefinitionId !== indexDefinitionId
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const overlap =
      cause.reason === "overlap"
        ? Result.all({
            encodedKey: decodePointCommitOrderedKeyResult(cause.encodedKey),
            rowId: decodePointCommitOrderedRowIdResult(cause.rowId),
          }).pipe(Result.mapError(() => corruption("commandInvalid")))
        : Result.succeed(undefined);
    const overlapEvidence = yield* overlap;
    return Object.freeze({
      conflict: Object.freeze({
        kind: "appIndexRange",
        reason: cause.reason,
        dependencyOrdinal: cause.dependencyOrdinal,
        tableId,
        indexDefinitionId,
        ...(overlapEvidence === undefined ? {} : overlapEvidence),
      }),
      snapshotCommitSeq: expectedSnapshotCommitSeq,
      currentCommitSeq,
    });
  });
}

export function capturePointCommitDependenciesResult(
  input: ReadonlyArray<PointCommitDependencyV1>,
  expectedCount: number | undefined,
): Result.Result<
  ReadonlyArray<PointCommitDependencyV1>,
  PointCommitCorruptionV1Error
> {
  if (!Array.isArray(input)) {
    return Result.fail(corruption("commandInvalid"));
  }
  const dependencyCount = input.length;
  if (
    dependencyCount > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    expectedCount !== undefined && dependencyCount !== expectedCount)
   {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: PointCommitDependencyV1[] = [];
    for (let index = 0; index < dependencyCount; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const dependency = input[index];
      if (dependency === undefined) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      captured.push(yield* capturePointDependencyResult(dependency));
    }
    if (expectedCount !== undefined && captured.length !== expectedCount) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependencies = Object.freeze(captured);
    yield* requireCanonicalDependencyOrderResult(dependencies);
    return dependencies;
  });
}

export function capturePointCommitFinishingTransitionCommandResult(
  input: PointCommitFinishingTransitionCommandV1,
): Result.Result<
  PreparedPointCommitFinishingTransitionCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (
    input.session.lifecycle !== "running" ||
    input.sealIdentity.lifecycle !== "running"
  ) {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const sealIdentity = yield* captureSealIdentityResult(input.sealIdentity);
    const executionClaim = yield* captureExecutionClaimPinResult(
      input.executionClaim,
    );
    yield* requireCommandAuthorityConsistencyResult(
      authorityPins,
      session,
      sealIdentity,
    );
    return Object.freeze({
      authorityPins,
      session: Object.freeze({ ...session, lifecycle: "running" as const }),
      sealIdentity: Object.freeze({
        ...sealIdentity,
        lifecycle: "running" as const,
      }),
      executionClaim,
    });
  });
}

export function captureExecutionClaimPinResult(
  input: TransactionExecutionClaimPinV1,
): Result.Result<TransactionExecutionClaimPinV1, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const fields = yield* Result.try({
      try: () =>
        Object.freeze({
          owner: input.claimOwner,
          fence: input.claimFence,
        }),
      catch: () => corruption("commandInvalid"),
    });
    const owner = yield* decodeTransactionExecutionClaimOwnerV1(
      fields.owner,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const fence = yield* decodeTransactionExecutionClaimFenceV1(
      fields.fence,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    return Object.freeze({
      claimOwner: owner,
      claimFence: fence,
    });
  });
}

export function captureAuthorityPinsResult(
  input: PointCommitAuthorityPinsV1,
): Result.Result<
  Readonly<PointCommitAuthorityPinsV1>,
  PointCommitCorruptionV1Error
> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.snapshotToken.scopeId !== input.scopeId ||
    input.snapshotToken.commitSeq < 0n ||
    input.functionKind !== "mutation"
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  if (input.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (hasOwn(input, "applicationExecutionAuthoritySha256")) {
      return Result.fail(corruption("commandInvalid"));
    }
    return Result.succeed(
      Object.freeze({
        executionAuthorityGeneration: "legacy_dynamic_worker_v1",
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        sessionId: input.sessionId,
        attemptFence: input.attemptFence,
        storageGeneration: input.storageGeneration,
        storageGenerationFence: input.storageGenerationFence,
        snapshotToken: Object.freeze({ ...input.snapshotToken }),
        schemaVersionId: input.schemaVersionId,
        packageId: input.packageId,
        artifactRuntime: input.artifactRuntime,
        artifactId: input.artifactId,
        sourcePackageHash: input.sourcePackageHash,
        executionModule: input.executionModule,
        functionPath: input.functionPath,
        functionKind: input.functionKind,
        policyVersion: input.policyVersion,
        authorizationRevocationEpoch: input.authorizationRevocationEpoch,
        requestKey: input.requestKey,
      })
    );
  }
  if (
    input.executionAuthorityGeneration !== "application_v1" ||
    hasAnyOwn(input, LEGACY_EXECUTION_AUTHORITY_FIELDS) ||
    !validHash(input.applicationExecutionAuthoritySha256)
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.succeed(
    Object.freeze({
      executionAuthorityGeneration: "application_v1",
      deploymentId: input.deploymentId,
      scopeId: input.scopeId,
      sessionId: input.sessionId,
      attemptFence: input.attemptFence,
      storageGeneration: input.storageGeneration,
      storageGenerationFence: input.storageGenerationFence,
      snapshotToken: Object.freeze({ ...input.snapshotToken }),
      schemaVersionId: input.schemaVersionId,
      applicationExecutionAuthoritySha256: new Uint8Array(
        input.applicationExecutionAuthoritySha256,
      ),
      functionPath: input.functionPath,
      functionKind: input.functionKind,
      policyVersion: input.policyVersion,
      authorizationRevocationEpoch: input.authorizationRevocationEpoch,
      requestKey: input.requestKey,
    }) satisfies Readonly<PointCommitAuthorityPinsV1>
  );
}

export function captureSessionScalarsResult(
  input: PointCommitSessionScalarsV1,
): Result.Result<
  Readonly<PointCommitSessionScalarsV1>,
  PointCommitCorruptionV1Error
> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.validatedArgsValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.authorizationGrantValueCodecVersion !==
      FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    !isPositiveSafeInteger(input.validatedArgsCanonicalByteLength) ||
    !isPositiveSafeInteger(input.authorizationGrantCanonicalByteLength) ||
    !validHash(input.identityAccessPolicySha256) ||
    !validHash(input.validatedArgsSha256) ||
    !validHash(input.authorizationGrantSha256) ||
    !validHash(input.requestSha256) ||
    !validEpochMilliseconds(input.authorizationGrantExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.hardExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.createdAtMilliseconds) ||
    !validEpochMilliseconds(input.updatedAtMilliseconds) ||
    input.updatedAtMilliseconds < input.createdAtMilliseconds ||
    input.hardExpiresAtMilliseconds >
      input.authorizationGrantExpiresAtMilliseconds
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  if (input.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (hasAnyOwn(input, APPLICATION_EXECUTION_AUTHORITY_FIELDS)) {
      return Result.fail(corruption("commandInvalid"));
    }
    return Result.succeed(
      Object.freeze({
        executionAuthorityGeneration: "legacy_dynamic_worker_v1",
        lifecycle: input.lifecycle,
        storageGeneration: input.storageGeneration,
        storageGenerationFence: input.storageGenerationFence,
        packageId: input.packageId,
        artifactRuntime: input.artifactRuntime,
        artifactId: input.artifactId,
        sourcePackageHash: input.sourcePackageHash,
        executionModule: input.executionModule,
        functionPath: input.functionPath,
        functionKind: input.functionKind,
        schemaVersionId: input.schemaVersionId,
        policyVersion: input.policyVersion,
        identityAccessPolicySha256: new Uint8Array(
          input.identityAccessPolicySha256
        ),
        validatedArgsValueCodecVersion: input.validatedArgsValueCodecVersion,
        validatedArgsCanonicalByteLength:
          input.validatedArgsCanonicalByteLength,
        validatedArgsSha256: new Uint8Array(input.validatedArgsSha256),
        authorizationGrantId: input.authorizationGrantId,
        authorizationGrantValueCodecVersion:
          input.authorizationGrantValueCodecVersion,
        authorizationGrantCanonicalByteLength:
          input.authorizationGrantCanonicalByteLength,
        authorizationGrantSha256: new Uint8Array(
          input.authorizationGrantSha256
        ),
        authorizationRevocationEpoch: input.authorizationRevocationEpoch,
        authorizationGrantExpiresAtMilliseconds:
          input.authorizationGrantExpiresAtMilliseconds,
        requestKey: input.requestKey,
        requestSha256: new Uint8Array(input.requestSha256),
        protocolVersion: input.protocolVersion,
        hardExpiresAtMilliseconds: input.hardExpiresAtMilliseconds,
        createdAtMilliseconds: input.createdAtMilliseconds,
        updatedAtMilliseconds: input.updatedAtMilliseconds,
      })
    );
  }
  if (
    input.executionAuthorityGeneration !== "application_v1" ||
    hasAnyOwn(input, LEGACY_EXECUTION_AUTHORITY_FIELDS) ||
    !validHash(input.applicationExecutionAuthoritySha256) ||
    !isUint8Array(input.applicationExecutionAuthorityCanonicalBytes)
  )
    return Result.fail(corruption("commandInvalid"));
  return Result.try({
    try: () =>
      Object.freeze({
        executionAuthorityGeneration: "application_v1" as const,
        lifecycle: input.lifecycle,
        storageGeneration: input.storageGeneration,
        storageGenerationFence: input.storageGenerationFence,
        applicationExecutionAuthorityJson:
          snapshotApplicationExecutionAuthorityJson(
            input.applicationExecutionAuthorityJson,
          ),
        applicationExecutionAuthorityCanonicalBytes: new Uint8Array(
          input.applicationExecutionAuthorityCanonicalBytes,
        ),
        applicationExecutionAuthoritySha256: new Uint8Array(
          input.applicationExecutionAuthoritySha256,
        ),
        functionPath: input.functionPath,
        functionKind: input.functionKind,
        schemaVersionId: input.schemaVersionId,
        policyVersion: input.policyVersion,
        identityAccessPolicySha256: new Uint8Array(
          input.identityAccessPolicySha256
        ),
        validatedArgsValueCodecVersion: input.validatedArgsValueCodecVersion,
        validatedArgsCanonicalByteLength:
          input.validatedArgsCanonicalByteLength,
        validatedArgsSha256: new Uint8Array(input.validatedArgsSha256),
        authorizationGrantId: input.authorizationGrantId,
        authorizationGrantValueCodecVersion:
          input.authorizationGrantValueCodecVersion,
        authorizationGrantCanonicalByteLength:
          input.authorizationGrantCanonicalByteLength,
        authorizationGrantSha256: new Uint8Array(
          input.authorizationGrantSha256
        ),
        authorizationRevocationEpoch: input.authorizationRevocationEpoch,
        authorizationGrantExpiresAtMilliseconds:
          input.authorizationGrantExpiresAtMilliseconds,
        requestKey: input.requestKey,
        requestSha256: new Uint8Array(input.requestSha256),
        protocolVersion: input.protocolVersion,
        hardExpiresAtMilliseconds: input.hardExpiresAtMilliseconds,
        createdAtMilliseconds: input.createdAtMilliseconds,
        updatedAtMilliseconds: input.updatedAtMilliseconds,
      }) satisfies Readonly<PointCommitSessionScalarsV1>,
    catch: () => corruption("commandInvalid"),
  });
}

export const LEGACY_EXECUTION_AUTHORITY_FIELDS = [
  "packageId",
  "artifactRuntime",
  "artifactId",
  "sourcePackageHash",
  "executionModule",
] as const;

export const APPLICATION_EXECUTION_AUTHORITY_FIELDS = [
  "applicationExecutionAuthorityJson",
  "applicationExecutionAuthorityCanonicalBytes",
  "applicationExecutionAuthoritySha256",
] as const;

export function hasAnyOwn<T extends object>(
  value: T,
  fields: ReadonlyArray<PropertyKey>,
): boolean {
  return fields.some(field => hasOwn(value, field));
}

export function captureSealIdentityResult(
  input: PointCommitSealIdentityV1,
): Result.Result<
  Readonly<PointCommitSealIdentityV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const creationTimeSeedInput = yield* readPointCommitCommandFieldResult(
      () => input.creationTimeSeed,
    );
    const creationTimeSeed = yield* decodePointCommitCreationTimeResult(
      creationTimeSeedInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const nextCreationTimeInput = yield* readPointCommitCommandFieldResult(
      () => input.nextCreationTime,
    );
    const nextCreationTime = yield* decodePointCommitCreationTimeResult(
      nextCreationTimeInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      input.journalFormat !== SESSION_JOURNAL_FORMAT ||
      input.journalProtocolVersion !==
        TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
      input.journalValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      input.resultValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      input.finalSyscallSequence < 0n ||
      nextCreationTime < creationTimeSeed ||
      !isPositiveSafeInteger(input.journalByteLength) ||
      !isPositiveSafeInteger(input.resultByteLength) ||
      !isNonNegativeSafeInteger(input.resultSemanticBytes) ||
      !isNonNegativeSafeInteger(input.readDocuments) ||
      !isNonNegativeSafeInteger(input.readSemanticBytes) ||
      !isNonNegativeSafeInteger(input.pointDependencyCount) ||
      !isNonNegativeSafeInteger(input.indexedQuerySyscalls) ||
      !isNonNegativeSafeInteger(input.indexRangeDependencyCount) ||
      input.indexRangeDependencyCount >
        MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 ||
      !isNonNegativeSafeInteger(input.indexRangeDependencyEvidenceBytes) ||
      input.indexRangeDependencyEvidenceBytes >
        MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1 ||
      !isNonNegativeSafeInteger(input.relationReadSyscalls) ||
      input.relationReadSyscalls > MAX_COMMIT_RELATION_READ_SYSCALLS_V1 ||
      !isNonNegativeSafeInteger(input.relationDependencyCount) ||
      input.relationDependencyCount >
        MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 ||
      !isNonNegativeSafeInteger(input.relationBaseOccurrences) ||
      input.relationBaseOccurrences > MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 ||
      !isNonNegativeSafeInteger(input.writeOperations) ||
      !isNonNegativeSafeInteger(input.writeSemanticBytes) ||
      !isNonNegativeSafeInteger(input.materialWriteEventEvidenceBytes) ||
      !isNonNegativeSafeInteger(input.receiptEvidenceBytes) ||
      !isNonNegativeSafeInteger(input.participantWorkBytes) ||
      !isNonNegativeSafeInteger(input.participantWorkCalls) ||
      !validHash(input.journalSha256) ||
      !validHash(input.resultSha256) ||
      !validEpochMilliseconds(input.sessionUpdatedAtMilliseconds) ||
      !validEpochMilliseconds(input.leaseExpiresAtMilliseconds) ||
      !validEpochMilliseconds(input.rootCreatedAtMilliseconds) ||
      !validEpochMilliseconds(input.rootUpdatedAtMilliseconds) ||
      !validEpochMilliseconds(input.sealedAtMilliseconds) ||
      input.rootUpdatedAtMilliseconds < input.rootCreatedAtMilliseconds ||
      input.sealedAtMilliseconds < input.rootCreatedAtMilliseconds
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return Object.freeze({
      ...input,
      creationTimeSeed,
      nextCreationTime,
      journalSha256: new Uint8Array(input.journalSha256),
      resultSha256: new Uint8Array(input.resultSha256),
    });
  });
}

export function requireCommandAuthorityConsistencyResult(
  pins: Readonly<PointCommitAuthorityPinsV1>,
  session: Readonly<PointCommitSessionScalarsV1>,
  seal: Readonly<PointCommitSealIdentityV1>,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const projectedScopeUuid = (yield* projectScopeIdUuidV1Result(
      pins.scopeId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")))).scopeUuid;
    if (
      seal.scopeUuid !== projectedScopeUuid ||
      seal.sessionUpdatedAtMilliseconds !== session.updatedAtMilliseconds ||
      seal.leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds ||
      pins.storageGeneration !== session.storageGeneration ||
      pins.storageGenerationFence !== session.storageGenerationFence ||
      !commandExecutionAuthorityConsistent(pins, session) ||
      pins.functionPath !== session.functionPath ||
      pins.functionKind !== session.functionKind ||
      pins.schemaVersionId !== session.schemaVersionId ||
      pins.policyVersion !== session.policyVersion ||
      pins.authorizationRevocationEpoch !==
        session.authorizationRevocationEpoch ||
      pins.requestKey !== session.requestKey
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
  });
}

export function commandExecutionAuthorityConsistent(
  pins: Readonly<PointCommitAuthorityPinsV1>,
  session: Readonly<PointCommitSessionScalarsV1>,
): boolean {
  if (
    pins.executionAuthorityGeneration !== session.executionAuthorityGeneration
  ) {
    return false;
  }
  if (
    pins.executionAuthorityGeneration === "legacy_dynamic_worker_v1" &&
    session.executionAuthorityGeneration === "legacy_dynamic_worker_v1"
  ) {
    return pins.packageId === session.packageId &&
      pins.artifactRuntime === session.artifactRuntime &&
      pins.artifactId === session.artifactId &&
      pins.sourcePackageHash === session.sourcePackageHash &&
      pins.executionModule === session.executionModule;
  }
  return pins.executionAuthorityGeneration === "application_v1" &&
    session.executionAuthorityGeneration === "application_v1" &&
    bytesEqual(
      pins.applicationExecutionAuthoritySha256,
      session.applicationExecutionAuthoritySha256,
    );
}

export function capturePointDependencyResult(
  input: PointCommitDependencyV1,
): Result.Result<
  Readonly<PointCommitDependencyV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const tableIdInput = yield* readPointCommitCommandFieldResult(
      () => input.tableId,
    );
    const tableId = yield* decodePointCommitTableIdResult(tableIdInput).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const rowIdInput = yield* readPointCommitCommandFieldResult(
      () => input.rowId,
    );
    const rowId = yield* decodePointCommitRowIdResult(rowIdInput).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const documentIdInput = yield* readPointCommitCommandFieldResult(
      () => input.documentId,
    );
    const identity = yield* decodeAppDocumentIdentityV1Result(
      documentIdInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (identity.tableId !== tableId || identity.rowId !== rowId) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependencyInput = yield* readPointCommitCommandFieldResult(
      () => input.dependency,
    );
    const dependencyKind = yield* readPointCommitCommandFieldResult(
      () => dependencyInput.kind,
    );
    if (dependencyKind !== "appRowPoint") {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependencyDocumentId = yield* readPointCommitCommandFieldResult(
      () => dependencyInput.documentId,
    );
    if (dependencyDocumentId !== identity.id) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependency = yield* captureLogicalDependencyResult(dependencyInput);
    return Object.freeze({
      documentId: identity.id,
      tableId,
      rowId,
      dependency,
    });
  });
}

export const INVALID_LOGICAL_DEPENDENCY = Symbol("InvalidLogicalDependency");

export function captureLogicalDependencyResult(
  input: Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
): Result.Result<
  Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
  PointCommitCorruptionV1Error
> {
  const captured: Result.Result<
    | Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>
    | typeof INVALID_LOGICAL_DEPENDENCY,
    PointCommitCorruptionV1Error
  > = Result.try({
    try: () => {
      switch (input.observed.kind) {
        case "present":
          return Object.freeze({
            kind: "appRowPoint",
            documentId: input.documentId,
            observed: Object.freeze({
              kind: "present",
              revisionCommitSeq: input.observed.revisionCommitSeq,
            }),
          } satisfies Extract<
            LogicalReadDependencyV1,
            { readonly kind: "appRowPoint" }
          >);
        case "missing":
          switch (input.observed.basis.kind) {
            case "noVisibleRevision":
              return Object.freeze({
                kind: "appRowPoint",
                documentId: input.documentId,
                observed: Object.freeze({
                  kind: "missing",
                  basis: Object.freeze({ kind: "noVisibleRevision" }),
                }),
              } satisfies Extract<
                LogicalReadDependencyV1,
                { readonly kind: "appRowPoint" }
              >);
            case "tombstone":
              return Object.freeze({
                kind: "appRowPoint",
                documentId: input.documentId,
                observed: Object.freeze({
                  kind: "missing",
                  basis: Object.freeze({
                    kind: "tombstone",
                    revisionCommitSeq: input.observed.basis.revisionCommitSeq,
                  }),
                }),
              } satisfies Extract<
                LogicalReadDependencyV1,
                { readonly kind: "appRowPoint" }
              >);
            default:
              return INVALID_LOGICAL_DEPENDENCY;
          }
        default:
          return INVALID_LOGICAL_DEPENDENCY;
      }
    },
    catch: () => corruption("commandInvalid"),
  });
  return captured.pipe(
    Result.flatMap((dependency) =>
      dependency === INVALID_LOGICAL_DEPENDENCY
        ? Result.fail(corruption("commandInvalid"))
        : Result.succeed(dependency)
    )
  );
}

export function readPointCommitCommandFieldResult<Value>(
  read: () => Value,
): Result.Result<Value, PointCommitCorruptionV1Error> {
  return Result.try({
    try: read,
    catch: () => corruption("commandInvalid"),
  });
}

export function captureRowIntentResult(
  input: PointCommitRowIntentV1,
): Result.Result<
  Readonly<PointCommitRowIntentV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const dependency = yield* capturePointDependencyResult(input);
    if (input.kind === "deleted") {
      return Object.freeze({ ...dependency, kind: "deleted" });
    }
    const creationTimeInput = yield* readPointCommitCommandFieldResult(
      () => input.creationTime,
    );
    const creationTime = yield* decodePointCommitCreationTimeResult(
      creationTimeInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const canonicalBytesInput = yield* readPointCommitCommandFieldResult(
      () => input.canonicalBytes,
    );
    if (!isUint8Array(canonicalBytesInput)) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const canonicalBytes = yield* Result.try({
      try: () => copyBytes(canonicalBytesInput),
      catch: () => corruption("commandInvalid"),
    });
    if (
      canonicalBytes.byteLength === 0 ||
      !isPositiveSafeInteger(input.semanticSizeBytes)
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return Object.freeze({
      ...dependency,
      kind: "live",
      creationTime,
      value: structuredClone(input.value),
      canonicalBytes,
      semanticSizeBytes: input.semanticSizeBytes,
    });
  });
}

export function captureRowIntentsResult(
  input: ReadonlyArray<PointCommitRowIntentV1>,
): Result.Result<
  ReadonlyArray<Readonly<PointCommitRowIntentV1>>,
  PointCommitCorruptionV1Error
> {
  if (
    !Array.isArray(input) ||
    input.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: Readonly<PointCommitRowIntentV1>[] = [];
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const intent = input[index];
      if (intent === undefined) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      captured.push(yield* captureRowIntentResult(intent));
    }
    const rowIntents = Object.freeze(captured);
    yield* requireCanonicalDependencyOrderResult(rowIntents);
    return rowIntents;
  });
}

export function requireCanonicalDependencyOrderResult(
  dependencies: ReadonlyArray<Readonly<PointCommitDependencyV1>>,
): Result.Result<void, PointCommitCorruptionV1Error> {
  for (let index = 1; index < dependencies.length; index += 1) {
    const previous = dependencies[index - 1];
    const current = dependencies[index];
    if (previous === undefined || current === undefined) {
      return Result.fail(corruption("commandInvalid"));
    }
    const tableDifference = previous.tableId - current.tableId;
    const rowDifference = compareRowIds(previous.rowId, current.rowId);
    if (tableDifference > 0 || (tableDifference === 0 && rowDifference >= 0)) {
      return Result.fail(corruption("commandInvalid"));
    }
  }
  return Result.succeed(undefined);
}

export function compareRowIds(
  left: AppRowIdHexV1,
  right: AppRowIdHexV1
): number {
  const leftBytes = appRowIdHexV1ToBytes(left);
  const rightBytes = appRowIdHexV1ToBytes(right);
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function isCanonicalDocumentForIntent(
  document: CanonicalFlarexValueV1,
  intent: Pick<
    PreparedLivePointCommitRowIntentV1,
    "documentId" | "creationTime"
  >,
): boolean {
  const value = document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(value)) return false;
  return value._id === intent.documentId &&
    value._creationTime === intent.creationTime;
}

export function validHash(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, HASH_BYTE_LENGTH);
}

export function validEpochMilliseconds(value: unknown): value is number {
  return isPositiveSafeInteger(value);
}
