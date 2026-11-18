import { scopeClockSelection } from "../../scope/scopeClock";
import { fxSystemScopeExecutionAuthorities } from "../../database/schema";
import { isTerminalTransactionSessionLifecycleV1 } from "../../execution/transactionSessionAttemptFacet";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import {
  readPreparedFiniteApplicationTerminalProjection,
} from "../../application/activation/finiteIdentity";
import {
  type PreparedFiniteActiveApplication,
} from "../../application/activation/contracts";
import { snapshotSchemaManifestValue } from "../../storage/catalog/schemaManifestValueSnapshot";
import type {
  OriginalApplicationControlRead,
} from "../../application/readiness/contracts";
import type { OriginalSchemaVersionRead } from "../../storage/catalog/schemaVersionArtifacts";

import {
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  SCHEMA_MANIFEST_CODEC_VERSION_V1,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import type {
  ReplacementScopeIdV1,
  ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { AppRowTransaction } from "../../storage/documents/appRows";
import { fxSystemApplicationActivations } from "../../application/applicationActivationSchema";
import {
  fxSystemApplicationFunctions,
  fxSystemApplicationPublications,
  fxSystemApplicationReadiness,
  fxSystemApplicationRevisionSchemas,
} from "../../application/relations/applicationRelationSchema";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import {
  detachDriverRows,
  detachUnknownDriverRows,
} from "../../database/detachDriverRows";
import { rowsFromDriverExecuteResult } from "../../database/driverExecuteResult";
import { observeDrizzleQuery } from "../../database/drizzleQueryObservation";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
} from "../../scope/scopeAuthorityResolution";
import {
  fxControlSchemaVersions,
  fxControlApplicationSchemaAuthoritiesV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../database/schema";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import {
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedRepeatableReadAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";
import {
  materializeEffect,
  materializeFiniteExecutionSchema,
  parseLength,
  type AttemptChildExistenceRow,
  type ApplicationGraphPayloadRow,
  type ApplicationGraphScopePayloadRow,
  type ApplicationGraphSizeRow,
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

export interface StoredCommitAuthorityEvidenceQueryV1 {
  readonly name:
    | "attemptHeader"
    | "executionClaim"
    | "attemptChildren"
    | "schemaSizes"
    | "applicationGraphSizes"
    | "applicationSchemaAuthoritySizes"
    | "authorityPayload"
    | "schemaPayload"
    | "applicationGraphPayload"
    | "applicationSchemaAuthorityPayload"
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

export interface StoredCommitAuthorityEvidenceLoaderPortsV1
  extends PointMutationSessionAuthorityResolutionPortsV1 {
  /** Immutable control-plane schema evidence required by Application authority. */
  readonly applicationControlDb?: FlarexMetadataDatabase;
}

export function createStoredCommitAuthorityEvidenceLoaderV1(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
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

interface ApplicationGraphSelector {
  readonly activationSequence: bigint;
  readonly revisionId: string;
  readonly functionPath: string;
  readonly applicationSchemaSha256: Uint8Array;
}
export type ApplicationGraphSessionSelector = Pick<SessionSizeRow,
  "executionAuthorityGeneration" | "applicationExecutionAuthorityFormat" |
  "applicationExecutionAuthorityVersionText" | "applicationExecutionAuthorityActivationSequence" |
  "applicationExecutionAuthorityRevisionId" | "applicationExecutionAuthorityFunctionPath" |
  "applicationExecutionAuthoritySchemaSha256">;

export interface PreparedTerminalControl {
  readonly schemaSizeRows: ReadonlyArray<SchemaSizeRow>;
  readonly schemaPayloadRows: ReadonlyArray<SchemaPayloadRow>;
  readonly schemaAuthoritySizeRows: Readonly<Awaited<ReturnType<typeof selectApplicationSchemaAuthoritySizeRows>>>;
  readonly schemaAuthorityPayloadRows: Readonly<Awaited<ReturnType<typeof selectApplicationSchemaAuthorityPayloadRows>>>;
  readonly bindingRows: ReadonlyArray<unknown>;
}

/** Trusted finite entry needs the already authenticated decoded schema only.
 * Durable seal/recovery retain their full control evidence query profile. */
export type PreparedFiniteTerminalControl = Effect.Success<ReturnType<typeof materializeFiniteExecutionSchema>>;

/** The genuine Application construction owner authenticates these originals once. */
export const prepareFiniteApplicationExecutionSchema = Effect.fn("StoredCommitAuthority.prepareFiniteApplicationExecutionSchema")(
  function* (original: OriginalApplicationControlRead | Readonly<{ database: FlarexMetadataDatabase; artifact: OriginalSchemaVersionRead }>,
    expected: Readonly<{ deploymentId: string; schemaVersionId: CatalogSchemaVersionId }>) {
    const deploymentId = yield* Schema.decodeUnknownEffect(TransactionGrantDeploymentIdV1Schema)(expected.deploymentId)
      .pipe(Effect.mapError(cause => new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode", cause })));
    const authority = { deploymentId, schemaVersionId: expected.schemaVersionId };
    const payload = original.artifact.payload;
    if (payload === null) return yield* Effect.fail(new StoredCommitAuthorityEvidencePersistenceV1Error({
      operation: "beforeSchemaArtifactDecode", cause: "Finite Application schema original payload unavailable" }));
    const bindingRows = yield* Effect.tryPromise({ try: () => selectTerminalStableBindings(original.database, authority, {}),
      catch: cause => new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode", cause }) });
    const schema = yield* materializeFiniteExecutionSchema(authority, {
      schemaSizeRows: [original.artifact.sizes], schemaPayloadRows: [payload], bindingRows,
    });
    return Object.freeze({ schemaManifest: snapshotSchemaManifestValue(schema.schemaManifest), stableBindings: schema.stableBindings });
  },
);

/** Finite entry only: the existing native preparation lends its authenticated
 * originals. No absent-evidence branch can select the full query profile. */
export const prepareFiniteTerminalControlEffect = Effect.fn("StoredCommitAuthority.prepareFiniteTerminalControl")(
function* (ports: StoredCommitAuthorityEvidenceLoaderPortsV1, authority: StoredCommitAuthorityCaptureAuthorityV1,
  session: ApplicationGraphSessionSelector | undefined, application: PreparedFiniteActiveApplication): Effect.fn.Return<
    PreparedFiniteTerminalControl, StoredCommitAuthorityEvidencePersistenceV1Error
  > {
  const selector = captureApplicationGraphSelector(session);
  const db = ports.applicationControlDb;
  if (selector === undefined || db === undefined) return yield* Effect.fail(
    new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode",
      cause: "Finite Application terminal control evidence unavailable" }));
  const projection = readPreparedFiniteApplicationTerminalProjection(application, db, selector.functionPath, sizes => {
      const jsonLength = parseLength(sizes.manifestJsonByteLengthText);
      const canonicalLength = parseLength(sizes.manifestCanonicalByteLengthText);
      const bindingLength = parseLength(sizes.schemaBindingByteLengthText);
      return jsonLength === undefined || canonicalLength === undefined || bindingLength === undefined ||
        jsonLength + canonicalLength + bindingLength > MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1
        ? Result.fail(new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode",
          cause: "Finite Application terminal control materialization budget exceeded" })) : Result.succeed(undefined);
    });
  const projected = yield* Effect.fromResult<Result.Result.Success<typeof projection>, Result.Result.Failure<typeof projection>>(projection)
    .pipe(Effect.mapError(cause => cause instanceof StoredCommitAuthorityEvidencePersistenceV1Error ? cause :
      new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode", cause })));
  if (projected.kind === "relation") {
    const { basis, authority: schema, binding, artifact } = projected;
    if (authority.deploymentId !== basis.deploymentId || authority.scopeId !== basis.authority.scopeId ||
      authority.schemaVersionId !== basis.schemaVersionId || selector.revisionId !== basis.revisionId ||
      !projected.functionDeclared || !bytesEqualFullScan(selector.applicationSchemaSha256, basis.applicationSchemaSha256) ||
      schema.deploymentId !== basis.deploymentId || schema.schemaVersionId !== basis.schemaVersionId ||
      artifact.sizes.deploymentId !== basis.deploymentId || artifact.sizes.schemaVersionId !== basis.schemaVersionId ||
      !bytesEqualFullScan(artifact.sizes.manifestSha256, basis.schemaManifestSha256) || artifact.payload === null ||
      binding.manifestBinding.sha256Hex !== encodeBytesToLowercaseHex(basis.manifestSchemaBindingSha256) ||
      !bytesEqualFullScan(binding.relationBinding.boundPublicationSha256, basis.boundPublicationSha256) ||
      !bytesEqualFullScan(binding.relationBinding.applicationSchemaSha256, basis.applicationSchemaSha256) ||
      !bytesEqualFullScan(binding.relationBinding.schemaManifestSha256, basis.schemaManifestSha256))
      return yield* Effect.fail(new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode",
        cause: "Finite composite Application terminal selector mismatch" }));
    return projected.schema;
  }
  const { basis, schemaVersion, artifact, binding } = projected;
  const sizes = artifact.sizes;
  // Replacement admission authenticates the original signed program against a
  // fresh head. These immutable schema originals do not pin that head's sequence.
  if (authority.deploymentId !== basis.deploymentId || authority.scopeId !== basis.scopeId ||
    authority.schemaVersionId !== basis.schemaVersionId || selector.revisionId !== basis.revisionId ||
    !basis.functionDeclared ||
    !bytesEqualFullScan(selector.applicationSchemaSha256, basis.applicationSchemaSha256) ||
    sizes.deploymentId !== basis.deploymentId || sizes.schemaVersionId !== basis.schemaVersionId ||
    sizes.version !== schemaVersion || sizes.manifestCodecVersion !== SCHEMA_MANIFEST_CODEC_VERSION_V1 ||
    !bytesEqualFullScan(sizes.manifestSha256, basis.schemaManifestSha256) ||
    binding.status !== "published" || binding.deploymentId !== basis.deploymentId ||
    binding.schemaVersionId !== basis.schemaVersionId || binding.schemaVersion !== schemaVersion ||
    !bytesEqualFullScan(binding.applicationSchemaSha256, basis.applicationSchemaSha256) ||
    binding.schemaManifestSha256 === null || binding.bindingSha256 === null ||
    !bytesEqualFullScan(binding.schemaManifestSha256, basis.schemaManifestSha256) ||
    !bytesEqualFullScan(binding.bindingSha256, basis.schemaBindingSha256)) return yield* Effect.fail(
      new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode",
        cause: "Finite Application terminal control selector mismatch" }));
  const canonicalLength = parseLength(sizes.manifestCanonicalByteLengthText);
  const bindingLength = parseLength(projected.schemaBindingByteLengthText);
  const payload = artifact.payload;
  if (payload === null || binding.bindingByteLength === null || payload.manifestCodecVersion !== sizes.manifestCodecVersion ||
    payload.manifestByteLength !== canonicalLength ||
    binding.bindingByteLength !== bindingLength) return yield* Effect.fail(
      new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode",
        cause: "Finite Application terminal control original payload unavailable" }));
  return projected.schema;
});

/** Full, durable-seal and recovery query profile. The target capture still authenticates
 * the complete selected graph and admits all representations before decoding. */
export const prepareTerminalControlEffect = Effect.fn("StoredCommitAuthority.prepareTerminalControl")(function* (
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  authority: StoredCommitAuthorityCaptureAuthorityV1,
  session: ApplicationGraphSessionSelector | undefined,
): Effect.fn.Return<PreparedTerminalControl | undefined, StoredCommitAuthorityEvidencePersistenceV1Error> {
  const selector = captureApplicationGraphSelector(session);
  if (session?.executionAuthorityGeneration !== "application_v1") return undefined;
  if (selector === undefined || ports.applicationControlDb === undefined) {
    return yield* Effect.fail(new StoredCommitAuthorityEvidencePersistenceV1Error({
      operation: "beforeSchemaArtifactDecode", cause: "Application terminal control evidence unavailable",
    }));
  }
  const db = ports.applicationControlDb;
  return yield* Effect.tryPromise({
    try: async () => {
      const schemaSizeRows = detachDriverRows(await selectSchemaSizeRows(db, authority.deploymentId, authority.schemaVersionId));
      const schemaAuthoritySizeRows = detachDriverRows(await selectApplicationSchemaAuthoritySizeRows(db, authority.deploymentId, selector.applicationSchemaSha256, {}));
      const size = schemaSizeRows[0];
      const schemaLengths = size === undefined ? [] : [size.manifestJsonByteLengthText, size.manifestCanonicalByteLengthText].map(parseLength);
      const bindingLength = parseLength(schemaAuthoritySizeRows[0]?.schemaBindingByteLengthText);
      const admitted = schemaSizeRows.length === 1 && schemaLengths.every(value => value !== undefined) &&
        schemaLengths.reduce((total, value) => total + (value ?? 0), 0) + (bindingLength ?? 0) <=
          MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1;
      const schemaPayloadRows = admitted ? detachSchemaPayloadRows(await db.select({
        deploymentId: fxControlSchemaVersions.deploymentId, schemaVersionId: fxControlSchemaVersions.schemaVersionId,
        version: fxControlSchemaVersions.version, manifestCodecVersion: fxControlSchemaVersions.manifestCodecVersion,
        manifestJsonText: sql<string>`${fxControlSchemaVersions.manifestJson}::text`,
        manifestBytes: fxControlSchemaVersions.manifestBytes, manifestSha256: fxControlSchemaVersions.manifestSha256,
        createdAt: fxControlSchemaVersions.createdAt,
      }).from(fxControlSchemaVersions).where(and(eq(fxControlSchemaVersions.deploymentId, authority.deploymentId), eq(fxControlSchemaVersions.schemaVersionId, authority.schemaVersionId))).limit(2)) : Object.freeze([]);
      const schemaAuthorityPayloadRows = admitted && bindingLength !== undefined
        ? detachDriverRows(await selectApplicationSchemaAuthorityPayloadRows(db, authority.deploymentId, selector.applicationSchemaSha256, {})) : Object.freeze([]);
      return Object.freeze({ schemaSizeRows, schemaPayloadRows, schemaAuthoritySizeRows,
        schemaAuthorityPayloadRows, bindingRows: admitted ? await selectTerminalStableBindings(db, authority, {}) : Object.freeze([]) });
    },
    catch: cause => new StoredCommitAuthorityEvidencePersistenceV1Error({ operation: "beforeSchemaArtifactDecode", cause }),
  });
});

const DECIMAL_SEQUENCE = /^[1-9][0-9]*$/;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

function captureApplicationGraphSelector(
  session: ApplicationGraphSessionSelector | undefined,
): ApplicationGraphSelector | undefined {
  if (session?.executionAuthorityGeneration !== "application_v1" ||
    session.applicationExecutionAuthorityFormat !==
      "flarex.application-mutation-execution-authority" ||
    session.applicationExecutionAuthorityVersionText !== "1") return undefined;
  const sequence = session.applicationExecutionAuthorityActivationSequence;
  if (typeof sequence !== "string" || !DECIMAL_SEQUENCE.test(sequence)) {
    return undefined;
  }
  const activationSequence = BigInt(sequence);
  const revisionId = session.applicationExecutionAuthorityRevisionId;
  const functionPath = session.applicationExecutionAuthorityFunctionPath;
  const schemaSha256 = session.applicationExecutionAuthoritySchemaSha256;
  if (activationSequence > MAX_POSTGRES_BIGINT ||
    typeof revisionId !== "string" ||
    typeof functionPath !== "string" ||
    typeof schemaSha256 !== "string" ||
    !LOWERCASE_SHA256.test(schemaSha256)) return undefined;
  return Object.freeze({
    activationSequence,
    revisionId,
    functionPath,
    applicationSchemaSha256: decodeSha256Hex(schemaSha256),
  });
}

function decodeSha256Hex(value: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
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
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: authority.deploymentId, scopeId: authority.scopeId },
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
          captureStoredCommitAuthorityRowsInTransaction(tx, authority, ports, options, includeAttemptChildren),
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

export async function captureStoredCommitAuthorityRowsInTransaction(
  tx: AppRowTransaction,
  authority: StoredCommitAuthorityCaptureAuthorityV1,
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
  includeAttemptChildren: boolean,
  preparedControl?: PreparedTerminalControl,
): Promise<CapturedRowsV1> {
  // Each join uses the complete primary key; absent children stay absent.
  // Keep large session and sealed-journal payloads behind size admission.
  const headerQuery = tx.select({
    clock: scopeClockSelection(),
    session: sessionSizeFields,
    lease: getTableColumns(fxSystemSnapshotLeases),
    root: rootScalarFields,
  }).from(fxSystemScopeClocks)
    .innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .leftJoin(fxSystemTransactionSessions, and(
      eq(fxSystemTransactionSessions.scopeUuid, fxSystemScopeClocks.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, authority.sessionId),
    ))
    .leftJoin(fxSystemSnapshotLeases, and(
      eq(fxSystemSnapshotLeases.scopeUuid, fxSystemScopeClocks.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, authority.sessionId),
    ))
    .leftJoin(fxSystemTransactionJournals, and(
      eq(fxSystemTransactionJournals.scopeUuid, fxSystemScopeClocks.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, authority.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, authority.attemptFence),
    ))
    .where(eq(fxSystemScopeClocks.scopeId, authority.scopeId))
    .limit(2);
  observeDrizzleQuery("attemptHeader", headerQuery, options.observeQuery);
  const headerRows = await headerQuery;
  const clockRows = headerRows.map(row => row.clock);
  const sessionSizeRows = headerRows.flatMap(row => row.session === null ? [] : [row.session]);
  const leaseRows = headerRows.flatMap(row => row.lease === null ? [] : [row.lease]);
  const rootRows = headerRows.flatMap(row => row.root === null ? [] : [row.root]);
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
  if (sessionSizeRows.length === 1 &&
    isTerminalTransactionSessionLifecycleV1(sessionSizeRows[0]?.lifecycle)) {
    await options.afterSizeProjection?.();
    return Object.freeze({
      ...emptyCapture(clockRows, nowRows[0]?.milliseconds),
      sessionSizeRows: detachDriverRows(sessionSizeRows),
      leaseRows: detachDriverRows(leaseRows),
      rootRows: detachDriverRows(rootRows),
      executionClaimRows: detachDriverRows(executionClaimRows),
      attemptChildRows: detachDriverRows(attemptChildRows),
    });
  }
  const applicationSelector = captureApplicationGraphSelector(
    sessionSizeRows[0],
  );
  const schemaDb = applicationSelector === undefined
    ? tx
    : ports.applicationControlDb;
  const schemaSizeQuery = schemaDb === undefined ? null : selectSchemaSizeRows(
    schemaDb,
    authority.deploymentId,
    authority.schemaVersionId,
  );
  if (schemaSizeQuery !== null) {
    observeDrizzleQuery("schemaSizes", schemaSizeQuery, options.observeQuery);
  }
  const schemaSizeRows = preparedControl !== undefined ? preparedControl.schemaSizeRows : schemaSizeQuery === null
    ? Object.freeze([])
    : await schemaSizeQuery;
  const scopeApplicationGraphSizeRows = applicationSelector !== undefined
    ? await selectApplicationGraphSizeRows(
        tx,
        authority.deploymentId,
        authority.scopeId,
        applicationSelector.activationSequence,
        applicationSelector.revisionId,
        applicationSelector.functionPath,
        applicationSelector.applicationSchemaSha256,
        options,
      )
    : Object.freeze([]);
  const scopeApplicationGraphSize = scopeApplicationGraphSizeRows[0];
  const applicationGraphKind = scopeApplicationGraphSize?.kind;
  const schemaAuthoritySizeRows = preparedControl !== undefined ? preparedControl.schemaAuthoritySizeRows : applicationSelector !== undefined &&
      applicationGraphKind === "legacy" &&
      ports.applicationControlDb !== undefined
    ? await selectApplicationSchemaAuthoritySizeRows(
        ports.applicationControlDb,
        authority.deploymentId,
        applicationSelector.applicationSchemaSha256,
        options,
      )
    : Object.freeze([]);
  const applicationGraphSizeRows = scopeApplicationGraphSizeRows.length !== 1 || scopeApplicationGraphSize === undefined
    ? Object.freeze([])
    : applicationGraphKind === "relation"
    ? scopeApplicationGraphSizeRows
    : schemaAuthoritySizeRows.length === 1
    ? Object.freeze([Object.freeze({
        ...scopeApplicationGraphSize,
        schemaBindingByteLengthText:
          schemaAuthoritySizeRows[0]?.schemaBindingByteLengthText ?? "",
      })])
    : Object.freeze([]);
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
      applicationGraphSizeRows: detachDriverRows(applicationGraphSizeRows),
      skipReason,
      sessionPayloadRows: Object.freeze([]),
      schemaPayloadRows: Object.freeze([]),
      applicationGraphPayloadRows: Object.freeze([]),
      bindingRows: Object.freeze([]),
    });
  }

  const sessionPayloadQuery = tx
    .select({
      scopeUuid: fxSystemTransactionSessions.scopeUuid,
      sessionId: fxSystemTransactionSessions.sessionId,
      attemptFence: fxSystemTransactionSessions.attemptFence,
      validatedArgsJsonText: sql<string | null>`
        ${fxSystemTransactionSessions.validatedArgsJson}::text
      `,
      validatedArgsCanonicalBytes:
        fxSystemTransactionSessions.validatedArgsCanonicalBytes,
      authorizationGrantJsonText: sql<string | null>`
        ${fxSystemTransactionSessions.authorizationGrantJson}::text
      `,
      authorizationGrantCanonicalBytes:
        fxSystemTransactionSessions.authorizationGrantCanonicalBytes,
      applicationExecutionAuthorityJsonText: sql<string | null>`case
        when ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
          is null then null
        else ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}::text
      end`,
      applicationExecutionAuthorityCanonicalBytes:
        fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes,
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
  const schemaPayloadQuery = schemaDb === undefined ? null : schemaDb
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
  if (schemaPayloadQuery !== null) {
    observeDrizzleQuery(
      "schemaPayload",
      schemaPayloadQuery,
      options.observeQuery,
    );
  }
  const schemaPayloadRows = preparedControl !== undefined ? preparedControl.schemaPayloadRows : schemaPayloadQuery === null
    ? Object.freeze([])
    : await schemaPayloadQuery;
  const scopeApplicationGraphPayloadRows = applicationGraphSizeRows.length === 1 &&
      applicationSelector !== undefined
    ? await selectApplicationGraphPayloadRows(
        tx,
        authority.deploymentId,
        authority.scopeId,
        applicationSelector.activationSequence,
        applicationSelector.revisionId,
        applicationSelector.functionPath,
        applicationSelector.applicationSchemaSha256,
        applicationGraphSizeRows[0]?.kind,
        options,
      )
    : Object.freeze([]);
  const schemaAuthorityPayloadRows = preparedControl !== undefined ? preparedControl.schemaAuthorityPayloadRows : applicationGraphSizeRows.length === 1 &&
      applicationGraphKind === "legacy" && applicationSelector !== undefined &&
      ports.applicationControlDb !== undefined
    ? await selectApplicationSchemaAuthorityPayloadRows(
        ports.applicationControlDb,
        authority.deploymentId,
        applicationSelector.applicationSchemaSha256,
        options,
      )
    : Object.freeze([]);
  let applicationGraphPayloadRows: ReadonlyArray<ApplicationGraphPayloadRow> =
    Object.freeze([]);
  const scopeGraph = scopeApplicationGraphPayloadRows[0];
  if (applicationGraphKind === "relation" &&
    scopeApplicationGraphPayloadRows.length === 1 &&
    scopeGraph?.kind === "relation") {
    applicationGraphPayloadRows = Object.freeze([scopeGraph]);
  } else if (applicationGraphKind === "legacy" &&
    scopeApplicationGraphPayloadRows.length === 1 &&
    schemaAuthorityPayloadRows.length === 1 && scopeGraph?.kind === "legacy") {
    const schemaAuthority = schemaAuthorityPayloadRows[0];
    if (schemaAuthority !== undefined) {
      applicationGraphPayloadRows = Object.freeze([Object.freeze({
        ...scopeGraph,
        schemaAuthority,
      })]);
    }
  }
  const bindingRows = preparedControl?.bindingRows ?? await selectTerminalStableBindings(schemaDb, authority, options);

  return Object.freeze({
    clockRows: detachDriverRows(clockRows),
    databaseNowText: nowRows[0]?.milliseconds,
    sessionSizeRows: detachDriverRows(sessionSizeRows),
    leaseRows: detachDriverRows(leaseRows),
    rootRows: detachDriverRows(rootRows),
    executionClaimRows: detachDriverRows(executionClaimRows),
    attemptChildRows: detachDriverRows(attemptChildRows),
    schemaSizeRows: detachDriverRows(schemaSizeRows),
    applicationGraphSizeRows: detachDriverRows(applicationGraphSizeRows),
    sessionPayloadRows: detachSessionPayloadRows(sessionPayloadRows),
    schemaPayloadRows: detachSchemaPayloadRows(schemaPayloadRows),
    applicationGraphPayloadRows:
      detachApplicationGraphPayloadRows(applicationGraphPayloadRows),
    bindingRows,
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

export async function selectAttemptChildExistenceRows(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<ReadonlyArray<AttemptChildExistenceRow>> {
  const query = tx
    .select({
      receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalReceipts}
      where ${fxSystemTransactionJournalReceipts.scopeUuid} = ${scopeUuid}
        and ${fxSystemTransactionJournalReceipts.sessionId} = ${sessionId}
        and ${fxSystemTransactionJournalReceipts.attemptFence} =
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
      relationDependencyExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalRelationIncomingDependencies}
      where ${fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid} =
          ${scopeUuid}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.sessionId} =
          ${sessionId}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.attemptFence} =
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

const sessionSizeFields = {
  scopeUuid: fxSystemTransactionSessions.scopeUuid,
  sessionId: fxSystemTransactionSessions.sessionId,
  storageGeneration: fxSystemTransactionSessions.storageGeneration,
  storageGenerationFence:
    fxSystemTransactionSessions.storageGenerationFence,
  executionAuthorityGeneration:
    fxSystemTransactionSessions.executionAuthorityGeneration,
  applicationExecutionAuthoritySha256:
    fxSystemTransactionSessions.applicationExecutionAuthoritySha256,
  applicationExecutionAuthorityFormat: sql<string | null>`
    ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      ->> 'format'
  `,
  applicationExecutionAuthorityVersionText: sql<string | null>`
    ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      ->> 'version'
  `,
  applicationExecutionAuthorityActivationSequence: sql<string | null>`
    ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      ->> 'activationSequence'
  `,
  applicationExecutionAuthorityRevisionId: sql<string | null>`
    ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      #>> '{runtimeTarget,revisionId}'
  `,
  applicationExecutionAuthorityFunctionPath: sql<string | null>`
    ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      #>> '{runtimeTarget,function,path}'
  `,
  applicationExecutionAuthoritySchemaSha256: sql<string | null>`
    ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      #>> '{runtimeTarget,schemaSha256}'
  `,
  applicationExecutionAuthorityJsonByteLengthText: sql<string | null>`case
    when ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}
      is null then null else octet_length(
        ${fxSystemTransactionSessions.applicationExecutionAuthorityJson}::text
      )::bigint::text end`,
  applicationExecutionAuthorityCanonicalByteLengthText:
    sql<string | null>`case
      when ${fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes}
        is null then null else octet_length(
          ${fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes}
        )::bigint::text end`,
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
  validatedArgsJsonByteLengthText: sql<string | null>`
    octet_length(${fxSystemTransactionSessions.validatedArgsJson}::text)::bigint::text
  `,
  validatedArgsCanonicalByteLengthText: sql<string | null>`
    octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})::bigint::text
  `,
  authorizationGrantJsonByteLengthText: sql<string | null>`
    octet_length(${fxSystemTransactionSessions.authorizationGrantJson}::text)::bigint::text
  `,
  authorizationGrantCanonicalByteLengthText: sql<string | null>`
    octet_length(${fxSystemTransactionSessions.authorizationGrantCanonicalBytes})::bigint::text
  `,
};

const rootScalarFields = {
  scopeUuid: fxSystemTransactionJournals.scopeUuid,
  sessionId: fxSystemTransactionJournals.sessionId,
  attemptFence: fxSystemTransactionJournals.attemptFence,
  journalFormat: fxSystemTransactionJournals.journalFormat,
  executionProfile: fxSystemTransactionJournals.executionProfile,
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
  relationReadSyscalls: fxSystemTransactionJournals.relationReadSyscalls,
  relationDependencyCount:
    fxSystemTransactionJournals.relationDependencyCount,
  relationBaseOccurrences:
    fxSystemTransactionJournals.relationBaseOccurrences,
  writeOperations: fxSystemTransactionJournals.writeOperations,
  writeSemanticBytes: fxSystemTransactionJournals.writeSemanticBytes,
  materialWriteEventEvidenceBytes:
    fxSystemTransactionJournals.materialWriteEventEvidenceBytes,
  receiptEvidenceBytes: fxSystemTransactionJournals.receiptEvidenceBytes,
  participantWorkBytes: fxSystemTransactionJournals.participantWorkBytes,
  participantWorkCalls: fxSystemTransactionJournals.participantWorkCalls,
  failureDimension: fxSystemTransactionJournals.failureDimension,
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
};

function selectSchemaSizeRows(
  db: Pick<AppRowTransaction, "select">,
  deploymentId: TransactionGrantDeploymentIdV1,
  schemaVersionId: CatalogSchemaVersionId,
) {
  return db.select({
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

async function selectApplicationGraphSizeRows(
  tx: AppRowTransaction,
  deploymentId: TransactionGrantDeploymentIdV1,
  scopeId: ReplacementScopeIdV1,
  activationSequence: bigint,
  revisionId: string,
  functionPath: string,
  applicationSchemaSha256: Uint8Array,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<ReadonlyArray<ApplicationGraphSizeRow>> {
  const contractRows = await tx.select({
    readinessContractVersion:
      fxSystemApplicationActivations.readinessContractVersion,
  }).from(fxSystemApplicationActivations).where(and(
    eq(fxSystemApplicationActivations.scopeId, scopeId),
    eq(fxSystemApplicationActivations.activationSequence, activationSequence),
    eq(fxSystemApplicationActivations.revisionId, revisionId),
  )).limit(2);
  const contract = contractRows[0]?.readinessContractVersion;
  if (contractRows.length !== 1 || (contract !== 1 && contract !== 2 && contract !== 3)) {
    return Object.freeze([]);
  }
  if (contract === 2 || contract === 3) {
    const query = tx.select({
      kind: sql<"relation">`'relation'`,
      activationByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationActivations.activationBytes}
      )::bigint::text`,
      readinessByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationReadiness.readinessBytes}
      )::bigint::text`,
      manifestByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationAnalysesV1.manifestBytes}
      )::bigint::text`,
      schemaByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationPublications.schemaBytes}
      )::bigint::text`,
      functionCatalogByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationPublications.functionCatalogBytes}
      )::bigint::text`,
      functionEntryByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationFunctions.entryBytes}
      )::bigint::text`,
      schemaBindingByteLengthText: sql<string>`'0'`,
      relationSetReadinessByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationReadiness.relationSetReadinessBytes}
      )::bigint::text`,
    }).from(fxSystemApplicationActivations)
      .innerJoin(fxSystemApplicationReadiness, and(
        eq(fxSystemApplicationReadiness.scopeId,
          fxSystemApplicationActivations.scopeId),
        eq(fxSystemApplicationReadiness.revisionId,
          fxSystemApplicationActivations.revisionId),
        eq(fxSystemApplicationReadiness.readinessSha256,
          fxSystemApplicationActivations.relationReadinessSha256),
      ))
      .innerJoin(fxSystemApplicationRevisionsV2, and(
        eq(fxSystemApplicationRevisionsV2.scopeId,
          fxSystemApplicationActivations.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId,
          fxSystemApplicationActivations.revisionId),
      ))
      .innerJoin(fxSystemApplicationAnalysesV1, and(
        eq(fxSystemApplicationAnalysesV1.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationAnalysesV1.analysisId,
          fxSystemApplicationRevisionsV2.analysisId),
      ))
      .innerJoin(fxSystemApplicationPublications, and(
        eq(fxSystemApplicationPublications.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationPublications.revisionId,
          fxSystemApplicationRevisionsV2.revisionId),
        eq(fxSystemApplicationPublications.deploymentId, deploymentId),
        eq(fxSystemApplicationPublications.schemaSha256,
          applicationSchemaSha256),
      ))
      .innerJoin(fxSystemApplicationFunctions, and(
        eq(fxSystemApplicationFunctions.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationFunctions.revisionId,
          fxSystemApplicationRevisionsV2.revisionId),
        eq(fxSystemApplicationFunctions.functionPath, functionPath),
      ))
      .innerJoin(fxSystemApplicationRevisionSchemas, and(
        eq(fxSystemApplicationRevisionSchemas.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationRevisionSchemas.revisionId,
          fxSystemApplicationRevisionsV2.revisionId),
      ))
      .where(and(
        eq(fxSystemApplicationActivations.scopeId, scopeId),
        eq(fxSystemApplicationActivations.activationSequence,
          activationSequence),
        eq(fxSystemApplicationActivations.revisionId, revisionId),
        inArray(fxSystemApplicationActivations.readinessContractVersion, [2, 3]),
      )).limit(2);
    observeDrizzleQuery("applicationGraphSizes", query, options.observeQuery);
    return await query;
  }
  const query = tx.select({
      kind: sql<"legacy">`'legacy'`,
      activationByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationActivations.activationBytes}
      )::bigint::text`,
      readinessByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationReadinessV1.readinessBytes}
      )::bigint::text`,
      manifestByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationAnalysesV1.manifestBytes}
      )::bigint::text`,
      schemaByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationPublicationsV1.schemaBytes}
      )::bigint::text`,
      functionCatalogByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationPublicationsV1.functionCatalogBytes}
      )::bigint::text`,
      functionEntryByteLengthText: sql<string>`octet_length(
        ${fxSystemApplicationFunctionsV1.entryBytes}
      )::bigint::text`,
      schemaBindingByteLengthText: sql<string>`'0'`,
      relationSetReadinessByteLengthText: sql<string>`'0'`,
    })
    .from(fxSystemApplicationActivations)
    .innerJoin(fxSystemApplicationReadinessV1, and(
      eq(fxSystemApplicationReadinessV1.scopeId,
        fxSystemApplicationActivations.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId,
        fxSystemApplicationActivations.revisionId),
      eq(fxSystemApplicationReadinessV1.readinessSha256,
        fxSystemApplicationActivations.legacyReadinessSha256),
    ))
    .innerJoin(fxSystemApplicationRevisionsV2, and(
      eq(fxSystemApplicationRevisionsV2.scopeId,
        fxSystemApplicationActivations.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId,
        fxSystemApplicationActivations.revisionId),
    ))
    .innerJoin(fxSystemApplicationAnalysesV1, and(
      eq(fxSystemApplicationAnalysesV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationAnalysesV1.analysisId,
        fxSystemApplicationRevisionsV2.analysisId),
    ))
    .innerJoin(fxSystemApplicationPublicationsV1, and(
      eq(fxSystemApplicationPublicationsV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId,
        fxSystemApplicationRevisionsV2.revisionId),
    ))
    .innerJoin(fxSystemApplicationFunctionsV1, and(
      eq(fxSystemApplicationFunctionsV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationFunctionsV1.revisionId,
        fxSystemApplicationRevisionsV2.revisionId),
      eq(fxSystemApplicationFunctionsV1.functionPath, functionPath),
    ))
    .innerJoin(fxSystemApplicationRevisionSchemasV1, and(
      eq(fxSystemApplicationRevisionSchemasV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationRevisionSchemasV1.revisionId,
        fxSystemApplicationRevisionsV2.revisionId),
    ))
    .where(and(
      eq(fxSystemApplicationActivations.scopeId, scopeId),
      eq(fxSystemApplicationActivations.activationSequence,
        activationSequence),
      eq(fxSystemApplicationActivations.revisionId, revisionId),
      eq(fxSystemApplicationActivations.readinessContractVersion, 1),
    )).limit(2);
  observeDrizzleQuery("applicationGraphSizes", query, options.observeQuery);
  return await query;
}

