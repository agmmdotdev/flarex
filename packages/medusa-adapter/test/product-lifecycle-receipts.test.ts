import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productLogicalInternalProductLifecycleEventPolicy, productLogicalLifecycleEventPolicy } from "../src/modules/product/events/lifecycle";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Entity = ProductRuntimeMetadata["product"];
let catalog: ProductRuntimeMetadata;
const deletedAt = "2026-10-15T01:00:00.000Z";
const earlier = "2026-10-14T01:00:00.000Z";
const empty = (): Activity => ({ mutations: [], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] });
const receipt = (commandName: string, input: Json, result: Json, activity: Activity, events: readonly Json[] = []): Receipt => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: activity.mutations.length,
  fromLifecycle: 0, toLifecycle: activity.lifecycle.length,
});
const event = (entity: Entity, id: string, operation: "softDelete" | "restore" = "softDelete"): Json => ({
  name: operation === "softDelete" ? entity.deletedEvent : entity.restoredEvent,
  metadata: { source: "product", object: entity.eventObject, action: operation === "softDelete" ? "deleted" : "restored" }, data: { id },
});
function transition(entity: Entity, row: JsonObject, operation: "softDelete" | "restore" = "softDelete", ordinal = 0) {
  const after = { ...row, deleted_at: operation === "restore" ? null : deletedAt };
  if (typeof row.id !== "string" || row.deleted_at !== null && typeof row.deleted_at !== "string") throw new Error("Invalid test preimage");
  return {
    mutation: { ordinal, table: entity.table.name, operation: "patch" as const, before: row, after },
    lifecycle: { table: entity.table.name, key: { id: row.id }, operation, beforeDeletedAt: row.deleted_at,
      afterDeletedAt: after.deleted_at, attemptOrdinal: ordinal, rowAtOperation: null },
    observation: { table: entity.table.name, row: after },
  };
}
const activityFor = (...changes: ReturnType<typeof transition>[]): Activity => ({ ...empty(),
  mutations: changes.map(change => change.mutation), lifecycle: changes.map(change => change.lifecycle), observedRows: changes.map(change => change.observation),
});
const refused = async (policy: LogicalCallReceiptValidation, call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy(call, activity)))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => { const captured = await Effect.runPromise(captureProductSchema("product-lifecycle-receipts"));
  catalog = await Effect.runPromise(productRuntimeMetadata(captured.metadata.frame)); });

