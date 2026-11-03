import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareCoreOrderCheckout } from "./support/core-order-checkout-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];

describe("genuine checkout child steps", () => {
  let order: Awaited<ReturnType<typeof prepareCoreOrderCheckout>>;
  beforeAll(async () => { order = await prepareCoreOrderCheckout(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.splice(0).reverse()), 120_000);
  it("retains actual native creation IDs and executes the native Order inverse completely", async () => {
    const forward = await order.retainedCreate(), inverse = await order.retainedDelete();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), [{ currency_code: "usd",
      items: [{ title: "Native inverse item", quantity: 1, unit_price: "12.5", requires_shipping: false }] }]));
    const { retained } = created;
    expect(retained).toHaveLength(1);
    expect(created.output).toMatchObject([{ id: retained[0], items: [{ title: "Native inverse item" }] }]);
    const before = await order.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
    const after = await order.snapshot();
    const outcome = after.outcomes.find(record => record.value.key === key);
    if (outcome === undefined) throw new Error("Missing committed retained Order inverse outcome");
    expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    const tombstones = after.revisions.filter(row => row.timestamp === outcome.timestamp && row.deleted);
    expect(after.revisions.length - before.revisions.length).toBe(4);
    expect(tombstones.map(row => order.definition.tables.find(table => table.name === row.table)?.localName).sort())
      .toEqual(["order", "order_item", "order_line_item", "order_summary"]);
    expect(await order.read(retained)).toEqual([]);
    expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
    expect(await order.snapshot()).toEqual(after);
  }, 240_000);
});
