import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV2,
  applicationFunctionEntryPublicationFrameV2,
  applicationPublicationCommitmentFrameV2,
  applicationSchemaPublicationFrameV2,
} from "@flarex/analysis/internal/application-publication-v2";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import {
  locateApplicationRelationManifestBindingEffect,
  type LocatedApplicationRelationManifestBinding,
} from "./applicationRelationBinding";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { runEffectTransaction } from "./effectTransaction";
import { isRetryableSqlTransactionCause } from
  "./locatedReadCommittedEffect";
import {
  fxSystemApplicationFunctions,
  fxSystemApplicationPublications,
} from "./applicationRelationSchema";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
} from "./schema";

export interface PublishApplicationRelationInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly manifestSha256: string;
  readonly manifest: ApplicationManifestV2;
}

export interface ApplicationRelationPublicationFunction {
  readonly path: string;
  readonly moduleName: string;
  readonly exportName: string;
  readonly kind: "query" | "mutation" | "workflowMutation" | "action";
  readonly visibility: "public" | "internal";
  readonly args: ApplicationManifestV2["functions"][number]["args"];
  readonly returns: ApplicationManifestV2["functions"][number]["returns"];
  readonly partition: ApplicationManifestV2["functions"][number]["partition"];
  readonly entrySha256: string;
}

/** Nominal private publication for the accepted relation-aware lifecycle. */
export interface ApplicationRelationPublication {
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly manifestSha256: string;
  readonly applicationSchemaSha256: string;
  readonly functionCatalogSha256: string;
  readonly schemaVersionId: string;
  readonly schemaVersion: number;
  readonly schemaManifestSha256: string;
  readonly manifestSchemaBindingSha256: string;
  readonly boundPublicationSha256: string;
  readonly publicationSha256: string;
  readonly executionModulePath: string;
  readonly functions: ReadonlyArray<ApplicationRelationPublicationFunction>;
  readonly publishedAt: Date;
}

