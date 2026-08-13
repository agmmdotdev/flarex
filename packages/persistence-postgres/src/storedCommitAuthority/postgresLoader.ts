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
import {
  detachDriverRows,
  detachUnknownDriverRows,
} from "../detachDriverRows";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { observeDrizzleQuery } from "../drizzleQueryObservation";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
} from "../scopeAuthorityResolution";
import {
  fxControlSchemaVersions,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../schema";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import {
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedRepeatableReadAttemptTargetV1,
} from "../transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";
import {
  materializeEffect,
  parseLength,
  type AttemptChildExistenceRow,
  type CapturedRowsV1,
  type ClockRow,
  type SchemaPayloadRow,
  type SchemaSizeRow,
  type SessionPayloadRow,
  type SessionSizeRow,
} from "./materialization";
import {
  MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  type StoredCommitAuthorityCorruptionReasonV1,
  type StoredCommitAuthorityCaptureAuthorityV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceLoadResultV1,
  type StoredCommitAuthorityEvidenceLoaderV1,
  StoredCommitAuthorityEvidencePersistenceV1Error,
} from "./model";
import {
  EMPTY_APPLICATION_GRAPH_ROWS_V1,
  captureApplicationGraphPayloadRowsV1,
  captureApplicationGraphSizeRowsV1,
  type ApplicationGraphSelectorV1,
} from "./applicationGraphRows";

export interface StoredCommitAuthorityEvidenceQueryV1 {
  readonly name:
    | "clock"
    | "authoritySizes"
    | "lease"
    | "root"
    | "executionClaim"
    | "attemptChildren"
    | "schemaSizes"
    | "applicationGraphSizes"
    | "applicationGraphFunctionSizes"
    | "applicationGraphCandidate"
    | "applicationGraphAnalysis"
    | "applicationGraphRevision"
    | "applicationGraphPublication"
    | "applicationGraphFunction"
    | "applicationGraphSchema"
    | "applicationGraphTaskCatalog"
    | "applicationGraphTaskRuntimePublication"
    | "applicationGraphReadiness"
    | "applicationGraphReadinessFunctions"
    | "applicationGraphActivation"
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
    const capturedResult = yield* captureStoredCommitAuthorityRowsEffect(
      ports,
      authority,
      options,
      false,
    );
    if (capturedResult.kind !== "captured") return capturedResult;
    return yield* materializeEffect(
      authority,
      capturedResult.preliminaryAuthority,
      capturedResult.rows,
      options,
    );
  });

  return Object.freeze({
    loadEffect,
  });
}

export type StoredCommitAuthorityRowsCaptureResultV1 =
  | Readonly<{
      readonly kind: "captured";
      readonly preliminaryAuthority: TrustedScopeAuthority;
      readonly rows: CapturedRowsV1;
    }>
  | Readonly<{
      readonly kind: "authorityMismatch";
      readonly reason:
        | "placementChanged"
        | "scopeChanged"
        | "generationChanged"
        | "epochChanged";
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredCommitAuthorityCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

/** Internal capture shared by sealed C04B1 and open/pristine O08-B2a. */
export const captureStoredCommitAuthorityRowsEffect = Effect.fn(
  "StoredCommitAuthority.captureRows",
)(function* (
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  authority: StoredCommitAuthorityCaptureAuthorityV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
  includeAttemptChildren: boolean,
): Effect.fn.Return<
  StoredCommitAuthorityRowsCaptureResultV1,
  StoredCommitAuthorityEvidencePersistenceV1Error
> {
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    authority.deploymentId,
    {
      scopeMetadata: ports.scopeMetadata,
      provisioningReceipts: ports.provisioningReceipts,
      scopeClockTargets: ports.scopeSessionTargets,
    },
  ).pipe(
    Effect.catchTag("TrustedScopeAuthorityResolutionError", () =>
      Effect.succeed(null),
    ),
    Effect.mapError(
      (error) =>
        new StoredCommitAuthorityEvidencePersistenceV1Error({
          operation: error.operation,
          cause: error.cause,
        }),
    ),
  );
  if (located === null) return captureAuthorityMismatch("placementChanged");
  if (located.authority.scopeId !== authority.scopeId) {
    return captureAuthorityMismatch("scopeChanged");
  }
  if (
    located.authority.storageGeneration !== authority.storageGeneration ||
    located.authority.storageGenerationFence !==
      authority.storageGenerationFence
  ) {
    return captureAuthorityMismatch("generationChanged");
  }
  if (located.authority.epoch !== authority.snapshotToken.epoch) {
    return captureAuthorityMismatch("epochChanged");
  }
  const repeatableReadTarget = isLocatedRepeatableReadAttemptTargetV1(
    located.target,
  )
    ? located.target
    : null;
  if (repeatableReadTarget === null) {
    return captureCorrupt("repeatableReadCapabilityMissing");
  }

  const rows = yield* Effect.uninterruptible(
    Effect.tryPromise({
      try: () =>
        repeatableReadTarget[RUN_LOCATED_REPEATABLE_READ_V1]((tx) =>
          captureRows(tx, authority, options, includeAttemptChildren),
        ),
      catch: (cause) =>
        new StoredCommitAuthorityEvidencePersistenceV1Error({
          operation: "repeatableRead",
          cause,
        }),
    }),
  );
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
  return Object.freeze({
    kind: "captured",
    preliminaryAuthority: located.authority,
    rows,
  });
});

