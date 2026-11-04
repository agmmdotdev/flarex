import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { prepareCoreOrderPaymentCollections } from "./support/core-order-payment-collection-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectCheckoutRollback as expectNativeRollback } from "./support/core-checkout-evidence";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let local: Awaited<ReturnType<typeof prepareCoreOrderPaymentCollections>>;
const tuple = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]));
const config = { select: ["order_id", "payment_collection_id"], relations: [], order: { order_id: "ASC" }, take: 4, skip: 0 };
beforeAll(async () => { local = await prepareCoreOrderPaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

describe("native stored Order Payment Collection complete reads", () => {
  it("reads the real active association, excludes its historical counterpart and replays", async () => {
    const before = await local.snapshot();
    expect(before.rows.filter(row => row.value.payment_collection_id === "paycol-normal-0").map(row => row.value))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "ordpay-normal-0", deleted_at: null }),
        expect.objectContaining({ id: "ordpay-history", deleted_at: "2020-01-02T03:04:05.000Z" }),
      ]));
    const args = { filters: { payment_collection_id: "paycol-normal-0" }, config }, key = local.host.newRequestKey();
    const result = await Effect.runPromise(local.run(args, key));
    expect(result).toEqual([[{ order_id: "order-links", payment_collection_id: "paycol-normal-0" }], 1]);
    const committed = await local.snapshot();
    expect(committed.outcomes.slice(before.outcomes.length)).toMatchObject([{ value: { key, kind: "nativeRoot", state: "committed" } }]);
    expect({ ...committed, outcomes: before.outcomes }).toEqual(before);
    expect(await Effect.runPromise(local.run(args, key))).toEqual(result);
    expect(await local.snapshot()).toEqual(committed);
  });
  it("authenticates genuine absence and a complete four-Link Order cohort", async () => {
    expect(await Effect.runPromise(local.run({ filters: { order_id: "missing" }, config }))).toEqual([[], 0]);
    const [rows, total] = tuple(await Effect.runPromise(local.run({ filters: { order_id: "order-links" }, config })));
    expect(total).toBe(4);
    expect(rows.map(row => row.payment_collection_id).sort()).toEqual(Array.from({ length: 4 }, (_, index) => "paycol-normal-" + index));
  });
  it("refuses a genuine four-of-five page before it can authenticate an incomplete cohort", async () => {
    const before = await local.fixture.inventory(), key = local.host.newRequestKey();
    expect(before.rows.filter(row => row.value.order_id === "order-overflow")).toHaveLength(5);
    const result = await Effect.runPromise(Effect.result(local.run({ filters: { order_id: "order-overflow" }, config }, key)));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    await expectNativeRollback(local.fixture, before, key);
  });
  it("uses the same omitted-take contract under a smaller coherent host budget", async () => {
    const small = await local.prepareSmall(), { take, ...withoutTake } = config;
    expect(take).toBe(4);
    expect(await Effect.runPromise(small.run({ filters: { payment_collection_id: "paycol-normal-0" }, config: withoutTake })))
      .toEqual([[{ order_id: "order-links", payment_collection_id: "paycol-normal-0" }], 1]);
  });
});
