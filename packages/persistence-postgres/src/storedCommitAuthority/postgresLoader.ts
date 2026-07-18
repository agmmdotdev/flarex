import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import {
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import type { ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { AppRowTransaction } from "../appRows";
import { observeDrizzleQuery } from "../drizzleQueryObservation";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
} from "../scopeAuthorityResolution";
import {
  fxControlSchemaVersions,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../schema";
import {
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedRepeatableReadAttemptTargetV1,
} from "../transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";
import {
  materializeEffect,
  parseLength,
  type CapturedRowsV1,
  type ClockRow,
  type SchemaPayloadRow,
  type SchemaSizeRow,
  type SessionPayloadRow,
  type SessionSizeRow,
} from "./materialization";
import {
  MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  authorityMismatch,
  corrupt,
  type StoredCommitAuthorityCorruptionReasonV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceLoadResultV1,
  type StoredCommitAuthorityEvidenceLoaderV1,
  StoredCommitAuthorityEvidencePersistenceV1Error,
} from "./model";

export interface StoredCommitAuthorityEvidenceQueryV1 {
  readonly name:
    | "clock"
    | "authoritySizes"
    | "lease"
    | "root"
    | "schemaSizes"
    | "authorityPayload"
    | "schemaPayload"
    | "stableBindings";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface StoredCommitAuthorityEvidenceLoaderOptionsV1 {
  /** Test-only: runs after size projection while the RR transaction is open. */
  readonly afterSizeProjection?: () => void | Promise<void>;
  /** Test-only: runs after the RR transaction has closed, before CPU work. */
  readonly afterRepeatableRead?: () => void | Promise<void>;
  /** Test-only: runs immediately before schema evidence decoding. */
  readonly beforeSchemaArtifactDecode?: () => void | Promise<void>;
  readonly observeQuery?: (
    query: StoredCommitAuthorityEvidenceQueryV1,
  ) => void;
}

export function createStoredCommitAuthorityEvidenceLoaderV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1 = {},
): StoredCommitAuthorityEvidenceLoaderV1 {
  const loadEffect = Effect.fn("StoredCommitAuthority.load")(function* (
    input: StoredCommitAuthorityEvidenceAuthorityV1,
  ): Effect.fn.Return<
    StoredCommitAuthorityEvidenceLoadResultV1,
    StoredCommitAuthorityEvidencePersistenceV1Error
  > {
    const authority = captureAuthority(input);
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      authority.deploymentId,
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(
      Effect.catchTag(
        "TrustedScopeAuthorityResolutionError",
        () => Effect.succeed(null),
      ),
      Effect.mapError((error) =>
        new StoredCommitAuthorityEvidencePersistenceV1Error({
          operation: error.operation,
          cause: error.cause,
        })
      ),
    );
    if (located === null) {
      return authorityMismatch("placementChanged");
    }
    if (located.authority.scopeId !== authority.scopeId) {
      return authorityMismatch("scopeChanged");
    }
    if (
      located.authority.storageGeneration !== authority.storageGeneration ||
      located.authority.storageGenerationFence !==
        authority.storageGenerationFence
    ) {
      return authorityMismatch("generationChanged");
    }
    if (located.authority.epoch !== authority.snapshotToken.epoch) {
      return authorityMismatch("epochChanged");
    }
    const repeatableReadTarget = isLocatedRepeatableReadAttemptTargetV1(
      located.target,
    )
      ? located.target
      : null;
    if (repeatableReadTarget === null) {
      return corrupt("repeatableReadCapabilityMissing");
    }

    const captured = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => repeatableReadTarget[RUN_LOCATED_REPEATABLE_READ_V1](
        (tx) => captureRows(tx, authority, options),
      ),
      catch: (cause) =>
        new StoredCommitAuthorityEvidencePersistenceV1Error({
          operation: "repeatableRead",
          cause,
        }),
    }));
    if (options.afterRepeatableRead !== undefined) {
      yield* Effect.tryPromise({
        try: async () => options.afterRepeatableRead?.(),
        catch: (cause) =>
          new StoredCommitAuthorityEvidencePersistenceV1Error({
            operation: "afterRepeatableRead",
            cause,
          }),
      });
    }
    return yield* materializeEffect(
      authority,
      located.authority,
      captured,
      options,
    );
  });

  return Object.freeze({
    loadEffect,
  });
}