export class ApplicationRelationPublicationError extends Data.TaggedError(
  "ApplicationRelationPublicationError",
)<{
  readonly operation: "publish";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "schemaBindingMissing"
    | "schemaBindingMismatch"
    | "revisionMissing"
    | "revisionMismatch"
    | "conflictingReplay"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationRelationPublicationRepository {
  readonly publish: (
    input: PublishApplicationRelationInput,
  ) => Effect.Effect<
    ApplicationRelationPublication,
    ApplicationRelationPublicationError
  >;
}

interface PublicationAuthorityState {
  readonly targetDb: FlarexMetadataDatabase;
  readonly controlDb: FlarexMetadataDatabase;
  readonly manifest: ApplicationManifestV2;
  readonly authority: ApplicationAnalysisAuthority;
}

const publicationAuthorityStates = new WeakMap<object, PublicationAuthorityState>();

export function hasApplicationRelationPublicationAuthority(
  targetDb: FlarexMetadataDatabase,
  controlDb: FlarexMetadataDatabase,
  value: unknown,
): value is ApplicationRelationPublication {
  if (typeof value !== "object" || value === null) return false;
  const state = publicationAuthorityStates.get(value);
  return state?.targetDb === targetDb && state.controlDb === controlDb;
}

export function makeApplicationRelationPublicationRepository(
  targetDb: FlarexMetadataDatabase,
  controlDb: FlarexMetadataDatabase,
): ApplicationRelationPublicationRepository {
  const publish = Effect.fn("ApplicationRelationPublication.publish")(
    function* (input: PublishApplicationRelationInput): Effect.fn.Return<
      ApplicationRelationPublication,
      ApplicationRelationPublicationError
    > {
      const prepared = yield* preparePublication(controlDb, input);
      const publication = yield* runTransaction(
        targetDb,
        tx => publishInTransaction(tx, prepared),
      );
      publicationAuthorityStates.set(publication, Object.freeze({
        targetDb,
        controlDb,
        manifest: prepared.input.manifest,
        authority: prepared.input.authority,
      }));
      return publication;
    },
  );
  return Object.freeze({ publish });
}

interface PreparedFunction extends ApplicationRelationPublicationFunction {
  readonly entrySha256Bytes: Uint8Array;
  readonly entryBytes: Uint8Array;
}

interface PreparedPublication {
  readonly input: PublishApplicationRelationInput;
  readonly binding: LocatedApplicationRelationManifestBinding;
  readonly sourceRootBytes: Uint8Array;
  readonly manifestSha256Bytes: Uint8Array;
  readonly schemaSha256Bytes: Uint8Array;
  readonly schemaBytes: Uint8Array;
  readonly functionCatalogSha256Bytes: Uint8Array;
  readonly functionCatalogBytes: Uint8Array;
  readonly schemaManifestSha256Bytes: Uint8Array;
  readonly manifestSchemaBindingSha256Bytes: Uint8Array;
  readonly boundPublicationSha256Bytes: Uint8Array;
  readonly publicationSha256Bytes: Uint8Array;
  readonly functions: ReadonlyArray<PreparedFunction>;
}

const preparePublication = Effect.fn("ApplicationRelationPublication.prepare")(
  function* (
    controlDb: FlarexMetadataDatabase,
    input: PublishApplicationRelationInput,
  ): Effect.fn.Return<PreparedPublication, ApplicationRelationPublicationError> {
    const captured = Object.freeze({
      ...input,
      authority: Object.freeze({ ...input.authority }),
    });
    if (
      !validIdentity(captured.deploymentId, 1_024) ||
      !validIdentity(captured.revisionId, 256) ||
      !validIdentity(captured.candidateId, 256) ||
      !validIdentity(captured.analysisId, 256)
    ) return yield* failure("invalidInput");
    const canonicalManifest = yield* Effect.fromResult(
      canonicalizeApplicationManifestV2(captured.manifest).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const manifestSha256Bytes = yield* sha256(canonicalManifest.canonicalBytes);
    if (
      encodeBytesToLowercaseHex(manifestSha256Bytes) !== captured.manifestSha256
    ) return yield* failure("invalidInput");
    const binding = yield* locateApplicationRelationManifestBindingEffect(
      controlDb,
      {
        deploymentId: captured.deploymentId,
        applicationManifestSha256: captured.manifestSha256,
      },
    ).pipe(Effect.mapError(cause => failureValue(
      cause.reason === "resourceFailure" ? "resourceFailure" : "storedState",
      cause.reason === "resourceFailure" &&
        isRetryableNestedSqlTransactionCause(cause),
      cause,
    )));
    if (binding === null) return yield* failure("schemaBindingMissing");
    const manifestBinding = binding.manifestBinding.binding;
    const relationBinding = binding.relationBinding;
    if (
      manifestBinding.deploymentId !== captured.deploymentId ||
      manifestBinding.applicationManifestSha256 !== captured.manifestSha256 ||
      relationBinding.deploymentId !== captured.deploymentId ||
      relationBinding.schemaVersionId !== manifestBinding.schemaVersionId ||
      relationBinding.binding.schemaVersion !== manifestBinding.schemaVersion ||
      relationBinding.binding.relationBindings.length !==
        canonicalManifest.manifest.schema.relations.length
    ) return yield* failure("schemaBindingMismatch");
    const schemaBytes = yield* Effect.fromResult(
      applicationSchemaPublicationFrameV2(canonicalManifest.manifest).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const schemaSha256Bytes = yield* sha256(schemaBytes);
    if (
      encodeBytesToLowercaseHex(schemaSha256Bytes) !==
        manifestBinding.applicationSchemaSha256 ||
      !bytesEqualFullScan(
        schemaSha256Bytes,
        relationBinding.applicationSchemaSha256,
      )
    ) return yield* failure("schemaBindingMismatch");
    const functionCatalogBytes = yield* Effect.fromResult(
      applicationFunctionCatalogPublicationFrameV2(
        canonicalManifest.manifest,
      ).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const functionCatalogSha256Bytes = yield* sha256(functionCatalogBytes);
    const functions: PreparedFunction[] = [];
    for (const fn of canonicalManifest.manifest.functions) {
      const entryBytes = yield* Effect.fromResult(
        applicationFunctionEntryPublicationFrameV2(fn).pipe(
          Result.mapError(cause => failureValue("invalidInput", false, cause)),
        ),
      );
      if (entryBytes.byteLength > 65_536) return yield* failure("invalidInput");
      const entrySha256Bytes = yield* sha256(entryBytes);
      functions.push(Object.freeze({
        ...fn,
        entrySha256: encodeBytesToLowercaseHex(entrySha256Bytes),
        entrySha256Bytes,
        entryBytes,
      }));
    }
    const schemaManifestSha256Bytes = copyBytes(
      relationBinding.schemaManifestSha256,
    );
    const manifestSchemaBindingSha256Bytes = yield* Effect.fromResult(
      decodeSha256(binding.manifestBinding.sha256Hex),
    );
    const boundPublicationSha256Bytes = yield* Effect.fromResult(
      decodeSha256(manifestBinding.boundPublicationSha256),
    );
    if (!bytesEqualFullScan(
      boundPublicationSha256Bytes,
      relationBinding.boundPublicationSha256,
    )) return yield* failure("schemaBindingMismatch");
    const publicationBytes = yield* Effect.fromResult(
      applicationPublicationCommitmentFrameV2({
        scopeId: captured.authority.scopeId,
        deploymentId: captured.deploymentId,
        revisionId: captured.revisionId,
        candidateId: captured.candidateId,
        analysisId: captured.analysisId,
        sourceArtifactRootSha256:
          canonicalManifest.manifest.sourceArtifact.rootSha256,
        manifestSha256: captured.manifestSha256,
        schemaSha256: encodeBytesToLowercaseHex(schemaSha256Bytes),
        functionCatalogSha256:
          encodeBytesToLowercaseHex(functionCatalogSha256Bytes),
        schemaVersionId: manifestBinding.schemaVersionId,
        schemaManifestSha256: encodeBytesToLowercaseHex(
          relationBinding.schemaManifestSha256,
        ),
        manifestSchemaBindingSha256: binding.manifestBinding.sha256Hex,
        boundPublicationSha256: manifestBinding.boundPublicationSha256,
      }).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const publicationSha256Bytes = yield* sha256(publicationBytes);
    return Object.freeze({
      input: Object.freeze({
        ...captured,
        manifest: canonicalManifest.manifest,
      }),
      binding,
      sourceRootBytes: yield* Effect.fromResult(decodeSha256(
        canonicalManifest.manifest.sourceArtifact.rootSha256,
      )),
      manifestSha256Bytes,
      schemaSha256Bytes,
      schemaBytes,
      functionCatalogSha256Bytes,
      functionCatalogBytes,
      schemaManifestSha256Bytes,
      manifestSchemaBindingSha256Bytes,
      boundPublicationSha256Bytes,
      publicationSha256Bytes,
      functions: Object.freeze(functions),
    });
  },
);

const publishInTransaction = Effect.fn(
  "ApplicationRelationPublication.publishInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedPublication,
): Effect.fn.Return<
  ApplicationRelationPublication,
  ApplicationRelationPublicationError
> {
    yield* requireExactAuthority(tx, prepared.input.authority);
    const revisionRows = yield* query(
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId,
          prepared.input.authority.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId,
          prepared.input.revisionId),
      )).limit(1).for("update"),
    );
    const revision = revisionRows[0];
    if (revision === undefined) return yield* failure("revisionMissing");
    if (
      revision.candidateId !== prepared.input.candidateId ||
      revision.analysisId !== prepared.input.analysisId ||
      revision.status !== "inactive" ||
      !bytesEqualFullScan(
        revision.sourceArtifactRootSha256,
        prepared.sourceRootBytes,
      ) ||
      !bytesEqualFullScan(revision.manifestSha256,
        prepared.manifestSha256Bytes)
    ) return yield* failure("revisionMismatch");
    const candidateRows = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId,
          prepared.input.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId,
          prepared.input.candidateId),
      )).limit(1).for("update"),
    );
    const candidate = candidateRows[0];
    if (
      candidate === undefined ||
      candidate.storageGeneration !== prepared.input.authority.storageGeneration ||
      candidate.storageGenerationFence !==
        prepared.input.authority.storageGenerationFence ||
      candidate.epoch !== prepared.input.authority.epoch
    ) return yield* failure("authorityChanged");
    const publishedAt = yield* databaseTime(
      tx,
      prepared.input.authority.scopeId,
    );
    const inserted = yield* query(
      tx.insert(fxSystemApplicationPublications).values({
        scopeId: prepared.input.authority.scopeId,
        deploymentId: prepared.input.deploymentId,
        revisionId: prepared.input.revisionId,
        candidateId: prepared.input.candidateId,
        analysisId: prepared.input.analysisId,
        revisionStatus: "inactive",
        sourceArtifactRootSha256: prepared.sourceRootBytes,
        manifestSha256: prepared.manifestSha256Bytes,
        schemaSha256: prepared.schemaSha256Bytes,
        schemaBytes: prepared.schemaBytes,
        functionCatalogSha256: prepared.functionCatalogSha256Bytes,
        functionCatalogBytes: prepared.functionCatalogBytes,
        schemaVersionId: prepared.binding.manifestBinding.binding.schemaVersionId,
        schemaManifestSha256: prepared.schemaManifestSha256Bytes,
        manifestSchemaBindingSha256:
          prepared.manifestSchemaBindingSha256Bytes,
        boundPublicationSha256: prepared.boundPublicationSha256Bytes,
        publicationSha256: prepared.publicationSha256Bytes,
        publishedAt,
      }).onConflictDoNothing().returning({
        revisionId: fxSystemApplicationPublications.revisionId,
      }),
    );
    if (inserted.length === 1) {
      if (prepared.functions.length > 0) {
        yield* execute(tx.insert(fxSystemApplicationFunctions).values(
          prepared.functions.map(fn => ({
            scopeId: prepared.input.authority.scopeId,
            revisionId: prepared.input.revisionId,
            functionCatalogSha256: prepared.functionCatalogSha256Bytes,
            functionPath: fn.path,
            moduleName: fn.moduleName,
            exportName: fn.exportName,
            functionKind: fn.kind,
            visibility: fn.visibility,
            entrySha256: fn.entrySha256Bytes,
            entryBytes: fn.entryBytes,
          })),
        ));
      }
      return projection(prepared, publishedAt);
    }
    return yield* loadExactReplay(tx, prepared);
});

