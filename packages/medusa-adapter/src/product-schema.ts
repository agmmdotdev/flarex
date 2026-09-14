import { Effect, Schema } from "effect";
import { lowerDmlSchema } from "./schema/lower";
import { decodeCompiledDml as decodeCompiled } from "./schema/compiled";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import {
  Product,
  ProductVariant,
  ProductOption,
  ProductOptionValue,
  ProductType,
  ProductTag,
  ProductCollection,
  ProductCategory,
  ProductImage,
  ProductVariantProductImage,
} from "@medusajs/product/models";
export const productModels = Object.freeze([
  Product,
  ProductVariant,
  ProductOption,
  ProductOptionValue,
  ProductType,
  ProductTag,
  ProductCollection,
  ProductCategory,
  ProductImage,
  ProductVariantProductImage,
] as const);
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import {
  capturePrivateCanonicalValue,
  captureRelationalPhysicalLayout,
  registerCommerceSchemaProfile,
} from "@flarex/persistence-postgres/internal/commerce-profile";

export class ProductSchemaError extends Schema.TaggedError<ProductSchemaError>()(
  "ProductSchemaError",
  { cause: Schema.Unknown },
) {}

const expectedTables = [
  "image",
  "product",
  "product_category",
  "product_category_product",
  "product_collection",
  "product_option",
  "product_option_value",
  "product_tag",
  "product_tags",
  "product_type",
  "product_variant",
  "product_variant_option",
  "product_variant_product_image",
];

/** Capture only the pinned Product grammar; arbitrary modules remain unadmitted. */
export const productSchemaInput = Effect.fn("MedusaProduct.schemaInput")(
  function* (input: unknown) {
    const compiled = yield* decodeCompiled(input).pipe(
      Effect.mapError((cause) => new ProductSchemaError({ cause })),
    );
    return yield* productSchemaFromCompiled(compiled);
  },
);

const productSchemaFromCompiled = Effect.fn("MedusaProduct.normalizeCompiled")(
  function* (compiled: Effect.Success<ReturnType<typeof decodeCompiled>>) {
    if (
      compiled.tables.some(table => table.columns.some(column =>
        column.type === "bigNumber" || column.defaultValue === null ||
        typeof column.defaultValue === "object")) ||
      compiled.tables.length !== expectedTables.length ||
      compiled.tables
        .map((table) => table.name)
        .sort()
        .some((name, index) => name !== expectedTables[index])
    ) {
      return yield* Effect.fail(
        new ProductSchemaError({ cause: "Incomplete Product model/pivot set" }),
      );
    }
    return lowerDmlSchema(compiled.tables, "commerce.product");
  },
);

export const productSourceProvenance = Object.freeze({
  kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze([
    "packages/modules/product/src/models",
    "packages/modules/product/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts",
    "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
  ]),
} as const);

export const captureProductSchema = Effect.fn("MedusaProduct.captureSchema")(
  function* (deploymentId: string) {
    // The pinned compiler is a foreign synchronous parser. Its optional undefined
    // members are omitted by its JSON representation before the closed decoder.
    const input = yield* Effect.try({
      try: (): unknown =>
        JSON.parse(JSON.stringify(compileDmlSchema([...productModels]))),
      catch: (cause) => new ProductSchemaError({ cause }),
    });
    const metadata = yield* decodeCompiled(input).pipe(
      Effect.mapError((cause) => new ProductSchemaError({ cause })),
    );
    const source = yield* productSchemaFromCompiled(metadata);
    const captured = yield* captureRelationalSchemaArtifact({
      deploymentId,
      provenance: productSourceProvenance,
      schema: source,
    });
    freezeOwnedProductMetadata(metadata);
    const retained = yield* capturePrivateCanonicalValue(metadata, 1_048_576, {
      invalidInput: () =>
        new ProductSchemaError({ cause: "Invalid Product metadata" }),
      hashFailure: (cause) => new ProductSchemaError({ cause }),
    });
    return { ...captured, metadata: retained };
  },
);

/** The closed decoder above owns this plain-data tree; no caller model is frozen. */
function freezeOwnedProductMetadata(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeOwnedProductMetadata(child);
  Object.freeze(value);
}

export const prepareProductSchemaProfile = Effect.fn(
  "MedusaProduct.prepareSchemaProfile",
)(function* (
  deploymentId: string,
  target: Omit<
    Parameters<typeof captureRelationalPhysicalLayout>[0],
    "artifact"
  >,
) {
  const captured = yield* captureProductSchema(deploymentId);
  const layout = yield* captureRelationalPhysicalLayout({
    ...target,
    artifact: captured.artifact,
  });
  const profile = yield* registerCommerceSchemaProfile(
    captured.artifact,
    layout,
  );
  return { ...captured, layout, profile };
});
