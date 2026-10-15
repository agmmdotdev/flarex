import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Result, Schema } from "effect";
import type { PreparedWorkflow, WorkflowContainer } from "@medusajs/workflows-sdk";
import { batchImageVariantsWorkflow } from "@medusajs/core-flows/product/batch-image-variants";
import type { WorkflowGraphResource } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";
import { ImageVariantsWorkflowInput, ImageVariantsWorkflowOutput, VariantImagesWorkflowInput,
  VariantThumbnailSelector, VariantUpdateSelector, decodeVariantThumbnailUpdate } from "../src/modules/product/variant-workflow-input";

/** Fixed native method responses prove composer ABI and scheduling. Database
 * assignments, endpoint admission and settlement belong to connected tests. */
function nativePort(services: Readonly<Record<string, object>>) {
  const resolve = vi.fn((name: string): unknown => {
    const value: unknown = Object.getOwnPropertyDescriptor(services, name)?.value;
    if (value === undefined) throw new Error("Unselected native Image-Variant resource: " + name);
    return value;
  });
  const container: WorkflowContainer = { resolve: <Service>(name: string): Service => {
    // SAFETY: this framework generic cannot depend on its string argument.
    // Only the explicitly selected, recorded method stubs can be resolved.
    return resolve(name) as Service;
  } };
  const decode = commerceDecoder(Schema.Json, "invalidInput");
  const context: AtomicCommerceContext = { eventGroupId: "native-image-variants", checkpoint: Effect.void,
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(value))),
    call: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: error => Effect.fail(error),
  };
  return { resolve, run: (prepared: PreparedWorkflow, input: unknown) =>
    runNativeMedusaWorkflow(prepared, context, input, () => container),
  };
}

function queryPort(image: typeof Schema.JsonObject.Type | undefined, variants: readonly (typeof Schema.JsonObject.Type)[] = []) {
  const graph = vi.fn<WorkflowGraphResource["graph"]>(async input => {
    if (!["variants", "product_image"].includes(input.entity)) throw new Error("Unexpected native image-workflow query");
    const data = input.entity === "variants" ? variants : image === undefined ? [] : [image];
    return { data, metadata: { count: data.length, skip: 0, take: input.pagination.take } };
  });
  return { maxPageSize: 4, graph } satisfies WorkflowGraphResource;
}

