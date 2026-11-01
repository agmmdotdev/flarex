import { Schema } from "effect";
import { ScopeEpochUuidV1Schema, ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import { MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS } from "flarex-protocol/schema-manifest";
import { RelationDeclarationV1Schema } from "flarex-protocol/internal/relation-declaration-v1";
import { LogicalSchemaExtensionSchema } from "flarex-protocol/internal/logical-schema-candidate";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const isDocumentId = Schema.is(DeveloperDocumentIdSchema);
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const CoreNativeIdentitySchema = Schema.Struct({ scopeUuid: ScopeUuidV1Schema, epochUuid: ScopeEpochUuidV1Schema,
  sourceKey: Schema.NonEmptyString, sourceSha256: Digest, configSha256: Digest, provenanceSha256: Digest, definitionHash: Digest }).annotate(strict);
export type CoreNativeIdentity = typeof CoreNativeIdentitySchema.Type;
export const CoreNativeReferenceSchema = Schema.Struct({ declaration: RelationDeclarationV1Schema,
  reference: LogicalSchemaExtensionSchema, sourceTable: Schema.NonEmptyString, targetTable: Schema.NonEmptyString,
  field: Schema.NonEmptyString, indexName: Schema.NonEmptyString }).annotate(strict);
export type CoreNativeReference = typeof CoreNativeReferenceSchema.Type;
/** Narrow reader for the captured Native10 table policy; source identities do not change. */
const LegacyCoreNativeUniqueConstraintSchema = Schema.Struct({ descriptor: Schema.NonEmptyString,
  field: Schema.NonEmptyString, indexName: Schema.NonEmptyString }).annotate(strict);
export const CoreNativeUniqueConstraintSchema = Schema.Struct({ descriptor: Schema.NonEmptyString,
  fields: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS),
    Schema.makeFilter(fields => new Set(fields).size === fields.length ? undefined : "Native unique fields must be distinct")),
  indexName: Schema.NonEmptyString, nullsDistinct: Schema.Boolean }).annotate(strict);
const StoredUniqueConstraint = Schema.Union([LegacyCoreNativeUniqueConstraintSchema, CoreNativeUniqueConstraintSchema]);
type StoredUniqueConstraint = typeof StoredUniqueConstraint.Type;
export function coreNativeConstraintFields(constraint: StoredUniqueConstraint): readonly string[] {
  return "field" in constraint ? [constraint.field] : constraint.fields;
}
export function coreNativeConstraintNullsDistinct(constraint: StoredUniqueConstraint): boolean {
  return "field" in constraint ? false : constraint.nullsDistinct;
}
export const CoreNativeTablePolicySchema = Schema.Struct({ state: Schema.Literals(["reserved", "active"]),
  schemaId: Schema.String.check(Schema.makeFilter(value => isDocumentId(value) ? undefined : "Expected a schema document ID")),
  identity: CoreNativeIdentitySchema, applicationRead: Schema.Boolean,
  references: Schema.optionalKey(Schema.Array(CoreNativeReferenceSchema).check(Schema.isMaxLength(1))),
  uniqueConstraints: Schema.Array(StoredUniqueConstraint).check(Schema.isMaxLength(64), Schema.makeFilter(values =>
    new Set(values.map(value => value.descriptor)).size !== values.length
      || new Set(values.map(value => JSON.stringify(coreNativeConstraintFields(value)))).size !== values.length
      ? "Native constraints require distinct descriptors and field tuples" : undefined)) }).annotate(strict);
export type CoreNativeTablePolicy = typeof CoreNativeTablePolicySchema.Type;
