import { Effect, Schema } from "effect";
import {
  CatalogTableIdSchema,
  CatalogIndexDefinitionIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
} from "flarex-protocol/catalog";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
  orderedIndexKeyHexV1ToBytes,
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
} from "flarex-protocol/ordered-index";
import {
  SnapshotTokenSchema,
  ScopeUuidV1Schema,
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  projectScopeEpochUuidV1Result,
  type CommitSeq,
} from "flarex-protocol/storage-authority";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import { readPreparedApplicationDocumentParticipant, type PreparedApplicationParticipant } from "../../src/storage/materialization/participant";
import {
  lockPointCommitIntrinsicIndexBuilds,
  lockPointCommitDeveloperIndexBuilds,
  runCandidateSchemaWriteGuard,
} from "../../src/storage/materialization/materialization";
import type { LogicalDocumentChange } from "../../src/storage/documents/logicalDocuments/workingSet";
import { projectLogicalPointExpectation } from "../../src/storage/documents/logicalDocuments/pointEvidence";
import { cmsError, cmsLimits } from "../../src/frameworks/cmsTransaction/model";
import { lowerAppDeveloperIndexKeyV1 } from "../../src/storage/indexes/appDeveloperIndexCommitV1";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../src/storage/unique/appUniqueConstraintCommitV1";
import {
  prepareActiveUniqueCoverageInTransactionEffect,
  AppUniqueConstraintSetBuildIntegrationV1Error,
} from "../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  readIndexCoverageContextInTransactionEffect,
  isIndexBuildSnapshotCoveredInTransactionEffect,
} from "../../src/storage/indexes/indexBuildStates";
import {
  AppRowReadPersistenceError,
  type AppRowTransaction,
} from "../../src/storage/documents/appRows";
import { IndexMaintenanceError } from "../../src/storage/indexes/indexMaintenanceModel";
import { APP_UNIQUE_KEY_CODEC_VERSION_V1 } from "../../src/storage/unique/appUniqueKeyContract";
import { runDrizzleStatementEffect } from "../../src/database/drizzleStatementEffect";
import type { ScopeClockRecord } from "../../src/scope/scopeClock";
import type { TrustedScopeAuthority } from "../../src/scope/scopeAuthorityResolution";
import {
  fxAppRowRevisions,
  fxAppRowCurrent,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxAppUniqueKeys,
} from "../../src/database/schema";
import {
  ce0PersistenceStep,
  projectCe0KernelFailure,
} from "../frameworks/cmsTransaction/ce0CmsReferencePersistence";

const hash = makeLivePrivateSha256V1({
  invalidBudget: () => cmsError("limitExceeded"),
  invalidBytes: () => cmsError("storedCorruption"),
  inputBytesExceeded: () => cmsError("limitExceeded"),
  unavailable: () => cmsError("resourceFailure"),
  nativeRejected: (cause) => cmsError("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid reference digest"),
});
const digest = (bytes: Uint8Array) =>
  hash(bytes, { maximumInputBytes: cmsLimits.documentBytes });

export type Ce0FirstInsertMaterializationStep = "rowBatchWritten" | "indexBatchWritten" | "uniquePublicationApplied";
/** Observes this independent reference's actual native writes. */
export interface Ce0FirstInsertMaterializationOptions {
  readonly afterTransactionStep?: (event: Readonly<{
    scopeId: TrustedScopeAuthority["scopeId"];
    step: Ce0FirstInsertMaterializationStep;
  }>) => Promise<void>;
}
const rowIdBytes = Schema.Uint8Array.check(
  Schema.makeFilter((value) => value.byteLength === 16),
);
const keyBytes = Schema.Uint8Array.check(
  Schema.makeFilter(
    (value) =>
      value.byteLength >= 1 &&
      value.byteLength <= MAX_ORDERED_INDEX_KEY_BYTES_V1,
  ),
);
const decodeRowWrites = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      scopeUuid: Schema.toType(ScopeUuidV1Schema),
      tableId: Schema.toType(CatalogTableIdSchema),
      rowId: rowIdBytes,
      commitSeq: Schema.toType(CommitSeqSchema),
    }),
  ),
);
const decodeMemberWrites = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      scopeUuid: Schema.toType(ScopeUuidV1Schema),
      indexDefinitionId: Schema.toType(CatalogIndexDefinitionIdSchema),
      encodedKey: keyBytes,
      rowId: rowIdBytes,
      commitSeq: Schema.toType(CommitSeqSchema),
    }),
  ),
);
const decodeClaimWrites = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      scopeUuid: Schema.toType(ScopeUuidV1Schema),
      constraintId: Schema.toType(CatalogUniqueConstraintDefinitionIdSchema),
      localeKey: Schema.String,
      keyCodecVersion: Schema.Literal(APP_UNIQUE_KEY_CODEC_VERSION_V1),
      encodedKey: keyBytes,
      canonicalKeySha256: Schema.Uint8Array.check(
        Schema.makeFilter((value) => value.byteLength === 32),
      ),
      tableId: Schema.toType(CatalogTableIdSchema),
      rowId: rowIdBytes,
    }),
  ),
);
const invalidEvidence = (cause: unknown) => cmsError("storedCorruption", cause);
const failedStatement = (cause: unknown) => cmsError("statementFailure", cause);
const exact = (expected: readonly string[], actual: readonly string[]) => {
  const remaining = new Set(expected);
  return (
    remaining.size === expected.length &&
    actual.length === expected.length &&
    actual.every((key) => remaining.delete(key)) &&
    remaining.size === 0
  );
};

