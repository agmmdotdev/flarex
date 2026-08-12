import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, desc, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import type {
  CatalogIndexId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  MAX_CATALOG_SCHEMA_VERSION,
  canonicalizeSchemaManifestV1,
  decodeSchemaManifestAppSchemaV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result,
  decodeSchemaManifestAppTableDeclarationsV1Result,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import {
  publishAppSchemaV1WithRepositoryGateEffect,
  type AppSchemaPublicationV1Repository,
  type PublishAppSchemaV1Error,
  type PublishAppSchemaV1Input,
  type PublishAppSchemaV1Result,
} from "./appSchemaPublication";
import type { PreparedAppSchemaPublicationV1 } from
  "./appSchemaPublicationPreparation";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  deployments,
  fxControlApplicationSchemaAuthoritiesV1,
  fxControlSchemaVersions,
} from "./schema";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";
import {
  getSchemaVersionArtifactByIdEffect,
  type ReadSchemaVersionArtifactError,
} from "./schemaVersionArtifacts";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

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
  readonly operation: "publish" | "readPublished";
  readonly reason:
    | "invalidDeployment"
    | "invalidManifest"
    | "invalidSchema"
    | "projectionMismatch"
    | "resourceFailure";
  readonly cause?: unknown;
}> {}

export interface ApplicationSchemaAuthorityPublisher<Failure> {
  readonly publish: (input: {
    readonly deploymentId: string;
    readonly manifest: unknown;
  }) => Effect.Effect<
    ApplicationSchemaAuthority,
    ApplicationSchemaAuthorityError | Failure
  >;
  readonly readPublished: (input: {
    readonly deploymentId: string;
    readonly manifest: unknown;
  }) => Effect.Effect<
    ApplicationSchemaAuthority,
    ApplicationSchemaAuthorityError | ReadSchemaVersionArtifactError
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
      const schemaSha256Bytes = yield* sha256(schemaFrame);
      const schemaSha256 = encodeBytesToLowercaseHex(schemaSha256Bytes);
      const schemaVersionId = CatalogSchemaVersionIdSchema.make(
        `application_${schemaSha256}`,
      );
      const published = yield* publishWithAtomicReservation(
        repository,
        input.deploymentId,
        schemaSha256Bytes,
        schemaSha256,
        schemaVersionId,
        canonical.manifest,
      );
      yield* verifyPublicationArtifact(
        input.deploymentId,
        schemaVersionId,
        published.schemaVersion,
        published.publication,
      );
      return yield* Effect.fromResult(projectAuthority(
        input.deploymentId,
        schemaSha256,
        schemaVersionId,
        published.schemaVersion,
        canonical.manifest.schema,
        published.publication.manifest,
        published.publication.artifact.manifestSha256,
      ));
    },
  );
  const readPublished = Effect.fn("ApplicationSchemaAuthority.readPublished")(
    function* (input: {
      readonly deploymentId: string;
      readonly manifest: unknown;
    }): Effect.fn.Return<
      ApplicationSchemaAuthority,
      ApplicationSchemaAuthorityError | ReadSchemaVersionArtifactError
    > {
      if (!isNonBlankString(input.deploymentId) ||
        input.deploymentId.includes("\0")) {
        return yield* authorityFailure(
          "invalidDeployment",
          undefined,
          "readPublished",
        );
      }
      const canonical = yield* Effect.fromResult(
        canonicalizeApplicationManifestV1(input.manifest).pipe(
          Result.mapError(cause => authorityFailureValue(
            "invalidManifest",
            cause,
            "readPublished",
          )),
        ),
      );
      const schemaFrame = yield* Effect.fromResult(
        applicationSchemaPublicationFrameV1(canonical.manifest).pipe(
          Result.mapError(cause => authorityFailureValue(
            "invalidSchema",
            cause,
            "readPublished",
          )),
        ),
      );
      const applicationSchemaSha256 = encodeBytesToLowercaseHex(
        yield* sha256(schemaFrame),
      );
      const schemaVersionId = CatalogSchemaVersionIdSchema.make(
        `application_${applicationSchemaSha256}`,
      );
      const artifact = yield* getSchemaVersionArtifactByIdEffect(
        repository.db,
        input.deploymentId,
        schemaVersionId,
      );
      if (artifact === null) {
        return yield* authorityFailure(
          "projectionMismatch",
          undefined,
          "readPublished",
        );
      }
      const manifest = yield* Effect.fromResult(
        decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(
          Result.mapError(cause => authorityFailureValue(
            "projectionMismatch",
            cause,
            "readPublished",
          )),
        ),
      );
      return yield* Effect.fromResult(projectAuthority(
        input.deploymentId,
        applicationSchemaSha256,
        schemaVersionId,
        artifact.version,
        canonical.manifest.schema,
        manifest,
        artifact.manifestSha256,
        "readPublished",
      ));
    },
  );
  const publisher = Object.freeze({ publish, readPublished });
  applicationSchemaPublisherControlDatabases.set(publisher, repository.db);
  return publisher;
}

