import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Result, Schema } from "effect";
import type { PreparedWorkflow, WorkflowContainer } from "@medusajs/workflows-sdk";
import { createProductCategoriesWorkflow } from "@medusajs/core-flows/product-category/create-product-categories";
import { updateProductCategoriesWorkflow } from "@medusajs/core-flows/product-category/update-product-categories";
import { deleteProductCategoriesWorkflow } from "@medusajs/core-flows/product-category/delete-product-categories";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";

// These fixed method responses test the actual workflow ABI and scheduling.
// They do not model Category trees, persistence, lifecycle or settlement.
function nativePort(services: Readonly<Record<string, object>>) {
  const resolve = vi.fn((name: string): unknown => {
    const value: unknown = Object.getOwnPropertyDescriptor(services, name)?.value;
    if (value === undefined) throw new Error("Unselected native Category resource: " + name);
    return value;
  });
  const container: WorkflowContainer = { resolve: <Service>(name: string): Service => {
    // SAFETY: the native resolver's generic type cannot depend on its string
    // argument. This port returns only explicitly named, recorded method stubs.
    return resolve(name) as Service;
  } };
  const decode = commerceDecoder(Schema.Json, "invalidInput");
  const context: AtomicCommerceContext = { eventGroupId: "native-category-composition", checkpoint: Effect.void,
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(value))),
    call: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: error => Effect.fail(error),
  };
  return { resolve, run: (prepared: PreparedWorkflow, input: unknown) =>
    runNativeMedusaWorkflow(prepared, context, input, () => container),
  };
}

const message = (action: "created" | "updated" | "deleted", id: string) => ({
  name: "product-category." + action, data: { id }, metadata: { eventGroupId: "native-category-composition" },
});

