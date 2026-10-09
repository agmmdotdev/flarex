import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
} from "@flarex/analysis/application-analysis";
import {
  APPLICATION_SCHEMA_PUBLICATION_MAXIMUM_FRAME_BYTES_V2,
} from "@flarex/analysis/internal/application-publication-v2";
import {
  MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES,
  type ApplicationSchemaBindingWithRelations,
} from "flarex-protocol/internal/application-schema-binding";
import type { CatalogSchemaVersion, CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { bytea, nonBlankText } from "./primitives";
import { deployments, fxControlSchemaVersions } from "./catalogIdentity";

/** One reusable immutable relation-aware bound schema. */
export const fxControlBoundApplicationSchemas = pgTable(
  "fx_control_bound_application_schema",
  {
    deploymentId: text("deployment_id").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    applicationSchemaFrameBytes: bytea("application_schema_frame_bytes")
      .notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    bindingCodecVersion: integer("binding_codec_version")
      .$type<2 | 3>()
      .notNull(),
    bindingJson: jsonb("binding_json")
      .$type<ApplicationSchemaBindingWithRelations>()
      .notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_bound_application_schema_pk",
      columns: [table.deploymentId, table.applicationSchemaSha256],
    }),
    unique("fx_control_bound_application_schema_version_id_unique").on(
      table.deploymentId,
      table.schemaVersionId,
    ),
    unique("fx_control_bound_application_schema_version_unique").on(
      table.deploymentId,
      table.schemaVersion,
    ),
    unique("fx_control_bound_application_schema_identity_unique").on(
      table.deploymentId,
      table.applicationSchemaSha256,
      table.schemaVersionId,
      table.schemaVersion,
      table.boundPublicationSha256,
    ),
    foreignKey({
      name: "fx_control_bound_application_schema_artifact_fk",
      columns: [
        table.deploymentId,
        table.schemaVersionId,
        table.schemaVersion,
        table.schemaManifestSha256,
      ],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
        fxControlSchemaVersions.version,
        fxControlSchemaVersions.manifestSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_bound_application_schema_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and octet_length(${table.applicationSchemaSha256}) = 32
        and octet_length(${table.applicationSchemaFrameBytes}) between 1 and ${sql.raw(
          String(APPLICATION_SCHEMA_PUBLICATION_MAXIMUM_FRAME_BYTES_V2),
        )}
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647
        and octet_length(${table.schemaManifestSha256}) = 32
        and ${table.bindingCodecVersion} in (2, 3)
        and octet_length(${table.bindingBytes}) between 1 and ${sql.raw(
          String(MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES),
        )}
        and octet_length(${table.boundPublicationSha256}) = 32`,
    ),
    check(
      "fx_control_bound_application_schema_json_check",
      sql`(
          jsonb_typeof(${table.bindingJson}) = 'object'
          and ${table.bindingJson} ->> 'format'
            = 'flarex.application-schema-binding'
          and ${table.bindingJson} -> 'version' = to_jsonb(${table.bindingCodecVersion})
        ) is true`,
    ),
    check(
      "fx_control_bound_application_schema_time_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

/** Immutable pin from one analyzed manifest to its reusable bound schema. */
export const fxControlApplicationManifestSchemaBindings = pgTable(
  "fx_control_application_manifest_schema_binding",
  {
    deploymentId: text("deployment_id").notNull(),
    applicationManifestSha256: bytea("application_manifest_sha256").notNull(),
    applicationManifestBytes: bytea("application_manifest_bytes").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    bindingSha256: bytea("binding_sha256").notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_application_manifest_schema_binding_pk",
      columns: [table.deploymentId, table.applicationManifestSha256],
    }),
    unique("fx_control_application_manifest_schema_binding_identity_unique")
      .on(
        table.deploymentId,
        table.applicationManifestSha256,
        table.applicationSchemaSha256,
        table.schemaVersionId,
        table.boundPublicationSha256,
        table.bindingSha256,
      ),
    foreignKey({
      name: "fx_control_application_manifest_schema_binding_schema_fk",
      columns: [
        table.deploymentId,
        table.applicationSchemaSha256,
        table.schemaVersionId,
        table.schemaVersion,
        table.boundPublicationSha256,
      ],
      foreignColumns: [
        fxControlBoundApplicationSchemas.deploymentId,
        fxControlBoundApplicationSchemas.applicationSchemaSha256,
        fxControlBoundApplicationSchemas.schemaVersionId,
        fxControlBoundApplicationSchemas.schemaVersion,
        fxControlBoundApplicationSchemas.boundPublicationSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_application_manifest_schema_binding_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and octet_length(${table.applicationManifestSha256}) = 32
        and octet_length(${table.applicationManifestBytes}) between 1 and ${sql.raw(
          String(APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1),
        )}
        and octet_length(${table.applicationSchemaSha256}) = 32
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647
        and octet_length(${table.boundPublicationSha256}) = 32
        and octet_length(${table.bindingSha256}) = 32
        and octet_length(${table.bindingBytes}) between 1 and ${sql.raw(
          String(MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES),
        )}`,
    ),
    check(
      "fx_control_application_manifest_schema_binding_time_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

/**
 * Reserved and then published bridge from one canonical Application schema
 * digest to the existing deployment-stable app-schema catalog.
 */
export const fxControlApplicationSchemaAuthoritiesV1 = pgTable(
  "fx_control_application_schema_authority_v1",
  {
    deploymentId: text("deployment_id").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    status: text("status").$type<"reserved" | "published">().notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256"),
    bindingSha256: bytea("binding_sha256"),
    bindingBytes: bytea("binding_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.applicationSchemaSha256],
    }),
    unique("fx_application_schema_authority_v1_version_id_unique").on(
      table.deploymentId,
      table.schemaVersionId,
    ),
    unique("fx_application_schema_authority_v1_version_unique").on(
      table.deploymentId,
      table.schemaVersion,
    ),
    unique("fx_application_schema_authority_v1_binding_unique").on(
      table.deploymentId,
      table.applicationSchemaSha256,
      table.schemaVersionId,
      table.schemaVersion,
    ),
    foreignKey({
      name: "fx_application_schema_authority_v1_deployment_fk",
      columns: [table.deploymentId],
      foreignColumns: [deployments.deploymentId],
    }).onDelete("restrict"),
    check(
      "fx_application_schema_authority_v1_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and octet_length(${table.applicationSchemaSha256}) = 32
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647`,
    ),
    check(
      "fx_application_schema_authority_v1_state_check",
      sql`(
          ${table.status} = 'reserved'
          and ${table.schemaManifestSha256} is null
          and ${table.bindingSha256} is null
          and ${table.bindingBytes} is null
          and ${table.publishedAt} is null
        ) or (
          ${table.status} = 'published'
          and octet_length(${table.schemaManifestSha256}) = 32
          and octet_length(${table.bindingSha256}) = 32
          and octet_length(${table.bindingBytes}) between 1 and 1048576
          and ${table.publishedAt} is not null
        )`,
    ),
    check(
      "fx_application_schema_authority_v1_time_check",
      sql`isfinite(${table.createdAt})
        and (${table.publishedAt} is null or (
          isfinite(${table.publishedAt}) and ${table.publishedAt} >= ${table.createdAt}
        ))`,
    ),
  ],
);