class ApplicationSchemaVersionReservationStaleError extends Error {
  readonly _tag = "ApplicationSchemaVersionReservationStaleError" as const;
}

function publishWithAtomicReservation(
  repository: AppSchemaPublicationV1Repository,
  deploymentId: string,
  schemaSha256Bytes: Uint8Array,
  schemaSha256: string,
  schemaVersionId: CatalogSchemaVersionId,
  manifest: ApplicationManifestV1,
): Effect.Effect<Readonly<{
  readonly schemaVersion: CatalogSchemaVersion;
  readonly publication: PublishAppSchemaV1Result;
}>, ApplicationSchemaAuthorityError | PublishAppSchemaV1Error> {
  const attempt = (remaining: number): Effect.Effect<Readonly<{
    readonly schemaVersion: CatalogSchemaVersion;
    readonly publication: PublishAppSchemaV1Result;
  }>, ApplicationSchemaAuthorityError | PublishAppSchemaV1Error> =>
    selectApplicationSchemaVersion(
      repository.db,
      deploymentId,
      schemaSha256Bytes,
    )
      .pipe(
        Effect.flatMap(schemaVersion => Effect.fromResult(
          schemaPublicationInput(
            deploymentId,
            schemaVersionId,
            schemaVersion,
            manifest,
          ),
        ).pipe(
          Effect.flatMap(publicationInput =>
            publishAppSchemaV1WithRepositoryGateEffect(
              repository,
              publicationInput,
              Object.freeze({
                beforePublish: (
                  tx: StableTableCatalogTransaction,
                  publication: PreparedAppSchemaPublicationV1,
                ) => reserveApplicationSchemaVersion(
                  tx,
                  deploymentId,
                  schemaSha256Bytes,
                  schemaVersionId,
                  schemaVersion,
                  publication,
                ),
              }),
            )
          ),
          Effect.map(publication => Object.freeze({
            schemaVersion,
            publication,
          })),
        )),
        Effect.catch((failure) =>
          failure instanceof ApplicationSchemaVersionReservationStaleError
            ? remaining > 1
              ? attempt(remaining - 1)
              : authorityFailure("projectionMismatch", failure)
            : Effect.fail(failure)
        ),
      );
  return attempt(3);
}

function selectApplicationSchemaVersion(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaSha256: Uint8Array,
): Effect.Effect<CatalogSchemaVersion, ApplicationSchemaAuthorityError> {
  return Effect.gen(function* () {
    const existing = yield* authorityQuery(() => db.select({
      schemaVersion: fxControlApplicationSchemaAuthoritiesV1.schemaVersion,
      status: fxControlApplicationSchemaAuthoritiesV1.status,
    }).from(fxControlApplicationSchemaAuthoritiesV1).where(and(
      eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId),
      eq(
        fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
        schemaSha256,
      ),
    )).limit(1));
    if (existing[0] !== undefined) {
      const artifact = yield* authorityQuery(() => db.select({
        version: fxControlSchemaVersions.version,
      }).from(fxControlSchemaVersions).where(and(
        eq(fxControlSchemaVersions.deploymentId, deploymentId),
        eq(
          fxControlSchemaVersions.schemaVersionId,
          CatalogSchemaVersionIdSchema.make(
            `application_${encodeBytesToLowercaseHex(schemaSha256)}`,
          ),
        ),
      )).limit(1));
      if (artifact[0] !== undefined) {
        return artifact[0].version === existing[0].schemaVersion
          ? existing[0].schemaVersion
          : yield* authorityFailure("projectionMismatch");
      }
      if (existing[0].status === "published") {
        return yield* authorityFailure("projectionMismatch");
      }
    }
    const deployment = yield* authorityQuery(() => db.select({
      activeSchemaVersion: deployments.activeSchemaVersion,
    }).from(deployments).where(eq(
      deployments.deploymentId,
      deploymentId,
    )).limit(1));
    if (deployment.length !== 1) {
      return yield* authorityFailure("projectionMismatch");
    }
    const catalog = yield* authorityQuery(() => db.select({
      version: fxControlSchemaVersions.version,
    }).from(fxControlSchemaVersions).where(eq(
      fxControlSchemaVersions.deploymentId,
      deploymentId,
    )).orderBy(desc(fxControlSchemaVersions.version)).limit(1));
    const reserved = yield* authorityQuery(() => db.select({
      version: fxControlApplicationSchemaAuthoritiesV1.schemaVersion,
    }).from(fxControlApplicationSchemaAuthoritiesV1).where(eq(
      fxControlApplicationSchemaAuthoritiesV1.deploymentId,
      deploymentId,
    )).orderBy(desc(
      fxControlApplicationSchemaAuthoritiesV1.schemaVersion,
    )).limit(1));
    const maximum = Math.max(
      deployment[0]?.activeSchemaVersion ?? 0,
      catalog[0]?.version ?? 0,
      reserved[0]?.version ?? 0,
    );
    if (maximum >= MAX_CATALOG_SCHEMA_VERSION) {
      return yield* authorityFailure("projectionMismatch");
    }
    return CatalogSchemaVersionSchema.make(maximum + 1);
  });
}