describe("genuine native Product Category composition", () => {
  it("retains the native 3/3/4 nodes, hooks, compensation declarations and real delete sibling group", () => {
    const create = Result.getOrThrow(createProductCategoriesWorkflow.prepare());
    const update = Result.getOrThrow(updateProductCategoriesWorkflow.prepare());
    const deletion = Result.getOrThrow(deleteProductCategoriesWorkflow.prepare());
    expect(create.nodeCount).toBe(3); expect(update.nodeCount).toBe(3); expect(deletion.nodeCount).toBe(4);
    expect(create.nodes.map(node => node.name)).toEqual(["create-product-categories", "emit-event-step", "categoriesCreated"]);
    expect(update.nodes.map(node => node.name)).toEqual(["update-product-categories", "emit-event-step", "categoriesUpdated"]);
    expect(deletion.nodes.map(node => node.name)).toEqual(["delete-product-categories", "remove-remote-links", "emit-event-step", "categoriesDeleted"]);
    expect(create).not.toHaveProperty("parallel"); expect(update).not.toHaveProperty("parallel");
    expect(deletion.parallel).toEqual([{ branches: [{ start: 1, end: 2 }, { start: 2, end: 3 }] }]);
    for (const flow of [create, update, deletion]) for (const node of flow.nodes) {
      if (node.kind === "workflow") throw new Error("Category roots have no workflow children");
      expect(node.hook).toBe(node.name.startsWith("categories"));
      if (!node.hook) expect(node.compensation).toBe("transactionCovered");
    }
  });

  it("returns four complete native DTOs in service order and emits before the additional-data creation hook", async () => {
    const rows = ["c", "a", "d", "b"].map((id, rank) => ({ id, name: "Category " + id, handle: id, rank,
      mpath: "parent." + id, parent_category_id: "parent", parent_category: { id: "parent", rank: 0 },
      category_children: [{ id: id + "-child", mpath: "parent." + id + "." + id + "-child" }],
      products: [{ id: "product", title: "Native related Product" }], metadata: { native: true }, deleted_at: null }));
    const trace: string[] = [];
    const create = vi.fn(async (_input: unknown) => { trace.push("create"); return rows; });
    const inverse = vi.fn(async () => undefined);
    const emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const native = nativePort({ product: { createProductCategories: create, deleteProductCategories: inverse }, event_bus: { emit } });
    const additional_data = { reference: "erp", nested: { enabled: true } };
    const prepared = Result.getOrThrow(createProductCategoriesWorkflow.prepare({ categoriesCreated: value => {
      trace.push("hook"); expect(value).toEqual({ categories: rows, additional_data });
    } }));
    const input = { product_categories: ["a", "b", "c", "d"].map(name => ({ name })), additional_data };
    expect(await Effect.runPromise(native.run(prepared, input))).toEqual(rows);
    expect(create).toHaveBeenCalledExactlyOnceWith(input.product_categories);
    expect(emit).toHaveBeenCalledExactlyOnceWith(rows.map(row => message("created", row.id)));
    expect(trace).toEqual(["create", "events", "hook"]); expect(inverse).not.toHaveBeenCalled();
    expect(native.resolve.mock.calls.map(([name]) => name)).toEqual(["product", "event_bus"]);
  });

  it("retains actual native preimage config and four-target selector update calls before events and hook", async () => {
    const selector = { id: ["c", "a", "d", "b"] };
    const update = { parent_category_id: null, rank: 0, metadata: { next: true } };
    const rows = selector.id.map(id => ({ id, name: "Category " + id, handle: id, rank: 0, mpath: id,
      parent_category_id: null, parent_category: null, category_children: [], metadata: { next: true }, deleted_at: null }));
    const trace: string[] = [];
    const list = vi.fn(async (_selector: unknown, _config: unknown) => { trace.push("list"); return selector.id.map(id => ({ id })); });
    const change = vi.fn(async (_selector: unknown, _update: unknown) => { trace.push("update"); return rows; });
    const inverse = vi.fn(async () => undefined);
    const emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const native = nativePort({ product: { listProductCategories: list, updateProductCategories: change,
      upsertProductCategories: inverse }, event_bus: { emit } });
    const additional_data = { witness: "native" };
    const prepared = Result.getOrThrow(updateProductCategoriesWorkflow.prepare({ categoriesUpdated: value => {
      trace.push("hook"); expect(value).toEqual({ categories: rows, additional_data });
    } }));
    expect(await Effect.runPromise(native.run(prepared, { selector, update, additional_data }))).toEqual(rows);
    expect(list).toHaveBeenCalledExactlyOnceWith(selector, { select: ["parent_category_id", "rank", "metadata.next"], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith(selector, update);
    expect(emit).toHaveBeenCalledExactlyOnceWith(rows.map(row => message("updated", row.id)));
    expect(trace).toEqual(["list", "update", "events", "hook"]); expect(inverse).not.toHaveBeenCalled();
  });

  it("invokes empty native creation and selector update while retaining hooks and event resource selection", async () => {
    const emit = vi.fn(async (_messages: unknown) => undefined), create = vi.fn(async (_input: unknown) => []);
    const created = vi.fn((value: unknown) => { expect(value).toEqual({ categories: [], additional_data: undefined }); });
    const creation = nativePort({ product: { createProductCategories: create }, event_bus: { emit } });
    expect(await Effect.runPromise(creation.run(Result.getOrThrow(createProductCategoriesWorkflow.prepare({ categoriesCreated: created })),
      { product_categories: [] }))).toEqual([]);
    expect(create).toHaveBeenCalledExactlyOnceWith([]); expect(created).toHaveBeenCalledTimes(1); expect(emit).not.toHaveBeenCalled();
    expect(creation.resolve.mock.calls.map(([name]) => name)).toEqual(["product", "event_bus"]);
    const list = vi.fn(async (_selector: unknown, _config: unknown) => []), change = vi.fn(async (_selector: unknown, _update: unknown) => []);
    const updated = vi.fn((value: unknown) => { expect(value).toEqual({ categories: [], additional_data: undefined }); });
    const native = nativePort({ product: { listProductCategories: list, updateProductCategories: change }, event_bus: { emit } });
    expect(await Effect.runPromise(native.run(Result.getOrThrow(updateProductCategoriesWorkflow.prepare({ categoriesUpdated: updated })),
      { selector: { id: [] }, update: {} }))).toEqual([]);
    expect(list).toHaveBeenCalledExactlyOnceWith({ id: [] }, { select: [], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith({ id: [] }, {}); expect(updated).toHaveBeenCalledTimes(1); expect(emit).not.toHaveBeenCalled();
  });

  it("overlaps actual delete siblings before the hook and preserves raw requested IDs when the native method succeeds", async () => {
    // Missing/duplicate Category admission belongs to the real service tests.
    // Here the successful ABI response proves the composer preserves its input.
    const ids = ["category", "missing", "category"];
    const release = await Effect.runPromise(Deferred.make<void>());
    const entered = new Set<"link" | "events">();
    const trace: string[] = [];
    let completed = 0;
    const enter = async (name: "link" | "events") => {
      trace.push(name); entered.add(name);
      if (entered.size === 2) await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(release)); completed++;
    };
    const softDelete = vi.fn(async (_ids: unknown) => { trace.push("soft-delete"); return {}; });
    const remove = vi.fn(async (_selector: unknown) => { await enter("link"); return [null, {}]; });
    const emit = vi.fn(async (_messages: unknown) => { await enter("events"); });
    const inverse = vi.fn(async () => undefined);
    const native = nativePort({ product: { softDeleteProductCategories: softDelete, restoreProductCategories: inverse },
      link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteProductCategoriesWorkflow.prepare({ categoriesDeleted: value => {
      expect(completed).toBe(2); trace.push("hook"); expect(value).toEqual({ ids });
    } }));
    expect(await Effect.runPromise(native.run(prepared, ids).pipe(Effect.timeout(2_000)))).toBeNull();
    expect(trace[0]).toBe("soft-delete"); expect(trace.at(-1)).toBe("hook"); expect(trace).toHaveLength(4);
    expect(new Set(trace.slice(1, 3))).toEqual(new Set(["link", "events"]));
    expect(softDelete).toHaveBeenCalledExactlyOnceWith(ids);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_category_id: ids } });
    expect(emit).toHaveBeenCalledExactlyOnceWith(ids.map(id => message("deleted", id))); expect(inverse).not.toHaveBeenCalled();
    expect(native.resolve.mock.calls[0]).toEqual(["product"]);
    expect(native.resolve.mock.calls.slice(1).map(([name]) => name).toSorted()).toEqual(["event_bus", "link"]);
  });

  it("retains empty delete method, Link and event dependencies and normalizes void to null", async () => {
    const softDelete = vi.fn(async (_ids: unknown) => ({})), remove = vi.fn(async (_selector: unknown) => [null, {}]);
    const emit = vi.fn(async (_messages: unknown) => undefined), hook = vi.fn((value: unknown) => { expect(value).toEqual({ ids: [] }); });
    const native = nativePort({ product: { softDeleteProductCategories: softDelete }, link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteProductCategoriesWorkflow.prepare({ categoriesDeleted: hook }));
    expect(await Effect.runPromise(native.run(prepared, []))).toBeNull();
    expect(softDelete).toHaveBeenCalledExactlyOnceWith([]);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_category_id: [] } });
    expect(emit).not.toHaveBeenCalled(); expect(hook).toHaveBeenCalledTimes(1);
    expect(native.resolve.mock.calls.map(([name]) => name).toSorted()).toEqual(["event_bus", "link", "product"]);
  });

  it("preserves native hook failures after prior event capture and completed delete siblings", async () => {
    const failure = new Error("Category hook failed"), trace: string[] = [];
    const rows = [{ id: "category", name: "Category", rank: 0, mpath: "category", metadata: null }];
    const emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const create = vi.fn(async (_input: unknown) => rows), inverse = vi.fn(async () => undefined);
    const native = nativePort({ product: { createProductCategories: create, deleteProductCategories: inverse }, event_bus: { emit } });
    const prepared = Result.getOrThrow(createProductCategoriesWorkflow.prepare({ categoriesCreated: () => {
      expect(trace).toEqual(["events"]); throw failure;
    } }));
    await expect(Effect.runPromise(native.run(prepared, { product_categories: [{ name: "Category" }] })))
      .rejects.toMatchObject({ reason: "adapterFailure", cause: failure });
    expect(inverse).not.toHaveBeenCalled();
    trace.length = 0; emit.mockClear();
    const updateInverse = vi.fn(async () => undefined);
    const update = nativePort({ product: { listProductCategories: async (_selector: unknown, _config: unknown) => [{ id: "category" }],
      updateProductCategories: async (_selector: unknown, _update: unknown) => rows, upsertProductCategories: updateInverse }, event_bus: { emit } });
    const changed = Result.getOrThrow(updateProductCategoriesWorkflow.prepare({ categoriesUpdated: () => {
      expect(trace).toEqual(["events"]); throw failure;
    } }));
    await expect(Effect.runPromise(update.run(changed, { selector: { id: "category" }, update: {} })))
      .rejects.toMatchObject({ reason: "adapterFailure", cause: failure });
    expect(updateInverse).not.toHaveBeenCalled();
    trace.length = 0; emit.mockClear();
    const remove = vi.fn(async (_selector: unknown) => { trace.push("link"); return [null, {}]; });
    const deletion = nativePort({ product: { softDeleteProductCategories: async (_ids: unknown) => ({}) }, link: { delete: remove }, event_bus: { emit } });
    const deleted = Result.getOrThrow(deleteProductCategoriesWorkflow.prepare({ categoriesDeleted: () => {
      expect(new Set(trace)).toEqual(new Set(["link", "events"])); throw failure;
    } }));
    await expect(Effect.runPromise(deletion.run(deleted, ["category"])))
      .rejects.toMatchObject({ reason: "adapterFailure", cause: failure });
  });
});