async function selectApplicationGraphPayloadRows(
  tx: AppRowTransaction,
  deploymentId: TransactionGrantDeploymentIdV1,
  scopeId: ReplacementScopeIdV1,
  activationSequence: bigint,
  revisionId: string,
  functionPath: string,
  applicationSchemaSha256: Uint8Array,
  kind: ApplicationGraphSizeRow["kind"] | undefined,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<ReadonlyArray<ApplicationGraphScopePayloadRow>> {
  if (kind === "relation") {
    const query = tx.select({
      activation: fxSystemApplicationActivations,
      readiness: fxSystemApplicationReadiness,
      revision: fxSystemApplicationRevisionsV2,
      analysis: {
        scopeId: fxSystemApplicationAnalysesV1.scopeId,
        analysisId: fxSystemApplicationAnalysesV1.analysisId,
        candidateId: fxSystemApplicationAnalysesV1.candidateId,
        sourceArtifactRootSha256:
          fxSystemApplicationAnalysesV1.sourceArtifactRootSha256,
        analyzerIdentity: fxSystemApplicationAnalysesV1.analyzerIdentity,
        analyzerPolicyIdentity:
          fxSystemApplicationAnalysesV1.analyzerPolicyIdentity,
        status: fxSystemApplicationAnalysesV1.status,
        manifestSha256: fxSystemApplicationAnalysesV1.manifestSha256,
        manifestBytes: fxSystemApplicationAnalysesV1.manifestBytes,
        receiptSha256: sql<Uint8Array | null>`null`,
        receiptBytes: sql<Uint8Array | null>`null`,
        failureCode: fxSystemApplicationAnalysesV1.failureCode,
        failureDetail: fxSystemApplicationAnalysesV1.failureDetail,
        completedAt: fxSystemApplicationAnalysesV1.completedAt,
        createdAt: fxSystemApplicationAnalysesV1.createdAt,
        updatedAt: fxSystemApplicationAnalysesV1.updatedAt,
      },
      publication: fxSystemApplicationPublications,
      selectedFunction: fxSystemApplicationFunctions,
      revisionSchema: fxSystemApplicationRevisionSchemas,
    }).from(fxSystemApplicationActivations)
      .innerJoin(fxSystemApplicationReadiness, and(
        eq(fxSystemApplicationReadiness.scopeId,
          fxSystemApplicationActivations.scopeId),
        eq(fxSystemApplicationReadiness.revisionId,
          fxSystemApplicationActivations.revisionId),
        eq(fxSystemApplicationReadiness.readinessSha256,
          fxSystemApplicationActivations.relationReadinessSha256),
      ))
      .innerJoin(fxSystemApplicationRevisionsV2, and(
        eq(fxSystemApplicationRevisionsV2.scopeId,
          fxSystemApplicationActivations.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId,
          fxSystemApplicationActivations.revisionId),
      ))
      .innerJoin(fxSystemApplicationAnalysesV1, and(
        eq(fxSystemApplicationAnalysesV1.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationAnalysesV1.analysisId,
          fxSystemApplicationRevisionsV2.analysisId),
      ))
      .innerJoin(fxSystemApplicationPublications, and(
        eq(fxSystemApplicationPublications.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationPublications.revisionId,
          fxSystemApplicationRevisionsV2.revisionId),
        eq(fxSystemApplicationPublications.deploymentId, deploymentId),
        eq(fxSystemApplicationPublications.schemaSha256,
          applicationSchemaSha256),
      ))
      .innerJoin(fxSystemApplicationFunctions, and(
        eq(fxSystemApplicationFunctions.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationFunctions.revisionId,
          fxSystemApplicationRevisionsV2.revisionId),
        eq(fxSystemApplicationFunctions.functionPath, functionPath),
      ))
      .innerJoin(fxSystemApplicationRevisionSchemas, and(
        eq(fxSystemApplicationRevisionSchemas.scopeId,
          fxSystemApplicationRevisionsV2.scopeId),
        eq(fxSystemApplicationRevisionSchemas.revisionId,
          fxSystemApplicationRevisionsV2.revisionId),
      ))
      .where(and(
        eq(fxSystemApplicationActivations.scopeId, scopeId),
        eq(fxSystemApplicationActivations.activationSequence,
          activationSequence),
        eq(fxSystemApplicationActivations.revisionId, revisionId),
        inArray(fxSystemApplicationActivations.readinessContractVersion, [2, 3]),
      )).limit(2);
    observeDrizzleQuery("applicationGraphPayload", query, options.observeQuery);
    const rows = await query;
    return Object.freeze(rows.map(row => Object.freeze({
      kind: "relation" as const,
      ...row,
    })));
  }
  if (kind !== "legacy") return Object.freeze([]);
  const query = tx.select({
      activation: fxSystemApplicationActivations,
      readiness: fxSystemApplicationReadinessV1,
      revision: fxSystemApplicationRevisionsV2,
      analysis: {
        scopeId: fxSystemApplicationAnalysesV1.scopeId,
        analysisId: fxSystemApplicationAnalysesV1.analysisId,
        candidateId: fxSystemApplicationAnalysesV1.candidateId,
        sourceArtifactRootSha256:
          fxSystemApplicationAnalysesV1.sourceArtifactRootSha256,
        analyzerIdentity: fxSystemApplicationAnalysesV1.analyzerIdentity,
        analyzerPolicyIdentity:
          fxSystemApplicationAnalysesV1.analyzerPolicyIdentity,
        status: fxSystemApplicationAnalysesV1.status,
        manifestSha256: fxSystemApplicationAnalysesV1.manifestSha256,
        manifestBytes: fxSystemApplicationAnalysesV1.manifestBytes,
        receiptSha256: sql<Uint8Array | null>`null`,
        receiptBytes: sql<Uint8Array | null>`null`,
        failureCode: fxSystemApplicationAnalysesV1.failureCode,
        failureDetail: fxSystemApplicationAnalysesV1.failureDetail,
        completedAt: fxSystemApplicationAnalysesV1.completedAt,
        createdAt: fxSystemApplicationAnalysesV1.createdAt,
        updatedAt: fxSystemApplicationAnalysesV1.updatedAt,
      },
      publication: fxSystemApplicationPublicationsV1,
      selectedFunction: fxSystemApplicationFunctionsV1,
      revisionSchema: fxSystemApplicationRevisionSchemasV1,
    })
    .from(fxSystemApplicationActivations)
    .innerJoin(fxSystemApplicationReadinessV1, and(
      eq(fxSystemApplicationReadinessV1.scopeId,
        fxSystemApplicationActivations.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId,
        fxSystemApplicationActivations.revisionId),
      eq(fxSystemApplicationReadinessV1.readinessSha256,
        fxSystemApplicationActivations.legacyReadinessSha256),
    ))
    .innerJoin(fxSystemApplicationRevisionsV2, and(
      eq(fxSystemApplicationRevisionsV2.scopeId,
        fxSystemApplicationActivations.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId,
        fxSystemApplicationActivations.revisionId),
    ))
    .innerJoin(fxSystemApplicationAnalysesV1, and(
      eq(fxSystemApplicationAnalysesV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationAnalysesV1.analysisId,
        fxSystemApplicationRevisionsV2.analysisId),
    ))
    .innerJoin(fxSystemApplicationPublicationsV1, and(
      eq(fxSystemApplicationPublicationsV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId,
        fxSystemApplicationRevisionsV2.revisionId),
    ))
    .innerJoin(fxSystemApplicationFunctionsV1, and(
      eq(fxSystemApplicationFunctionsV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationFunctionsV1.revisionId,
        fxSystemApplicationRevisionsV2.revisionId),
      eq(fxSystemApplicationFunctionsV1.functionPath, functionPath),
    ))
    .innerJoin(fxSystemApplicationRevisionSchemasV1, and(
      eq(fxSystemApplicationRevisionSchemasV1.scopeId,
        fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationRevisionSchemasV1.revisionId,
        fxSystemApplicationRevisionsV2.revisionId),
    ))
    .where(and(
      eq(fxSystemApplicationActivations.scopeId, scopeId),
      eq(fxSystemApplicationActivations.activationSequence,
        activationSequence),
      eq(fxSystemApplicationActivations.revisionId, revisionId),
      eq(fxSystemApplicationActivations.readinessContractVersion, 1),
    )).limit(2);
  observeDrizzleQuery("applicationGraphPayload", query, options.observeQuery);
  const rows = await query;
  return Object.freeze(rows.map(row => Object.freeze({
    kind: "legacy" as const,
    ...row,
  })));
}

async function selectApplicationSchemaAuthoritySizeRows(
  db: FlarexMetadataDatabase,
  deploymentId: TransactionGrantDeploymentIdV1,
  applicationSchemaSha256: Uint8Array,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
) {
  const query = db.select({
    schemaBindingByteLengthText: sql<string>`octet_length(
      ${fxControlApplicationSchemaAuthoritiesV1.bindingBytes}
    )::bigint::text`,
  }).from(fxControlApplicationSchemaAuthoritiesV1).where(and(
    eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId),
    eq(fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
      applicationSchemaSha256),
  )).limit(2);
  observeDrizzleQuery(
    "applicationSchemaAuthoritySizes",
    query,
    options.observeQuery,
  );
  return await query;
}