function captureAuthorityMismatch(
  reason: Extract<
    StoredCommitAuthorityRowsCaptureResultV1,
    { readonly kind: "authorityMismatch" }
  >["reason"],
): StoredCommitAuthorityRowsCaptureResultV1 {
  return Object.freeze({ kind: "authorityMismatch", reason });
}

function captureCorrupt(
  reason: StoredCommitAuthorityCorruptionReasonV1,
  cause?: unknown,
): StoredCommitAuthorityRowsCaptureResultV1 {
  return Object.freeze({
    kind: "corrupt",
    reason,
    ...(cause === undefined ? {} : { cause }),
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
  authority: StoredCommitAuthorityCaptureAuthorityV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
  includeAttemptChildren: boolean,
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
  const executionClaimRows = includeAttemptChildren
    ? await selectExecutionClaimRows(
        tx,
        scopeUuid,
        authority.sessionId,
        authority.attemptFence,
        options,
      )
    : Object.freeze([]);
  const attemptChildRows = includeAttemptChildren
    ? await selectAttemptChildExistenceRows(
        tx,
        scopeUuid,
        authority.sessionId,
        authority.attemptFence,
        options,
      )
    : Object.freeze([]);
  const schemaSizeQuery = selectSchemaSizeRows(
    tx,
    authority.deploymentId,
    authority.schemaVersionId,
  );
  observeDrizzleQuery("schemaSizes", schemaSizeQuery, options.observeQuery);
  const schemaSizeRows = await schemaSizeQuery;
  const applicationGraphSelector = captureApplicationGraphSelector(
    authority,
    sessionSizeRows,
  );
  const applicationGraphSizeRows = applicationGraphSelector === undefined
    ? Object.freeze({
        parentSizeRows: Object.freeze([]),
        readinessFunctionSizeRows: Object.freeze([]),
      })
    : await captureApplicationGraphSizeRowsV1(
        tx,
        applicationGraphSelector,
        options,
      );
  await options.afterSizeProjection?.();

  const skipReason = sizeProjectionFailure(
    sessionSizeRows,
    schemaSizeRows,
    applicationGraphSizeRows,
  );
  if (skipReason !== undefined) {
    return Object.freeze({
      clockRows: detachDriverRows(clockRows),
      databaseNowText: nowRows[0]?.milliseconds,
      sessionSizeRows: detachDriverRows(sessionSizeRows),
      leaseRows: detachDriverRows(leaseRows),
      rootRows: detachDriverRows(rootRows),
      executionClaimRows: detachDriverRows(executionClaimRows),
      attemptChildRows: detachDriverRows(attemptChildRows),
      schemaSizeRows: detachDriverRows(schemaSizeRows),
      applicationGraphRows: Object.freeze({
        ...EMPTY_APPLICATION_GRAPH_ROWS_V1,
        ...applicationGraphSizeRows,
      }),
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
      applicationExecutionAuthorityJsonText: sql<string | null>`
        ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}::text
      `,
      applicationExecutionAuthorityCanonicalBytes:
        fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes,
      applicationExecutionAuthoritySha256:
        fxSystemTransactionSessions.applicationExecutionAuthoritySha256,
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
  const applicationGraphRows = applicationGraphSelector === undefined
    ? EMPTY_APPLICATION_GRAPH_ROWS_V1
    : await captureApplicationGraphPayloadRowsV1(
        tx,
        applicationGraphSelector,
        applicationGraphSizeRows,
        options,
      );
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
    clockRows: detachDriverRows(clockRows),
    databaseNowText: nowRows[0]?.milliseconds,
    sessionSizeRows: detachDriverRows(sessionSizeRows),
    leaseRows: detachDriverRows(leaseRows),
    rootRows: detachDriverRows(rootRows),
    executionClaimRows: detachDriverRows(executionClaimRows),
    attemptChildRows: detachDriverRows(attemptChildRows),
    schemaSizeRows: detachDriverRows(schemaSizeRows),
    applicationGraphRows,
    sessionPayloadRows: detachSessionPayloadRows(sessionPayloadRows),
    schemaPayloadRows: detachSchemaPayloadRows(schemaPayloadRows),
    bindingRows: detachUnknownDriverRows(
      rowsFromDriverExecuteResult(
        bindingResult,
        () => {
          throw new Error(
            "Stable-binding query returned an invalid driver result.",
          );
        },
      ),
    ),
  });
}

async function selectExecutionClaimRows(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
) {
  const query = tx
    .select()
    .from(fxSystemTransactionExecutionClaims)
    .where(and(
      eq(fxSystemTransactionExecutionClaims.scopeUuid, scopeUuid),
      eq(fxSystemTransactionExecutionClaims.sessionId, sessionId),
      eq(fxSystemTransactionExecutionClaims.attemptFence, attemptFence),
    ))
    .limit(2);
  observeDrizzleQuery("executionClaim", query, options.observeQuery);
  return await query;
}

async function selectAttemptChildExistenceRows(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<ReadonlyArray<AttemptChildExistenceRow>> {
  const query = tx
    .select({
      receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalLatestReceipts}
      where ${fxSystemTransactionJournalLatestReceipts.scopeUuid} = ${scopeUuid}
        and ${fxSystemTransactionJournalLatestReceipts.sessionId} = ${sessionId}
        and ${fxSystemTransactionJournalLatestReceipts.attemptFence} =
          ${attemptFence}
    )`,
      pointExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalPoints}
      where ${fxSystemTransactionJournalPoints.scopeUuid} = ${scopeUuid}
        and ${fxSystemTransactionJournalPoints.sessionId} = ${sessionId}
        and ${fxSystemTransactionJournalPoints.attemptFence} = ${attemptFence}
    )`,
      indexRangeExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalIndexRanges}
      where ${fxSystemTransactionJournalIndexRanges.scopeUuid} = ${scopeUuid}
        and ${fxSystemTransactionJournalIndexRanges.sessionId} = ${sessionId}
        and ${fxSystemTransactionJournalIndexRanges.attemptFence} =
          ${attemptFence}
    )`,
      eventExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalWriteEvents}
      where ${fxSystemTransactionJournalWriteEvents.scopeUuid} = ${scopeUuid}
        and ${fxSystemTransactionJournalWriteEvents.sessionId} = ${sessionId}
        and ${fxSystemTransactionJournalWriteEvents.attemptFence} =
          ${attemptFence}
    )`,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid))
    .limit(1);
  observeDrizzleQuery("attemptChildren", query, options.observeQuery);
  return await query;
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
    executionAuthorityGeneration:
      fxSystemTransactionSessions.executionAuthorityGeneration,
    applicationExecutionAuthoritySha256:
      fxSystemTransactionSessions.applicationExecutionAuthoritySha256,
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
    applicationExecutionAuthorityJsonByteLengthText: sql<string>`
      coalesce(
        octet_length(${fxSystemTransactionSessions.applicationExecutionAuthorityJson}::text),
        0
      )::bigint::text
    `,
    applicationExecutionAuthorityCanonicalByteLengthText: sql<string>`
      coalesce(
        octet_length(${fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes}),
        0
      )::bigint::text
    `,
    applicationRevisionId: sql<string | null>`
      ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
        #>> '{runtimeTarget,revisionId}'
    `,
    applicationCandidateId: sql<string | null>`
      ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
        #>> '{runtimeTarget,candidateId}'
    `,
    applicationAnalysisId: sql<string | null>`
      ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
        #>> '{runtimeTarget,analysisId}'
    `,
    applicationActivationSequenceText: sql<string | null>`
      ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
        #>> '{activationSequence}'
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
    indexedQuerySyscalls: fxSystemTransactionJournals.indexedQuerySyscalls,
    indexRangeDependencyCount:
      fxSystemTransactionJournals.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes:
      fxSystemTransactionJournals.indexRangeDependencyEvidenceBytes,
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
  applicationGraph: Readonly<{
    readonly parentSizeRows: ReadonlyArray<{
      readonly readinessVersion: number;
      readonly manifestByteLengthText: string | null;
      readonly schemaByteLengthText: string;
      readonly functionCatalogByteLengthText: string;
      readonly functionEntryByteLengthText: string;
      readonly readinessByteLengthText: string;
      readonly taskRuntimeReadinessBasisByteLengthText: string;
      readonly activationByteLengthText: string;
    }>;
    readonly readinessFunctionSizeRows: ReadonlyArray<{
      readonly functionCountText: string;
      readonly functionPathByteLengthText: string;
    }>;
  }>,
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
    session.applicationExecutionAuthorityJsonByteLengthText,
    session.applicationExecutionAuthorityCanonicalByteLengthText,
    schema.manifestJsonByteLengthText,
    schema.manifestCanonicalByteLengthText,
  ].map(parseLength);
  if (session.executionAuthorityGeneration === "application_v1") {
    if (
      applicationGraph.parentSizeRows.length !== 1 ||
      applicationGraph.readinessFunctionSizeRows.length !== 1
    ) return "applicationGraphMissingOrDuplicate";
    const parent = applicationGraph.parentSizeRows[0];
    const children = applicationGraph.readinessFunctionSizeRows[0];
    if (parent === undefined || children === undefined) {
      return "applicationGraphMissingOrDuplicate";
    }
    const childCount = parseLength(children.functionCountText);
    if (childCount === undefined) return "sizeProjectionInvalid";
    if (childCount > 1_024) return "applicationGraphFunctionOverflow";
    lengths.push(...[
      parent.manifestByteLengthText,
      parent.schemaByteLengthText,
      parent.functionCatalogByteLengthText,
      parent.functionEntryByteLengthText,
      parent.readinessByteLengthText,
      parent.taskRuntimeReadinessBasisByteLengthText,
      parent.activationByteLengthText,
      children.functionPathByteLengthText,
      String(childCount * 96),
    ].map(parseLength));
  } else if (
    applicationGraph.parentSizeRows.length !== 0 ||
    applicationGraph.readinessFunctionSizeRows.length !== 0
  ) {
    return "applicationGraphInvalid";
  }
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
    clockRows: detachDriverRows(clockRows),
    databaseNowText,
    sessionSizeRows: Object.freeze([]),
    leaseRows: Object.freeze([]),
    rootRows: Object.freeze([]),
    executionClaimRows: Object.freeze([]),
    attemptChildRows: Object.freeze([]),
    schemaSizeRows: Object.freeze([]),
    applicationGraphRows: EMPTY_APPLICATION_GRAPH_ROWS_V1,
    sessionPayloadRows: Object.freeze([]),
    schemaPayloadRows: Object.freeze([]),
    bindingRows: Object.freeze([]),
  });
}

function captureApplicationGraphSelector(
  authority: StoredCommitAuthorityCaptureAuthorityV1,
  sessionRows: ReadonlyArray<SessionSizeRow>,
): ApplicationGraphSelectorV1 | undefined {
  if (sessionRows.length !== 1) return undefined;
  const session = sessionRows[0];
  if (session?.executionAuthorityGeneration !== "application_v1") {
    return undefined;
  }
  const activationSequence = parsePositiveBigint(
    session.applicationActivationSequenceText,
  );
  if (
    session.applicationRevisionId === null ||
    session.applicationCandidateId === null ||
    session.applicationAnalysisId === null ||
    activationSequence === undefined
  ) return undefined;
  return Object.freeze({
    scopeId: authority.scopeId,
    revisionId: session.applicationRevisionId,
    candidateId: session.applicationCandidateId,
    analysisId: session.applicationAnalysisId,
    functionPath: session.functionPath,
    activationSequence,
  });
}

function parsePositiveBigint(value: string | null): bigint | undefined {
  if (value === null || !/^[1-9][0-9]{0,18}$/u.test(value)) return undefined;
  const decoded = BigInt(value);
  return decoded <= 9_223_372_036_854_775_807n ? decoded : undefined;
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
    applicationExecutionAuthorityCanonicalBytes:
      row.applicationExecutionAuthorityCanonicalBytes === null
        ? null
        : new Uint8Array(row.applicationExecutionAuthorityCanonicalBytes),
    applicationExecutionAuthoritySha256:
      row.applicationExecutionAuthoritySha256 === null
        ? null
        : new Uint8Array(row.applicationExecutionAuthoritySha256),
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
