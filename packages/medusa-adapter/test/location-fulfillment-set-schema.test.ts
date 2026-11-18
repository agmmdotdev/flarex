import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { LocationFulfillmentSet, ProductSalesChannel, generateEntityDefinition } from "@medusajs/link-modules";
import { captureLocationFulfillmentSetLinkMetadata, compileLocationFulfillmentSetLinkDefinition } from "../src/links/location-fulfillment-set-schema";
import { prepareLocationFulfillmentSetCreationLinkResource } from "../src/links/location-fulfillment-set-service";
import { captureLinkMetadata } from "../src/links/schema";

describe("named Location FulfillmentSet Link source", () => {
  it("preserves native endpoint-pair identity, no endpoint FKs and accepted active Set uniqueness", async () => {
    const metadata = await Effect.runPromise(captureLocationFulfillmentSetLinkMetadata());
    expect(metadata.frame.name).toBe("location_fulfillment_set");
    expect(metadata.frame.columns.filter(column => column.primaryKey).map(column => column.name)).toEqual(["stock_location_id", "fulfillment_set_id"]);
    expect(metadata.frame.foreignKeys).toEqual([]);
    expect(metadata.frame.indexes.filter(index => index.unique).map(index => ({ columns: index.columns, where: index.where })))
      .toEqual([{ columns: ["fulfillment_set_id"], where: "deleted_at IS NULL" }]);
    expect(metadata.joiner.databaseConfig?.idPrefix).toBe("locfs");
    expect(metadata.joiner.relationships?.map(relationship => relationship.deleteCascade ?? false)).toEqual([false, true]);
    const definition = await Effect.runPromise(compileLocationFulfillmentSetLinkDefinition());
    expect(definition.schema.tables).toHaveLength(1);
    expect(definition.provenance.paths).toContain("packages/modules/link-modules/src/definitions/fulfillment-set-location.ts");
  });
  it("refuses a caller-authored router service token", () => {
    expect(prepareLocationFulfillmentSetCreationLinkResource({ admission: "dismiss", routing: {} }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  });
  it("retains signed native generated index identities through lowering without widening authored names", async () => {
    const expected = ["IDX_id_-e88adb96", "IDX_stock_location_id_-e88adb96", "IDX_fulfillment_set_id_-e88adb96", "IDX_deleted_at_-e88adb96"];
    const metadata = await Effect.runPromise(captureLocationFulfillmentSetLinkMetadata());
    expect(metadata.frame.indexes.map(index => index.name)).toEqual(expected);
    const definition = await Effect.runPromise(compileLocationFulfillmentSetLinkDefinition());
    expect(definition.schema.tables[0]?.indexes.filter(index => index.identity.indexId.startsWith("IDX_"))
      .map(index => index.identity.indexId).sort()).toEqual([...expected].sort());
    await expect(Effect.runPromise(captureLinkMetadata({ ...LocationFulfillmentSet,
      databaseConfig: { ...LocationFulfillmentSet.databaseConfig, tableName: "location-fulfillment-set" } })))
      .rejects.toMatchObject({ _tag: "LinkSchemaError" });
  });
  it("preserves the existing positive-hash ProductSalesChannel generated identities", async () => {
    const [primary, foreign] = ProductSalesChannel.relationships ?? [];
    if (primary === undefined || foreign === undefined) throw new Error("Missing native ProductSalesChannel relationships");
    const generated = generateEntityDefinition(ProductSalesChannel, primary, foreign);
    expect(generated.indexes.every(index => !index.name.includes("_-"))).toBe(true);
    const metadata = await Effect.runPromise(captureLinkMetadata(ProductSalesChannel));
    expect(metadata.frame.indexes.map(index => index.name)).toEqual(generated.indexes.map(index => index.name));
  });
});
