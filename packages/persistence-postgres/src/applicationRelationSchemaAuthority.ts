import {
  verifyApplicationManifestWithRelations,
  type ApplicationManifestWithRelations,
} from "@flarex/analysis/application-analysis";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import type {
  ApplicationSchemaEdgeDefinitionV2,
  ApplicationSchemaRelationBindingV2,
  ApplicationSchemaSemanticDefinitionV2,
  ApplicationSchemaBindingV3,
} from "flarex-protocol/internal/application-schema-binding";
import {
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  decodeSchemaManifestAppSchemaV1Result,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import {
  locateApplicationRelationManifestBindingEffect,
  type ReadApplicationRelationBindingError,
  type LocatedApplicationRelationManifestBinding,
  type LocateApplicationRelationManifestBindingInput,
} from "./applicationRelationBinding";
import type {
  ApplicationSchemaIndexBinding,
  ApplicationSchemaTableBinding,
} from "./applicationSchemaAuthority";
import type { FlarexMetadataDatabase } from "./deployments";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";
import {
  getSchemaVersionArtifactByIdEffect,
  type ReadSchemaVersionArtifactError,
} from "./schemaVersionArtifacts";

export interface ApplicationRelationSchemaAuthority {
  readonly writePolicy: Pick<ApplicationSchemaBindingV3, "writePolicySetSha256" | "writePolicies"> | null;
  readonly deploymentId: string;
  readonly applicationManifestSha256: string;
  readonly applicationSchemaSha256: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schemaManifestSha256: string;
  readonly manifestSchemaBindingSha256: string;
  readonly boundPublicationSha256: string;
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly tables: ReadonlyArray<ApplicationSchemaTableBinding>;
  readonly indexes: ReadonlyArray<ApplicationSchemaIndexBinding>;
  readonly relations: ReadonlyArray<ApplicationSchemaRelationBindingV2>;
  readonly semanticDefinitions:
    ReadonlyArray<ApplicationSchemaSemanticDefinitionV2>;
  readonly edgeDefinitions: ReadonlyArray<ApplicationSchemaEdgeDefinitionV2>;
}

export class ApplicationRelationSchemaAuthorityError extends Data.TaggedError(
  "ApplicationRelationSchemaAuthorityError",
)<{
  readonly operation: "resolve";
  readonly reason:
    | "invalidInput"
    | "bindingMissing"
    | "bindingMismatch"
    | "storedState";
  readonly cause?: unknown;
}> {}

export type ResolveApplicationRelationSchemaAuthorityError =
  | ApplicationRelationSchemaAuthorityError
  | ReadApplicationRelationBindingError<"locateManifestBinding">
  | ReadSchemaVersionArtifactError;

export interface ApplicationRelationSchemaAuthorityPort {
  readonly resolve: (input: {
    readonly deploymentId: string;
    readonly applicationManifestSha256: string;
    readonly manifest: ApplicationManifestWithRelations;
  }) => Effect.Effect<
    ApplicationRelationSchemaAuthority,
    ResolveApplicationRelationSchemaAuthorityError
  >;
}

const schemaAuthorityControlDatabases = new WeakMap<object, FlarexMetadataDatabase>();
const resolvedBindings = new WeakMap<ApplicationRelationSchemaAuthority, Readonly<{
  controlDb: FlarexMetadataDatabase;
  binding: LocatedApplicationRelationManifestBinding;
}>>();

/** Request-local planning reuse, never a fresh acceptance verdict. Return a
 * detached copy so a consumer cannot mutate the resolver's captured evidence. */
export const readResolvedApplicationRelationManifestBinding = Effect.fn("ApplicationRelationSchemaAuthority.readResolvedBinding")(
  function* (schema: ApplicationRelationSchemaAuthority, controlDb: FlarexMetadataDatabase,
    input: LocateApplicationRelationManifestBindingInput) {
    const state = resolvedBindings.get(schema);
    if (state === undefined || state.controlDb !== controlDb || schema.deploymentId !== input.deploymentId ||
      schema.applicationManifestSha256 !== input.applicationManifestSha256) return yield* failure("invalidInput");
    return structuredClone(state.binding);
  },
);

export function createApplicationRelationSchemaAuthorityPort(
  controlDb: FlarexMetadataDatabase,
): ApplicationRelationSchemaAuthorityPort {
  const resolve = Effect.fn("ApplicationRelationSchemaAuthority.resolve")(
    function* (input: {
      readonly deploymentId: string;
      readonly applicationManifestSha256: string;
      readonly manifest: ApplicationManifestWithRelations;
    }): Effect.fn.Return<
      ApplicationRelationSchemaAuthority,
      ResolveApplicationRelationSchemaAuthorityError
    > {
      if (
        input.deploymentId.trim().length === 0 ||
        input.deploymentId.includes("\0") ||
        !/^[0-9a-f]{64}$/.test(input.applicationManifestSha256)
      ) return yield* failure("invalidInput");
      const canonical = yield* verifyApplicationManifestWithRelations(input.manifest).pipe(
        Effect.mapError(cause => failureValue("invalidInput", cause)),
      );
      const manifestSha256 = yield* sha256(canonical.canonicalBytes);
      if (
        encodeBytesToLowercaseHex(manifestSha256) !==
          input.applicationManifestSha256
      ) return yield* failure("invalidInput");
      const located = yield* locateApplicationRelationManifestBindingEffect(
        controlDb,
        {
          deploymentId: input.deploymentId,
          applicationManifestSha256: input.applicationManifestSha256,
        },
      );
      if (located === null) return yield* failure("bindingMissing");
      const pin = located.manifestBinding.binding;
      const bound = located.relationBinding;
      if (
        pin.deploymentId !== input.deploymentId ||
        pin.applicationManifestSha256 !== input.applicationManifestSha256 ||
        bound.deploymentId !== input.deploymentId ||
        bound.schemaVersionId !== pin.schemaVersionId ||
        bound.binding.schemaVersion !== pin.schemaVersion ||
        bound.binding.applicationSchemaSha256 !==
          pin.applicationSchemaSha256 ||
        encodeBytesToLowercaseHex(bound.applicationSchemaSha256) !==
          pin.applicationSchemaSha256 ||
        encodeBytesToLowercaseHex(bound.boundPublicationSha256) !==
          pin.boundPublicationSha256
      ) return yield* failure("bindingMismatch");
      const artifact = yield* getSchemaVersionArtifactByIdEffect(
        controlDb,
        input.deploymentId,
        pin.schemaVersionId,
      );
      if (
        artifact === null || artifact.version !== pin.schemaVersion ||
        !bytesEqualFullScan(
          artifact.manifestSha256,
          bound.schemaManifestSha256,
        )
      ) return yield* failure("bindingMismatch");
      const manifest = yield* Effect.fromResult(
        decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(
          Result.mapError(cause => failureValue("storedState", cause)),
        ),
      );
      if (
        bound.binding.tables.length !== manifest.tableDefinitions.tables.length ||
        bound.binding.indexes.length !== manifest.indexBindings.indexes.length ||
        bound.binding.relationBindings.length !==
          canonical.manifest.schema.relations.length
      ) return yield* failure("bindingMismatch");
      const schema: ApplicationRelationSchemaAuthority = Object.freeze({
        writePolicy: bound.binding.version === 3 ? Object.freeze({
          writePolicySetSha256: bound.binding.writePolicySetSha256,
          writePolicies: bound.binding.writePolicies,
        }) : null,
        deploymentId: input.deploymentId,
        applicationManifestSha256: input.applicationManifestSha256,
        applicationSchemaSha256: pin.applicationSchemaSha256,
        schemaVersionId: pin.schemaVersionId,
        schemaVersion: pin.schemaVersion,
        schemaManifestSha256:
          encodeBytesToLowercaseHex(bound.schemaManifestSha256),
        manifestSchemaBindingSha256: located.manifestBinding.sha256Hex,
        boundPublicationSha256: pin.boundPublicationSha256,
        manifest: snapshotSchemaManifestValue(manifest),
        tables: Object.freeze(bound.binding.tables.map(table =>
          Object.freeze({ ...table })
        )),
        indexes: Object.freeze(bound.binding.indexes.map(index =>
          Object.freeze({ ...index })
        )),
        relations: Object.freeze(bound.binding.relationBindings.map(relation =>
          Object.freeze({ ...relation })
        )),
        semanticDefinitions: Object.freeze(
          bound.binding.semanticDefinitions.map(definition =>
            Object.freeze({ ...definition })
          ),
        ),
        edgeDefinitions: Object.freeze(bound.binding.edgeDefinitions.map(
          definition => Object.freeze({ ...definition }),
        )),
      });
      resolvedBindings.set(schema, { controlDb, binding: located });
      return schema;
    },
  );
  const port = Object.freeze({ resolve });
  schemaAuthorityControlDatabases.set(port, controlDb);
  return port;
}

export function hasApplicationRelationSchemaAuthorityComposition(
  port: unknown,
  controlDb: FlarexMetadataDatabase,
): port is ApplicationRelationSchemaAuthorityPort {
  return typeof port === "object" && port !== null &&
    schemaAuthorityControlDatabases.get(port) === controlDb;
}

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: host - SHA-256 of an owned ArrayBuffer copy is treated as a non-rejecting WebCrypto digest
  return Effect.promise(async () => new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
  )).pipe(Effect.flatMap(digest => digest.byteLength === 32
    ? Effect.succeed(digest)
    : Effect.die(new Error("SHA-256 returned a non-32-byte digest."))));
}

function failure(
  reason: ApplicationRelationSchemaAuthorityError["reason"],
  cause?: unknown,
): Effect.Effect<never, ApplicationRelationSchemaAuthorityError> {
  return Effect.fail(failureValue(reason, cause));
}

function failureValue(
  reason: ApplicationRelationSchemaAuthorityError["reason"],
  cause?: unknown,
): ApplicationRelationSchemaAuthorityError {
  return new ApplicationRelationSchemaAuthorityError({
    operation: "resolve",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
