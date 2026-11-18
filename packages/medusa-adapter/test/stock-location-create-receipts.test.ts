import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStockLocationMetadata } from "../src/modules/stock-location/schema";
import { stockLocationCreateEventPolicy } from "../src/modules/stock-location/events";
import { planStockLocationCreates } from "../src/modules/stock-location/create-planning";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: Result.Result.Success<ReturnType<typeof stockLocationCreateEventPolicy>>;
const stamp = "2026-10-22T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const address = (id: string): JsonObject & { id: string } => ({ id, address_1: "First street", country_code: "US",
  address_2: null, company: null, city: "Filled", phone: null, province: null, postal_code: null, metadata: null, ...managed });
const location = (id: string, address_id: string | null = null): JsonObject & { id: string } => ({
  id, name: "First root", metadata: null, address_id, ...managed });
const event = (table: string, id: string) => ({ name: "stock_location." +
  (table === "stock_location" ? "stock-location" : "stock-location-address") + ".created",
  metadata: { source: "stock_location", object: table, action: "created" }, data: { id } });
const activity = (children: readonly JsonObject[], roots: readonly JsonObject[]): Activity => {
  const entries = [...children.map(row => ({ table: "stock_location_address", row })), ...roots.map(row => ({ table: "stock_location", row }))];
  return { mutations: entries.map(({ table, row }, ordinal) => ({ ordinal, table, operation: "insert", before: null, after: row })),
    observedRows: entries, lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [] };
};
const call = (input: Call["input"], result: Call["result"], evidence: Activity): Call => ({ commandName: "stockLocationCreate",
  mode: "write", input, result, events: evidence.mutations.map(row => event(row.table, String(row.after?.id))),
  fromAttempt: 0, toAttempt: evidence.mutations.length, fromLifecycle: 0, toLifecycle: 0 });
const refused = async (receipt: Call, evidence: Activity) =>
  expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))).toBe(true);

