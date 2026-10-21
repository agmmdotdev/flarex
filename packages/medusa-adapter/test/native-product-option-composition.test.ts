import { expectNativePromiseDefect, promiseFailureObserver } from "./support/promise-failure-observer";
import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Result, Schema } from "effect";
import type { PreparedWorkflow, WorkflowContainer } from "@medusajs/workflows-sdk";
import { createProductOptionsWorkflow } from "@medusajs/core-flows/product/create-product-options";
import { updateProductOptionsWorkflow } from "@medusajs/core-flows/product/update-product-options";
import { deleteProductOptionsWorkflow } from "@medusajs/core-flows/product/delete-product-options";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";

/** Fixed native method responses exercise composer ABI and scheduling only.
 * Persistence, replacement and settlement stay in their integration witnesses. */
function nativePort(services: Readonly<Record<string, object>>) {
  const resolve = vi.fn((name: string): unknown => {
    const value: unknown = Object.getOwnPropertyDescriptor(services, name)?.value;
    if (value === undefined) throw new Error("Unselected native Option resource: " + name);
    return value;
  });
  const container: WorkflowContainer = { resolve: <Service>(name: string): Service => {
    // SAFETY: the framework generic cannot depend on its string argument. Only
    // the explicitly selected, recorded method stubs can be resolved here.
    return resolve(name) as Service;
  } };
  const decode = commerceDecoder(Schema.Json, "invalidInput");
  const context: AtomicCommerceContext = { eventGroupId: "native-option-composition", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(value))),
    call: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: error => Effect.fail(error),
  };
  return { resolve, run: (prepared: PreparedWorkflow, input: unknown) =>
    runNativeMedusaWorkflow(prepared, context, input, () => container),
  };
}

const message = (action: "created" | "updated" | "deleted", id: string) => ({
  name: "product-option." + action, data: { id }, metadata: { eventGroupId: "native-option-composition" },
});
const rows = ["c", "a", "d", "b"].map(id => ({ id, title: "Option " + id, product_id: "product",
  values: [{ id: id + "-value", value: id, option_id: id }], metadata: { native: true }, deleted_at: null }));

