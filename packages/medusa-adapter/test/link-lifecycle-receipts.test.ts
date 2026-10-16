import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { compileLinkLifecycleReceipt } from "../src/links/lifecycle-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let validate: LogicalCallReceiptValidation;
const table = "product_variant_inventory_item", time = "2026-10-17T00:00:00.000Z", later = "2026-10-17T00:01:00.000Z";
const row = (id: string, item = "i", deleted_at: string | null = null) => ({
  id, variant_id: "v-" + id, inventory_item_id: item, required_quantity: 7, created_at: time, updated_at: time, deleted_at,
} satisfies JsonObject);
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const result = (rows: readonly JsonObject[]): JsonObject => rows.length === 0 ? {} : {
  variant_id: rows.map(value => value.variant_id ?? null), inventory_item_id: rows.map(value => value.inventory_item_id ?? null),
};
const call = (ids: string[], rows: readonly JsonObject[], restore = false): Call => ({
  commandName: restore ? "restoreLink" : "deleteLink", mode: "write", input: {
    selector: { inventory_item_id: ids }, config: { returnLinkableKeys: ["id", "variant_id", "inventory_item_id"] },
  }, result: result(rows), events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const changes = (before: readonly ReturnType<typeof row>[], restore = false): Activity => {
  const after = before.map(value => ({ ...value, updated_at: later, deleted_at: restore ? null : later }));
  return { ...empty(), observedRows: after.map(value => ({ table, row: value })),
    mutations: after.map((value, ordinal) => ({ ordinal, table, operation: "patch", before: before[ordinal] ?? null, after: value })),
    lifecycle: before.map((value, attemptOrdinal) => ({ table, operation: restore ? "restore" : "softDelete",
      key: { variant_id: value.variant_id, inventory_item_id: value.inventory_item_id },
      beforeDeletedAt: restore ? time : null, afterDeletedAt: restore ? null : later, attemptOrdinal, rowAtOperation: null })) };
};
const refused = async (receipt: Call, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(validate(receipt, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureVariantInventoryLinkMetadata());
  validate = Result.getOrThrow(compileLinkLifecycleReceipt({ table: metadata.frame, endpoints: ["variant_id", "inventory_item_id"],
    returnLinkableKeys: ["id", "variant_id", "inventory_item_id"], softDeleteCommand: "deleteLink", restoreCommand: "restoreLink",
    maximumEndpoints: 4, maximumRows: 8 }));
});

describe("rich generated Link lifecycle receipts", () => {
  it("correlates all eight rows and exact ordered endpoint maps despite raw duplicates and missing Items", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => row("link" + index, "i" + index % 2));
    const receipt = call(["i1", "i0", "missing", "i1"], rows), activity = changes(rows);
    await Effect.runPromise(validate(receipt, activity));
    for (const value of [{}, result([...rows].reverse()), result([...rows, row("extra", "missing")]),
      { variant_id: rows.map(value => value.variant_id ?? null) },
      { variant_id: rows.map(value => value.variant_id ?? null), inventory_item_id: rows.map(() => "forged") }])
      await refused({ ...receipt, result: value }, activity);
    await refused(receipt, { ...activity, lifecycle: activity.lifecycle.slice(0, -1) });
    await refused(receipt, { ...activity, lifecycle: [...activity.lifecycle, activity.lifecycle[0]!] });
  });

  it("authenticates full rich rows and preserves every scalar through lifecycle patches", async () => {
    const rows = [row("a")], activity = changes(rows), receipt = call(["i"], rows);
    const mutation = activity.mutations[0];
    if (mutation === undefined || mutation.after === null) throw new Error("Missing rich mutation");
    for (const replacement of [{ required_quantity: 1 }, { required_quantity: 1.5 }, { required_quantity: 2147483648 },
      { id: "forged" }, { variant_id: "other" }, { inventory_item_id: "outside" }, { created_at: later }, { unknown: true }])
      await refused(receipt, { ...activity, mutations: [{ ...mutation, after: { ...mutation.after, ...replacement } }] });
    const incomplete = { ...mutation.after }; delete incomplete.required_quantity;
    await refused(receipt, { ...activity, mutations: [{ ...mutation, after: incomplete }] });
    await refused(receipt, { ...activity, mutations: [{ ...mutation, table: "product_variant" }] });
    await refused(receipt, { ...activity, mutations: [{ ...mutation, operation: "delete", after: null }] });
  });

  it("restores predeleted and already-active matching history with unchanged observations", async () => {
    const deleted = row("deleted", "i", time), active = row("active"), activity = changes([deleted], true);
    const restore: Activity = { ...activity, lifecycle: [...activity.lifecycle, { table, operation: "restore",
      key: { variant_id: active.variant_id ?? null, inventory_item_id: "i" }, beforeDeletedAt: null, afterDeletedAt: null,
      attemptOrdinal: null, rowAtOperation: active }] };
    const receipt = call(["i", "missing"], [deleted, active], true);
    await Effect.runPromise(validate(receipt, restore));
    await refused({ ...receipt, result: result([deleted]) }, restore);
    await refused(receipt, { ...restore, lifecycle: restore.lifecycle.map(change => ({ ...change, rowAtOperation: null })) });
    await refused(receipt, { ...restore, lifecycle: [...restore.lifecycle, restore.lifecycle[1]!] });
  });

  it("permits native extra read candidates while refusing out-of-selector mutations and missing selected outcomes", async () => {
    const target = row("target"), outside = row("outside", "outside"), activity = changes([target]), receipt = call(["i"], [target]);
    await Effect.runPromise(validate(receipt, { ...activity, observedRows: [...activity.observedRows, { table, row: outside }] }));
    await refused(call(["i"], []), { ...empty(), observedRows: [{ table, row: target }] });
    await refused(receipt, changes([outside]));
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "product_variant", row: outside }] });
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table, row: { ...outside, required_quantity: "broken" } }] });
  });

  it("refuses complete-history overflow, invented map keys and changed return-key requests", async () => {
    const rows = Array.from({ length: 9 }, (_, index) => row("link" + index));
    await refused(call(["i"], rows), changes(rows));
    const mixed = [row("active"), ...Array.from({ length: 8 }, (_, index) => row("deleted" + index, "i", time))];
    const mixedActivity = changes([mixed[0]!]);
    await refused(call(["i"], [mixed[0]!]), { ...mixedActivity,
      observedRows: [...mixedActivity.observedRows, ...mixed.slice(1).map(value => ({ table, row: value }))] });
    const target = row("a"), receipt = call(["i"], [target]), activity = changes([target]);
    await refused({ ...receipt, result: { ...result([target]), id: ["a"] } }, activity);
    await refused({ ...receipt, input: { selector: { inventory_item_id: ["i"] }, config: { returnLinkableKeys: ["id", "id", "id"] } } }, activity);
    await refused({ ...receipt, input: { selector: { inventory_item_id: ["i", "i", "i", "i", "i"] }, config: { returnLinkableKeys: ["id", "variant_id", "inventory_item_id"] } } }, activity);
    await refused({ ...receipt, mode: "read" }, activity);
  });

  it("retains empty, missing, predeleted-delete and active no-op restore semantics", async () => {
    for (const restore of [false, true]) {
      await Effect.runPromise(validate(call([], [], restore), empty()));
      await Effect.runPromise(validate(call(["missing"], [], restore), empty()));
    }
    await Effect.runPromise(validate(call(["i"], []), { ...empty(), observedRows: [{ table, row: row("deleted", "i", time) }] }));
    const active = row("active");
    await Effect.runPromise(validate(call(["i"], [active], true), { ...empty(), lifecycle: [{ table, operation: "restore",
      key: { variant_id: active.variant_id ?? null, inventory_item_id: "i" }, beforeDeletedAt: null, afterDeletedAt: null,
      attemptOrdinal: null, rowAtOperation: active }] }));
  });
});
