import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, asc, eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

import type { AppRowTransaction } from "./appRows";
import type {
  ApplicationAnalysisAuthority,
} from "./applicationAnalysisRegistration";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
} from "./schema";

export interface PublishApplicationInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly manifestSha256: string;
  readonly manifest: ApplicationManifestV1;
}

export interface ApplicationPublicationFunction {
  readonly path: string;
  readonly moduleName: string;
  readonly exportName: string;
  readonly kind: "query" | "mutation" | "workflowMutation" | "action";
  readonly visibility: "public" | "internal";
  readonly args: ApplicationManifestV1["functions"][number]["args"];
  readonly returns: ApplicationManifestV1["functions"][number]["returns"];
  readonly partition: ApplicationManifestV1["functions"][number]["partition"];
  readonly entrySha256: string;
}

export interface ApplicationPublication {
  readonly scopeId: PublishApplicationInput["authority"]["scopeId"];
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly manifestSha256: string;
  readonly schemaSha256: string;
  readonly functionCatalogSha256: string;
  readonly publicationSha256: string;
  readonly executionModulePath: string;
  readonly functions: ReadonlyArray<ApplicationPublicationFunction>;
  readonly publishedAt: Date;
}

export class ApplicationPublicationError extends Data.TaggedError(
  "ApplicationPublicationError",
)<{
  readonly operation: "publish";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "revisionMissing"
    | "revisionMismatch"
    | "conflictingReplay"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationPublicationRepository {
  readonly publish: (
    input: PublishApplicationInput,
  ) => Effect.Effect<ApplicationPublication, ApplicationPublicationError>;
}

/**
 * Package-private evidence retained for read-only managed-schema planning.
 * The publication object identity is the capability; a structural copy is
 * deliberately not recognized.
 */
export interface ApplicationPublicationPlanningEvidence {
  readonly authority: ApplicationAnalysisAuthority;
  readonly manifest: ApplicationManifestV1;
  readonly database: FlarexMetadataDatabase;
}

const applicationPublicationPlanningEvidence = new WeakMap<
  ApplicationPublication,
  Omit<ApplicationPublicationPlanningEvidence, "database">
>();
const applicationPublicationDatabases = new WeakMap<
  ApplicationPublication,
  FlarexMetadataDatabase
>();

export function claimApplicationPublicationPlanningEvidenceResult(
  publication: unknown,
): Result.Result<
  ApplicationPublicationPlanningEvidence,
  ApplicationPublicationError
> {
  if (typeof publication !== "object" || publication === null) {
    return Result.fail(failureValue("invalidInput"));
  }
  const evidence = applicationPublicationPlanningEvidence.get(
    publication as ApplicationPublication,
  );
  const database = applicationPublicationDatabases.get(
    publication as ApplicationPublication,
  );
  return evidence === undefined || database === undefined
    ? Result.fail(failureValue("invalidInput"))
    : Result.succeed(Object.freeze({ ...evidence, database }));
}

export function makeApplicationPublicationRepository(
  db: FlarexMetadataDatabase,
): ApplicationPublicationRepository {
  const publish = Effect.fn("ApplicationPublicationRepository.publish")(
    function* (input: PublishApplicationInput): Effect.fn.Return<
      ApplicationPublication,
      ApplicationPublicationError
    > {
      const prepared = yield* preparePublication(input);
      const publication = yield* runTransaction(
        db,
        tx => publishInTransaction(tx, prepared),
      );
      applicationPublicationDatabases.set(publication, db);
      return publication;
    },
  );
  return Object.freeze({ publish });
}

export function applicationRuntimeTargetFromPublication(
  publication: ApplicationPublication,
  functionPath: string,
): Result.Result<CanonicalApplicationRuntimeTargetV1, ApplicationPublicationError> {
  const fn = publication.functions.find(value => value.path === functionPath);
  if (fn === undefined) return Result.fail(failureValue("invalidInput"));
  return canonicalizeApplicationRuntimeTargetV1(
    runtimeTargetValue(publication, fn),
  ).pipe(Result.mapError(cause => failureValue(
    "storedState",
    false,
    cause,
  )));
}

interface PreparedFunction extends ApplicationPublicationFunction {
  readonly entrySha256Bytes: Uint8Array;
  readonly entryBytes: Uint8Array;
}

interface PreparedPublication {
  readonly input: PublishApplicationInput;
  readonly sourceRootBytes: Uint8Array;
  readonly manifestSha256Bytes: Uint8Array;
  readonly schemaSha256Bytes: Uint8Array;
  readonly schemaBytes: Uint8Array;
  readonly functionCatalogSha256Bytes: Uint8Array;
  readonly functionCatalogBytes: Uint8Array;
  readonly publicationSha256Bytes: Uint8Array;
  readonly functions: ReadonlyArray<PreparedFunction>;
}

const preparePublication = Effect.fn("ApplicationPublication.prepare")(
  function* (input: PublishApplicationInput): Effect.fn.Return<
    PreparedPublication,
    ApplicationPublicationError
  > {
    const capturedInput = Object.freeze({
      ...input,
      authority: Object.freeze({ ...input.authority }),
    });
    if (
      !validIdentity(capturedInput.revisionId) ||
      !validIdentity(capturedInput.candidateId) ||
      !validIdentity(capturedInput.analysisId)
    ) return yield* failure("invalidInput");
    const canonicalManifest = yield* Effect.fromResult(
      canonicalizeApplicationManifestV1(capturedInput.manifest).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const manifestDigest = yield* sha256(canonicalManifest.canonicalBytes);
    if (encodeBytesToLowercaseHex(manifestDigest) !==
      capturedInput.manifestSha256) {
      return yield* failure("invalidInput");
    }
    const sourceRootBytes = yield* Effect.fromResult(
      decodeSha256(canonicalManifest.manifest.sourceArtifact.rootSha256),
    );
    const schemaFrame = yield* Effect.fromResult(
      applicationSchemaPublicationFrameV1(canonicalManifest.manifest).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const functionCatalogFrame = yield* Effect.fromResult(
      applicationFunctionCatalogPublicationFrameV1(
        canonicalManifest.manifest,
      ).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const schemaSha256Bytes = yield* sha256(schemaFrame);
    const functionCatalogSha256Bytes = yield* sha256(functionCatalogFrame);
    const functions: PreparedFunction[] = [];
    for (const fn of canonicalManifest.manifest.functions) {
      const entryBytes = yield* Effect.fromResult(
        applicationFunctionEntryPublicationFrameV1(fn).pipe(
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
    const publicationFrame = yield* Effect.fromResult(
      applicationPublicationCommitmentFrameV1({
        scopeId: capturedInput.authority.scopeId,
        revisionId: capturedInput.revisionId,
        candidateId: capturedInput.candidateId,
        analysisId: capturedInput.analysisId,
        sourceArtifactRootSha256:
          canonicalManifest.manifest.sourceArtifact.rootSha256,
        manifestSha256: capturedInput.manifestSha256,
        schemaSha256: encodeBytesToLowercaseHex(schemaSha256Bytes),
        functionCatalogSha256:
          encodeBytesToLowercaseHex(functionCatalogSha256Bytes),
      }).pipe(
        Result.mapError(cause => failureValue("invalidInput", false, cause)),
      ),
    );
    const publicationSha256Bytes = yield* sha256(publicationFrame);
    const runtimePublication = Object.freeze({
      scopeId: capturedInput.authority.scopeId,
      revisionId: capturedInput.revisionId,
      candidateId: capturedInput.candidateId,
      analysisId: capturedInput.analysisId,
      sourceArtifactRootSha256:
        canonicalManifest.manifest.sourceArtifact.rootSha256,
      manifestSha256: capturedInput.manifestSha256,
      schemaSha256: encodeBytesToLowercaseHex(schemaSha256Bytes),
      functionCatalogSha256:
        encodeBytesToLowercaseHex(functionCatalogSha256Bytes),
      publicationSha256: encodeBytesToLowercaseHex(publicationSha256Bytes),
      executionModulePath:
        canonicalManifest.manifest.sourceArtifact.executionModulePath,
    });
    for (const fn of functions) {
      yield* Effect.fromResult(canonicalizeApplicationRuntimeTargetV1(
        runtimeTargetValue(runtimePublication, fn),
      ).pipe(Result.mapError(cause => failureValue(
        "invalidInput",
        false,
        cause,
      ))));
    }
    return Object.freeze({
      input: Object.freeze({
        ...capturedInput,
        manifest: canonicalManifest.manifest,
      }),
      sourceRootBytes,
      manifestSha256Bytes: manifestDigest,
      schemaSha256Bytes,
      schemaBytes: schemaFrame,
      functionCatalogSha256Bytes,
      functionCatalogBytes: functionCatalogFrame,
      publicationSha256Bytes,
      functions: Object.freeze(functions),
    });
  },
);

type RuntimeTargetPublication = Omit<ApplicationPublication, "functions" | "publishedAt">;

function runtimeTargetValue(
  publication: RuntimeTargetPublication,
  fn: ApplicationPublicationFunction,
): unknown {
  return {
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: publication.scopeId,
    revisionId: publication.revisionId,
    candidateId: publication.candidateId,
    analysisId: publication.analysisId,
    sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
    manifestSha256: publication.manifestSha256,
    schemaSha256: publication.schemaSha256,
    functionCatalogSha256: publication.functionCatalogSha256,
    publicationSha256: publication.publicationSha256,
    executionModulePath: publication.executionModulePath,
    function: {
      path: fn.path,
      moduleName: fn.moduleName,
      exportName: fn.exportName,
      kind: fn.kind,
      visibility: fn.visibility,
      args: fn.args,
      returns: fn.returns,
      partition: fn.partition,
      entrySha256: fn.entrySha256,
    },
  };
}

function publishInTransaction(
  tx: AppRowTransaction,
  prepared: PreparedPublication,
): Effect.Effect<ApplicationPublication, ApplicationPublicationError> {
  return Effect.gen(function* () {
    yield* requireExactAuthority(tx, prepared.input.authority);
    const revisionRows = yield* query(
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId, prepared.input.authority.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId, prepared.input.revisionId),
      )).limit(1).for("update"),
    );
    const revision = revisionRows[0];
    if (revision === undefined) return yield* failure("revisionMissing");
    if (
      revision.candidateId !== prepared.input.candidateId ||
      revision.analysisId !== prepared.input.analysisId ||
      revision.status !== "inactive" ||
      !bytesEqualFullScan(revision.sourceArtifactRootSha256, prepared.sourceRootBytes) ||
      !bytesEqualFullScan(revision.manifestSha256, prepared.manifestSha256Bytes)
    ) return yield* failure("revisionMismatch");
    const candidateRows = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, prepared.input.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId, prepared.input.candidateId),
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

    const publishedAt = yield* databaseTime(tx, prepared.input.authority.scopeId);
    const inserted = yield* query(
      tx.insert(fxSystemApplicationPublicationsV1).values({
        scopeId: prepared.input.authority.scopeId,
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
        publicationSha256: prepared.publicationSha256Bytes,
        publishedAt,
      }).onConflictDoNothing().returning({
        revisionId: fxSystemApplicationPublicationsV1.revisionId,
      }),
    );
    if (inserted.length === 1) {
      if (prepared.functions.length > 0) {
        yield* execute(tx.insert(fxSystemApplicationFunctionsV1).values(
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
}

function loadExactReplay(
  tx: AppRowTransaction,
  prepared: PreparedPublication,
): Effect.Effect<ApplicationPublication, ApplicationPublicationError> {
  return Effect.gen(function* () {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationPublicationsV1).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId,
          prepared.input.authority.scopeId),
        eq(fxSystemApplicationPublicationsV1.revisionId,
          prepared.input.revisionId),
      )).limit(1),
    );
    const row = rows[0];
    if (
      row === undefined ||
      row.candidateId !== prepared.input.candidateId ||
      row.analysisId !== prepared.input.analysisId ||
      row.revisionStatus !== "inactive" ||
      !bytesEqualFullScan(row.sourceArtifactRootSha256, prepared.sourceRootBytes) ||
      !bytesEqualFullScan(row.manifestSha256, prepared.manifestSha256Bytes) ||
      !bytesEqualFullScan(row.schemaSha256, prepared.schemaSha256Bytes) ||
      !bytesEqualFullScan(row.schemaBytes, prepared.schemaBytes) ||
      !bytesEqualFullScan(
        row.functionCatalogSha256,
        prepared.functionCatalogSha256Bytes,
      ) ||
      !bytesEqualFullScan(row.functionCatalogBytes, prepared.functionCatalogBytes) ||
      !bytesEqualFullScan(row.publicationSha256, prepared.publicationSha256Bytes)
    ) return yield* failure("conflictingReplay");
    const functionRows = yield* query(
      tx.select().from(fxSystemApplicationFunctionsV1).where(and(
        eq(fxSystemApplicationFunctionsV1.scopeId,
          prepared.input.authority.scopeId),
        eq(fxSystemApplicationFunctionsV1.revisionId,
          prepared.input.revisionId),
      )).orderBy(asc(fxSystemApplicationFunctionsV1.functionPath)),
    );
    if (
      functionRows.length !== prepared.functions.length ||
      functionRows.some((stored, index) => {
        const expected = prepared.functions[index];
        return expected === undefined ||
          stored.functionPath !== expected.path ||
          stored.moduleName !== expected.moduleName ||
          stored.exportName !== expected.exportName ||
          stored.functionKind !== expected.kind ||
          stored.visibility !== expected.visibility ||
          !bytesEqualFullScan(stored.functionCatalogSha256,
            prepared.functionCatalogSha256Bytes) ||
          !bytesEqualFullScan(stored.entrySha256, expected.entrySha256Bytes) ||
          !bytesEqualFullScan(stored.entryBytes, expected.entryBytes);
      })
    ) return yield* failure("conflictingReplay");
    const publishedAt = databaseTimestampFromUnknown(row.publishedAt);
    return publishedAt === null
      ? yield* failure("storedState")
      : projection(prepared, publishedAt);
  });
}

function projection(
  prepared: PreparedPublication,
  publishedAt: Date,
): ApplicationPublication {
  const publication = Object.freeze({
    scopeId: prepared.input.authority.scopeId,
    revisionId: prepared.input.revisionId,
    candidateId: prepared.input.candidateId,
    analysisId: prepared.input.analysisId,
    sourceArtifactRootSha256:
      prepared.input.manifest.sourceArtifact.rootSha256,
    manifestSha256: prepared.input.manifestSha256,
    schemaSha256: encodeBytesToLowercaseHex(prepared.schemaSha256Bytes),
    functionCatalogSha256:
      encodeBytesToLowercaseHex(prepared.functionCatalogSha256Bytes),
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
  applicationPublicationPlanningEvidence.set(publication, Object.freeze({
    authority: Object.freeze({ ...prepared.input.authority }),
    manifest: prepared.input.manifest,
  }));
  return publication;
}

function requireExactAuthority(
  tx: AppRowTransaction,
  authority: ApplicationAnalysisAuthority,
): Effect.Effect<void, ApplicationPublicationError> {
  return Effect.gen(function* () {
    const rows = yield* query(
      tx.select().from(fxSystemScopeClocks).where(
        eq(fxSystemScopeClocks.scopeId, authority.scopeId),
      ).limit(1).for("update"),
    );
    const clock = rows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* failure("authorityChanged");
  });
}

function databaseTime(
  tx: AppRowTransaction,
  scopeId: ApplicationAnalysisAuthority["scopeId"],
): Effect.Effect<Date, ApplicationPublicationError> {
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

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationPublicationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationPublicationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  }).pipe(Effect.asVoid);
}

function runTransaction<A>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<A, ApplicationPublicationError>,
): Effect.Effect<A, ApplicationPublicationError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application publication transaction rolled back.",
    body,
    cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  );
}

function sha256(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationPublicationError> {
  return Effect.tryPromise({
    try: async () => new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: cause => failureValue("resourceFailure", true, cause),
  }).pipe(Effect.flatMap(digest => digest.byteLength === 32
    ? Effect.succeed(digest)
    : Effect.die(new Error("SHA-256 returned a non-32-byte digest."))));
}

function decodeSha256(
  value: string,
): Result.Result<Uint8Array, ApplicationPublicationError> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return Result.fail(failureValue("invalidInput"));
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(bytes);
}

function validIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01";
}

function failure(
  reason: ApplicationPublicationError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationPublicationError> {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationPublicationError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationPublicationError {
  return new ApplicationPublicationError({
    operation: "publish",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
