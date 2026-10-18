import { Data, Effect, Schema } from "effect";
import { fulfillmentModuleModels } from "@medusajs/fulfillment/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export class ShippingProfileSchemaError extends Data.TaggedError("ShippingProfileSchemaError")<{
  readonly cause: unknown;
}> {}

// The full native snapshot includes unselected hasOne relationships. The
// storage grammar below applies only to tables the named owner selects.
const decodeNativeInventory = Schema.decodeUnknownEffect(Schema.Struct({
  tables: Schema.Array(Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)])),
}), { onExcessProperty: "error" });

const deletionTables = ["shipping_profile", "shipping_option", "service_zone", "fulfillment_set",
  "shipping_option_type", "fulfillment_provider"] as const;
const serviceZoneCreationTables = [...deletionTables, "geo_zone", "shipping_option_rule"] as const;
const fulfillmentCreationTables = [...serviceZoneCreationTables, "fulfillment_address", "fulfillment", "fulfillment_label", "fulfillment_item"] as const;

const captureSelectedMetadata = Effect.fn("ShippingProfile.captureSelectedMetadata")(function* (names: readonly string[]) {
  const input = yield* Effect.try({
    try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(fulfillmentModuleModels))),
    catch: cause => new ShippingProfileSchemaError({ cause }),
  });
  const inventory = yield* decodeNativeInventory(input).pipe(Effect.mapError(cause => new ShippingProfileSchemaError({ cause })));
  const selected = names.flatMap(name => inventory.tables.filter(table => table.name === name));
  const compiled = yield* decodeCompiledDml({ tables: selected }).pipe(Effect.mapError(cause => new ShippingProfileSchemaError({ cause })));
  const table = compiled.tables.find(table => table.name === "shipping_profile");
  if (inventory.tables.length !== 12 || new Set(inventory.tables.map(table => table.name)).size !== 12
    || compiled.tables.length !== names.length || table === undefined || table.foreignKeys.length || table.cascades.delete.length
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

/** Scalar profile: inverse metadata grants no permission to hydrate options. */
export const captureShippingProfileMetadata = Effect.fn("ShippingProfile.captureMetadata")(function* () {
  return yield* captureSelectedMetadata(["shipping_profile"]);
});

/** Deletion validation needs complete ShippingOption rows and their FK targets. */
export const captureShippingProfileDeletionMetadata = Effect.fn("ShippingProfile.captureDeletionMetadata")(function* () {
  return yield* captureSelectedMetadata(deletionTables);
});

/** Fresh graph composition for ServiceZone creation and its physical inverse. */
export const captureServiceZoneCreationMetadata = Effect.fn("ServiceZone.captureCreationMetadata")(function* () {
  return yield* captureSelectedMetadata(serviceZoneCreationTables);
});

/** Fresh complete native inventory for the selected Fulfillment create root. */
export const captureFulfillmentCreationMetadata = Effect.fn("Fulfillment.captureCreationMetadata")(function* () {
  return yield* captureSelectedMetadata(fulfillmentCreationTables);
});

export const shippingProfileSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/fulfillment/src/models/shipping-profile.ts",
    "packages/modules/fulfillment/src/static-manifest.ts", "packages/database/drizzle/src/schema.ts"]),
} as const);

const shippingProfileDeletionSourceProvenance = Object.freeze({
  ...shippingProfileSourceProvenance,
  paths: Object.freeze([...deletionTables.map(name => `packages/modules/fulfillment/src/models/${name.replaceAll("_", "-")}.ts`),
    "packages/modules/fulfillment/src/static-manifest.ts", "packages/database/drizzle/src/schema.ts"]),
});

const compileSelectedDefinition = Effect.fn("ShippingProfile.compileSelectedDefinition")(function* (
  metadata: Effect.Success<ReturnType<typeof captureShippingProfileMetadata>>,
) {
  const lowered = lowerDmlSchema(metadata.frame.tables, "commerce.shipping-profile");
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table => ({
    ...table, indexes: [...table.indexes, ...(table.tableId === "shipping_profile" ? [{ indexId: "shipping_profile.type-equality", kind: "textEquality" as const,
      columns: ["type"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "shipping_profile.type-equality" } }] : [])],
  })) }));
  return schema;
});

/** The selected native model and active-name uniqueness, with no generated DDL. */
export const compileShippingProfileDefinition = Effect.fn("ShippingProfile.compileDefinition")(function* () {
  const schema = yield* compileSelectedDefinition(yield* captureShippingProfileMetadata());
  return Object.freeze({ schema, provenance: shippingProfileSourceProvenance });
});

/** Fresh explicit six-table composition; no populated installation upgrade. */
export const compileShippingProfileDeletionDefinition = Effect.fn("ShippingProfile.compileDeletionDefinition")(function* () {
  const schema = yield* compileSelectedDefinition(yield* captureShippingProfileDeletionMetadata());
  return Object.freeze({ schema, provenance: shippingProfileDeletionSourceProvenance });
});

/** Eight native tables under the existing source lineage, with no populated upgrade. */
export const compileServiceZoneCreationDefinition = Effect.fn("ServiceZone.compileCreationDefinition")(function* () {
  const schema = yield* compileSelectedDefinition(yield* captureServiceZoneCreationMetadata());
  const provenance = Object.freeze({ ...shippingProfileSourceProvenance,
    paths: Object.freeze([...serviceZoneCreationTables.map(name => `packages/modules/fulfillment/src/models/${name.replaceAll("_", "-")}.ts`),
      "packages/modules/fulfillment/src/static-manifest.ts", "packages/database/drizzle/src/schema.ts"]),
  });
  return Object.freeze({ schema, provenance });
});

/** Fresh twelve-table composition; this does not upgrade installed eight-table sources. */
export const compileFulfillmentCreationDefinition = Effect.fn("Fulfillment.compileCreationDefinition")(function* () {
  const schema = yield* compileSelectedDefinition(yield* captureFulfillmentCreationMetadata());
  const provenance = Object.freeze({ ...shippingProfileSourceProvenance,
    paths: Object.freeze([...fulfillmentCreationTables.map(name => `packages/modules/fulfillment/src/models/${name === "fulfillment_address" ? "address" : name.replaceAll("_", "-")}.ts`),
      "packages/modules/fulfillment/src/static-manifest.ts", "packages/database/drizzle/src/schema.ts"]),
  });
  return Object.freeze({ schema, provenance });
});
