import { Cause, Effect, Exit, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareCoreOrderCreation } from "./support/core-order-creation-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const Id = Schema.decodeUnknownSync(Schema.String);
const input = [{ currency_code: "usd", items: [{ title: "Digital checkout item", quantity: 2, unit_price: "3.125", requires_shipping: false }] }];
type OrderFixture = Awaited<ReturnType<typeof prepareCoreOrderCreation>>;
type Snapshot = Awaited<ReturnType<OrderFixture["snapshot"]>>;
const insertedRows = (before: Snapshot, after: Snapshot) => after.rows.filter(row =>
  !before.rows.some(prior => row.value._id === prior.value._id));

describe("native Order creation prerequisites for checkout", () => {
  let local: OrderFixture;
  beforeAll(async () => { local = await prepareCoreOrderCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("creates real Order, Summary, LineItem and Item rows with generated display identity", async () => {
    const before = await local.snapshot();
    const result = rows(await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.create, input)));
    expect(result).toMatchObject([{ display_id: 401, currency_code: "usd", status: "pending", summary: { current_order_total: 6.25 },
      items: [{ title: "Digital checkout item", quantity: 2, unit_price: 3.125, requires_shipping: false }] }]);
    const id = Id(result[0]?.id);
    const active = await local.read([id]);
    expect(active).toMatchObject([{ id, display_id: 401, version: 1 }]);
    expect(local.emitted.length).toBeGreaterThan(0);
    const inserted = insertedRows(before, await local.snapshot());
    expect(inserted.map(row => local.definition.tables.find(table => table.name === row.table)?.localName).sort())
      .toEqual(["order", "order_item", "order_line_item", "order_summary"]);
    await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.remove, [id]));
    expect(await local.read([id])).toEqual([]);
    const after = await local.snapshot();
    expect(after.rows).toEqual(before.rows);
    // Each deleted graph member has a tombstone following its actual created revision.
    for (const row of inserted) {
      const documentId = Result.getOrThrow(decodeDocumentId(Id(row.value._id)));
      const storedId = encodeBytesToLowercaseHex(documentId.internalId);
      const revisions = after.revisions.filter(revision => revision.table === row.table && revision.id === storedId);
      expect(revisions).toMatchObject([
        { timestamp: row.timestamp, previous: null, deleted: false, value: row.value },
        { previous: row.timestamp, deleted: true, value: null },
      ]);
    }
  }, 240_000);

  it("creates the admitted maximum of four Orders with four total items", async () => {
    const before = await local.snapshot();
    const batch = Array.from({ length: 4 }, (_, index) => ({ currency_code: "usd", items: [{
      title: `Digital batch item ${index + 1}`, quantity: 1, unit_price: "3.125", requires_shipping: false,
    }] }));
    const created = rows(await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.create, batch)));
    expect(created.toSorted((a, b) => Number(a.display_id) - Number(b.display_id))).toMatchObject(batch.map(({ items }, index) => ({
      display_id: 401 + index, items: [{ ...items[0], unit_price: 3.125 }],
    })));
    expect(insertedRows(before, await local.snapshot())).toHaveLength(16);
    await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.remove, created.map(order => Id(order.id))));
    expect((await local.snapshot()).rows).toEqual(before.rows);
  }, 240_000);

  it("replays the settled creation without allocating another Order or display identity", async () => {
    const key = local.host.newRequestKey(), first = await Effect.runPromise(local.host.run(key, local.create, input));
    const after = await local.snapshot(), emitted = local.emitted.length;
    expect(await Effect.runPromise(local.host.run(key, local.create, input))).toEqual(first);
    expect(await local.snapshot()).toEqual(after);
    expect(local.emitted).toHaveLength(emitted);
    const [order] = rows(first);
    await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.remove, [Id(order?.id)]));
  }, 240_000);

  it("retains the exact stored line-item amount beyond numeric DTO precision", async () => {
    const created = rows(await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.create, [{
      currency_code: "usd", items: [{ title: "Exact item", quantity: 1, unit_price: "9007199254740993", requires_shipping: false }],
    }])));
    expect(created).toMatchObject([{ items: [{ unit_price: 9007199254740992,
      raw_unit_price: { value: "9007199254740993.0000", precision: 20 } }] }]);
    const lineItemTable = local.definition.tables.find(table => table.localName === "order_line_item")?.name;
    const stored = (await local.snapshot()).rows.filter(row => row.table === lineItemTable);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.value).toMatchObject({ unit_price: "9007199254740993.0000",
      raw_unit_price: { value: "9007199254740993.0000", precision: 20 } });
    await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.remove, [Id(created[0]?.id)]));
  }, 240_000);

  it("rolls back the complete new graph after a late native consumer failure", async () => {
    const before = await local.snapshot();
    const result = await Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), local.fail, input));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Late failure after genuine Order creation");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
});
