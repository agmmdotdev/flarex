import { Effect } from "effect";
import { expect, it } from "vitest";
import { makeCoreSchemaBundle } from "@flarex/persistence-postgres/internal/core";
import { serializeCoreSchema } from "../../persistence-postgres/src/core/schemaJson";
import { compileInventoryCoreDefinition } from "../src/modules/inventory/schema";
import { compileSalesChannelCoreDefinition } from "../src/modules/sales-channel/schema";
import { compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import previous from "./fixtures/native-declared-equality-producers-old-metadata.json" with { type: "json" };

const expected = {
  inventory: { tables: ["inventory_item", "inventory_level", "reservation_item"], table: "reservation_item",
    nativeId: "reservation-item.line-item-equality", field: "line_item_id", hashChanges: true },
  salesChannel: { tables: ["sales_channel"], table: "sales_channel", nativeId: "sales_channel.name-equality", field: "name", hashChanges: false },
  shippingProfile: { tables: ["shipping_profile"], table: "shipping_profile", nativeId: "shipping_profile.type-equality", field: "type", hashChanges: true },
} as const;
const compile = Effect.fn("DeclaredEqualityProducers.compile")(() => Effect.all({
  inventory: compileInventoryCoreDefinition(previous.target), salesChannel: compileSalesChannelCoreDefinition(previous.target),
  shippingProfile: compileShippingProfileCoreDefinition(previous.target),
}));

for (const name of ["inventory", "salesChannel", "shippingProfile"] as const) {
  it(`preserves the authentic ${name} producer while adding its declared equality footprint`, async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definitions = yield* compile(), definition = definitions[name], before = previous.producers[name], selected = expected[name];
      expect(definition.tables.map(table => table.localName).toSorted()).toEqual([...selected.tables].toSorted());
      const declaration = definition.tables.find(table => table.localName === selected.table);
      const equality = declaration?.indexes?.find(index => index.nativeId === selected.nativeId);
      if (declaration === undefined || equality === undefined) throw new Error("Missing actual declared equality: " + name);
      expect(equality).toMatchObject({ kind: "index", nativeId: selected.nativeId, fields: [selected.field] });
      expect(equality.requiredPrefix).toBeUndefined();
      const withoutEquality = { ...definition.schema, tables: definition.schema.tables.map(table => ({ ...table,
        indexes: table.indexes.filter(index => index.indexDescriptor !== equality.indexName) })) };
      // Compare complete captured schemas: existing descriptors, order, tables,
      // validators and other indexes must remain byte-identical.
      expect(yield* Effect.fromResult(serializeCoreSchema(withoutEquality))).toBe(before.serializedSchema);
      const { definitionHash: currentHash, ...currentIdentity } = definition.identity;
      const { definitionHash: previousHash, ...previousIdentity } = before.identity;
      expect(currentIdentity).toEqual(previousIdentity);
      if (selected.hashChanges) expect(currentHash).not.toBe(previousHash);
      else expect(currentHash).toBe(previousHash);
      expect(definition.metadata).not.toBe(before.metadata);
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
      expect(bundle.metadata).not.toBe(before.bundle.metadata);
      expect(yield* Effect.fromResult(serializeCoreSchema(bundle.schema))).not.toBe(before.bundle.serializedSchema);
    }));
  });
}