function captureAuthority(
  input: StoredCommitAuthorityEvidenceAuthorityV1,
): StoredCommitAuthorityEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    sessionId: input.sessionId,
    attemptFence: input.attemptFence,
    storageGeneration: input.storageGeneration,
    storageGenerationFence: input.storageGenerationFence,
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
    schemaVersionId: input.schemaVersionId,
    session: Object.freeze(structuredClone(input.session)),
    sealIdentity: Object.freeze(structuredClone(input.sealIdentity)),
  });
}

async function captureRows(
  tx: AppRowTransaction,
  authority: StoredCommitAuthorityEvidenceAuthorityV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<CapturedRowsV1> {
  const clockQuery = tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, authority.scopeId))
    .limit(2);
  observeDrizzleQuery("clock", clockQuery, options.observeQuery);
  const clockRows = await clockQuery;
  const nowQuery = tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, authority.scopeId))
    .limit(1);
  const nowRows = await nowQuery;
  const scopeUuid = clockRows[0]?.scopeUuid;
  if (scopeUuid === undefined || scopeUuid === null) {
    return emptyCapture(clockRows, nowRows[0]?.milliseconds);
  }

  const sessionSizeQuery = selectSessionSizeRows(
    tx,
    scopeUuid,
    authority.sessionId,
  );
  observeDrizzleQuery(
    "authoritySizes",
    sessionSizeQuery,
    options.observeQuery,
  );
  const sessionSizeRows = await sessionSizeQuery;
  const leaseQuery = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, authority.sessionId),
    ))
    .limit(2);
  observeDrizzleQuery("lease", leaseQuery, options.observeQuery);
  const leaseRows = await leaseQuery;
  const rootQuery = selectRootScalarRows(
    tx,
    scopeUuid,
    authority.sessionId,
    authority.attemptFence,
  );
  observeDrizzleQuery("root", rootQuery, options.observeQuery);
  const rootRows = await rootQuery;
  const schemaSizeQuery = selectSchemaSizeRows(
    tx,
    authority.deploymentId,
    authority.schemaVersionId,
  );
  observeDrizzleQuery("schemaSizes", schemaSizeQuery, options.observeQuery);
  const schemaSizeRows = await schemaSizeQuery;
  await options.afterSizeProjection?.();

  const skipReason = sizeProjectionFailure(
    sessionSizeRows,
    schemaSizeRows,
  );
  if (skipReason !== undefined) {
    return Object.freeze({
      clockRows: detachRows(clockRows),
      databaseNowText: nowRows[0]?.milliseconds,
      sessionSizeRows: detachRows(sessionSizeRows),
      leaseRows: detachRows(leaseRows),
      rootRows: detachRows(rootRows),
      schemaSizeRows: detachRows(schemaSizeRows),
      skipReason,
      sessionPayloadRows: Object.freeze([]),
      schemaPayloadRows: Object.freeze([]),
      bindingRows: Object.freeze([]),
    });
  }

  const sessionPayloadQuery = tx
    .select({
      scopeUuid: fxSystemTransactionSessions.scopeUuid,
      sessionId: fxSystemTransactionSessions.sessionId,
      attemptFence: fxSystemTransactionSessions.attemptFence,
      validatedArgsJsonText: sql<string>`
        ${fxSystemTransactionSessions.validatedArgsJson}::text
      `,
      validatedArgsCanonicalBytes:
        fxSystemTransactionSessions.validatedArgsCanonicalBytes,
      authorizationGrantJsonText: sql<string>`
        ${fxSystemTransactionSessions.authorizationGrantJson}::text
      `,
      authorizationGrantCanonicalBytes:
        fxSystemTransactionSessions.authorizationGrantCanonicalBytes,
    })
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, authority.sessionId),
    ))
    .limit(2);
  observeDrizzleQuery(
    "authorityPayload",
    sessionPayloadQuery,
    options.observeQuery,
  );
  const sessionPayloadRows = await sessionPayloadQuery;
  const schemaPayloadQuery = tx
    .select({
      deploymentId: fxControlSchemaVersions.deploymentId,
      schemaVersionId: fxControlSchemaVersions.schemaVersionId,
      version: fxControlSchemaVersions.version,
      manifestCodecVersion: fxControlSchemaVersions.manifestCodecVersion,
      manifestJsonText: sql<string>`
        ${fxControlSchemaVersions.manifestJson}::text
      `,
      manifestBytes: fxControlSchemaVersions.manifestBytes,
      manifestSha256: fxControlSchemaVersions.manifestSha256,
      createdAt: fxControlSchemaVersions.createdAt,
    })
    .from(fxControlSchemaVersions)
    .where(and(
      eq(fxControlSchemaVersions.deploymentId, authority.deploymentId),
      eq(
        fxControlSchemaVersions.schemaVersionId,
        authority.schemaVersionId,
      ),
    ))
    .limit(2);
  observeDrizzleQuery(
    "schemaPayload",
    schemaPayloadQuery,
    options.observeQuery,
  );
  const schemaPayloadRows = await schemaPayloadQuery;
  const bindingStatement = sql`
    select
      declared.ordinality::bigint::text as "ordinalText",
      case
        when jsonb_typeof(declared.value -> 'tableId') = 'number'
          then declared.value ->> 'tableId'
        else null
      end as "declaredTableIdText",
      stable.table_id::text as "stableTableIdText"
    from fx_control_schema_version as schema_version
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          schema_version.manifest_json #> '{tableDefinitions,tables}'
        ) = 'array'
          then schema_version.manifest_json #> '{tableDefinitions,tables}'
        else '[]'::jsonb
      end
    ) with ordinality as declared(value, ordinality)
    left join fx_control_table as stable
      on stable.deployment_id = schema_version.deployment_id
      and stable.namespace = 'app'
      and stable.logical_name = case
        when jsonb_typeof(declared.value -> 'logicalName') = 'string'
          then declared.value ->> 'logicalName'
        else null
      end
    where schema_version.deployment_id = ${authority.deploymentId}
      and schema_version.schema_version_id = ${authority.schemaVersionId}
    order by declared.ordinality asc
    limit ${MAX_SCHEMA_MANIFEST_APP_TABLES + 1}
  `;
  options.observeQuery?.(Object.freeze({
    name: "stableBindings",
    sql: "bounded pinned-manifest ordinality binding join",
    params: Object.freeze([
      authority.deploymentId,
      authority.schemaVersionId,
      MAX_SCHEMA_MANIFEST_APP_TABLES + 1,
    ]),
  }));
  const bindingResult: unknown = await tx.execute(bindingStatement);

  return Object.freeze({
    clockRows: detachRows(clockRows),
    databaseNowText: nowRows[0]?.milliseconds,
    sessionSizeRows: detachRows(sessionSizeRows),
    leaseRows: detachRows(leaseRows),
    rootRows: detachRows(rootRows),
    schemaSizeRows: detachRows(schemaSizeRows),
    sessionPayloadRows: detachSessionPayloadRows(sessionPayloadRows),
    schemaPayloadRows: detachSchemaPayloadRows(schemaPayloadRows),
    bindingRows: detachRows(rowsFromExecuteResult(bindingResult)),
  });
}