async function selectApplicationSchemaAuthorityPayloadRows(
  db: FlarexMetadataDatabase,
  deploymentId: TransactionGrantDeploymentIdV1,
  applicationSchemaSha256: Uint8Array,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
) {
  const query = db.select().from(fxControlApplicationSchemaAuthoritiesV1)
    .where(and(
      eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId),
      eq(fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
        applicationSchemaSha256),
    )).limit(2);
  observeDrizzleQuery(
    "applicationSchemaAuthorityPayload",
    query,
    options.observeQuery,
  );
  return await query;
}

function sizeProjectionFailure(
  sessionRows: ReadonlyArray<SessionSizeRow>,
  schemaRows: ReadonlyArray<SchemaSizeRow>,
  applicationGraphRows: ReadonlyArray<ApplicationGraphSizeRow>,
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
  const applicationExpected = session.executionAuthorityGeneration ===
    "application_v1";
  if (applicationExpected && applicationGraphRows.length !== 1) {
    return "applicationGraphMissingOrDuplicate";
  }
  if (!applicationExpected && applicationGraphRows.length !== 0) {
    return "applicationGraphInvalid";
  }
  const graph = applicationGraphRows[0];
  const lengths = [
    session.validatedArgsJsonByteLengthText,
    session.validatedArgsCanonicalByteLengthText,
    session.authorizationGrantJsonByteLengthText,
    session.authorizationGrantCanonicalByteLengthText,
    schema.manifestJsonByteLengthText,
    schema.manifestCanonicalByteLengthText,
    ...(session.executionAuthorityGeneration === "application_v1"
      ? [
          session.applicationExecutionAuthorityJsonByteLengthText,
          session.applicationExecutionAuthorityCanonicalByteLengthText,
        ]
      : []),
    ...(graph === undefined ? [] : [
      graph.activationByteLengthText,
      graph.readinessByteLengthText,
      graph.manifestByteLengthText,
      graph.schemaByteLengthText,
      graph.functionCatalogByteLengthText,
      graph.functionEntryByteLengthText,
      graph.schemaBindingByteLengthText,
      graph.relationSetReadinessByteLengthText,
    ]),
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
    clockRows: detachDriverRows(clockRows),
    databaseNowText,
    sessionSizeRows: Object.freeze([]),
    leaseRows: Object.freeze([]),
    rootRows: Object.freeze([]),
    executionClaimRows: Object.freeze([]),
    attemptChildRows: Object.freeze([]),
    schemaSizeRows: Object.freeze([]),
    applicationGraphSizeRows: Object.freeze([]),
    sessionPayloadRows: Object.freeze([]),
    schemaPayloadRows: Object.freeze([]),
    applicationGraphPayloadRows: Object.freeze([]),
    bindingRows: Object.freeze([]),
  });
}

