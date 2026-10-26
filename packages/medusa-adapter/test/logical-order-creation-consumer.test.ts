import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareLogicalOrderCreation } from "./support/logical-order-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const Id = Schema.decodeUnknownSync(Schema.String);
const input = [{ currency_code: "usd", items: [{ title: "Digital checkout item", quantity: 2, unit_price: "3.125", requires_shipping: false }] }];
type Head = Awaited<ReturnType<Awaited<ReturnType<typeof prepareLogicalOrderCreation>>["snapshot"]>>["rows"][number];
const sameRow = (a: Head, b: Head) => a.scopeUuid === b.scopeUuid && a.tableId === b.tableId && Buffer.from(a.rowId).equals(Buffer.from(b.rowId));

describe("native Order creation prerequisites for checkout", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalOrderCreation>>;
  beforeAll(async () => { local = await prepareLogicalOrderCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates real Order, Summary, LineItem and Item rows with generated display identity", async () => {
    const before = await local.snapshot();
    const result = rows(await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.create, input)));
    expect(result).toMatchObject([{ display_id: 401, currency_code: "usd", status: "pending", summary: { current_order_total: 6.25 },
      items: [{ title: "Digital checkout item", quantity: 2, unit_price: 3.125, requires_shipping: false }] }]);
    const id = Id(result[0]?.id);
    const active = await local.read([id]);
    expect(active).toMatchObject([{ id, display_id: 401, version: 1 }]);
    expect(local.emitted.length).toBeGreaterThan(0);
    const created = await local.snapshot(), inserted = created.rows.filter(row => !before.rows.some(prior => sameRow(row, prior)));
    expect(inserted).toHaveLength(4);
    await Effect.runPromise(local.host.run(local.host.newRequestKey(), local.remove, [id]));
    expect(await local.read([id])).toEqual([]);
    const after = await local.snapshot();
    // Physical relational deletion retains generic identity heads and revision
    // history. Every created graph member must now point at a tombstone.
    for (const row of inserted) {
      const latest = after.rows.find(head => sameRow(head, row));
      expect(latest).toBeDefined();
      expect(after.revisions.find(revision => latest !== undefined && sameRow(revision, latest) && revision.commitSeq === latest.commitSeq))
        .toMatchObject({ isTombstone: true });
    }
    expect(after.rows.filter(row => before.rows.some(prior => sameRow(row, prior)))).toEqual(before.rows);
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