function selectSessionSizeRows(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
) {
  return tx.select({
    scopeUuid: fxSystemTransactionSessions.scopeUuid,
    sessionId: fxSystemTransactionSessions.sessionId,
    storageGeneration: fxSystemTransactionSessions.storageGeneration,
    storageGenerationFence:
      fxSystemTransactionSessions.storageGenerationFence,
    packageId: fxSystemTransactionSessions.packageId,
    artifactRuntime: fxSystemTransactionSessions.artifactRuntime,
    artifactId: fxSystemTransactionSessions.artifactId,
    sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
    executionModule: fxSystemTransactionSessions.executionModule,
    functionPath: fxSystemTransactionSessions.functionPath,
    functionKind: fxSystemTransactionSessions.functionKind,
    schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
    policyVersion: fxSystemTransactionSessions.policyVersion,
    identityAccessPolicySha256:
      fxSystemTransactionSessions.identityAccessPolicySha256,
    validatedArgsValueCodecVersion:
      fxSystemTransactionSessions.validatedArgsValueCodecVersion,
    validatedArgsSha256: fxSystemTransactionSessions.validatedArgsSha256,
    authorizationGrantId: fxSystemTransactionSessions.authorizationGrantId,
    authorizationGrantValueCodecVersion:
      fxSystemTransactionSessions.authorizationGrantValueCodecVersion,
    authorizationGrantSha256:
      fxSystemTransactionSessions.authorizationGrantSha256,
    authorizationRevocationEpoch:
      fxSystemTransactionSessions.authorizationRevocationEpoch,
    authorizationGrantExpiresAt:
      fxSystemTransactionSessions.authorizationGrantExpiresAt,
    requestKey: fxSystemTransactionSessions.requestKey,
    requestSha256: fxSystemTransactionSessions.requestSha256,
    lifecycle: fxSystemTransactionSessions.lifecycle,
    attemptFence: fxSystemTransactionSessions.attemptFence,
    protocolVersion: fxSystemTransactionSessions.protocolVersion,
    hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
    createdAt: fxSystemTransactionSessions.createdAt,
    updatedAt: fxSystemTransactionSessions.updatedAt,
    validatedArgsJsonByteLengthText: sql<string>`
      octet_length(${fxSystemTransactionSessions.validatedArgsJson}::text)::bigint::text
    `,
    validatedArgsCanonicalByteLengthText: sql<string>`
      octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})::bigint::text
    `,
    authorizationGrantJsonByteLengthText: sql<string>`
      octet_length(${fxSystemTransactionSessions.authorizationGrantJson}::text)::bigint::text
    `,
    authorizationGrantCanonicalByteLengthText: sql<string>`
      octet_length(${fxSystemTransactionSessions.authorizationGrantCanonicalBytes})::bigint::text
    `,
  }).from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
    eq(fxSystemTransactionSessions.sessionId, sessionId),
  )).limit(2);
}

