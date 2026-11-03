import { afterAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { prepareCoreOrderSerial } from "./support/core-order-serial-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);
describe("native Order Change Action generated serial consumer", () => {
  it("creates omitted ordering through the genuine service and retains replay allocation", async () => {
    const local = await prepareCoreOrderSerial(driver, close => cleanup.push(close)), key = local.host.newRequestKey();
    const first = await Effect.runPromise(local.run(key, "refund-serial-first"));
    expect(first).toMatchObject({ id: expect.stringMatching(/^ordchact_/), ordering: 204, version: 1,
      order_id: "order173-d", order_change_id: "ordch-serial", amount: "3.1250000000000000000",
      raw_amount: { value: "3.1250000000000000000", precision: 20 } });
    const committed = await local.snapshot();
    const actionTable = local.definition.tables.find(table => table.localName === "order_change_action")?.name;
    const actions = committed.rows.filter(row => row.table === actionTable).map(row => row.value);
    expect(actions.toSorted((a, b) => Number(a.ordering) - Number(b.ordering))).toMatchObject([
      { ordering: 203 },
      { ordering: 204, amount: "3.1250000000000000000", raw_amount: { value: "3.1250000000000000000", precision: 20 } },
    ]);
    expect(await Effect.runPromise(local.run(key, "refund-serial-first"))).toEqual(first);
    expect(await local.snapshot()).toEqual(committed);
    expect(await Effect.runPromise(local.run(local.host.newRequestKey(), "refund-serial-second"))).toMatchObject({ ordering: 205 });
    expect(local.emitted).toHaveLength(2);
    expect(local.emitted[0]).toMatchObject({ name: "order.order-change-action.created" });
  }, 240_000);
});
