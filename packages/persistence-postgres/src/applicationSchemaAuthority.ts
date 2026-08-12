import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import type {
  CatalogIndexId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  canonicalizeSchemaManifestV1,
  decodeSchemaManifestAppSchemaV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result,
  decodeSchemaManifestAppTableDeclarationsV1Result,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import {
  publishAppSchemaV1WithRepositoryEffect,
  type AppSchemaPublicationV1Repository,
  type PublishAppSchemaV1Error,
  type PublishAppSchemaV1Input,
  type PublishAppSchemaV1Result,
} from "./appSchemaPublication";
import type { FlarexMetadataDatabase } from "./deployments";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";

export interface ApplicationSchemaTableBinding {
  readonly applicationTableId: number;
  readonly logicalName: string;
  readonly tableId: CatalogTableId;
}

export interface ApplicationSchemaIndexBinding {
  readonly applicationIndexId: number;
  readonly applicationTableId: number;
  readonly descriptor: string;
  readonly logicalIndexId: CatalogIndexId;
  readonly tableId: CatalogTableId;
}

export interface ApplicationSchemaAuthority {
  readonly deploymentId: string;
  readonly applicationSchemaSha256: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schemaManifestSha256: string;
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly tables: ReadonlyArray<ApplicationSchemaTableBinding>;
  readonly indexes: ReadonlyArray<ApplicationSchemaIndexBinding>;
}

export class ApplicationSchemaAuthorityError extends Data.TaggedError(
  "ApplicationSchemaAuthorityError",
)<{
  readonly operation: "publish";
  readonly reason:
    | "invalidDeployment"
    | "invalidManifest"
    | "invalidSchema"
    | "projectionMismatch";
  readonly cause?: unknown;
}> {}

export interface ApplicationSchemaAuthorityPublisher<Failure> {
  readonly publish: (input: {
    readonly deploymentId: string;
    readonly manifest: unknown;
    readonly schemaVersion: CatalogSchemaVersion;
  }) => Effect.Effect<
    ApplicationSchemaAuthority,
    ApplicationSchemaAuthorityError | Failure
  >;
}

const applicationSchemaPublisherControlDatabases = new WeakMap<
  ApplicationSchemaAuthorityPublisher<unknown>,
  FlarexMetadataDatabase
>();

export function makeApplicationSchemaAuthorityPublisher(
  repository: AppSchemaPublicationV1Repository,
): ApplicationSchemaAuthorityPublisher<PublishAppSchemaV1Error> {
  const publish = Effect.fn("ApplicationSchemaAuthority.publish")(
    function* (input: {
      readonly deploymentId: string;
      readonly manifest: unknown;
      readonly schemaVersion: CatalogSchemaVersion;
    }): Effect.fn.Return<
      ApplicationSchemaAuthority,
      ApplicationSchemaAuthorityError | PublishAppSchemaV1Error
    > {
      if (!isNonBlankString(input.deploymentId) ||
        input.deploymentId.includes("\0")) {
        return yield* authorityFailure("invalidDeployment");
      }
      const canonical = yield* Effect.fromResult(
        canonicalizeApplicationManifestV1(input.manifest).pipe(
          Result.mapError(cause => authorityFailureValue(
            "invalidManifest",
            cause,
          )),
        ),
      );
      const schemaFrame = yield* Effect.fromResult(
        applicationSchemaPublicationFrameV1(canonical.manifest).pipe(
          Result.mapError(cause => authorityFailureValue(
            "invalidSchema",
            cause,
          )),
        ),
      );
      const schemaSha256 = encodeBytesToLowercaseHex(yield* sha256(schemaFrame));
      const schemaVersionId = CatalogSchemaVersionIdSchema.make(
        `application_${schemaSha256}`,
      );
      const publicationInput = yield* Effect.fromResult(
        schemaPublicationInput(
          input.deploymentId,
          schemaVersionId,
          input.schemaVersion,
          canonical.manifest,
        ),
      );
      const publication = yield* publishAppSchemaV1WithRepositoryEffect(
        repository,
        publicationInput,
      );
      yield* verifyPublicationArtifact(
        input.deploymentId,
        schemaVersionId,
        input.schemaVersion,
        publication,
      );
      return yield* Effect.fromResult(projectAuthority(
        input.deploymentId,
        schemaSha256,
        schemaVersionId,
        input.schemaVersion,
        canonical.manifest.schema,
        publication,
      ));
    },
  );
  const publisher = Object.freeze({ publish });
  applicationSchemaPublisherControlDatabases.set(publisher, repository.db);
  return publisher;
}

export function hasApplicationSchemaAuthorityComposition(
  publisher: ApplicationSchemaAuthorityPublisher<unknown>,
  controlDb: FlarexMetadataDatabase,
): boolean {
  return applicationSchemaPublisherControlDatabases.get(publisher) === controlDb;
}

function verifyPublicationArtifact(
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  schemaVersion: CatalogSchemaVersion,
  publication: PublishAppSchemaV1Result,
): Effect.Effect<void, ApplicationSchemaAuthorityError> {
  return Effect.gen(function* () {
    if (publication.artifact.deploymentId !== deploymentId ||
      publication.artifact.schemaVersionId !== schemaVersionId ||
      publication.artifact.version !== schemaVersion) {
      return yield* authorityFailure("projectionMismatch");
    }
    const manifest = yield* Effect.fromResult(
      decodeSchemaManifestAppSchemaV1Result(publication.manifest).pipe(
        Result.mapError(cause => authorityFailureValue(
          "projectionMismatch",
          cause,
        )),
      ),
    );
    const canonical = yield* Effect.promise(
      () => canonicalizeSchemaManifestV1(manifest),
    );
    if (publication.artifact.manifestCodecVersion !== canonical.codecVersion ||
      !canonicalJsonEqual(
        publication.artifact.manifestJson,
        canonical.manifestJson,
      ) ||
      !bytesEqualFullScan(
        publication.artifact.manifestBytes,
        canonical.canonicalBytes,
      ) ||
      !bytesEqualFullScan(publication.artifact.manifestSha256, canonical.sha256)) {
      return yield* authorityFailure("projectionMismatch");
    }
  });
}

function schemaPublicationInput(
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  schemaVersion: CatalogSchemaVersion,
  manifest: ApplicationManifestV1,
): Result.Result<PublishAppSchemaV1Input, ApplicationSchemaAuthorityError> {
  const tableNames = new Map(
    manifest.schema.tables.map(table => [table.tableId, table.name] as const),
  );
  const tables = manifest.schema.tables.map(table => ({
    logicalName: table.name,
    definition: {
      kind: "appDocument" as const,
      definitionVersion: 1 as const,
      documentType: table.validator,
    },
  }));
  const indexes: Array<{
    readonly tableLogicalName: string;
    readonly descriptor: string;
    readonly fields: ReadonlyArray<string>;
  }> = [];
  for (const index of manifest.schema.indexes) {
    const tableLogicalName = tableNames.get(index.tableId);
    if (tableLogicalName === undefined) {
      return Result.fail(authorityFailureValue("invalidSchema"));
    }
    indexes.push({
      tableLogicalName,
      descriptor: index.name,
      fields: index.fields,
    });
  }
  return Result.gen(function* () {
    const decodedTables = yield* decodeSchemaManifestAppTableDeclarationsV1Result(
      tables,
    ).pipe(Result.mapError(cause => authorityFailureValue(
      "invalidSchema",
      cause,
    )));
    const decodedIndexes = yield* decodeSchemaManifestAppIndexDeclarationsV1Result(
      indexes,
    ).pipe(Result.mapError(cause => authorityFailureValue(
      "invalidSchema",
      cause,
    )));
    return Object.freeze({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(schemaVersion),
      tables: decodedTables,
      indexes: decodedIndexes,
    });
  });
}

function projectAuthority(
  deploymentId: string,
  applicationSchemaSha256: string,
  schemaVersionId: CatalogSchemaVersionId,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationManifestV1["schema"],
  publication: PublishAppSchemaV1Result,
): Result.Result<ApplicationSchemaAuthority, ApplicationSchemaAuthorityError> {
  const boundTablesByName = new Map<string,
    PublishAppSchemaV1Result["manifest"]["tableDefinitions"]["tables"][number]
  >(
    publication.manifest.tableDefinitions.tables.map(table => [
      table.logicalName,
      table,
    ] as const),
  );
  if (boundTablesByName.size !== schema.tables.length) {
    return Result.fail(authorityFailureValue("projectionMismatch"));
  }
  const tables: ApplicationSchemaTableBinding[] = [];
  const boundTableIdsByApplicationId = new Map<number, CatalogTableId>();
  for (const table of schema.tables) {
    const bound = boundTablesByName.get(table.name);
    if (bound === undefined ||
      !canonicalJsonEqual(bound.definition.documentType, table.validator)) {
      return Result.fail(authorityFailureValue("projectionMismatch"));
    }
    boundTableIdsByApplicationId.set(table.tableId, bound.tableId);
    tables.push(Object.freeze({
      applicationTableId: table.tableId,
      logicalName: table.name,
      tableId: bound.tableId,
    }));
  }

  const indexes: ApplicationSchemaIndexBinding[] = [];
  const unmatched = new Set(publication.manifest.indexBindings.indexes);
  for (const index of schema.indexes) {
    const tableId = boundTableIdsByApplicationId.get(index.tableId);
    if (tableId === undefined) {
      return Result.fail(authorityFailureValue("projectionMismatch"));
    }
    const bound = publication.manifest.indexBindings.indexes.find(candidate =>
      candidate.tableId === tableId && candidate.descriptor === index.name
    );
    if (bound === undefined ||
      !stringArraysEqual(bound.spec.fields, index.fields)) {
      return Result.fail(authorityFailureValue("projectionMismatch"));
    }
    unmatched.delete(bound);
    indexes.push(Object.freeze({
      applicationIndexId: index.indexId,
      applicationTableId: index.tableId,
      descriptor: index.name,
      logicalIndexId: bound.logicalIndexId,
      tableId,
    }));
  }
  if (unmatched.size !== 0) {
    return Result.fail(authorityFailureValue("projectionMismatch"));
  }

  return Result.succeed(Object.freeze({
    deploymentId,
    applicationSchemaSha256,
    schemaVersionId,
    schemaVersion,
    schemaManifestSha256: encodeBytesToLowercaseHex(
      publication.artifact.manifestSha256,
    ),
    manifest: snapshotSchemaManifestValue(publication.manifest),
    tables: Object.freeze(tables),
    indexes: Object.freeze(indexes),
  }));
}

function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  if (!isJson(left) || !isJson(right)) return false;
  return encodeCanonicalJson(left, canonicalJsonInvariant) ===
    encodeCanonicalJson(right, canonicalJsonInvariant);
}

function canonicalJsonInvariant(issue: { readonly reason: string }): never {
  throw new Error(`Application schema JSON invariant: ${issue.reason}`);
}

function stringArraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.tryPromise(() => crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  )).pipe(
    Effect.map(buffer => new Uint8Array(buffer)),
    Effect.orDie,
  );
}

function authorityFailure(
  reason: ApplicationSchemaAuthorityError["reason"],
  cause?: unknown,
): Effect.Effect<never, ApplicationSchemaAuthorityError> {
  return Effect.fail(authorityFailureValue(reason, cause));
}

function authorityFailureValue(
  reason: ApplicationSchemaAuthorityError["reason"],
  cause?: unknown,
): ApplicationSchemaAuthorityError {
  return new ApplicationSchemaAuthorityError({
    operation: "publish",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