describe("genuine native inverse Image-Variant composition", () => {
  it("retains native parallel assignment steps, both query dependencies and transaction-covered compensators", () => {
    const prepared = Result.getOrThrow(batchImageVariantsWorkflow.prepare());
    expect(prepared.nodeCount).toBe(9);
    expect(prepared.nodes.map(node => node.name)).toEqual([
      "add-image-to-variants", "remove-image-from-variants", "should-remove-variants",
      "get-variants-for-thumbnail-check", "get-image-for-thumbnail-check", "$should-remove-variants",
      "should-update-variants", "update-product-variants", "$should-update-variants",
    ]);
    expect(prepared.parallel).toEqual([{ branches: [{ start: 0, end: 1 }, { start: 1, end: 2 }] }]);
    for (const node of prepared.nodes) {
      if (node.kind === "workflow") throw new Error("This native workflow has no child workflows");
      expect(node.hook).toBe(false);
      if (["add-image-to-variants", "remove-image-from-variants", "update-product-variants"].includes(node.name)) {
        expect(node.compensation).toBe("transactionCovered"); expect(node.compensate).toBeTypeOf("function");
      }
    }
  });

  it("normalizes omitted and empty arrays without resolving Product, Query or an event resource", async () => {
    const native = nativePort({}), prepared = Result.getOrThrow(batchImageVariantsWorkflow.prepare());
    for (const input of [{ image_id: "image" }, { image_id: "image", add: [], remove: [] }]) {
      expect(await Effect.runPromise(native.run(prepared, input))).toEqual({ added: [], removed: [] });
    }
    expect(native.resolve).not.toHaveBeenCalled();
  });

  it("maps additions to native pairs and returns raw requested IDs independently of assignment DTOs", async () => {
    const add = vi.fn(async (_input: unknown) => [{ id: "native-assignment" }]);
    const native = nativePort({ product: { addImageToVariant: add } });
    const ids = ["b", "a", "b"];
    expect(await Effect.runPromise(native.run(Result.getOrThrow(batchImageVariantsWorkflow.prepare()), { image_id: "image", add: ids })))
      .toEqual({ added: ids, removed: [] });
    expect(add).toHaveBeenCalledExactlyOnceWith(ids.map(variant_id => ({ image_id: "image", variant_id })));
    expect(native.resolve.mock.calls).toEqual([["product"]]);
  });

  it("overlaps actual assignment siblings before the mandatory removal queries and preserves intersections", async () => {
    const release = await Effect.runPromise(Deferred.make<void>()), entered = new Set<string>(); let completed = 0;
    const enter = async (name: string) => {
      entered.add(name); if (entered.size === 2) await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(release)); completed++;
    };
    const add = vi.fn(async (_input: unknown) => { await enter("add"); return [{ id: "assignment" }]; });
    const remove = vi.fn(async (_input: unknown) => { await enter("remove"); });
    const query = queryPort({ id: "image", url: "" });
    query.graph.mockImplementation(async input => {
      expect(completed).toBe(2);
      const data = input.entity === "product_image" ? [{ id: "image", url: "" }] : [];
      return { data, metadata: { count: data.length, skip: 0, take: input.pagination.take } };
    });
    const native = nativePort({ product: { addImageToVariant: add, removeImageFromVariant: remove }, query });
    const input = { image_id: "image", add: ["new", "both"], remove: ["old", "both", "old"] };
    expect(await Effect.runPromise(native.run(Result.getOrThrow(batchImageVariantsWorkflow.prepare()), input).pipe(Effect.timeout(2_000))))
      .toEqual({ added: input.add, removed: input.remove });
    expect(add).toHaveBeenCalledExactlyOnceWith(input.add.map(variant_id => ({ image_id: input.image_id, variant_id })));
    expect(remove).toHaveBeenCalledExactlyOnceWith(input.remove.map(variant_id => ({ image_id: input.image_id, variant_id })));
    expect(query.graph.mock.calls.map(([input]) => input.entity)).toEqual(["variants", "product_image"]);
    expect(native.resolve.mock.calls.every(([name]) => name === "product" || name === "query")).toBe(true);
  });

  it.each([undefined, { id: "image", url: "" }, { id: "image", url: null }, { id: "image", url: 0 }])
    ("executes both queries but skips native thumbnail updates for a missing or nontruthy string URL (%j)", async image => {
      const remove = vi.fn(async (_input: unknown) => undefined), list = vi.fn(), update = vi.fn();
      const query = queryPort(image), native = nativePort({ product: { removeImageFromVariant: remove,
        listProductVariants: list, updateProductVariants: update }, query });
      const input = { image_id: "image", remove: ["missing", "missing"] };
      expect(await Effect.runPromise(native.run(Result.getOrThrow(batchImageVariantsWorkflow.prepare()), input)))
        .toEqual({ added: [], removed: input.remove });
      expect(query.graph).toHaveBeenNthCalledWith(1, { entity: "variants", fields: ["id", "thumbnail"],
        filters: { id: input.remove }, pagination: { take: 4 } });
      expect(query.graph).toHaveBeenNthCalledWith(2, { entity: "product_image", fields: ["id", "url"],
        filters: { id: "image" }, pagination: { take: 4 } });
      expect(list).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    });

  it("resolves the native transform's captured removal reference before exact thumbnail-selector calls", async () => {
    const remove = vi.fn(async (_input: unknown) => undefined), imageUrl = "https://images.example/image.png";
    const query = queryPort({ id: "image", url: imageUrl }, [{ id: "matching", thumbnail: imageUrl }, { id: "other", thumbnail: "other-url" }]);
    const list = vi.fn(async (_selector: unknown, _config: unknown) => [{ id: "matching", thumbnail: imageUrl }]);
    const update = vi.fn(async (_selector: unknown, _update: unknown) => [{ id: "matching", thumbnail: null }]);
    const native = nativePort({ product: { removeImageFromVariant: remove, listProductVariants: list, updateProductVariants: update }, query });
    const input = { image_id: "image", remove: ["matching", "other", "missing", "matching"] };
    expect(await Effect.runPromise(native.run(Result.getOrThrow(batchImageVariantsWorkflow.prepare()), input)))
      .toEqual({ added: [], removed: input.remove });
    const selector = { id: input.remove, thumbnail: imageUrl };
    expect(list).toHaveBeenCalledExactlyOnceWith(selector, { select: ["thumbnail"], relations: [] });
    expect(update).toHaveBeenCalledExactlyOnceWith(selector, { thumbnail: null });
    expect(query.graph).toHaveBeenCalledTimes(2);
  });

  it("retains the native no-match update invocation even when the preliminary variants query is empty", async () => {
    const imageUrl = "https://images.example/image.png", query = queryPort({ id: "image", url: imageUrl });
    const list = vi.fn(async (_selector: unknown, _config: unknown) => []), update = vi.fn(async (_selector: unknown, _update: unknown) => []);
    const native = nativePort({ product: { removeImageFromVariant: async () => undefined, listProductVariants: list, updateProductVariants: update }, query });
    expect(await Effect.runPromise(native.run(Result.getOrThrow(batchImageVariantsWorkflow.prepare()), { image_id: "image", remove: ["missing"] })))
      .toEqual({ added: [], removed: ["missing"] });
    expect(list).toHaveBeenCalledExactlyOnceWith({ id: ["missing"], thumbnail: imageUrl }, { select: ["thumbnail"], relations: [] });
    expect(update).toHaveBeenCalledExactlyOnceWith({ id: ["missing"], thumbnail: imageUrl }, { thumbnail: null });
  });

  it("propagates a late native failure without applying inverse assignment or upsert compensators", async () => {
    const failure = new Error("Native thumbnail update failed");
    const add = vi.fn(async (_input: unknown) => [{ id: "assignment" }]), remove = vi.fn(async (_input: unknown) => undefined);
    const restore = vi.fn(async () => undefined), query = queryPort({ id: "image", url: "image-url" });
    const native = nativePort({ product: { addImageToVariant: add, removeImageFromVariant: remove,
      listProductVariants: async () => [{ id: "variant", thumbnail: "image-url" }],
      updateProductVariants: async () => { throw failure; }, upsertProductVariants: restore }, query });
    await expect(Effect.runPromise(native.run(Result.getOrThrow(batchImageVariantsWorkflow.prepare()),
      { image_id: "image", add: ["new"], remove: ["variant"] }))).rejects.toMatchObject({ reason: "adapterFailure", cause: failure });
    expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled();
  });

  it("admits only the new finite selector and raw-array contract while retaining existing Variant admissions", () => {
    const input = commerceDecoder(ImageVariantsWorkflowInput, "invalidInput"), output = commerceDecoder(ImageVariantsWorkflowOutput, "storedCorruption");
    const duplicate = { image_id: "image", add: ["b", "a", "b", "c"], remove: ["b", "b"] };
    expect(Result.getOrThrow(input(duplicate))).toEqual(duplicate);
    expect(Result.getOrThrow(input({ image_id: "image" }))).toEqual({ image_id: "image" });
    expect(Result.getOrThrow(output({ added: duplicate.add, removed: duplicate.remove }))).toEqual({ added: duplicate.add, removed: duplicate.remove });
    expect(Result.isFailure(input({ image_id: "image", add: ["a", "b", "c", "d", "e"] }))).toBe(true);
    expect(Result.isFailure(output({ added: [], removed: ["a", "b", "c", "d", "e"] }))).toBe(true);
    const selector = commerceDecoder(VariantThumbnailSelector, "invalidInput");
    expect(Result.getOrThrow(selector({ id: "variant" }))).toEqual({ id: "variant" });
    expect(Result.getOrThrow(decodeVariantThumbnailUpdate({ selector: { id: ["a", "a"], thumbnail: "url" }, update: { thumbnail: null } })))
      .toEqual({ selector: { id: ["a", "a"], thumbnail: "url" }, update: { thumbnail: null } });
    for (const value of [{ id: ["a"] }, { id: "a", thumbnail: "url" }, { id: ["a"], thumbnail: null },
      { id: ["a", "b", "c", "d", "e"], thumbnail: "url" }, { id: ["a"], thumbnail: "url", product_id: "p" }])
      expect(Result.isFailure(selector(value))).toBe(true);
    expect(Result.isFailure(commerceDecoder(VariantUpdateSelector, "invalidInput")({ id: ["a"], thumbnail: "url" }))).toBe(true);
    expect(Result.isFailure(commerceDecoder(VariantImagesWorkflowInput, "invalidInput")({ variant_id: "v", add: ["a", "a"] }))).toBe(true);
    expect(Result.isFailure(commerceDecoder(VariantImagesWorkflowInput, "invalidInput")({ variant_id: "v", add: ["a"], remove: ["a"] }))).toBe(true);
  });
});
