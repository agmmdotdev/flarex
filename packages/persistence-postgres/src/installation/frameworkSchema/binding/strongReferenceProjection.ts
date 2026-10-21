import { Schema } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema } from "flarex-protocol/catalog";
import { LogicalSchemaEndpointLivenessSchema, LogicalSchemaExtensionSchema } from "flarex-protocol/internal/logical-schema-candidate";
import { AppOrderedIndexPhysicalSpecV1Schema } from "flarex-protocol/ordered-index";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

/** Authenticated target-side projection produced only by activation from the
 * control catalog. It is read for touched endpoints under the scope lock. */
export const StrongReferenceActivationProjectionSchema = Schema.Struct({
  name: Name,
  sourceTableId: CatalogTableIdSchema,
  sourceField: Name,
  sourceLiveness: LogicalSchemaEndpointLivenessSchema,
  reverseIndex: Schema.Struct({
    indexDefinitionId: CatalogIndexDefinitionIdSchema,
    physicalSpec: AppOrderedIndexPhysicalSpecV1Schema,
    physicalSpecSha256Hex: Sha256,
  }).annotate(strict),
  targetTableId: CatalogTableIdSchema,
  targetField: Name,
  targetLiveness: LogicalSchemaEndpointLivenessSchema,
  onTargetSoftDelete: LogicalSchemaExtensionSchema.fields.onTargetSoftDelete,
  targetIdentity: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("documentId"), logicalTableName: Name }).annotate(strict),
    Schema.Struct({ kind: Schema.Literal("textPrimaryKey"),
      uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema }).annotate(strict),
  ]),
  onTargetDelete: Schema.Literal("restrict"),
}).annotate(strict);
export type StrongReferenceActivationProjection = typeof StrongReferenceActivationProjectionSchema.Type;
export const StrongReferenceActivationProjectionsSchema = Schema.Array(StrongReferenceActivationProjectionSchema)
  .check(Schema.isMaxLength(1024));
