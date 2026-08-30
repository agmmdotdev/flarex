import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { bytea, deployments } from "../../schema";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifactOwner,
  type FrameworkSchemaLineageId,
} from "./model";
import {
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES,
} from "./policy";

const collatedText = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'text COLLATE "C"';
  },
});

const ecmaScriptTrimCharacters = sql`
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
`;

function isPhysicallyNonBlank(value: SQLWrapper) {
  return sql`btrim(${value}, ${ecmaScriptTrimCharacters}) <> ''`;
}

export const fxControlFrameworkSchemaArtifacts = pgTable(
  "fx_control_framework_schema_artifact",
  {
    artifactStorageId: bigint("artifact_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_artifact_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: "9223372036854775807",
        cache: 1,
        cycle: false,
      }),
    deploymentId: text("deployment_id").notNull(),
    owner: collatedText("owner")
      .$type<FrameworkSchemaArtifactOwner>()
      .notNull(),
    lineageId: collatedText("lineage_id")
      .$type<FrameworkSchemaLineageId>()
      .notNull(),
    artifactSha256: bytea("artifact_sha256").notNull(),
    frameFormat: collatedText("frame_format")
      .$type<typeof FRAMEWORK_SCHEMA_ARTIFACT_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_SCHEMA_ARTIFACT_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    primaryKey({
      name: "fx_framework_artifact_storage_pk",
      columns: [table.artifactStorageId],
    }),
    unique("fx_framework_artifact_identity_unique").on(
      table.deploymentId,
      table.owner,
      table.lineageId,
      table.artifactSha256,
    ),
    unique("fx_framework_artifact_storage_identity_unique").on(
      table.artifactStorageId,
      table.deploymentId,
      table.owner,
      table.lineageId,
    ),
    foreignKey({
      name: "fx_framework_artifact_deployment_fk",
      columns: [table.deploymentId],
      foreignColumns: [deployments.deploymentId],
    }).onDelete("restrict"),
    check(
      "fx_framework_artifact_owner_check",
      sql`${table.owner} in ('payload', 'medusa', 'system')`,
    ),
    check(
      "fx_framework_artifact_identity_check",
      sql`${table.artifactStorageId} between 1 and 9223372036854775807
        and octet_length(convert_to(${table.deploymentId}, 'UTF8')) between 1 and ${sql.raw(String(MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES))}
        and ${isPhysicallyNonBlank(table.deploymentId)}
        and octet_length(convert_to(${table.lineageId}, 'UTF8')) between 1 and ${sql.raw(String(MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES))}
        and ${isPhysicallyNonBlank(table.lineageId)}
        and octet_length(${table.artifactSha256}) = 32`,
    ),
    check(
      "fx_framework_artifact_frame_check",
      sql`${table.frameFormat} = ${sql.raw(`'${FRAMEWORK_SCHEMA_ARTIFACT_FORMAT}'`)}
        and ${table.frameVersion} = ${sql.raw(String(FRAMEWORK_SCHEMA_ARTIFACT_VERSION))}
        and ${table.canonicalByteLength} between 1 and ${sql.raw(String(MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES))}
        and octet_length(${table.canonicalBytes}) = ${table.canonicalByteLength}`,
    ),
    check(
      "fx_framework_artifact_time_check",
      sql`isfinite(${table.admittedAt})`,
    ),
  ],
);

export const fxControlFrameworkSchemaArtifactDependencies = pgTable(
  "fx_control_framework_schema_artifact_dependency",
  {
    artifactStorageId: bigint("artifact_storage_id", {
      mode: "bigint",
    }).notNull(),
    dependencyStorageId: bigint("dependency_storage_id", {
      mode: "bigint",
    }).notNull(),
    deploymentId: text("deployment_id").notNull(),
    owner: collatedText("owner")
      .$type<FrameworkSchemaArtifactOwner>()
      .notNull(),
    artifactLineageId: collatedText("artifact_lineage_id")
      .$type<FrameworkSchemaLineageId>()
      .notNull(),
    dependencyOrdinal: integer("dependency_ordinal").notNull(),
    dependencyLineageId: collatedText("dependency_lineage_id")
      .$type<FrameworkSchemaLineageId>()
      .notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_artifact_dependency_pk",
      columns: [table.artifactStorageId, table.dependencyOrdinal],
    }),
    unique("fx_framework_artifact_dependency_target_unique").on(
      table.artifactStorageId,
      table.dependencyStorageId,
    ),
    foreignKey({
      name: "fx_framework_artifact_dependency_parent_fk",
      columns: [
        table.artifactStorageId,
        table.deploymentId,
        table.owner,
        table.artifactLineageId,
      ],
      foreignColumns: [
        fxControlFrameworkSchemaArtifacts.artifactStorageId,
        fxControlFrameworkSchemaArtifacts.deploymentId,
        fxControlFrameworkSchemaArtifacts.owner,
        fxControlFrameworkSchemaArtifacts.lineageId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_framework_artifact_dependency_target_fk",
      columns: [
        table.dependencyStorageId,
        table.deploymentId,
        table.owner,
        table.dependencyLineageId,
      ],
      foreignColumns: [
        fxControlFrameworkSchemaArtifacts.artifactStorageId,
        fxControlFrameworkSchemaArtifacts.deploymentId,
        fxControlFrameworkSchemaArtifacts.owner,
        fxControlFrameworkSchemaArtifacts.lineageId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_framework_artifact_dependency_identity_check",
      sql`${table.dependencyOrdinal} between 0 and ${sql.raw(String(MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES - 1))}
        and ${table.artifactStorageId} <> ${table.dependencyStorageId}
        and ${table.artifactLineageId} <> ${table.dependencyLineageId}`,
    ),
    index("fx_framework_artifact_dependency_reverse_idx").on(
      table.dependencyStorageId,
      table.artifactStorageId,
    ),
  ],
);