function selectRootScalarRows(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
) {
  return tx.select({
    scopeUuid: fxSystemTransactionJournals.scopeUuid,
    sessionId: fxSystemTransactionJournals.sessionId,
    attemptFence: fxSystemTransactionJournals.attemptFence,
    state: fxSystemTransactionJournals.state,
    lastSyscallSequence: fxSystemTransactionJournals.lastSyscallSequence,
    creationTimeSeed: fxSystemTransactionJournals.creationTimeSeed,
    nextCreationTime: fxSystemTransactionJournals.nextCreationTime,
    readDocuments: fxSystemTransactionJournals.readDocuments,
    readSemanticBytes: fxSystemTransactionJournals.readSemanticBytes,
    pointDependencyCount: fxSystemTransactionJournals.pointDependencyCount,
    writeOperations: fxSystemTransactionJournals.writeOperations,
    writeSemanticBytes: fxSystemTransactionJournals.writeSemanticBytes,
    materialWriteEventEvidenceBytes:
      fxSystemTransactionJournals.materialWriteEventEvidenceBytes,
    failureDimension: fxSystemTransactionJournals.failureDimension,
    sealedFinalSyscallSequence:
      fxSystemTransactionJournals.sealedFinalSyscallSequence,
    sealedJournalByteLengthText: sql<string | null>`
      case when ${fxSystemTransactionJournals.sealedJournalBytes} is null
        then null
        else octet_length(${fxSystemTransactionJournals.sealedJournalBytes})::bigint::text
      end
    `,
    sealedJournalSha256: fxSystemTransactionJournals.sealedJournalSha256,
    sealedResultValueCodecVersion:
      fxSystemTransactionJournals.sealedResultValueCodecVersion,
    sealedResultSemanticBytes:
      fxSystemTransactionJournals.sealedResultSemanticBytes,
    sealedResultByteLengthText: sql<string | null>`
      case when ${fxSystemTransactionJournals.sealedResultBytes} is null
        then null
        else octet_length(${fxSystemTransactionJournals.sealedResultBytes})::bigint::text
      end
    `,
    sealedResultSha256: fxSystemTransactionJournals.sealedResultSha256,
    sealedAt: fxSystemTransactionJournals.sealedAt,
    createdAt: fxSystemTransactionJournals.createdAt,
    updatedAt: fxSystemTransactionJournals.updatedAt,
  }).from(fxSystemTransactionJournals).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
    eq(fxSystemTransactionJournals.sessionId, sessionId),
    eq(fxSystemTransactionJournals.attemptFence, attemptFence),
  )).limit(2);
}