const loadExactReplay = Effect.fn(
  "ApplicationRelationPublication.loadExactReplay",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedPublication,
): Effect.fn.Return<
  ApplicationRelationPublication,
  ApplicationRelationPublicationError
> {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationPublications).where(and(
        eq(fxSystemApplicationPublications.scopeId,
          prepared.input.authority.scopeId),
        eq(fxSystemApplicationPublications.revisionId,
          prepared.input.revisionId),
      )).limit(1),
    );
    const row = rows[0];
    if (
      row === undefined || row.deploymentId !== prepared.input.deploymentId ||
      row.candidateId !== prepared.input.candidateId ||
      row.analysisId !== prepared.input.analysisId ||
      row.revisionStatus !== "inactive" ||
      row.schemaVersionId !==
        prepared.binding.manifestBinding.binding.schemaVersionId ||
      !bytesEqualFullScan(row.sourceArtifactRootSha256,
        prepared.sourceRootBytes) ||
      !bytesEqualFullScan(row.manifestSha256,
        prepared.manifestSha256Bytes) ||
      !bytesEqualFullScan(row.schemaSha256, prepared.schemaSha256Bytes) ||
      !bytesEqualFullScan(row.schemaBytes, prepared.schemaBytes) ||
      !bytesEqualFullScan(row.functionCatalogSha256,
        prepared.functionCatalogSha256Bytes) ||
      !bytesEqualFullScan(row.functionCatalogBytes,
        prepared.functionCatalogBytes) ||
      !bytesEqualFullScan(row.schemaManifestSha256,
        prepared.schemaManifestSha256Bytes) ||
      !bytesEqualFullScan(row.manifestSchemaBindingSha256,
        prepared.manifestSchemaBindingSha256Bytes) ||
      !bytesEqualFullScan(row.boundPublicationSha256,
        prepared.boundPublicationSha256Bytes) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.publicationSha256Bytes)
    ) return yield* failure("conflictingReplay");
    const functionRows = yield* query(
      tx.select().from(fxSystemApplicationFunctions).where(and(
        eq(fxSystemApplicationFunctions.scopeId,
          prepared.input.authority.scopeId),
        eq(fxSystemApplicationFunctions.revisionId,
          prepared.input.revisionId),
      )).limit(prepared.functions.length + 1),
    );
    const functionsByPath = new Map(
      functionRows.map(stored => [stored.functionPath, stored] as const),
    );
    if (
      functionRows.length !== prepared.functions.length ||
      functionsByPath.size !== functionRows.length ||
      prepared.functions.some(expected => {
        const stored = functionsByPath.get(expected.path);
        return stored === undefined ||
          stored.moduleName !== expected.moduleName ||
          stored.exportName !== expected.exportName ||
          stored.functionKind !== expected.kind ||
          stored.visibility !== expected.visibility ||
          !bytesEqualFullScan(stored.functionCatalogSha256,
            prepared.functionCatalogSha256Bytes) ||
          !bytesEqualFullScan(stored.entrySha256,
            expected.entrySha256Bytes) ||
          !bytesEqualFullScan(stored.entryBytes, expected.entryBytes);
      })
    ) return yield* failure("conflictingReplay");
    const publishedAt = databaseTimestampFromUnknown(row.publishedAt);
    return publishedAt === null
      ? yield* failure("storedState")
      : projection(prepared, publishedAt);
});