/** Test-only active first-insert persistence. Common build and candidate authority
 * are checked inside the borrowed transaction; no production delta or writer runs. */
export const prepareCe0FirstInsertMaterialization = Effect.fn(
  "Ce0Insert.prepare",
)(function* (
  tx: AppRowTransaction,
  token: PreparedApplicationParticipant,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  referenceOptions: Ce0FirstInsertMaterializationOptions = {},
) {
  const prepared = yield* readPreparedApplicationDocumentParticipant(token).pipe(
    Effect.catchTag("LogicalDocumentMaterializationError", cause => Effect.fail(cmsError(cause.reason, cause.cause))));
  if (
    prepared.relations !== null ||
    prepared.command.rowIntents.length !== 1 ||
    prepared.intrinsic.length !== 1 ||
    prepared.developer.length !== 1 ||
    prepared.unique.length !== 1
  )
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId),
  );
  const epoch = yield* Effect.fromResult(
    projectScopeEpochUuidV1Result(clock.epoch),
  );
  const envelope = {
    record: clock,
    scopeUuid: scope.scopeUuid,
    epochUuid: epoch.epochUuid,
  };
  const empty = {
    authorityPins: {
      ...prepared.command.authorityPins,
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: authority.scopeId,
        epoch: clock.epoch,
        commitSeq: clock.lastCommitSeq,
      }),
    },
    rowIntents: [],
    dependencies: [],
  };
  const intrinsic = yield* ce0PersistenceStep(() =>
    lockPointCommitIntrinsicIndexBuilds(
      tx,
      envelope,
      prepared.intrinsic,
      empty,
    ),
  );
  const developer = yield* ce0PersistenceStep(() =>
    lockPointCommitDeveloperIndexBuilds(
      tx,
      envelope,
      prepared.developer,
      empty,
    ),
  );
  const builds = [...intrinsic, ...developer];
  return Effect.fn("Ce0Insert.apply")(function* (
    changes: readonly LogicalDocumentChange[],
    commitSeq: CommitSeq,
  ) {
    if (
      changes.length < 1 ||
      changes.length > 32 ||
      commitSeq !== clock.lastCommitSeq + 1n
    )
      return yield* Effect.fail(cmsError("unsupportedProfile"));
    const rows = [];
    for (const row of changes) {
      if (
        row.kind !== "live" ||
        row.dependency.kind !== "appRowPoint" ||
        row.dependency.observed.kind !== "missing" ||
        row.dependency.observed.basis.kind !== "noVisibleRevision" ||
        row.tableId !== prepared.command.rowIntents[0]?.tableId
      )
        return yield* Effect.fail(cmsError("unsupportedProfile"));
      rows.push(row);
    }
    if (new Set(rows.map((row) => row.rowId)).size !== rows.length)
      return yield* Effect.fail(cmsError("storedCorruption"));
    const context = yield* readIndexCoverageContextInTransactionEffect(
      tx,
      clock,
    ).pipe(
      Effect.mapError((cause) =>
        cmsError(
          cause.reason === "resourceFailure"
            ? "statementFailure"
            : "storedCorruption",
          cause,
        ),
      ),
    );
    if (context.active === null)
      return yield* Effect.fail(cmsError("unsupportedProfile"));
    const unique = yield* prepareActiveUniqueCoverageInTransactionEffect(
      tx,
      clock,
      prepared.schema.schemaVersionId,
      prepared.unique,
      context,
      "activeApplication",
    ).pipe(
      Effect.mapError((cause) =>
        cmsError(
          cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error
            ? "statementFailure"
            : "storedCorruption",
          cause,
        ),
      ),
    );
    if (unique.some((build) => build.maintenance === null))
      return yield* Effect.fail(cmsError("unsupportedProfile"));
    for (const { build, definition } of builds) {
      if (
        build.lifecycle !== "enabled" ||
        build.maintenance === null ||
        build.maintenance.schemaVersionId !==
          prepared.schema.schemaVersionId ||
        build.maintenance.deploymentId !== prepared.schema.deploymentId ||
        encodeBytesToLowercaseHex(build.maintenance.physicalSpecSha256) !==
          definition.physicalSpecSha256Hex
      )
        return yield* Effect.fail(cmsError("storedCorruption"));
      if (
        !(yield* isIndexBuildSnapshotCoveredInTransactionEffect(
          tx,
          build,
          { ...definition, tableId: definition.access.tableId },
          clock.lastCommitSeq,
          context,
        ).pipe(
          Effect.mapError((cause) =>
            cmsError(
              cause instanceof AppRowReadPersistenceError ||
                (cause instanceof IndexMaintenanceError &&
                  cause.reason === "resourceFailure")
                ? "statementFailure"
                : "storedCorruption",
              cause,
            ),
          ),
        ))
      )
        return yield* Effect.fail(cmsError("storedCorruption"));
    }
    yield* runCandidateSchemaWriteGuard(
      tx,
      prepared.candidate,
      authority,
      clock,
      commitSeq,
      rows.map(row => ({ ...row, ...projectLogicalPointExpectation(row) })),
    ).pipe(Effect.mapError(projectCe0KernelFailure));
    const rowValues = rows.map((row) => ({
      scopeUuid: scope.scopeUuid,
      tableId: row.tableId,
      rowId: appRowIdHexV1ToBytes(row.rowId),
      commitSeq,
      prevCommitSeq: null,
      writeEpochUuid: epoch.epochUuid,
      schemaVersionId: prepared.schema.schemaVersionId,
      creationTime: row.creationTime,
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      isTombstone: false,
      valueBytes: row.document.canonicalBytes,
      valueSha256: row.document.sha256,
    }));
    const memberships: (typeof fxAppIndexEntryRevisions.$inferInsert)[] = [];
    const claims: (typeof fxAppUniqueKeys.$inferInsert)[] = [];
    for (const row of rows) {
      for (const definition of [...prepared.intrinsic, ...prepared.developer]) {
        if (definition.access.tableId !== row.tableId)
          return yield* Effect.fail(cmsError("unsupportedProfile"));
        const key =
          definition.access.kind === "by_creation_time"
            ? encodeAppOrderedIndexKeyV1({
                spec: definition.physicalSpec,
                values: [orderedIndexCreationTimeV1(row.creationTime)],
              })
            : yield* Effect.fromResult(
                lowerAppDeveloperIndexKeyV1(
                  definition,
                  row.document,
                  row.creationTime,
                ),
              ).pipe(
                Effect.mapError((cause) => cmsError("storedCorruption", cause)),
              );
        if (key === null) continue;
        const bytes = orderedIndexKeyHexV1ToBytes(key);
        memberships.push({
          scopeUuid: scope.scopeUuid,
          tableId: row.tableId,
          rowId: appRowIdHexV1ToBytes(row.rowId),
          indexDefinitionId: definition.indexDefinitionId,
          commitSeq,
          isTombstone: false,
          keyCodecVersion: definition.physicalSpec.keyCodecVersion,
          physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
            definition.physicalSpecSha256Hex,
          ),
          encodedKey: bytes,
          keySha256: yield* digest(bytes),
        });
      }
      for (const definition of prepared.unique) {
        if (definition.tableId !== row.tableId)
          return yield* Effect.fail(cmsError("unsupportedProfile"));
        const canonical = yield* Effect.fromResult(
          lowerCanonicalAppUniqueConstraintV1Result(definition, row.document),
        ).pipe(Effect.mapError((cause) => cmsError("storedCorruption", cause)));
        if (canonical.kind !== "claim")
          return yield* Effect.fail(cmsError("unsupportedProfile"));
        claims.push({
          scopeUuid: scope.scopeUuid,
          constraintId: definition.uniqueConstraintDefinitionId,
          localeKey: canonical.localeKey,
          keyCodecVersion: canonical.keyCodecVersion,
          encodedKey: canonical.canonicalKeyBytes,
          canonicalKeySha256: yield* digest(canonical.canonicalKeyBytes),
          tableId: row.tableId,
          rowId: appRowIdHexV1ToBytes(row.rowId),
        });
      }
    }
    const rowKey = (row: {
      scopeUuid: string;
      tableId: number;
      rowId: Uint8Array;
      commitSeq: bigint;
    }) =>
      `${row.scopeUuid}/${row.tableId}/${encodeBytesToLowercaseHex(row.rowId)}/${row.commitSeq}`;
    const memberKey = (row: {
      scopeUuid: string;
      commitSeq: bigint;
      indexDefinitionId: number;
      rowId: Uint8Array;
      encodedKey: Uint8Array;
    }) =>
      `${row.scopeUuid}/${row.indexDefinitionId}/${encodeBytesToLowercaseHex(row.rowId)}/${encodeBytesToLowercaseHex(row.encodedKey)}/${row.commitSeq}`;
    const claimKey = (row: {
      scopeUuid: string;
      tableId: number;
      constraintId: number;
      rowId: Uint8Array;
      localeKey: string;
      canonicalKeySha256: Uint8Array;
      keyCodecVersion: number;
      encodedKey: Uint8Array;
    }) =>
      `${row.scopeUuid}/${row.tableId}/${row.constraintId}/${row.localeKey}/${encodeBytesToLowercaseHex(row.rowId)}/${encodeBytesToLowercaseHex(row.canonicalKeySha256)}/${row.keyCodecVersion}/${encodeBytesToLowercaseHex(row.encodedKey)}`;
    const step = (
      name: Ce0FirstInsertMaterializationStep,
    ) =>
      Effect.promise(async () => {
        await referenceOptions.afterTransactionStep?.({
          scopeId: scope.scopeId,
          step: name,
        });
      });
    const revisions = yield* runDrizzleStatementEffect(
      tx
        .insert(fxAppRowRevisions)
        .values(rowValues)
        .onConflictDoNothing()
        .returning(),
      failedStatement,
    ).pipe(
      Effect.flatMap((value) =>
        decodeRowWrites(value).pipe(Effect.mapError(invalidEvidence)),
      ),
    );
    if (!exact(rowValues.map(rowKey), revisions.map(rowKey)))
      return yield* Effect.fail(cmsError("storedCorruption"));
    const pointers = rowValues.map(
      ({ scopeUuid, tableId, rowId, commitSeq }) => ({
        scopeUuid,
        tableId,
        rowId,
        commitSeq,
      }),
    );
    const writtenPointers = yield* runDrizzleStatementEffect(
      tx
        .insert(fxAppRowCurrent)
        .values(pointers)
        .onConflictDoNothing()
        .returning(),
      failedStatement,
    ).pipe(
      Effect.flatMap((value) =>
        decodeRowWrites(value).pipe(Effect.mapError(invalidEvidence)),
      ),
    );
    if (!exact(pointers.map(rowKey), writtenPointers.map(rowKey)))
      return yield* Effect.fail(cmsError("storedCorruption"));
    yield* step("rowBatchWritten");
    const writtenMembers = yield* runDrizzleStatementEffect(
      tx
        .insert(fxAppIndexEntryRevisions)
        .values(memberships)
        .onConflictDoNothing()
        .returning(),
      failedStatement,
    ).pipe(
      Effect.flatMap((value) =>
        decodeMemberWrites(value).pipe(Effect.mapError(invalidEvidence)),
      ),
    );
    if (!exact(memberships.map(memberKey), writtenMembers.map(memberKey)))
      return yield* Effect.fail(cmsError("storedCorruption"));
    const memberPointers = memberships.map(
      ({ scopeUuid, indexDefinitionId, encodedKey, rowId, commitSeq }) => ({
        scopeUuid,
        indexDefinitionId,
        encodedKey,
        rowId,
        commitSeq,
      }),
    );
    const writtenMemberPointers = yield* runDrizzleStatementEffect(
      tx
        .insert(fxAppIndexEntryCurrent)
        .values(memberPointers)
        .onConflictDoNothing()
        .returning(),
      failedStatement,
    ).pipe(
      Effect.flatMap((value) =>
        decodeMemberWrites(value).pipe(Effect.mapError(invalidEvidence)),
      ),
    );
    if (
      !exact(
        memberPointers.map(memberKey),
        writtenMemberPointers.map(memberKey),
      )
    )
      return yield* Effect.fail(cmsError("storedCorruption"));
    yield* step("indexBatchWritten");
    const writtenClaims = yield* runDrizzleStatementEffect(
      tx.insert(fxAppUniqueKeys).values(claims).returning(),
      failedStatement,
    ).pipe(
      Effect.flatMap((value) =>
        decodeClaimWrites(value).pipe(Effect.mapError(invalidEvidence)),
      ),
    );
    if (!exact(claims.map(claimKey), writtenClaims.map(claimKey)))
      return yield* Effect.fail(cmsError("storedCorruption"));
    yield* step("uniquePublicationApplied");
  });
});
