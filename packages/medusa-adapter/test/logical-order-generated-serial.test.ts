import { afterAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { prepareLogicalOrderSerial } from "./support/logical-order-serial-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);
describe("native Order Change Action generated serial consumer", () => {
  it("creates omitted ordering through the genuine service and retains replay allocation", async () => {
    const local = await prepareLogicalOrderSerial(driver, close => cleanup.push(close)), key = local.host.newRequestKey();
    const first = await Effect.runPromise(local.run(key, "refund-serial-first"));
    expect(first).toMatchObject({ id: expect.stringMatching(/^ordchact_/), ordering: 204, version: 1,
      order_id: "order173-d", order_change_id: "ordch-serial", amount: "3.1250000000000000000",
      raw_amount: { value: "3.1250000000000000000", precision: 20 } });
    const committed = await local.snapshot();
    expect(await Effect.runPromise(local.run(key, "refund-serial-first"))).toEqual(first);
    expect(await local.snapshot()).toEqual(committed);
    expect(await Effect.runPromise(local.run(local.host.newRequestKey(), "refund-serial-second"))).toMatchObject({ ordering: 205 });
    expect(local.emitted).toHaveLength(2);
    expect(local.emitted[0]).toMatchObject({ name: "order.order-change-action.created" });
  }, 240_000);
});
