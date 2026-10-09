import type {
  AppRowTransaction,
} from "../../storage/documents/appRows";
import type {
  LockedPointCommitClockV1,
} from "./lockedState";
import type {
  PreparedPointCommitDependencyCommandV1,
  PreparedPointMutationAttemptReplacementCommandV1,
} from "./preparedCommands";
import {
  PointCommitConflictV1Error,
  corruption,
  type PointCommitCorruptionV1Error,
  PointMutationAttemptReplacementConflictNoLongerPresentV1Error,
  type PointCommitConflictEvidenceV1,
  PointCommitStaleAuthorityV1Error,
} from "./errors";
import {
  CommitSeqSchema,
  type CommitSeq,
} from "flarex-protocol/storage-authority";
import {
  MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1,
} from "./limits";
import {
  sql,
} from "drizzle-orm";
import {
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1ToBytes,
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexRowIdHexV1,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexRowIdHexV1FromBytesResult,
} from "flarex-protocol/ordered-index";
import {
  sqlCall,
  PointCommitSqlFailureMarkerV1,
} from "./sqlFailures";
import {
  rowsFromDriverExecuteResult,
} from "../../database/driverExecuteResult";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
} from "./promiseBoundary";
import type {
  PointCommitTransactionProofOptionsV1,
} from "./constructionContracts";
import {
  readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect,
  AppRelationEdgePersistenceError,
} from "../../storage/relations";
import {
  Result,
  Effect,
} from "effect";
import type {
  CatalogTableId,
  CatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  isNonArrayRecord,
} from "@flarex/utils/records";
import {
  parseNonNegativeIntegerTextResult,
  parseNullableCommitSeqTextResult,
} from "../../storage/materialization/headEvidence";
import {
  decodePointCommitEncodedTableIdResult,
  selectLogicalOperationProfileResult,
} from "./capture";
import {
  isUint8Array,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import type {
  LoadedPointCommitHeadV1,
} from "../../storage/materialization/model";
import type {
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import {
  type SessionJournal,
  type LogicalMetadataReadDependency,
  logicalMetadataDependencyIdentity,
  canonicalizeAdmittedParticipantBindingV1Result,
} from "flarex-protocol/commit-protocol";
import type {
  FiniteMetadataReservation,
} from "../../execution/finiteMetadataReservation";
import {
  findPointCommitConflictAfterEvidenceValidationResult,
} from "../../storage/materialization/materialization";
import {
  validateConsumedMetadataDependencies,
} from "../../execution/finiteMetadataDependencies";
import {
  requireAdmittedOperationBundleDigest,
  PointCommitAdmissionDigestProviderError,
} from "./participantProof";
import {
  requireLogicalParticipantCommitAuthorityEffect,
  requireFiniteLogicalParticipantCommitAuthorityEffect,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import {
  validateLogicalParticipantDependencyEvidence,
} from "../../storage/documents/logicalDocuments/commitEvidence";

export async function findPointCommitIndexRangeConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitDependencyCommandV1,
): Promise<PointCommitConflictV1Error | null> {
  const dependencies = command.indexRangeDependencies;
  if (dependencies.length === 0) return null;
  const snapshotCommitSeq = command.authorityPins.snapshotToken.commitSeq;
  const lastCommitSeq = CommitSeqSchema.make(clock.record.lastCommitSeq);
  const first = dependencies[0]!;
  if (
    snapshotCommitSeq < clock.oldestAvailableCommitSeq ||
    lastCommitSeq - snapshotCommitSeq > MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1
  ) {
    return new PointCommitConflictV1Error({
      conflict: Object.freeze({
        kind: "appIndexRange",
        reason: "validationWindowExceeded",
        dependencyOrdinal: 0,
        tableId: first.tableId,
        indexDefinitionId: first.indexDefinitionId,
      }),
      snapshotCommitSeq,
      currentCommitSeq: lastCommitSeq,
    });
  }
  if (lastCommitSeq === snapshotCommitSeq) return null;

  const requestedValues = sql.join(dependencies.map((dependency, ordinal) => {
    const lower = dependency.lower === null
      ? null
      : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey);
    const upper = dependency.upper === null
      ? null
      : dependency.upper.kind === "key"
        ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey)
        : orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey);
    const upperRowId = dependency.upper?.kind === "position"
      ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId)
      : null;
    return sql`(
      ${ordinal}::integer,
      ${dependency.indexDefinitionId}::integer,
      ${lower}::bytea,
      ${dependency.upper?.kind ?? "unbounded"}::text,
      ${upper}::bytea,
      ${upperRowId}::bytea
    )`;
  }), sql`, `);
  const statement = sql`
    with requested(
      ordinal,
      index_definition_id,
      lower_encoded_key,
      upper_kind,
      upper_encoded_key,
      upper_row_id
    ) as (values ${requestedValues})
    select
      requested.ordinal::text as "ordinalText",
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText"
    from requested
    join fx_app_index_entry_rev as revision
      on revision.scope_uuid = ${clock.scopeUuid}
      and revision.index_definition_id = requested.index_definition_id
      and revision.commit_seq > ${snapshotCommitSeq}
      and revision.commit_seq <= ${lastCommitSeq}
      and (
        requested.lower_encoded_key is null or
        revision.encoded_key >= requested.lower_encoded_key
      )
      and (
        requested.upper_kind = 'unbounded' or
        (
          requested.upper_kind = 'key' and
          revision.encoded_key < requested.upper_encoded_key
        ) or
        (
          requested.upper_kind = 'position' and
          (
            revision.encoded_key < requested.upper_encoded_key or
            (
              revision.encoded_key = requested.upper_encoded_key and
              revision.row_id <= requested.upper_row_id
            )
          )
        )
      )
    order by requested.ordinal asc, revision.commit_seq asc,
      revision.encoded_key asc, revision.row_id asc
    limit 1
  `;
  const result = await sqlCall(
    "validateIndexRanges",
    () => tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("occEvidenceInvalid");
  });
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw corruption("occEvidenceInvalid");
  const decoded = projectPointCommitTransactionResult(
    decodePointCommitIndexRangeConflictRowResult(
      rows[0],
      dependencies,
      snapshotCommitSeq,
      lastCommitSeq,
    ),
  );
  return new PointCommitConflictV1Error({
    conflict: Object.freeze({
      kind: "appIndexRange",
      reason: "overlap",
      dependencyOrdinal: decoded.ordinal,
      tableId: decoded.tableId,
      indexDefinitionId: decoded.indexDefinitionId,
      encodedKey: decoded.encodedKey,
      rowId: decoded.rowId,
    }),
    snapshotCommitSeq,
    currentCommitSeq: decoded.currentCommitSeq,
  });
}