function projection(
  prepared: PreparedPublication,
  publishedAt: Date,
): ApplicationRelationPublication {
  return Object.freeze({
    scopeId: prepared.input.authority.scopeId,
    deploymentId: prepared.input.deploymentId,
    revisionId: prepared.input.revisionId,
    candidateId: prepared.input.candidateId,
    analysisId: prepared.input.analysisId,
    sourceArtifactRootSha256:
      prepared.input.manifest.sourceArtifact.rootSha256,
    manifestSha256: prepared.input.manifestSha256,
    applicationSchemaSha256:
      encodeBytesToLowercaseHex(prepared.schemaSha256Bytes),
    functionCatalogSha256:
      encodeBytesToLowercaseHex(prepared.functionCatalogSha256Bytes),
    schemaVersionId:
      prepared.binding.manifestBinding.binding.schemaVersionId,
    schemaVersion: prepared.binding.manifestBinding.binding.schemaVersion,
    schemaManifestSha256:
      encodeBytesToLowercaseHex(
        prepared.binding.relationBinding.schemaManifestSha256,
      ),
    manifestSchemaBindingSha256:
      prepared.binding.manifestBinding.sha256Hex,
    boundPublicationSha256:
      prepared.binding.manifestBinding.binding.boundPublicationSha256,
    publicationSha256:
      encodeBytesToLowercaseHex(prepared.publicationSha256Bytes),
    executionModulePath:
      prepared.input.manifest.sourceArtifact.executionModulePath,
    functions: Object.freeze(prepared.functions.map(fn => Object.freeze({
      path: fn.path,
      moduleName: fn.moduleName,
      exportName: fn.exportName,
      kind: fn.kind,
      visibility: fn.visibility,
      args: fn.args,
      returns: fn.returns,
      partition: fn.partition,
      entrySha256: fn.entrySha256,
    }))),
    publishedAt: new Date(publishedAt.getTime()),
  });
}

