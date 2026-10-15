import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Result, Schema } from "effect";
import type { PreparedWorkflow, WorkflowContainer } from "@medusajs/workflows-sdk";
import { createProductTypesWorkflow } from "@medusajs/core-flows/product/create-product-types";
import { updateProductTypesWorkflow } from "@medusajs/core-flows/product/update-product-types";
import { deleteProductTypesWorkflow } from "@medusajs/core-flows/product/delete-product-types";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";

// Fixed native service responses expose composer ABI and ordering. This port
// does not simulate persistence, business normalization, rollback or settlement.
function nativePort(services: Readonly<Record<string, object>>) {
  const resolve = vi.fn((name: string): unknown => {
    const service: unknown = Object.getOwnPropertyDescriptor(services, name)?.value;
    if (service === undefined) throw new Error("Unselected native composition resource: " + name);
    return service;
  });
  const container: WorkflowContainer = { resolve: <Service>(name: string): Service => {
    // SAFETY: Medusa's generic resolver ABI does not infer from a name. The
    // mock records calls; this port returns only explicitly named service stubs.
    return resolve(name) as Service;
  } };
  const decode = commerceDecoder(Schema.Json, "invalidInput");
  const context: AtomicCommerceContext = { eventGroupId: "native-type-composition", checkpoint: Effect.void,
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(value))),
    call: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: error => Effect.fail(error),
  };
  return { resolve, run: (prepared: PreparedWorkflow, input: unknown) =>
    runNativeMedusaWorkflow(prepared, context, input, () => container),
  };
}

