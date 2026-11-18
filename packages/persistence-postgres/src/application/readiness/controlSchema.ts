import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { ApplicationSchemaAuthority } from "../applicationSchemaAuthority";
import type { CatalogSchemaVersion } from "flarex-protocol/schema-manifest";
import { Effect } from "effect";
import {
  fxSystemApplicationRevisionSchemasV1,
  fxControlApplicationSchemaAuthoritiesV1,
} from "../../database/schema";
import {
  copyBytes,
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import {
  and,
  eq,
  getTableColumns,
  sql,
} from "drizzle-orm";
import {
  type ApplicationReadinessError,
  readinessFailure,
} from "./errors";
import {
  execute,
  query,
  controlDatabaseTime,
} from "./databaseBoundary";
import type { StoredBundle } from "./bundle";
import { MAX_BINDING_BYTES } from "./limits";
import {
  sha256,
  decodeSha256,
  canonicalBytes,
} from "./frames";
import type { FlarexMetadataDatabase } from "../deployments";

export const bindRevisionSchema = Effect.fn(function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  revisionId: string,
  deploymentId: string,
  applicationSchemaSha256: Uint8Array,
  schemaVersionId: ApplicationSchemaAuthority["schemaVersionId"],
  schemaVersion: CatalogSchemaVersion,
  schemaManifestSha256: Uint8Array,
  schemaBindingSha256: Uint8Array,
): Effect.fn.Return<void, ApplicationReadinessError> {
    yield* execute(tx.insert(fxSystemApplicationRevisionSchemasV1).values({
      scopeId,
      revisionId,
      deploymentId,
      applicationSchemaSha256: copyBytes(applicationSchemaSha256),
      schemaVersionId,
      schemaVersion,
      schemaManifestSha256: copyBytes(schemaManifestSha256),
      schemaBindingSha256: copyBytes(schemaBindingSha256),
    }).onConflictDoNothing());
    const rows = yield* query(
      tx.select().from(fxSystemApplicationRevisionSchemasV1).where(and(
        eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId),
        eq(fxSystemApplicationRevisionSchemasV1.revisionId, revisionId),
      )).limit(1),
    );
    const row = rows[0];
    if (row === undefined || row.deploymentId !== deploymentId ||
      row.schemaVersionId !== schemaVersionId ||
      row.schemaVersion !== schemaVersion ||
      !bytesEqualFullScan(
        row.applicationSchemaSha256,
        applicationSchemaSha256,
      ) ||
      !bytesEqualFullScan(row.schemaManifestSha256, schemaManifestSha256) ||
      !bytesEqualFullScan(row.schemaBindingSha256, schemaBindingSha256)) {
      return yield* readinessFailure("conflictingReplay");
    }
  });

export function requireSchemaCorrelation(
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
): Effect.Effect<void, ApplicationReadinessError> {
  return schema.deploymentId === bundle.deploymentId &&
      schema.applicationSchemaSha256 ===
        encodeBytesToLowercaseHex(bundle.publication.schemaSha256) &&
      schema.schemaVersion === schemaVersion &&
      schema.schemaVersionId ===
        `application_${schema.applicationSchemaSha256}`
    ? Effect.void
    : readinessFailure("schemaBinding");
}