describe("genuine native Product Option composition", () => {
  it("retains the native hook-first nodes, compensation declarations and delete sibling group", () => {
    const create = Result.getOrThrow(createProductOptionsWorkflow.prepare());
    const update = Result.getOrThrow(updateProductOptionsWorkflow.prepare());
    const deletion = Result.getOrThrow(deleteProductOptionsWorkflow.prepare());
    expect(create.nodes.map(node => node.name)).toEqual(["create-product-options", "productOptionsCreated", "emit-event-step"]);
    expect(update.nodes.map(node => node.name)).toEqual(["update-product-options", "productOptionsUpdated", "emit-event-step"]);
    expect(deletion.nodes.map(node => node.name)).toEqual(["delete-product-options", "productOptionsDeleted", "remove-remote-links", "emit-event-step"]);
    expect(create.nodeCount).toBe(3); expect(update.nodeCount).toBe(3); expect(deletion.nodeCount).toBe(4);
    expect(deletion.parallel).toEqual([{ branches: [{ start: 2, end: 3 }, { start: 3, end: 4 }] }]);
    for (const flow of [create, update, deletion]) for (const node of flow.nodes) {
      if (node.kind === "workflow") throw new Error("Option roots have no child workflows");
      expect(node.hook).toBe(node.name.startsWith("productOptions"));
      if (!node.hook) expect(node.compensation).toBe("transactionCovered");
    }
  });

  it("returns complete native DTOs in service order and calls the creation hook before events", async () => {
    const trace: string[] = [];
    const create = vi.fn(async (_input: unknown) => { trace.push("create"); return rows; });
    const inverse = vi.fn(async () => undefined), emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const native = nativePort({ product: { createProductOptions: create, deleteProductOptions: inverse }, event_bus: { emit } });
    const additional_data = { reference: "erp", nested: { enabled: true } };
    const prepared = Result.getOrThrow(createProductOptionsWorkflow.prepare({ productOptionsCreated: value => {
      trace.push("hook"); expect(value).toEqual({ product_options: rows, additional_data });
    } }));
    const input = { product_options: rows.map(row => ({ title: row.title, product_id: row.product_id, values: [row.id] })), additional_data };
    expect(await Effect.runPromise(native.run(prepared, input))).toEqual(rows);
    expect(create).toHaveBeenCalledExactlyOnceWith(input.product_options);
    expect(emit).toHaveBeenCalledExactlyOnceWith(rows.map(row => message("created", row.id)));
    expect(trace).toEqual(["create", "hook", "events"]); expect(inverse).not.toHaveBeenCalled();
  });

  it("keeps actual preimage selection and selector calls before the update hook and events", async () => {
    const selector = { id: ["c", "a", "d", "b"] }, update = { values: ["Small"], metadata: { next: true } };
    const trace: string[] = [];
    const list = vi.fn(async (_selector: unknown, _config: unknown) => { trace.push("list"); return [{ id: "c" }]; });
    const change = vi.fn(async (_selector: unknown, _update: unknown) => { trace.push("update"); return rows; });
    const inverse = vi.fn(async () => undefined), emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const native = nativePort({ product: { listProductOptions: list, updateProductOptions: change, upsertProductOptions: inverse }, event_bus: { emit } });
    const additional_data = { witness: "native" };
    const prepared = Result.getOrThrow(updateProductOptionsWorkflow.prepare({ productOptionsUpdated: value => {
      trace.push("hook"); expect(value).toEqual({ product_options: rows, additional_data });
    } }));
    expect(await Effect.runPromise(native.run(prepared, { selector, update, additional_data }))).toEqual(rows);
    // The native helper traverses strings as enumerable primitive entries.
    expect(list).toHaveBeenCalledExactlyOnceWith(selector, { select: ["values.0", "values.1", "values.2", "values.3", "values.4", "metadata.next"], relations: ["values"] });
    expect(change).toHaveBeenCalledExactlyOnceWith(selector, update);
    expect(emit).toHaveBeenCalledExactlyOnceWith(rows.map(row => message("updated", row.id)));
    expect(trace).toEqual(["list", "update", "hook", "events"]); expect(inverse).not.toHaveBeenCalled();
  });

  it("retains empty creation and unmatched selector updates including hooks and event dependencies", async () => {
    const emit = vi.fn(async (_messages: unknown) => undefined), create = vi.fn(async (_input: unknown) => []);
    const created = vi.fn((value: unknown) => { expect(value).toEqual({ product_options: [], additional_data: undefined }); });
    const creation = nativePort({ product: { createProductOptions: create }, event_bus: { emit } });
    expect(await Effect.runPromise(creation.run(Result.getOrThrow(createProductOptionsWorkflow.prepare({ productOptionsCreated: created })), { product_options: [] }))).toEqual([]);
    expect(create).toHaveBeenCalledExactlyOnceWith([]); expect(created).toHaveBeenCalledTimes(1); expect(emit).not.toHaveBeenCalled();
    expect(creation.resolve.mock.calls.map(([name]) => name)).toEqual(["product", "event_bus"]);
    const list = vi.fn(async (_selector: unknown, _config: unknown) => []), change = vi.fn(async (_selector: unknown, _update: unknown) => []);
    const updated = vi.fn((value: unknown) => { expect(value).toEqual({ product_options: [], additional_data: undefined }); });
    const native = nativePort({ product: { listProductOptions: list, updateProductOptions: change }, event_bus: { emit } });
    expect(await Effect.runPromise(native.run(Result.getOrThrow(updateProductOptionsWorkflow.prepare({ productOptionsUpdated: updated })),
      { selector: { id: [] }, update: {} }))).toEqual([]);
    expect(list).toHaveBeenCalledExactlyOnceWith({ id: [] }, { select: [], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith({ id: [] }, {}); expect(updated).toHaveBeenCalledTimes(1); expect(emit).not.toHaveBeenCalled();
  });

  it("runs the deletion hook before genuine parallel Link/event siblings and preserves raw IDs", async () => {
    const ids = ["option", "missing", "option"], trace: string[] = [];
    const release = await Effect.runPromise(Deferred.make<void>()), entered = new Set<string>();
    const enter = async (name: string) => {
      trace.push(name); entered.add(name);
      if (entered.size === 2) await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(release));
    };
    const softDelete = vi.fn(async (_ids: unknown) => { trace.push("soft-delete"); return { product_option_id: ["option"] }; });
    const remove = vi.fn(async (_selector: unknown) => { await enter("link"); return [null, {}]; });
    const emit = vi.fn(async (_messages: unknown) => { await enter("events"); }), inverse = vi.fn(async () => undefined);
    const native = nativePort({ product: { softDeleteProductOptions: softDelete, restoreProductOptions: inverse }, link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteProductOptionsWorkflow.prepare({ productOptionsDeleted: value => {
      expect(trace).toEqual(["soft-delete"]); trace.push("hook"); expect(value).toEqual({ ids });
    } }));
    expect(await Effect.runPromise(native.run(prepared, { ids }).pipe(Effect.timeout(2_000)))).toBeNull();
    expect(trace.slice(0, 2)).toEqual(["soft-delete", "hook"]);
    expect(new Set(trace.slice(2))).toEqual(new Set(["link", "events"]));
    expect(softDelete).toHaveBeenCalledExactlyOnceWith(ids);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_option_id: ids } });
    expect(emit).toHaveBeenCalledExactlyOnceWith(ids.map(id => message("deleted", id))); expect(inverse).not.toHaveBeenCalled();
  });

  it("retains empty deletion dependencies and normalizes the native void output", async () => {
    const softDelete = vi.fn(async (_ids: unknown) => ({})), remove = vi.fn(async (_selector: unknown) => [null, {}]);
    const emit = vi.fn(async (_messages: unknown) => undefined), hook = vi.fn((value: unknown) => { expect(value).toEqual({ ids: [] }); });
    const native = nativePort({ product: { softDeleteProductOptions: softDelete }, link: { delete: remove }, event_bus: { emit } });
    expect(await Effect.runPromise(native.run(Result.getOrThrow(deleteProductOptionsWorkflow.prepare({ productOptionsDeleted: hook })), { ids: [] }))).toBeNull();
    expect(softDelete).toHaveBeenCalledExactlyOnceWith([]);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_option_id: [] } });
    expect(emit).not.toHaveBeenCalled(); expect(hook).toHaveBeenCalledTimes(1);
    expect(native.resolve.mock.calls.map(([name]) => name).toSorted()).toEqual(["event_bus", "link", "product"]);
  });

  it("propagates hook failure before event capture and before either deletion sibling", async () => {
    const failure = new Error("Option hook failed"), emit = vi.fn(async (_messages: unknown) => undefined);
    const inverse = vi.fn(async () => undefined), create = nativePort({ product: { createProductOptions: async () => rows, deleteProductOptions: inverse }, event_bus: { emit } });
    const created = Result.getOrThrow(createProductOptionsWorkflow.prepare({ productOptionsCreated: () => { throw failure; } }));
    await expectNativePromiseDefect(create.run(created, { product_options: [] }), failure);
    expect(emit).not.toHaveBeenCalled(); expect(inverse).not.toHaveBeenCalled();
    const update = nativePort({ product: { listProductOptions: async () => [], updateProductOptions: async () => rows }, event_bus: { emit } });
    const updated = Result.getOrThrow(updateProductOptionsWorkflow.prepare({ productOptionsUpdated: () => { throw failure; } }));
    await expectNativePromiseDefect(update.run(updated, { selector: {}, update: {} }), failure);
    expect(emit).not.toHaveBeenCalled();
    const remove = vi.fn(async (_input: unknown) => [null, {}]);
    const deletion = nativePort({ product: { softDeleteProductOptions: async () => ({}) }, link: { delete: remove }, event_bus: { emit } });
    const deleted = Result.getOrThrow(deleteProductOptionsWorkflow.prepare({ productOptionsDeleted: () => { throw failure; } }));
    await expectNativePromiseDefect(deletion.run(deleted, { ids: ["option"] }), failure);
    expect(emit).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
});