export async function findPointCommitRelationConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitDependencyCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitConflictV1Error | null> {
  const dependencies = command.relationDependencies;
  if (dependencies.length === 0) return null;
  const pointCommitObserver = options.observeQuery;
  const settled = await runPointCommitInTransactionEffect(
    readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId,
      endpoints: dependencies.map((dependency) => Object.freeze({
        edgeDefinitionId: dependency.edgeDefinitionId,
        targetRowId: dependency.targetRowId,
      })),
      ...(pointCommitObserver === undefined
        ? {}
        : {
            observeQuery: ({ sql: statement, params }) =>
              pointCommitObserver(Object.freeze({
                name: "validateRelationDependencies",
                sql: statement,
                params,
              })),
          }),
    }),
  );
  const currentVersions = projectPointCommitTransactionResult(
    settled.pipe(Result.mapError((failure) =>
      failure instanceof AppRelationEdgePersistenceError
        ? new PointCommitSqlFailureMarkerV1(
            "validateRelationDependencies",
            failure.cause,
          )
        : corruption("occEvidenceInvalid")
    )),
  );
  if (currentVersions.length !== dependencies.length) {
    throw corruption("occEvidenceInvalid");
  }
  for (let ordinal = 0; ordinal < dependencies.length; ordinal += 1) {
    const dependency = dependencies[ordinal];
    const currentVersion = currentVersions[ordinal];
    if (dependency === undefined || currentVersion === undefined) {
      throw corruption("occEvidenceInvalid");
    }
    if (
      currentVersion.edgeDefinitionId !== dependency.edgeDefinitionId ||
      currentVersion.targetRowId !== dependency.targetRowId
    ) {
      throw corruption("occEvidenceInvalid");
    }
    const current = currentVersion.adjacencyVersion;
    if (
      current < dependency.observedAdjacencyVersion ||
      current > clock.record.lastCommitSeq
    ) {
      throw corruption("occEvidenceInvalid");
    }
    if (current !== dependency.observedAdjacencyVersion) {
      if (current <= command.authorityPins.snapshotToken.commitSeq) {
        throw corruption("occEvidenceInvalid");
      }
      return new PointCommitConflictV1Error({
        conflict: Object.freeze({
          kind: "appRelationIncoming",
          edgeDefinitionId: dependency.edgeDefinitionId,
          targetRowId: dependency.targetRowId,
        }),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
        currentCommitSeq: current,
      });
    }
  }
  return null;
}