describe("genuine native Product Type composition", () => {
  it("retains the native nodes, hook positions, compensation declarations and delete sibling group", () => {
    const create = Result.getOrThrow(createProductTypesWorkflow.prepare());
    const update = Result.getOrThrow(updateProductTypesWorkflow.prepare());
    const deletion = Result.getOrThrow(deleteProductTypesWorkflow.prepare());
    expect(create.nodeCount).toBe(3); expect(update.nodeCount).toBe(3); expect(deletion.nodeCount).toBe(4);
    expect(create.nodes.map(node => node.name)).toEqual(["create-product-types", "productTypesCreated", "emit-event-step"]);
    expect(update.nodes.map(node => node.name)).toEqual(["update-product-types", "productTypesUpdated", "emit-event-step"]);
    expect(deletion.nodes.map(node => node.name)).toEqual(["delete-product-types", "productTypesDeleted", "remove-remote-links", "emit-event-step"]);
    expect(create).not.toHaveProperty("parallel"); expect(update).not.toHaveProperty("parallel");
    expect(deletion.parallel).toEqual([{ branches: [{ start: 2, end: 3 }, { start: 3, end: 4 }] }]);
    for (const flow of [create, update, deletion]) for (const node of flow.nodes) {
      if (node.kind === "workflow") throw new Error("Type roots have no workflow children");
      expect(node.hook).toBe(node.name.startsWith("productTypes"));
      if (!node.hook) expect(node.compensation).toBe("transactionCovered");
    }
  });

  it("returns complete created DTOs and invokes the additional-data hook before ordered events", async () => {
    const rows = [{ id: "ptyp-second", value: "Second", metadata: { native: true }, deleted_at: null },
      { id: "ptyp-first", value: "First", metadata: null, deleted_at: null }];
    const trace: string[] = [], emitted: unknown[] = [];
    const create = vi.fn(async (_input: unknown) => { trace.push("create"); return rows; });
    const inverse = vi.fn(async () => undefined);
    const emit = vi.fn(async (messages: unknown) => { trace.push("events"); emitted.push(messages); });
    const native = nativePort({ product: { createProductTypes: create, deleteProductTypes: inverse }, event_bus: { emit } });
    const additional_data = { reference: "erp" };
    const prepared = Result.getOrThrow(createProductTypesWorkflow.prepare({ productTypesCreated: value => {
      trace.push("hook"); expect(value).toEqual({ product_types: rows, additional_data });
    } }));
    const input = { product_types: [{ value: "First" }, { value: "Second" }], additional_data };
    expect(await Effect.runPromise(native.run(prepared, input))).toEqual(rows);
    expect(create).toHaveBeenCalledExactlyOnceWith(input.product_types);
    expect(trace).toEqual(["create", "hook", "events"]);
    expect(emitted).toEqual([[{ name: "product-type.created", data: { id: rows[0]!.id }, metadata: { eventGroupId: "native-type-composition" } },
      { name: "product-type.created", data: { id: rows[1]!.id }, metadata: { eventGroupId: "native-type-composition" } }]]);
    expect(inverse).not.toHaveBeenCalled();
    expect(native.resolve.mock.calls.map(([name]) => name)).toEqual(["product", "event_bus"]);
  });

  it("keeps the native preimage list and object-selector update calls and full returned metadata", async () => {
    const selector = { id: ["ptyp-first", "ptyp-missing"] }, update = { metadata: { added: "new" } };
    const rows = [{ id: "ptyp-first", value: "First", metadata: { kept: "old", added: "new" }, deleted_at: null }];
    const trace: string[] = [];
    const list = vi.fn(async (_selector: unknown, _config: unknown) => { trace.push("list"); return [{ id: "ptyp-first" }]; });
    const change = vi.fn(async (_selector: unknown, _update: unknown) => { trace.push("update"); return rows; });
    const emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const native = nativePort({ product: { listProductTypes: list, updateProductTypes: change }, event_bus: { emit } });
    const prepared = Result.getOrThrow(updateProductTypesWorkflow.prepare({ productTypesUpdated: value => {
      trace.push("hook"); expect(value.product_types).toEqual(rows); expect(value.additional_data).toBeUndefined();
    } }));
    expect(await Effect.runPromise(native.run(prepared, { selector, update }))).toEqual(rows);
    expect(list).toHaveBeenCalledExactlyOnceWith(selector, { select: ["metadata.added"], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith(selector, update);
    expect(trace).toEqual(["list", "update", "hook", "events"]);
    expect(emit).toHaveBeenCalledExactlyOnceWith([{ name: "product-type.updated", data: { id: "ptyp-first" }, metadata: { eventGroupId: "native-type-composition" } }]);
  });

  it("invokes native empty creation and empty-selector updates without inventing events", async () => {
    const create = vi.fn(async (_input: unknown) => []), emit = vi.fn(async (_messages: unknown) => undefined);
    const creation = nativePort({ product: { createProductTypes: create }, event_bus: { emit } });
    expect(await Effect.runPromise(creation.run(Result.getOrThrow(createProductTypesWorkflow.prepare()), { product_types: [] }))).toEqual([]);
    expect(create).toHaveBeenCalledExactlyOnceWith([]); expect(emit).not.toHaveBeenCalled();
    const list = vi.fn(async (_selector: unknown, _config: unknown) => []), change = vi.fn(async (_selector: unknown, _update: unknown) => []);
    const update = nativePort({ product: { listProductTypes: list, updateProductTypes: change }, event_bus: { emit } });
    expect(await Effect.runPromise(update.run(Result.getOrThrow(updateProductTypesWorkflow.prepare()), { selector: { id: [] }, update: {} }))).toEqual([]);
    expect(list).toHaveBeenCalledExactlyOnceWith({ id: [] }, { select: [], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith({ id: [] }, {}); expect(emit).not.toHaveBeenCalled();
  });

  it("runs actual delete siblings and preserves missing and duplicate requested IDs with a null result", async () => {
    const ids = ["ptyp-existing", "ptyp-missing", "ptyp-existing"];
    const release = await Effect.runPromise(Deferred.make<void>());
    const entered = new Set<"link" | "events">();
    const trace: string[] = [];
    const enter = async (name: "link" | "events") => {
      trace.push(name); entered.add(name);
      if (entered.size === 2) await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(release));
    };
    const softDelete = vi.fn(async (_ids: unknown) => { trace.push("soft-delete"); });
    const remove = vi.fn(async (_selector: unknown) => {
      await enter("link"); return [null, {}];
    });
    const emit = vi.fn(async (_messages: unknown) => { await enter("events"); });
    const native = nativePort({ product: { softDeleteProductTypes: softDelete }, link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteProductTypesWorkflow.prepare({ productTypesDeleted: value => {
      trace.push("hook"); expect(value.ids).toEqual(ids);
    } }));
    expect(await Effect.runPromise(native.run(prepared, { ids }).pipe(Effect.timeout(2_000)))).toBeNull();
    expect(trace.slice(0, 2)).toEqual(["soft-delete", "hook"]);
    expect(trace).toHaveLength(4); expect(new Set(trace.slice(2))).toEqual(new Set(["link", "events"]));
    expect(softDelete).toHaveBeenCalledExactlyOnceWith(ids);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_type_id: ids } });
    expect(emit).toHaveBeenCalledExactlyOnceWith(ids.map(id => ({ name: "product-type.deleted", data: { id }, metadata: { eventGroupId: "native-type-composition" } })));
    expect(native.resolve.mock.calls[0]).toEqual(["product"]);
    expect(native.resolve.mock.calls.slice(1).map(([name]) => name).toSorted()).toEqual(["event_bus", "link"]);
  });

  it("retains empty delete dependencies and stops before Link and events when the native hook fails", async () => {
    const softDelete = vi.fn(async (_ids: unknown) => undefined), remove = vi.fn(async (_selector: unknown) => [null, {}]);
    const emit = vi.fn(async (_messages: unknown) => undefined);
    const empty = nativePort({ product: { softDeleteProductTypes: softDelete }, link: { delete: remove }, event_bus: { emit } });
    expect(await Effect.runPromise(empty.run(Result.getOrThrow(deleteProductTypesWorkflow.prepare()), { ids: [] }))).toBeNull();
    expect(softDelete).toHaveBeenCalledExactlyOnceWith([]);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_type_id: [] } }); expect(emit).not.toHaveBeenCalled();
    softDelete.mockClear(); remove.mockClear();
    const failure = new Error("Type hook failed");
    const native = nativePort({ product: { softDeleteProductTypes: softDelete }, link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteProductTypesWorkflow.prepare({ productTypesDeleted: () => { throw failure; } }));
    await expect(Effect.runPromise(native.run(prepared, { ids: ["ptyp-existing"] })))
      .rejects.toMatchObject({ reason: "adapterFailure", cause: failure });
    expect(softDelete).toHaveBeenCalledExactlyOnceWith(["ptyp-existing"]); expect(remove).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
  });
});
