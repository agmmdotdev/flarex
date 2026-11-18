import { expect, it } from "vitest";
import { Effect } from "effect";
import { captureShippingProfileDeletionMetadata, compileShippingProfileDefinition,
  compileShippingProfileDeletionDefinition } from "../src/modules/fulfillment/shipping-profile-schema";

it("selects the authentic six-table FK closure without changing the scalar profile", async () => {
  const scalar = await Effect.runPromise(compileShippingProfileDefinition());
  const deletion = await Effect.runPromise(compileShippingProfileDeletionDefinition());
  const metadata = await Effect.runPromise(captureShippingProfileDeletionMetadata());
  expect(scalar.schema.tables.map(table => table.identity.tableId)).toEqual(["shipping_profile"]);
  expect(deletion.schema.tables.map(table => table.identity.tableId)).toEqual([
    "shipping_profile", "shipping_option", "service_zone", "fulfillment_set", "shipping_option_type", "fulfillment_provider",
  ].sort());
  expect(deletion.schema.tables.find(table => table.identity.tableId === "shipping_profile")).toEqual(scalar.schema.tables[0]);
  expect(metadata.frame.tables.flatMap(table => table.foreignKeys)).toHaveLength(5);
  expect(metadata.frame.tables.find(table => table.name === "shipping_option")?.foreignKeys.map(key => key.referencedTable).sort())
    .toEqual(["fulfillment_provider", "service_zone", "shipping_option_type", "shipping_profile"]);
  for (const table of deletion.schema.tables.filter(table => table.identity.tableId !== "shipping_profile")) {
    expect(table.indexes.some(index => index.indexId === "shipping_profile.type-equality")).toBe(false);
  }
  expect(deletion.provenance.paths).toHaveLength(8);
});