function decodePointCommitIndexRangeConflictRowResult(
  value: unknown,
  dependencies: PreparedPointCommitDependencyCommandV1[
    "indexRangeDependencies"
  ],
  snapshotCommitSeq: CommitSeq,
  lastCommitSeq: CommitSeq,
): Result.Result<
  Readonly<{
    readonly ordinal: number;
    readonly tableId: CatalogTableId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly currentCommitSeq: CommitSeq;
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly rowId: OrderedIndexRowIdHexV1;
  }>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(value)) {
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    }
    const ordinal = yield* parseNonNegativeIntegerTextResult(
      value.ordinalText,
    ).pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    const dependency = dependencies[ordinal];
    if (dependency === undefined) {
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    }
    const tableId = yield* parseNonNegativeIntegerTextResult(
      value.tableIdText,
    ).pipe(
      Result.mapError(() => corruption("occEvidenceInvalid")),
      Result.filterOrFail(
        (parsed) => parsed > 0,
        () => corruption("occEvidenceInvalid"),
      ),
      Result.flatMap((parsed) =>
        decodePointCommitEncodedTableIdResult(parsed).pipe(
          Result.mapError(() => corruption("occEvidenceInvalid")),
        )
      ),
    );
    const keyCodecVersion = yield* parseNonNegativeIntegerTextResult(
      value.keyCodecVersionText,
    ).pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    const currentCommitSeq = yield* parseNullableCommitSeqTextResult(
      value.commitSeqText,
    ).pipe(
      Result.mapError(() => corruption("occEvidenceInvalid")),
      Result.filterOrFail(
        (parsed): parsed is CommitSeq => parsed !== null,
        () => corruption("occEvidenceInvalid"),
      ),
    );
    if (
      !isUint8Array(value.physicalSpecSha256) ||
      encodeBytesToLowercaseHex(value.physicalSpecSha256) !==
        dependency.physicalSpecSha256Hex ||
      tableId !== dependency.tableId ||
      keyCodecVersion !== dependency.keyCodecVersion ||
      currentCommitSeq <= snapshotCommitSeq ||
      currentCommitSeq > lastCommitSeq ||
      !isUint8Array(value.encodedKeyBytes) ||
      !isUint8Array(value.rowIdBytes)
    ) {
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    }
    const encodedKeyBytes = value.encodedKeyBytes;
    const rowIdBytes = value.rowIdBytes;
    const encodedKey = yield* Result.try({
      try: () => orderedIndexKeyBytesHexV1FromBytes(encodedKeyBytes),
      catch: () => corruption("occEvidenceInvalid"),
    });
    const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(
      rowIdBytes,
    ).pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    return Object.freeze({
      ordinal,
      tableId,
      indexDefinitionId: dependency.indexDefinitionId,
      currentCommitSeq,
      encodedKey,
      rowId,
    });
  });
}

export async function requireReproduciblePointCommitConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  options: PointCommitTransactionProofOptionsV1,
  authority: TrustedScopeAuthority,
  sealedJournal: SessionJournal,
  finiteReservation: FiniteMetadataReservation | null,
): Promise<void> {
  const metadataConflict = command.expectedConflict.conflict;
  if (metadataConflict.kind === "metadata" && (clock.record.lastMetadataSequence <= metadataConflict.capturedMetadataWatermark ||
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - inconsistent authenticated metadata witness must refuse through the typed Promise rollback adapter
    clock.record.lastMetadataSequence < metadataConflict.lastChangedMetadataSequence)) throw corruption("occEvidenceInvalid");
  const actual = command.expectedConflict.conflict.kind === "logicalParticipant"
    ? await findPointCommitLogicalParticipantConflict(tx, clock, command, options, authority, sealedJournal, finiteReservation)
    : command.expectedConflict.conflict.kind === "metadata"
    ? await findPointCommitMetadataConflict(tx, clock, command, sealedJournal, finiteReservation)
    : projectPointCommitTransactionResult(
      findPointCommitConflictAfterEvidenceValidationResult(command, heads),
    ) ?? await findPointCommitIndexRangeConflict(tx, clock, command) ??
      await findPointCommitRelationConflict(tx, clock, command, options);
  if (
    actual === null ||
    !pointCommitConflictsReproduce(command.expectedConflict, actual)
  ) {
    throw new PointMutationAttemptReplacementConflictNoLongerPresentV1Error({
      reason: "conflictNoLongerPresent",
    });
  }
}

async function findPointCommitMetadataConflict(tx: AppRowTransaction, clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1, sealedJournal: SessionJournal,
  reservation: FiniteMetadataReservation | null): Promise<PointCommitConflictEvidenceV1 | null> {
  const expected = command.expectedConflict.conflict;
  if (expected.kind !== "metadata") return null;
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - metadata conflict without its reserved authority must refuse through the typed Promise rollback adapter
  if (reservation === null) throw corruption("occEvidenceInvalid");
  const dependencies = sealedJournal.readDependencies.filter((dependency): dependency is LogicalMetadataReadDependency => dependency.kind === "metadata" &&
    logicalMetadataDependencyIdentity(dependency) === logicalMetadataDependencyIdentity(expected));
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - missing or nonunique sealed dependency refuses through the typed Promise rollback adapter
  if (dependencies.length !== 1) throw corruption("occEvidenceInvalid");
  return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    validateConsumedMetadataDependencies(tx, command.authorityPins.scopeId, reservation.metadataWatermark, dependencies).pipe(
      Effect.as(null), Effect.catchTag("FiniteMetadataError", error => error.reason === "writeConflict" &&
        error.capturedMetadataWatermark !== undefined && error.lastChangedMetadataSequence !== undefined ? Effect.succeed(Object.freeze({
        conflict: Object.freeze({ kind: "metadata" as const, namespace: expected.namespace, ownerKey: expected.ownerKey, contractKey: expected.contractKey,
          capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence }),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq,
      })) : Effect.fail(error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("validateIndexRanges", error.cause ?? error)
        : corruption("occEvidenceInvalid"))))));
}

async function findPointCommitLogicalParticipantConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  authority: TrustedScopeAuthority,
  sealedJournal: SessionJournal,
  finiteReservation: FiniteMetadataReservation | null,
): Promise<PointCommitConflictEvidenceV1 | null> {
  const expected = command.expectedConflict.conflict;
  if (expected.kind !== "logicalParticipant") return null;
  const matching = sealedJournal.participantOperations.filter(operation =>
    operation.participant === expected.participant && operation.syscallSequence === expected.syscallSequence);
  if (matching.length !== 1) throw corruption("occEvidenceInvalid");
  const operation = matching[0]!;
  const selectedProfile = projectPointCommitTransactionResult(selectLogicalOperationProfileResult(options, operation));
  projectPointCommitTransactionResult((await runPointCommitInTransactionEffect(
    requireAdmittedOperationBundleDigest(operation))).pipe(Result.mapError(error =>
      error instanceof PointCommitAdmissionDigestProviderError ? error.cause : error)));
  for (const [ordinal, contribution] of operation.sourceContributions.entries()) {
  const binding = projectPointCommitTransactionResult(canonicalizeAdmittedParticipantBindingV1Result({
    scopeId: command.authorityPins.scopeId,
    sessionId: command.authorityPins.sessionId,
    attemptFence: command.authorityPins.attemptFence,
    snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
    schemaVersionId: command.authorityPins.schemaVersionId,
    principalDigest: encodeBytesToLowercaseHex(command.session.identityAccessPolicySha256),
    participant: operation.participant,
    method: operation.method,
    sourceKey: contribution.sourceKey,
    sourceSha256Hex: contribution.sourceSha256Hex,
    bindingHead: contribution.bindingHead,
  }).pipe(Result.mapError(() => corruption("commandInvalid"))));
  const bindingDigest = encodeBytesToLowercaseHex(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(binding.bytes).buffer)));
  if (bindingDigest !== contribution.sourceBindingSha256Hex) throw corruption("commandInvalid");
  const admitted = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    (finiteReservation === null ? requireLogicalParticipantCommitAuthorityEffect : requireFiniteLogicalParticipantCommitAuthorityEffect)(selectedProfile.authorities[ordinal]!,
      operation, contribution, tx, authority, clock.record).pipe(
      Effect.mapError(error => error.reason === "resourceFailure"
        ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
        : error.reason === "storedCorruption" ? corruption("activeApplicationHeadInvalid")
          : new PointCommitStaleAuthorityV1Error({ reason: "activeSchemaChanged" })))));
  const validation = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(Effect.result(
    validateLogicalParticipantDependencyEvidence(tx, command.authorityPins.scopeId,
      operation, contribution, { tableIds: admitted.tableIds, ...admitted.readDefinitions }))));
  const conflict = Result.match(validation, {
    onSuccess: () => null,
    onFailure: failure => {
      if (failure.reason === "resourceFailure")
        throw new PointCommitSqlFailureMarkerV1("validateIndexRanges", failure.cause ?? failure);
      if (failure.reason !== "writeConflict") throw corruption("dependencySetInvalid");
      return Object.freeze({ conflict: Object.freeze({ kind: "logicalParticipant" as const,
        participant: operation.participant, syscallSequence: operation.syscallSequence }),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
        currentCommitSeq: clock.record.lastCommitSeq });
    },
  });
  if (conflict !== null) return conflict;
  }
  return null;
}