describe("native Stock Location create identity and selected Address receipts", () => {
  beforeAll(async () => {
    const metadata = await Effect.runPromise(captureStockLocationMetadata());
    const table = metadata.frame.tables.find(row => row.name === "stock_location"), child = metadata.frame.tables.find(row => row.name === "stock_location_address");
    if (table === undefined || child === undefined) throw new Error("Missing genuine Stock Location models");
    policy = Result.getOrThrow(stockLocationCreateEventPolicy(table, child, () => Effect.void));
  });

  it("selects children before persistence and preserves every root result position", () => {
    const inputs = [
      { id: "a", name: "First root", address: { id: "x", address_1: "First street", country_code: "US", city: null } },
      { id: "b", name: "B", address: { id: "y", address_1: "B street", country_code: "US" } },
      { id: "a", name: "Ignored", address: { id: "ignored", address_1: "Ignored street", country_code: "CA" } },
      { id: "a", name: "Ignored", address: { id: "x", address_1: "Ignored street", country_code: "CA", city: "Filled" } },
    ];
    const before = structuredClone(inputs), plan = planStockLocationCreates(inputs, inputs.map(row => row.id));
    expect(inputs).toEqual(before); expect(plan.positions).toEqual([0, 1, 0, 0]);
    expect(plan.entities.map(row => row.name)).toEqual(["First root", "B"]);
    expect(plan.addresses).toEqual([
      { kind: "nested", input: { id: "x", address_1: "First street", country_code: "US", city: "Filled" } },
      { kind: "nested", input: { id: "y", address_1: "B street", country_code: "US" } },
    ]);
  });

  it("keeps ignored Address data out of another root's selected child", () => {
    const plan = planStockLocationCreates([
      { id: "a", name: "A", address: { id: "x", address_1: "A", country_code: "US" } },
      { id: "a", name: "A", address: { id: "y", address_1: "Ignored", country_code: "US", city: "Ignored" } },
      { id: "b", name: "B", address: { id: "y", address_1: "B", country_code: "US", city: "B city" } },
    ], ["a", "a", "b"]);
    expect(plan.addresses[1]).toEqual({ kind: "nested", input: { id: "y", address_1: "B", country_code: "US", city: "B city" } });
  });

  it("selects the first nonnull relation across raw FK and nested positions", () => {
    expect(planStockLocationCreates([{ id: "a", name: "A", address_id: "x" },
      { id: "a", name: "A", address: { id: "y", address_1: "Y", country_code: "US" } }], ["a", "a"]).addresses)
      .toEqual([{ kind: "reference", id: "x" }]);
    expect(planStockLocationCreates([{ id: "a", name: "A", address_id: null },
      { id: "a", name: "A", address: { id: "y", address_1: "Y", country_code: "US" } }], ["a", "a"]).addresses)
      .toEqual([{ kind: "nested", input: { id: "y", address_1: "Y", country_code: "US" } }]);
    const generated = planStockLocationCreates([{ name: "A" }, { name: "A" }], ["generated-a", "generated-b"]);
    expect(generated.entities).toHaveLength(2);
  });

  it("authenticates duplicate root DTOs against one complete child/root write and two events", async () => {
    const child = address("x"), root = location("a", "x"), output = { ...root, address: child };
    const input = [
      { id: "a", name: "First root", address: { id: "x", address_1: "First street", country_code: "US", city: null } },
      { id: "a", name: "Ignored", address: { id: "ignored", address_1: "Ignored", country_code: "CA" } },
      { id: "a", name: "Ignored", address: { id: "x", address_1: "Ignored", country_code: "CA", city: "Filled" } },
    ];
    const evidence = activity([child], [root]), receipt = call(input, [output, output, output], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: [output, { ...output, name: "Ignored" }, output] }, evidence);
    await refused({ ...receipt, result: [output, output] }, evidence);
    await refused(receipt, activity([], [root]));
    await refused(receipt, activity([child, address("ignored")], [root]));
    await refused({ ...receipt, events: receipt.events.slice().reverse() }, evidence);
    await refused({ ...receipt, events: [...receipt.events, receipt.events[0]!] }, evidence);
    await refused({ ...receipt, events: [] }, evidence);
    const forged = { ...output, address: { ...child, city: "Forged" } };
    await refused({ ...receipt, result: [forged, forged, forged] }, evidence);
  });

  it("keeps the native immediate FK residual separate from the nested relation's persisted FK", async () => {
    const child = address("y"), root = location("a", "y"), output = { ...root, address_id: "x", address: child };
    const input = [
      { id: "a", name: "First root", address: { id: "y", address_1: "First street", country_code: "US", city: "Filled" } },
      { id: "a", name: "Ignored", address_id: "x" },
    ];
    const evidence = activity([child], [root]), receipt = call(input, [output, output], evidence);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused(receipt, activity([child], [{ ...root, address_id: "x" }]));
    await refused({ ...receipt, result: [{ ...output, address_id: "y" }, { ...output, address_id: "y" }] }, evidence);
  });

  it("authenticates FK-only references, empty batches and scalar/array shape", async () => {
    const root = location("a", "x"), output = { ...root, address: { id: "x" } }, evidence = activity([], [root]);
    const input = [{ id: "a", name: "First root", address_id: "x" },
      { id: "a", name: "Ignored", address: { id: "y", address_1: "Ignored", country_code: "US" } }];
    await Effect.runPromise(policy.validateLogicalCall(call(input, [output, output], evidence), evidence));
    await Effect.runPromise(policy.validateLogicalCall(call(input[0]!, output, evidence), evidence));
    await refused(call(input[0]!, [output], evidence), evidence);
    const empty = activity([], []); await Effect.runPromise(policy.validateLogicalCall(call([], [], empty), empty));
  });

  it("refuses generated-ID aliases, conflicting explicit IDs and corrupt complete writes", async () => {
    const root = location("a"), evidence = activity([], [root]);
    await refused(call([{ name: "First root" }, { name: "First root" }], [root, root], evidence), evidence);
    await refused(call([{ id: "a", name: "First root" }, { id: "b", name: "First root" }], [root, root], evidence), evidence);
    const receipt = call([{ id: "a", name: "First root" }], [root], evidence);
    await refused(receipt, activity([], [{ ...root, name: "Forged" }]));
    await refused(receipt, activity([], [{ id: "a", name: "First root" }]));
    await refused(receipt, { ...evidence, mutations: evidence.mutations.map(row => ({ ...row, ordinal: 1 })) });
    await refused(receipt, { ...evidence, observedRows: [] });
    await refused(receipt, { ...evidence, observedRows: [{ table: "stock_location", row: { ...root, metadata: { forged: true } } }] });
    // Even a later ignored Address position is decoded before normalization.
    await refused(call([{ id: "a", name: "First root" }, { id: "a", name: "Ignored", address: { address_1: "Ignored", country_code: 42 } }],
      [root, root], evidence), evidence);
  });
});
