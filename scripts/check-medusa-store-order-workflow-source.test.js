import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeOrderReadSourcePairs, verifyStoreOrderReadSelection, verifyStoreOrderReadSource, verifyStoreOrderRemoteQueryExtension } from "./check-medusa-store-order-workflow-source.mjs";

const read = file => readFileSync(file, "utf8");
describe("native Store Order read source preservation", () => {
  it("pins the complete read workflows and actual aggregation programs", () => {
    verifyStoreOrderReadSelection(storeOrderReadSourcePairs);
    for (const pair of storeOrderReadSourcePairs) verifyStoreOrderReadSource(read(pair.source), read(pair.target), pair.target);
    const first = storeOrderReadSourcePairs[0];
    for (const changed of [storeOrderReadSourcePairs.slice(1), [...storeOrderReadSourcePairs, first],
      storeOrderReadSourcePairs.map(pair => pair === first ? { ...pair, source: pair.source + ".other" } : pair)])
      expect(() => verifyStoreOrderReadSelection(changed)).toThrow();
  });
  it("rejects omitted mandatory status relations and changed accounting or precedence", () => {
    for (const [suffix, before, after] of [
      ["get-order-detail.ts", '"fulfillments.*",', ""],
      ["get-orders-list.ts", '"payment_collections.captured_amount",', ""],
      ["get-orders-list.ts", "const requiredPaymentFields = fields.some", "const requiredPaymentFields = fields.every"],
      ["aggregate-status.ts", "paymentCollection.captured_amount ?? 0", "paymentCollection.captured_amount ?? 1"],
      ["aggregate-status.ts", "MathBN.lt(i.detail.raw_fulfilled_quantity, i.raw_quantity!)", "MathBN.gt(i.detail.raw_fulfilled_quantity, i.raw_quantity!)"],
      ["aggregate-status.ts", "canceled_at: FulfillmentStatus.CANCELED", "canceled_at: FulfillmentStatus.DELIVERED"],
      ["order-fulfillment.ts", 'foreignKey: "order_id"', 'foreignKey: "fulfillment_id"'],
    ]) {
      const pair = storeOrderReadSourcePairs.find(pair => pair.target.endsWith(suffix));
      const original = read(pair.target), changed = original.replace(before, after);
      expect(changed).not.toBe(original);
      expect(() => verifyStoreOrderReadSource(read(pair.source), changed, pair.target)).toThrow();
    }
  });
  it("confines counted native Order forwarding and preserves every pre-existing step branch", () => {
    const original = read("packages/medusa-core-flows/src/common/steps/use-remote-query.ts");
    verifyStoreOrderRemoteQueryExtension(original);
    for (const changed of [original.replace('entryPoint: "orders", fields: data.fields, variables: data.variables', 'entryPoint: "orders", fields: data.fields, variables: {}'),
      original.replace("decodeStoreOrderListResult(result)", "decodeStoreOrderListResult([])"),
      original.replace("const retainedProperties = Schema.Record(Schema.String, Schema.Json)", "const retainedProperties = Schema.Record(Schema.String, Schema.Unknown)"),
      original.replace('throwIfKeyNotFound: false, throwIfRelationNotFound: undefined', 'throwIfKeyNotFound: true, throwIfRelationNotFound: undefined')]) {
      expect(changed).not.toBe(original);
      expect(() => verifyStoreOrderRemoteQueryExtension(changed)).toThrow();
    }
  });
});
