import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Result, Schema } from "effect";
import type { PreparedWorkflow, WorkflowContainer } from "@medusajs/workflows-sdk";
import { createCollectionsWorkflow } from "@medusajs/core-flows/product/create-collections";
import { updateCollectionsWorkflow } from "@medusajs/core-flows/product/update-collections";
import { deleteCollectionsWorkflow } from "@medusajs/core-flows/product/delete-collections";
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
  const context: AtomicCommerceContext = { eventGroupId: "native-collection-composition", checkpoint: Effect.void,
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(value))),
    call: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: error => Effect.fail(error),
  };
  return { resolve, run: (prepared: PreparedWorkflow, input: unknown) =>
    runNativeMedusaWorkflow(prepared, context, input, () => container),
  };
}

describe("genuine native Product Collection composition", () => {
  it("retains the native nodes, hook positions, compensation declarations and delete sibling group", () => {
    const create = Result.getOrThrow(createCollectionsWorkflow.prepare());
    const update = Result.getOrThrow(updateCollectionsWorkflow.prepare());
    const deletion = Result.getOrThrow(deleteCollectionsWorkflow.prepare());
    expect(create.nodeCount).toBe(3); expect(update.nodeCount).toBe(3); expect(deletion.nodeCount).toBe(4);
    expect(create.nodes.map(node => node.name)).toEqual(["create-collections", "emit-event-step", "collectionsCreated"]);
    expect(update.nodes.map(node => node.name)).toEqual(["update-collections", "emit-event-step", "collectionsUpdated"]);
    expect(deletion.nodes.map(node => node.name)).toEqual(["delete-collections", "remove-remote-links", "emit-event-step", "collectionsDeleted"]);
    expect(create).not.toHaveProperty("parallel"); expect(update).not.toHaveProperty("parallel");
    expect(deletion.parallel).toEqual([{ branches: [{ start: 1, end: 2 }, { start: 2, end: 3 }] }]);
    for (const flow of [create, update, deletion]) for (const node of flow.nodes) {
      if (node.kind === "workflow") throw new Error("Collection roots have no workflow children");
      expect(node.hook).toBe(node.name.startsWith("collections"));
      if (!node.hook) expect(node.compensation).toBe("transactionCovered");
    }
  });

  it("returns complete created DTOs and invokes the additional-data hook after ordered events", async () => {
    const rows = [{ id: "pcol-second", title: "Second", handle: "second", products: [{ id: "p", title: "Existing Product" }], metadata: { native: true }, deleted_at: null },
      { id: "pcol-first", title: "First", handle: "first", products: [], metadata: null, deleted_at: null }];
    const trace: string[] = [], emitted: unknown[] = [];
    const create = vi.fn(async (_input: unknown) => { trace.push("create"); return rows; });
    const inverse = vi.fn(async () => undefined);
    const emit = vi.fn(async (messages: unknown) => { trace.push("events"); emitted.push(messages); });
    const native = nativePort({ product: { createProductCollections: create, deleteProductCollections: inverse }, event_bus: { emit } });
    const additional_data = { reference: "erp" };
    const prepared = Result.getOrThrow(createCollectionsWorkflow.prepare({ collectionsCreated: value => {
      trace.push("hook"); expect(value).toEqual({ collections: rows, additional_data });
    } }));
    const input = { collections: [{ title: "First" }, { title: "Second", product_ids: ["p"] }], additional_data };
    expect(await Effect.runPromise(native.run(prepared, input))).toEqual(rows);
    expect(create).toHaveBeenCalledExactlyOnceWith(input.collections);
    expect(trace).toEqual(["create", "events", "hook"]);
    expect(emitted).toEqual([[{ name: "product-collection.created", data: { id: rows[0]!.id }, metadata: { eventGroupId: "native-collection-composition" } },
      { name: "product-collection.created", data: { id: rows[1]!.id }, metadata: { eventGroupId: "native-collection-composition" } }]]);
    expect(inverse).not.toHaveBeenCalled();
    expect(native.resolve.mock.calls.map(([name]) => name)).toEqual(["product", "event_bus"]);
  });

  it("keeps the native preimage list and object-selector update calls and full returned metadata", async () => {
    const selector = { id: ["pcol-first", "pcol-missing"] }, update = { metadata: { added: "new" } };
    const rows = [{ id: "pcol-first", title: "First", handle: "first", products: [], metadata: { kept: "old", added: "new" }, deleted_at: null }];
    const trace: string[] = [];
    const list = vi.fn(async (_selector: unknown, _config: unknown) => { trace.push("list"); return [{ id: "pcol-first" }]; });
    const change = vi.fn(async (_selector: unknown, _update: unknown) => { trace.push("update"); return rows; });
    const emit = vi.fn(async (_messages: unknown) => { trace.push("events"); });
    const native = nativePort({ product: { listProductCollections: list, updateProductCollections: change }, event_bus: { emit } });
    const prepared = Result.getOrThrow(updateCollectionsWorkflow.prepare({ collectionsUpdated: value => {
      trace.push("hook"); expect(value.collections).toEqual(rows); expect(value.additional_data).toBeUndefined();
    } }));
    expect(await Effect.runPromise(native.run(prepared, { selector, update }))).toEqual(rows);
    expect(list).toHaveBeenCalledExactlyOnceWith(selector, { select: ["metadata.added"], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith(selector, update);
    expect(trace).toEqual(["list", "update", "events", "hook"]);
    expect(emit).toHaveBeenCalledExactlyOnceWith([{ name: "product-collection.updated", data: { id: "pcol-first" }, metadata: { eventGroupId: "native-collection-composition" } }]);
  });

  it("passes native product_ids DTO preimages and multi-target selector updates without a facade target restriction", async () => {
    const selector = { id: ["pcol-first", "pcol-second"] }, update = { product_ids: ["p"] };
    const rows = [{ id: "pcol-first", title: "First", handle: "first", products: [{ id: "p" }] },
      { id: "pcol-second", title: "Second", handle: "second", products: [{ id: "p" }] }];
    const list = vi.fn(async (_selector: unknown, _config: unknown) => [{ id: "pcol-first" }, { id: "pcol-second" }]);
    const change = vi.fn(async (_selector: unknown, _update: unknown) => rows);
    const emit = vi.fn(async (_messages: unknown) => undefined);
    const native = nativePort({ product: { listProductCollections: list, updateProductCollections: change }, event_bus: { emit } });
    expect(await Effect.runPromise(native.run(Result.getOrThrow(updateCollectionsWorkflow.prepare()), { selector, update }))).toEqual(rows);
    expect(list).toHaveBeenCalledExactlyOnceWith(selector, { select: ["product_ids.0"], relations: ["product_ids"] });
    expect(change).toHaveBeenCalledExactlyOnceWith(selector, update);
    expect(emit).toHaveBeenCalledExactlyOnceWith(rows.map(row => ({ name: "product-collection.updated", data: { id: row.id }, metadata: { eventGroupId: "native-collection-composition" } })));
  });

  it("invokes native empty creation and empty-selector updates without inventing events", async () => {
    const create = vi.fn(async (_input: unknown) => []), emit = vi.fn(async (_messages: unknown) => undefined);
    const creation = nativePort({ product: { createProductCollections: create }, event_bus: { emit } });
    expect(await Effect.runPromise(creation.run(Result.getOrThrow(createCollectionsWorkflow.prepare()), { collections: [] }))).toEqual([]);
    expect(create).toHaveBeenCalledExactlyOnceWith([]); expect(emit).not.toHaveBeenCalled();
    const list = vi.fn(async (_selector: unknown, _config: unknown) => []), change = vi.fn(async (_selector: unknown, _update: unknown) => []);
    const update = nativePort({ product: { listProductCollections: list, updateProductCollections: change }, event_bus: { emit } });
    expect(await Effect.runPromise(update.run(Result.getOrThrow(updateCollectionsWorkflow.prepare()), { selector: { id: [] }, update: {} }))).toEqual([]);
    expect(list).toHaveBeenCalledExactlyOnceWith({ id: [] }, { select: [], relations: [] });
    expect(change).toHaveBeenCalledExactlyOnceWith({ id: [] }, {}); expect(emit).not.toHaveBeenCalled();
  });

  it("runs actual delete siblings and preserves missing and duplicate requested IDs with a null result", async () => {
    const ids = ["pcol-existing", "pcol-missing", "pcol-existing"];
    const release = await Effect.runPromise(Deferred.make<void>());
    const entered = new Set<"link" | "events">();
    let completed = 0;
    const trace: string[] = [];
    const enter = async (name: "link" | "events") => {
      trace.push(name); entered.add(name);
      if (entered.size === 2) await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(release));
      completed++;
    };
    const softDelete = vi.fn(async (_ids: unknown) => { trace.push("soft-delete"); });
    const remove = vi.fn(async (_selector: unknown) => {
      await enter("link"); return [null, {}];
    });
    const emit = vi.fn(async (_messages: unknown) => { await enter("events"); });
    const native = nativePort({ product: { softDeleteProductCollections: softDelete }, link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteCollectionsWorkflow.prepare({ collectionsDeleted: value => {
      expect(completed).toBe(2); trace.push("hook"); expect(value.ids).toEqual(ids);
    } }));
    expect(await Effect.runPromise(native.run(prepared, { ids }).pipe(Effect.timeout(2_000)))).toBeNull();
    expect(trace[0]).toBe("soft-delete"); expect(trace[3]).toBe("hook");
    expect(trace).toHaveLength(4); expect(new Set(trace.slice(1, 3))).toEqual(new Set(["link", "events"]));
    expect(softDelete).toHaveBeenCalledExactlyOnceWith(ids);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_collection_id: ids } });
    expect(emit).toHaveBeenCalledExactlyOnceWith(ids.map(id => ({ name: "product-collection.deleted", data: { id }, metadata: { eventGroupId: "native-collection-composition" } })));
    expect(native.resolve.mock.calls[0]).toEqual(["product"]);
    expect(native.resolve.mock.calls.slice(1).map(([name]) => name).toSorted()).toEqual(["event_bus", "link"]);
  });

  it("retains empty delete dependencies and reaches Link and event capture before a native hook failure", async () => {
    const softDelete = vi.fn(async (_ids: unknown) => undefined), remove = vi.fn(async (_selector: unknown) => [null, {}]);
    const emit = vi.fn(async (_messages: unknown) => undefined);
    const empty = nativePort({ product: { softDeleteProductCollections: softDelete }, link: { delete: remove }, event_bus: { emit } });
    expect(await Effect.runPromise(empty.run(Result.getOrThrow(deleteCollectionsWorkflow.prepare()), { ids: [] }))).toBeNull();
    expect(softDelete).toHaveBeenCalledExactlyOnceWith([]);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_collection_id: [] } }); expect(emit).not.toHaveBeenCalled();
    softDelete.mockClear(); remove.mockClear(); emit.mockClear();
    const failure = new Error("Collection hook failed");
    const native = nativePort({ product: { softDeleteProductCollections: softDelete }, link: { delete: remove }, event_bus: { emit } });
    const prepared = Result.getOrThrow(deleteCollectionsWorkflow.prepare({ collectionsDeleted: () => { throw failure; } }));
    await expect(Effect.runPromise(native.run(prepared, { ids: ["pcol-existing"] })))
      .rejects.toMatchObject({ reason: "adapterFailure", cause: failure });
    expect(softDelete).toHaveBeenCalledExactlyOnceWith(["pcol-existing"]);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ product: { product_collection_id: ["pcol-existing"] } });
    expect(emit).toHaveBeenCalledExactlyOnceWith([{ name: "product-collection.deleted", data: { id: "pcol-existing" }, metadata: { eventGroupId: "native-collection-composition" } }]);
  });
});