function pointCommitConflictsReproduce(
  expected: PointCommitConflictEvidenceV1,
  actual: PointCommitConflictEvidenceV1,
): boolean {
  if (
    expected.snapshotCommitSeq !== actual.snapshotCommitSeq ||
    expected.conflict.kind !== actual.conflict.kind
  ) return false;
  if (expected.conflict.kind === "appRowPoint") {
    return actual.conflict.kind === "appRowPoint" &&
      expected.conflict.documentId === actual.conflict.documentId &&
      expected.currentCommitSeq === actual.currentCommitSeq;
  }
  if (expected.conflict.kind === "appRelationIncoming") {
    return actual.conflict.kind === "appRelationIncoming" &&
      expected.conflict.edgeDefinitionId ===
        actual.conflict.edgeDefinitionId &&
      expected.conflict.targetRowId === actual.conflict.targetRowId &&
      actual.currentCommitSeq >= expected.currentCommitSeq;
  }
  if (expected.conflict.kind === "logicalParticipant") {
    return actual.conflict.kind === "logicalParticipant" &&
      expected.conflict.participant === actual.conflict.participant &&
      expected.conflict.syscallSequence === actual.conflict.syscallSequence &&
      actual.currentCommitSeq >= expected.currentCommitSeq;
  }
  if (expected.conflict.kind === "metadata") return actual.conflict.kind === "metadata" &&
    logicalMetadataDependencyIdentity(expected.conflict) === logicalMetadataDependencyIdentity(actual.conflict) &&
    expected.conflict.capturedMetadataWatermark === actual.conflict.capturedMetadataWatermark &&
    actual.conflict.lastChangedMetadataSequence >= expected.conflict.lastChangedMetadataSequence &&
    actual.currentCommitSeq >= expected.currentCommitSeq;
  // Root-graph conflicts use exact finite nonacceptance, never legacy tickets.
  if (expected.conflict.kind !== "appIndexRange" || actual.conflict.kind !== "appIndexRange") return false;
  if (
    expected.conflict.reason !== actual.conflict.reason ||
    expected.conflict.dependencyOrdinal !== actual.conflict.dependencyOrdinal ||
    expected.conflict.tableId !== actual.conflict.tableId ||
    expected.conflict.indexDefinitionId !== actual.conflict.indexDefinitionId
  ) return false;
  return expected.conflict.reason === "validationWindowExceeded"
    ? actual.currentCommitSeq >= expected.currentCommitSeq
    : expected.currentCommitSeq === actual.currentCommitSeq &&
      expected.conflict.encodedKey === actual.conflict.encodedKey &&
      expected.conflict.rowId === actual.conflict.rowId;
}