function detachApplicationGraphPayloadRows(
  rows: ReadonlyArray<ApplicationGraphPayloadRow>,
): ReadonlyArray<ApplicationGraphPayloadRow> {
  return Object.freeze(rows.map(row => row.kind === "legacy"
    ? Object.freeze({
        kind: row.kind,
        activation: Object.freeze(structuredClone(row.activation)),
        readiness: Object.freeze(structuredClone(row.readiness)),
        revision: Object.freeze(structuredClone(row.revision)),
        analysis: Object.freeze(structuredClone(row.analysis)),
        publication: Object.freeze(structuredClone(row.publication)),
        selectedFunction: Object.freeze(structuredClone(row.selectedFunction)),
        revisionSchema: Object.freeze(structuredClone(row.revisionSchema)),
        schemaAuthority: Object.freeze(structuredClone(row.schemaAuthority)),
      })
    : Object.freeze({
    kind: row.kind,
    activation: Object.freeze(structuredClone(row.activation)),
    readiness: Object.freeze(structuredClone(row.readiness)),
    revision: Object.freeze(structuredClone(row.revision)),
    analysis: Object.freeze(structuredClone(row.analysis)),
    publication: Object.freeze(structuredClone(row.publication)),
    selectedFunction: Object.freeze(structuredClone(row.selectedFunction)),
    revisionSchema: Object.freeze(structuredClone(row.revisionSchema)),
  })));
}

