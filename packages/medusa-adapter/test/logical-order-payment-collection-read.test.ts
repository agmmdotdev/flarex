import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { prepareLogicalOrderPaymentCollections } from "./support/logical-order-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let local: Awaited<ReturnType<typeof prepareLogicalOrderPaymentCollections>>;
const tuple = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]));
const config = { select: ["order_id", "payment_collection_id"], relations: [], order: { order_id: "ASC" }, take: 4, skip: 0 };
beforeAll(async () => { local = await prepareLogicalOrderPaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

describe("native stored Order Payment Collection complete reads", () => {
  it("reads the real active association, excludes its historical counterpart and replays", async () => {
    if (driver === "postgres") expect((await local.fixture.persistence.query<{ ordinary: boolean }>(
      "select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) as ordinary from pg_roles where rolname=current_user")).rows)
      .toEqual([{ ordinary: true }]);
    const args = { filters: { payment_collection_id: "paycol-normal-0" }, config }, key = local.host.newRequestKey();
    const result = await Effect.runPromise(local.run(args, key));
    expect(result).toEqual([[{ order_id: "order-links", payment_collection_id: "paycol-normal-0" }], 1]);
    const committed = await local.snapshot();
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
    const before = await local.snapshot();
    const result = await Effect.runPromise(Effect.result(local.run({ filters: { order_id: "order-overflow" }, config })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const after = await local.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events);
  });
  it("uses the same omitted-take contract under a smaller coherent host budget", async () => {
    const small = await local.prepareSmall(), { take, ...withoutTake } = config;
    expect(take).toBe(4);
    expect(await Effect.runPromise(small.run({ filters: { payment_collection_id: "paycol-normal-0" }, config: withoutTake })))
      .toEqual([[{ order_id: "order-links", payment_collection_id: "paycol-normal-0" }], 1]);
  });
});