describe("Product lifecycle receipt root coverage", () => {
  it.each(["product", "variant"] as const)("refuses a public %s receipt that skips an observed active requested root", async target => {
    const entity = target === "product" ? catalog.product : catalog.variant;
    const activity: Activity = { ...empty(), observedRows: [{ table: entity.table.name, row: { id: "active", deleted_at: null } }] };
    const command = target === "product" ? "productSoftDelete" : "productSoftDeleteVariant";
    await refused(productLogicalLifecycleEventPolicy(catalog, "softDelete", target).validateLogicalCall,
      receipt(command, ["missing", "active", "active"], {}, activity), activity);
  });

  it("requires internal coverage of observed roots eligible for delete and restore", async () => {
    for (const operation of ["softDelete", "restore"] as const) for (const deleted_at of operation === "softDelete" ? [null] : [null, earlier]) {
      const activity: Activity = { ...empty(), observedRows: [{ table: catalog.product.table.name, row: { id: "existing", deleted_at } }] };
      await refused(productLogicalInternalProductLifecycleEventPolicy(catalog, operation),
        receipt("productInternalProduct" + operation, ["existing", "missing", "existing"], [[], {}], activity), activity);
    }
  });

  it("admits empty, missing and already-deleted soft-delete selections without inventing transitions", async () => {
    const activity: Activity = { ...empty(), observedRows: [{ table: catalog.product.table.name, row: { id: "deleted", deleted_at: earlier } },
      { table: catalog.variant.table.name, row: { id: "deleted", deleted_at: earlier } }] };
    for (const input of [[], ["missing"], ["deleted", "missing", "deleted"]]) {
      for (const target of ["product", "variant"] as const) await Effect.runPromise(productLogicalLifecycleEventPolicy(catalog, "softDelete", target)
        .validateLogicalCall(receipt(target === "product" ? "productSoftDelete" : "productSoftDeleteVariant", input, {}, activity), activity));
      await Effect.runPromise(productLogicalInternalProductLifecycleEventPolicy(catalog, "softDelete")(
        receipt("productInternalProductsoftDelete", input, [[], {}], activity), activity));
    }
  });

  it("uses the active mutation preimage despite the final deleted observation and coalesces duplicate Variant requests", async () => {
    const activity = activityFor(transition(catalog.variant, { id: "variant", product_id: "product", deleted_at: null }));
    const policy = productLogicalLifecycleEventPolicy(catalog, "softDelete", "variant").validateLogicalCall;
    const call = receipt("productSoftDeleteVariant", ["variant", "missing", "variant"],
      { variant_id: ["variant"], product_variant_id: ["variant"] }, activity, [event(catalog.variant, "variant")]);
    await Effect.runPromise(policy(call, activity));
    await refused(policy, { ...call, events: [] }, activity);
    await refused(policy, { ...call, result: {} }, activity);
    await refused(policy, call, { ...activity, lifecycle: [] });
  });

  it("coalesces internal requests while requiring every eligible root lifecycle observation", async () => {
    const change = transition(catalog.product, { id: "product", deleted_at: null }), activity = activityFor(change);
    const policy = productLogicalInternalProductLifecycleEventPolicy(catalog, "softDelete");
    const call = receipt("productInternalProductsoftDelete", ["missing", "product", "product"], [[change.mutation.after], {}], activity);
    await Effect.runPromise(policy(call, activity));
    await refused(policy, call, { ...activity, lifecycle: [] });
    await refused(policy, { ...call, input: ["missing"] }, activity);
  });

  it.each(["public", "internal"] as const)("authenticates an unchanged %s restore using the core operation row", async visibility => {
    const row = { id: "active", deleted_at: null };
    // A previously cached row need not add a fresh command-local observation.
    const activity: Activity = { ...empty(), lifecycle: [{ table: catalog.product.table.name, key: { id: row.id }, operation: "restore",
      beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: row }] };
    const policy = visibility === "public" ? productLogicalLifecycleEventPolicy(catalog, "restore").validateLogicalCall
      : productLogicalInternalProductLifecycleEventPolicy(catalog, "restore");
    const call = receipt(visibility === "public" ? "productRestore" : "productInternalProductrestore", ["missing", row.id, row.id],
      visibility === "public" ? { product_id: [row.id] } : [[row], {}], activity,
      visibility === "public" ? [event(catalog.product, row.id, "restore")] : []);
    await Effect.runPromise(policy(call, activity));
    for (const rowAtOperation of [null, { ...row, id: "unselected" }])
      await refused(policy, call, { ...activity, lifecycle: activity.lifecycle.map(observation => ({ ...observation, rowAtOperation })) });
  });

  it("restores an observed deleted root with exact mutation and native event evidence", async () => {
    const change = transition(catalog.product, { id: "product", deleted_at: earlier }, "restore"), activity = activityFor(change);
    await Effect.runPromise(productLogicalLifecycleEventPolicy(catalog, "restore").validateLogicalCall(
      receipt("productRestore", ["product", "missing", "product"], { product_id: ["product"] }, activity, [event(catalog.product, "product", "restore")]), activity));
  });

  it.each(["public", "internal"] as const)("binds %s Product descendants to eligible selected roots", async visibility => {
    const root = transition(catalog.product, { id: "product", deleted_at: null });
    const option = transition(catalog.option, { id: "option", product_id: "product", deleted_at: null }, "softDelete", 1);
    const value = transition(catalog.value, { id: "value", option_id: "option", deleted_at: null }, "softDelete", 2);
    const activity = activityFor(root, option, value);
    const policy = visibility === "public" ? productLogicalLifecycleEventPolicy(catalog, "softDelete").validateLogicalCall
      : productLogicalInternalProductLifecycleEventPolicy(catalog, "softDelete");
    const call = receipt(visibility === "public" ? "productSoftDelete" : "productInternalProductsoftDelete", ["product"], {}, activity,
      visibility === "public" ? [event(catalog.product, "product"), event(catalog.option, "option"), event(catalog.value, "value")] : []);
    await Effect.runPromise(policy(call, activity));
    const foreign = transition(catalog.option, { id: "option", product_id: "outside", deleted_at: null }, "softDelete", 1);
    await refused(policy, call, activityFor(root, foreign, value));
    await refused(policy, { ...call, input: ["product", "skipped"] }, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.product.table.name, row: { id: "skipped", deleted_at: null } }] ,
    });
  });
});
