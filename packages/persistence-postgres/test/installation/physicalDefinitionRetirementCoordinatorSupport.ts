import {
  canonicalAppUniqueConstraintSpecBytesHexV1ToBytes,
  appUniqueConstraintSpecSha256HexV1ToBytes,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import type {
  CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import type {
  CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";

interface QueryDatabase {
  readonly query: <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<Readonly<{ readonly rows: ReadonlyArray<Row> }>>;
}

export async function installRetireableUniqueConstraintDefinition(
  control: QueryDatabase,
  input: Readonly<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly logicalUniqueConstraintId: number;
    readonly uniqueConstraintDefinitionId:
      CatalogUniqueConstraintDefinitionId;
  }>,
): Promise<void> {
  const canonical = await canonicalizeAppUniqueConstraintPhysicalSpecV1({
    kind: "appUniqueConstraint",
    specVersion: 1,
    orderedFields: ["name"],
    sparse: false,
    localePolicy: { kind: "none" },
    keyCodecIdentity: "flarex.unique-key/ordered-index-components/v1",
    keyCodecVersion: 1,
  });
  await control.query(
    `insert into fx_control_unique_constraint
       (deployment_id, logical_unique_constraint_id, table_id, descriptor)
     values ($1, $2, 1, 'm05_b4_unique_name')`,
    [input.deploymentId, input.logicalUniqueConstraintId],
  );
  await control.query(
    `insert into fx_control_unique_constraint_definition
       (deployment_id, unique_constraint_definition_id,
        logical_unique_constraint_id, table_id,
        physical_spec_codec_version, physical_spec_json,
        physical_spec_bytes, physical_spec_sha256)
     values ($1, $2, $3, 1, 1, $4::jsonb, $5, $6)`,
    [
      input.deploymentId,
      input.uniqueConstraintDefinitionId,
      input.logicalUniqueConstraintId,
      JSON.stringify(canonical.physicalSpec),
      canonicalAppUniqueConstraintSpecBytesHexV1ToBytes(
        canonical.canonicalBytesHex,
      ),
      appUniqueConstraintSpecSha256HexV1ToBytes(canonical.sha256Hex),
    ],
  );
  await control.query(
    `insert into fx_control_schema_version_unique_constraint_binding
       (deployment_id, schema_version_id, logical_unique_constraint_id,
        unique_constraint_definition_id, required_for_activation)
     values ($1, $2, $3, $4, true)`,
    [
      input.deploymentId,
      input.schemaVersionId,
      input.logicalUniqueConstraintId,
      input.uniqueConstraintDefinitionId,
    ],
  );
}
