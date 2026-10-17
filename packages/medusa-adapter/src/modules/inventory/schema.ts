import { Effect, Schema } from "effect";
import { inventoryModuleModels } from "@medusajs/inventory/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

const decodeInventory = Schema.decodeUnknownEffect(Schema.Struct({ tables: Schema.Array(
  Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
) }), { onExcessProperty: "error" });
const compilePinnedInventoryMetadata = Effect.fn("Inventory.compilePinnedMetadata")(function* () {
  const input = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(inventoryModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const inventory = yield* decodeInventory(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const expected = ["inventory_item","inventory_level","reservation_item"];
  if (inventory.tables.length !== expected.length ||
    expected.some(name => inventory.tables.filter(table => table.name === name).length !== 1))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* decodeCompiledDml({ tables: inventory.tables })
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
});

export const captureInventoryMetadata = Effect.fn("Inventory.captureMetadata")(function* () {
  const frame = yield* compilePinnedInventoryMetadata();
  return yield* capturePrivateCanonicalValue(frame, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});

export const inventorySourceProvenance = Object.freeze({
  kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/inventory/src/models", "packages/modules/inventory/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts", "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts"]),
} as const);

/** Complete pinned Inventory source; runtime methods remain individually admitted. */
export const compileInventoryDefinition = Effect.fn("Inventory.compileDefinition")(function* () {
  const compiled = yield* compilePinnedInventoryMetadata();
  const lowered = lowerDmlSchema(compiled.tables, "commerce.inventory");
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table =>
    table.tableId !== "reservation_item" ? table : { ...table, indexes: [...table.indexes, {
      indexId: "reservation-item.line-item-equality", kind: "textEquality" as const,
      columns: ["line_item_id"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "reservation-item.line-item-equality" },
    }] }) }));
  return Object.freeze({ schema, provenance: inventorySourceProvenance });
});