const requireExactAuthority = Effect.fn(
  "ApplicationRelationPublication.requireExactAuthority",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationAnalysisAuthority,
): Effect.fn.Return<void, ApplicationRelationPublicationError> {
    const rows = yield* query(
      tx.select().from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        authority.scopeId,
      )).limit(1).for("update"),
    );
    const clock = rows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* failure("authorityChanged");
});

function databaseTime(
  tx: AppRowTransaction,
  scopeId: ApplicationAnalysisAuthority["scopeId"],
): Effect.Effect<Date, ApplicationRelationPublicationError> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ).pipe(Effect.flatMap(rows => {
    const date = databaseTimestampFromUnknown(rows[0]?.now);
    return date === null ? failure("storedState") : Effect.succeed(date);
  }));
}

function runTransaction<Value>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<
    Value,
    ApplicationRelationPublicationError
  >,
): Effect.Effect<Value, ApplicationRelationPublicationError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application relation publication transaction rolled back.",
    body,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  );
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationRelationPublicationError> {
  return runDrizzleStatementEffect(
    statement,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  );
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationRelationPublicationError> {
  return runDrizzleStatementEffect(
    statement,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  ).pipe(Effect.asVoid);
}

function sha256(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationRelationPublicationError> {
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: host - SHA-256 of an owned ArrayBuffer copy is treated as a non-rejecting WebCrypto digest
  return Effect.promise(async () => new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
  )).pipe(Effect.flatMap(digest => digest.byteLength === 32
    ? Effect.succeed(digest)
    : Effect.die(new Error("SHA-256 returned a non-32-byte digest."))));
}

function decodeSha256(
  value: string,
): Result.Result<Uint8Array, ApplicationRelationPublicationError> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return Result.fail(failureValue("invalidInput"));
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(bytes);
}

function validIdentity(value: string, maximumLength: number): boolean {
  return value.length >= 1 && value.length <= maximumLength &&
    value.trim().length > 0 && !value.includes("\0");
}

function isRetryableNestedSqlTransactionCause(cause: unknown): boolean {
  const seen = new Set<object>();
  let current = cause;
  for (let depth = 0; depth < 4; depth += 1) {
    if (isRetryableSqlTransactionCause(current)) return true;
    if (typeof current !== "object" || current === null || seen.has(current)) {
      return false;
    }
    seen.add(current);
    try {
      current = Reflect.get(current, "cause");
    } catch {
      return false;
    }
  }
  return false;
}

function failure(
  reason: ApplicationRelationPublicationError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationRelationPublicationError> {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationRelationPublicationError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationRelationPublicationError {
  return new ApplicationRelationPublicationError({
    operation: "publish",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