export const publishSchemaBinding = Effect.fn(function* (
  tx: AppRowTransaction,
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
): Effect.fn.Return<Uint8Array, ApplicationReadinessError> {
    const bindingBytes = applicationSchemaBindingBytes(schema);
    if (bindingBytes.byteLength > MAX_BINDING_BYTES) {
      return yield* readinessFailure("schemaBinding");
    }
    const bindingSha256 = yield* sha256(bindingBytes);
    const schemaManifestSha256 = decodeSha256(schema.schemaManifestSha256);
    const rows = yield* query(
      tx.select().from(fxControlApplicationSchemaAuthoritiesV1).where(and(
        eq(
          fxControlApplicationSchemaAuthoritiesV1.deploymentId,
          bundle.deploymentId,
        ),
        eq(
          fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
          bundle.publication.schemaSha256,
        ),
      )).limit(1).for("update"),
    );
    const row = rows[0];
    if (row === undefined || row.schemaVersionId !== schema.schemaVersionId ||
      row.schemaVersion !== schemaVersion) {
      return yield* readinessFailure("schemaBinding");
    }
    if (row.status === "published") {
      if (row.schemaManifestSha256 === null || row.bindingSha256 === null ||
        row.bindingBytes === null ||
        !bytesEqualFullScan(row.schemaManifestSha256, schemaManifestSha256) ||
        !bytesEqualFullScan(row.bindingSha256, bindingSha256) ||
        !bytesEqualFullScan(row.bindingBytes, bindingBytes)) {
        return yield* readinessFailure("conflictingReplay");
      }
      return copyBytes(bindingSha256);
    }
    const now = yield* controlDatabaseTime(tx, bundle.deploymentId);
    const updated = yield* query(
      tx.update(fxControlApplicationSchemaAuthoritiesV1).set({
        status: "published",
        schemaManifestSha256,
        bindingSha256,
        bindingBytes,
        publishedAt: now,
      }).where(and(
        eq(
          fxControlApplicationSchemaAuthoritiesV1.deploymentId,
          bundle.deploymentId,
        ),
        eq(
          fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
          bundle.publication.schemaSha256,
        ),
        eq(fxControlApplicationSchemaAuthoritiesV1.status, "reserved"),
      )).returning({
        deploymentId: fxControlApplicationSchemaAuthoritiesV1.deploymentId,
      }),
    );
    if (updated.length !== 1) {
      return yield* readinessFailure("conflictingReplay");
    }
    return copyBytes(bindingSha256);
  });

export const readSchemaBinding = Effect.fn("ApplicationReadiness.readSchemaBinding")(function* (
  tx: AppRowTransaction | FlarexMetadataDatabase,
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
): Effect.fn.Return<Readonly<{ sha256: Uint8Array;
  originalRow: typeof fxControlApplicationSchemaAuthoritiesV1.$inferSelect;
  schemaBindingByteLengthText: string }>, ApplicationReadinessError> {
  const bindingBytes = applicationSchemaBindingBytes(schema);
  if (bindingBytes.byteLength > MAX_BINDING_BYTES) {
    return yield* readinessFailure("schemaBinding");
  }
  const bindingSha256 = yield* sha256(bindingBytes);
  const schemaManifestSha256 = decodeSha256(schema.schemaManifestSha256);
  const rows = yield* query(
    tx.select({ ...getTableColumns(fxControlApplicationSchemaAuthoritiesV1),
      bindingBytes: sql<Uint8Array | null>`case when octet_length(${fxControlApplicationSchemaAuthoritiesV1.bindingBytes})
        <= ${MAX_BINDING_BYTES} then ${fxControlApplicationSchemaAuthoritiesV1.bindingBytes} else null end`,
      schemaBindingByteLengthText: sql<string>`octet_length(${fxControlApplicationSchemaAuthoritiesV1.bindingBytes})::bigint::text`,
    }).from(fxControlApplicationSchemaAuthoritiesV1).where(and(
      eq(
        fxControlApplicationSchemaAuthoritiesV1.deploymentId,
        bundle.deploymentId,
      ),
      eq(
        fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
        bundle.publication.schemaSha256,
      ),
    )).limit(1).for("share"),
  );
  const row = rows[0];
  if (row === undefined || row.status !== "published" ||
    row.schemaVersionId !== schema.schemaVersionId ||
    row.schemaVersion !== schemaVersion ||
    row.schemaManifestSha256 === null || row.bindingSha256 === null ||
    row.bindingBytes === null ||
    !bytesEqualFullScan(row.schemaManifestSha256, schemaManifestSha256) ||
    !bytesEqualFullScan(row.bindingSha256, bindingSha256) ||
    !bytesEqualFullScan(row.bindingBytes, bindingBytes)) {
    return yield* readinessFailure("schemaBinding");
  }
  const { schemaBindingByteLengthText, ...originalRow } = row;
  return Object.freeze({ sha256: copyBytes(bindingSha256), originalRow: structuredClone(originalRow), schemaBindingByteLengthText });
});

export function applicationSchemaBindingBytes(
  schema: ApplicationSchemaAuthority,
): Uint8Array {
  return canonicalBytes({
    format: "flarex.application-schema-binding",
    version: 1,
    deploymentId: schema.deploymentId,
    applicationSchemaSha256: schema.applicationSchemaSha256,
    schemaVersionId: schema.schemaVersionId,
    schemaVersion: schema.schemaVersion,
    schemaManifestSha256: schema.schemaManifestSha256,
    tables: schema.tables.map(table => ({ ...table })),
    indexes: schema.indexes.map(index => ({ ...index })),
  });
}