function detachSessionPayloadRows(
  rows: ReadonlyArray<SessionPayloadRow>,
): ReadonlyArray<SessionPayloadRow> {
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    validatedArgsCanonicalBytes:
      row.validatedArgsCanonicalBytes === null ? null : new Uint8Array(row.validatedArgsCanonicalBytes),
    authorizationGrantCanonicalBytes:
      row.authorizationGrantCanonicalBytes === null ? null : new Uint8Array(row.authorizationGrantCanonicalBytes),
    applicationExecutionAuthorityCanonicalBytes:
      row.applicationExecutionAuthorityCanonicalBytes === null
        ? null
        : new Uint8Array(row.applicationExecutionAuthorityCanonicalBytes),
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

async function selectTerminalStableBindings(schemaDb: AppRowTransaction | FlarexMetadataDatabase | undefined, authority: Pick<StoredCommitAuthorityCaptureAuthorityV1, "deploymentId" | "schemaVersionId">, options: StoredCommitAuthorityEvidenceLoaderOptionsV1) {
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
  const bindingResult: unknown = schemaDb === undefined
    ? Object.freeze({ rows: Object.freeze([]) })
    : await schemaDb.execute(bindingStatement);

  return detachUnknownDriverRows(rowsFromDriverExecuteResult(bindingResult, () => { throw new Error("Stable-binding query returned an invalid driver result."); }));
}

export async function captureTerminalSessionSizeInTransaction(tx: AppRowTransaction, scopeUuid: ScopeUuidV1, sessionId: TransactionSessionIdV1) {
  return detachDriverRows(await tx.select(sessionSizeFields).from(fxSystemTransactionSessions).where(and(eq(fxSystemTransactionSessions.scopeUuid, scopeUuid), eq(fxSystemTransactionSessions.sessionId, sessionId))).limit(2));
}
