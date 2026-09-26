import { Data, Effect, Schema } from "effect";
import { fulfillmentModuleModels } from "@medusajs/fulfillment/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "./schema/compiled";
import { lowerDmlSchema } from "./schema/lower";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export class ShippingProfileSchemaError extends Data.TaggedError("ShippingProfileSchemaError")<{
  readonly cause: unknown;
}> {}

// The full native snapshot includes unselected hasOne relationships. The
// storage grammar below applies only to the table this owner actually selects.
const decodeNativeInventory = Schema.decodeUnknownEffect(Schema.Struct({
  tables: Schema.Array(Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)])),
}), { onExcessProperty: "error" });

/** Capture the real constructor closure, then select only ShippingProfile.
 * Its inverse relationship remains metadata, not permission to hydrate options. */
export const captureShippingProfileMetadata = Effect.fn("ShippingProfile.captureMetadata")(function* () {
  const input = yield* Effect.try({
    try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(fulfillmentModuleModels))),
    catch: cause => new ShippingProfileSchemaError({ cause }),
  });
  const inventory = yield* decodeNativeInventory(input).pipe(Effect.mapError(cause => new ShippingProfileSchemaError({ cause })));
  const selected = inventory.tables.filter(table => table.name === "shipping_profile");
  const compiled = yield* decodeCompiledDml({ tables: selected }).pipe(Effect.mapError(cause => new ShippingProfileSchemaError({ cause })));
  const table = compiled.tables.find(table => table.name === "shipping_profile");
  if (inventory.tables.length !== 12 || new Set(inventory.tables.map(table => table.name)).size !== 12
    || compiled.tables.length !== 1 || table === undefined || table.foreignKeys.length || table.cascades.delete.length
    || table.cascades.detach.length || table.relationships.length !== 1
    || table.relationships[0]?.name !== "shipping_options" || table.relationships[0].type !== "hasMany") {
    return yield* Effect.fail(new ShippingProfileSchemaError({ cause: "Unsupported Fulfillment ShippingProfile metadata" }));
  }
  const errors = {
    invalidInput: () => new ShippingProfileSchemaError({ cause: "Invalid ShippingProfile metadata" }),
    hashFailure: cause => new ShippingProfileSchemaError({ cause }),
  } satisfies Parameters<typeof capturePrivateCanonicalValue>[2];
  const native = yield* capturePrivateCanonicalValue(inventory, 1_048_576, errors);
  return { ...yield* capturePrivateCanonicalValue(compiled, 1_048_576, errors), native };
});

export const shippingProfileSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/fulfillment/src/models/shipping-profile.ts",
    "packages/modules/fulfillment/src/static-manifest.ts", "packages/database/drizzle/src/schema.ts"]),
} as const);

/** The selected native model and active-name uniqueness, with no generated DDL. */
export const compileShippingProfileDefinition = Effect.fn("ShippingProfile.compileDefinition")(function* () {
  const metadata = yield* captureShippingProfileMetadata();
  const lowered = lowerDmlSchema(metadata.frame.tables, "commerce.shipping-profile");
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table => ({
    ...table, indexes: [...table.indexes, { indexId: "shipping_profile.type-equality", kind: "textEquality" as const,
      columns: ["type"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "shipping_profile.type-equality" } }],
  })) }));
  return Object.freeze({ schema, provenance: shippingProfileSourceProvenance });
});