function reserveApplicationSchemaVersion(
  tx: StableTableCatalogTransaction,
  deploymentId: string,
  schemaSha256: Uint8Array,
  schemaVersionId: CatalogSchemaVersionId,
  schemaVersion: CatalogSchemaVersion,
  publication: PreparedAppSchemaPublicationV1,
): Effect.Effect<void, ApplicationSchemaAuthorityError |
  ApplicationSchemaVersionReservationStaleError> {
  return Effect.gen(function* () {
    if (publication.deploymentId !== deploymentId ||
      publication.schemaVersionId !== schemaVersionId ||
      publication.version !== schemaVersion) {
      return yield* authorityFailure("projectionMismatch");
    }
    const deployment = yield* authorityQuery(() => tx.select({
      deploymentId: deployments.deploymentId,
      activeSchemaVersion: deployments.activeSchemaVersion,
    }).from(deployments).where(eq(
      deployments.deploymentId,
      deploymentId,
    )).limit(1).for("update"));
    if (deployment.length !== 1) {
      return yield* authorityFailure("projectionMismatch");
    }
    const existing = yield* authorityQuery(() => tx.select().from(
      fxControlApplicationSchemaAuthoritiesV1,
    ).where(and(
      eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId),
      eq(
        fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
        schemaSha256,
      ),
    )).limit(1).for("update"));
    const row = existing[0];
    if (row !== undefined) {
      if (row.status === "published") {
        if (row.schemaVersionId !== schemaVersionId ||
          row.schemaVersion !== schemaVersion) {
          return yield* authorityFailure("projectionMismatch");
        }
        return;
      }
      if (row.schemaVersionId !== schemaVersionId) {
        return yield* authorityFailure("projectionMismatch");
      }
      if (row.schemaVersion === schemaVersion) return;
      const occupiedCatalog = yield* schemaVersionOccupiedByCatalog(
        tx,
        deploymentId,
        schemaVersion,
      );
      const occupiedReservation = yield* schemaVersionOccupiedByReservation(
        tx,
        deploymentId,
        schemaVersion,
      );
      if (occupiedCatalog || occupiedReservation ||
        (deployment[0]?.activeSchemaVersion ?? 0) >= schemaVersion) {
        return yield* Effect.fail(
          new ApplicationSchemaVersionReservationStaleError(),
        );
      }
      const updated = yield* authorityQuery(() => tx.update(
        fxControlApplicationSchemaAuthoritiesV1,
      ).set({ schemaVersion }).where(and(
        eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId),
        eq(
          fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
          schemaSha256,
        ),
        eq(fxControlApplicationSchemaAuthoritiesV1.status, "reserved"),
        eq(
          fxControlApplicationSchemaAuthoritiesV1.schemaVersion,
          row.schemaVersion,
        ),
      )).returning({
        deploymentId: fxControlApplicationSchemaAuthoritiesV1.deploymentId,
      }));
      if (updated.length !== 1) {
        return yield* Effect.fail(
          new ApplicationSchemaVersionReservationStaleError(),
        );
      }
      return;
    }
    const occupiedCatalog = yield* schemaVersionOccupiedByCatalog(
      tx,
      deploymentId,
      schemaVersion,
    );
    const occupiedReservation = yield* schemaVersionOccupiedByReservation(
      tx,
      deploymentId,
      schemaVersion,
    );
    if (occupiedCatalog || occupiedReservation ||
      (deployment[0]?.activeSchemaVersion ?? 0) >= schemaVersion) {
      return yield* Effect.fail(
        new ApplicationSchemaVersionReservationStaleError(),
      );
    }
    yield* authorityQuery(() => tx.insert(
      fxControlApplicationSchemaAuthoritiesV1,
    ).values({
      deploymentId,
      applicationSchemaSha256: copyBytes(schemaSha256),
      schemaVersionId,
      schemaVersion,
      status: "reserved",
    }));
  });
}