function selectSchemaSizeRows(
  tx: AppRowTransaction,
  deploymentId: TransactionGrantDeploymentIdV1,
  schemaVersionId: CatalogSchemaVersionId,
) {
  return tx.select({
    deploymentId: fxControlSchemaVersions.deploymentId,
    schemaVersionId: fxControlSchemaVersions.schemaVersionId,
    version: fxControlSchemaVersions.version,
    manifestCodecVersion: fxControlSchemaVersions.manifestCodecVersion,
    manifestSha256: fxControlSchemaVersions.manifestSha256,
    createdAt: fxControlSchemaVersions.createdAt,
    manifestJsonByteLengthText: sql<string>`
      octet_length(${fxControlSchemaVersions.manifestJson}::text)::bigint::text
    `,
    manifestCanonicalByteLengthText: sql<string>`
      octet_length(${fxControlSchemaVersions.manifestBytes})::bigint::text
    `,
  }).from(fxControlSchemaVersions).where(and(
    eq(fxControlSchemaVersions.deploymentId, deploymentId),
    eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId),
  )).limit(2);
}

function sizeProjectionFailure(
  sessionRows: ReadonlyArray<SessionSizeRow>,
  schemaRows: ReadonlyArray<SchemaSizeRow>,
): StoredCommitAuthorityCorruptionReasonV1 | undefined {
  if (sessionRows.length !== 1 || schemaRows.length !== 1) {
    return sessionRows.length !== 1
      ? "sessionEvidenceMissingOrDuplicate"
      : "schemaArtifactMissingOrDuplicate";
  }
  const session = sessionRows[0];
  const schema = schemaRows[0];
  if (session === undefined || schema === undefined) {
    return "sizeProjectionInvalid";
  }
  const lengths = [
    session.validatedArgsJsonByteLengthText,
    session.validatedArgsCanonicalByteLengthText,
    session.authorizationGrantJsonByteLengthText,
    session.authorizationGrantCanonicalByteLengthText,
    schema.manifestJsonByteLengthText,
    schema.manifestCanonicalByteLengthText,
  ].map(parseLength);
  if (lengths.some((length) => length === undefined)) {
    return "sizeProjectionInvalid";
  }
  let total = 0;
  for (const length of lengths) {
    if (length === undefined || total > Number.MAX_SAFE_INTEGER - length) {
      return "sizeProjectionInvalid";
    }
    total += length;
  }
  return total > MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1
    ? "evidenceLimitExceeded"
    : undefined;
}

function emptyCapture(
  clockRows: ReadonlyArray<ClockRow>,
  databaseNowText: string | undefined,
): CapturedRowsV1 {
  return Object.freeze({
    clockRows: detachRows(clockRows),
    databaseNowText,
    sessionSizeRows: Object.freeze([]),
    leaseRows: Object.freeze([]),
    rootRows: Object.freeze([]),
    schemaSizeRows: Object.freeze([]),
    sessionPayloadRows: Object.freeze([]),
    schemaPayloadRows: Object.freeze([]),
    bindingRows: Object.freeze([]),
  });
}

function rowsFromExecuteResult(result: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(result)) return result;
  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows;
  }
  throw new Error("Stable-binding query returned an invalid driver result.");
}

function detachRows<Row>(rows: ReadonlyArray<Row>): ReadonlyArray<Row> {
  return Object.freeze(structuredClone(rows));
}

function detachSessionPayloadRows(
  rows: ReadonlyArray<SessionPayloadRow>,
): ReadonlyArray<SessionPayloadRow> {
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    validatedArgsCanonicalBytes:
      new Uint8Array(row.validatedArgsCanonicalBytes),
    authorizationGrantCanonicalBytes:
      new Uint8Array(row.authorizationGrantCanonicalBytes),
  })));
}

function detachSchemaPayloadRows(
  rows: ReadonlyArray<SchemaPayloadRow>,
): ReadonlyArray<SchemaPayloadRow> {
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    manifestBytes: new Uint8Array(row.manifestBytes),
    manifestSha256: new Uint8Array(row.manifestSha256),
  })));
}