function schemaVersionOccupiedByCatalog(
  tx: StableTableCatalogTransaction,
  deploymentId: string,
  schemaVersion: CatalogSchemaVersion,
): Effect.Effect<boolean, ApplicationSchemaAuthorityError> {
  return authorityQuery(() => tx.select({
    schemaVersionId: fxControlSchemaVersions.schemaVersionId,
  }).from(fxControlSchemaVersions).where(and(
    eq(fxControlSchemaVersions.deploymentId, deploymentId),
    eq(fxControlSchemaVersions.version, schemaVersion),
  )).limit(1)).pipe(Effect.map(rows => rows.length > 0));
}

function schemaVersionOccupiedByReservation(
  tx: StableTableCatalogTransaction,
  deploymentId: string,
  schemaVersion: CatalogSchemaVersion,
): Effect.Effect<boolean, ApplicationSchemaAuthorityError> {
  return authorityQuery(() => tx.select({
    schemaVersionId: fxControlApplicationSchemaAuthoritiesV1.schemaVersionId,
  }).from(fxControlApplicationSchemaAuthoritiesV1).where(and(
    eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId),
    eq(fxControlApplicationSchemaAuthoritiesV1.schemaVersion, schemaVersion),
  )).limit(1)).pipe(Effect.map(rows => rows.length > 0));
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
  manifest: SchemaManifestAppSchemaV1,
  manifestSha256: Uint8Array,
  operation: ApplicationSchemaAuthorityError["operation"] = "publish",
): Result.Result<ApplicationSchemaAuthority, ApplicationSchemaAuthorityError> {
  const boundTablesByName = new Map<string,
    PublishAppSchemaV1Result["manifest"]["tableDefinitions"]["tables"][number]
  >(
    manifest.tableDefinitions.tables.map(table => [
      table.logicalName,
      table,
    ] as const),
  );
  if (boundTablesByName.size !== schema.tables.length) {
    return Result.fail(authorityFailureValue(
      "projectionMismatch",
      undefined,
      operation,
    ));
  }
  const tables: ApplicationSchemaTableBinding[] = [];
  const boundTableIdsByApplicationId = new Map<number, CatalogTableId>();
  for (const table of schema.tables) {
    const bound = boundTablesByName.get(table.name);
    if (bound === undefined ||
      !canonicalJsonEqual(bound.definition.documentType, table.validator)) {
      return Result.fail(authorityFailureValue(
        "projectionMismatch",
        undefined,
        operation,
      ));
    }
    boundTableIdsByApplicationId.set(table.tableId, bound.tableId);
    tables.push(Object.freeze({
      applicationTableId: table.tableId,
      logicalName: table.name,
      tableId: bound.tableId,
    }));
  }

  const indexes: ApplicationSchemaIndexBinding[] = [];
  const unmatched = new Set(manifest.indexBindings.indexes);
  for (const index of schema.indexes) {
    const tableId = boundTableIdsByApplicationId.get(index.tableId);
    if (tableId === undefined) {
      return Result.fail(authorityFailureValue(
        "projectionMismatch",
        undefined,
        operation,
      ));
    }
    const bound = manifest.indexBindings.indexes.find(candidate =>
      candidate.tableId === tableId && candidate.descriptor === index.name
    );
    if (bound === undefined ||
      !stringArraysEqual(bound.spec.fields, index.fields)) {
      return Result.fail(authorityFailureValue(
        "projectionMismatch",
        undefined,
        operation,
      ));
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
    return Result.fail(authorityFailureValue(
      "projectionMismatch",
      undefined,
      operation,
    ));
  }

  return Result.succeed(Object.freeze({
    deploymentId,
    applicationSchemaSha256,
    schemaVersionId,
    schemaVersion,
    schemaManifestSha256: encodeBytesToLowercaseHex(
      manifestSha256,
    ),
    manifest: snapshotSchemaManifestValue(manifest),
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

function authorityQuery<Value>(
  run: () => PromiseLike<Value>,
  operation: ApplicationSchemaAuthorityError["operation"] = "publish",
): Effect.Effect<Value, ApplicationSchemaAuthorityError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: cause => authorityFailureValue("resourceFailure", cause, operation),
  });
}

function authorityFailure(
  reason: ApplicationSchemaAuthorityError["reason"],
  cause?: unknown,
  operation: ApplicationSchemaAuthorityError["operation"] = "publish",
): Effect.Effect<never, ApplicationSchemaAuthorityError> {
  return Effect.fail(authorityFailureValue(reason, cause, operation));
}

function authorityFailureValue(
  reason: ApplicationSchemaAuthorityError["reason"],
  cause?: unknown,
  operation: ApplicationSchemaAuthorityError["operation"] = "publish",
): ApplicationSchemaAuthorityError {
  return new ApplicationSchemaAuthorityError({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
