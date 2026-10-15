import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { batchImageVariantsWorkflow } from "@medusajs/core-flows/product/batch-image-variants";
import { ProductModuleService } from "@medusajs/product/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, getAtomicCommerceCommand, type AtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../src/workflow/host";
import { productImageVariantResources } from "../src/workflow/policy";
import { variantImagesWorkflowEvents } from "../src/workflows/product/variant-images";
import { ImageVariantsWorkflowInput } from "../src/modules/product/variant-workflow-input";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { withWorkflowPolicy } from "./support/workflow-policy-fixture";
import { prepareLogicalImageVariants } from "./support/logical-image-variants-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalImageVariants>>, fixtureCleanupCount = 0;
const readRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]; if (value === undefined) throw new Error("Expected a genuine Image-Variant fixture identity"); return value;
};
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)
  .orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const revisions = () => connected.fixture.persistence.drizzle.select().from(fxAppRowRevisions)
  .orderBy(fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq);
const deliveries = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)
  .orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId);
const snapshot = async () => ({ rows: await rows(), revisions: await revisions(), events: await events(), commits: await commits(), deliveries: await deliveries() });
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return failurePath(reason.error);
      case "Die": return failurePath(reason.defect);
      case "Interrupt": return [reason._tag];
    }
  });
  if (value === null || typeof value !== "object") return [];
  const reason: unknown = Object.getOwnPropertyDescriptor(value, "reason")?.value;
  const cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : failurePath(cause))];
}
const unchangedVariant = (row: typeof Schema.JsonObject.Type) => {
  const { thumbnail: _thumbnail, updated_at: _updated, ...retained } = row; return retained;
};
async function refuse(work: Effect.Effect<unknown, unknown>, expected: string) {
  const before = await snapshot(), outcome = await Effect.runPromise(Effect.result(work));
  expect(outcome._tag).toBe("Failure");
  if (outcome._tag === "Failure") expect(failurePath(outcome.failure)).toContain(expected);
  expect(await snapshot()).toEqual(before);
}

/** Forward the authentic native root and commands while arranging one legal
 * parallel interleaving. Gate BEFORE ctx.call enters the FIFO operation owner. */
async function addBeforeRemoveExecution(trace: string[]): Promise<AtomicWorkflowExecution> {
  const completed = await Effect.runPromise(Deferred.make<void>());
  return { ...connected.execution, prepare: composition => Effect.gen(function* () {
    const original = composition.commands[0], definition = original === undefined ? undefined : getAtomicCommerceCommand(original);
    if (original === undefined || definition === undefined || composition.commands.length !== 1)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const forwarded = defineAtomicCommerceCommand("imageVariantAddBeforeRemoveFixture", (context, value) => definition.run({ ...context,
      call: (participant, command, args) => {
        if (command === connected.product.runtime.commands.removeImageFromVariantForImageWorkflow)
          return Deferred.await(completed).pipe(Effect.andThen(Effect.sync(() => { trace.push("remove-enter"); })),
            Effect.andThen(context.call(participant, command, args)));
        return context.call(participant, command, args).pipe(Effect.tap(() =>
          command === connected.product.runtime.commands.addImageToVariantForImageWorkflow
            ? Effect.sync(() => { trace.push("added"); }).pipe(Effect.andThen(Deferred.succeed(completed, undefined))) : Effect.void));
      },
    }, value));
    const host = yield* makeAtomicCommerceHost({ ...connected.fixture.hostInput, ...composition, commands: [forwarded] });
    const forwardingHost: AtomicCommerceHost = { ...host, run: (key, command, value) => host.run(key, command === original ? forwarded : command, value) };
    return forwardingHost;
  }) };
}

describe("native Image-to-Variants workflow on shared logical storage", () => {
  beforeAll(async () => { connected = await prepareLogicalImageVariants(driver, close => cleanup.push(close)); fixtureCleanupCount = cleanup.length; }, 180_000);
  afterEach(async () => {
    vi.restoreAllMocks(); const failures: unknown[] = [];
    try { await connected.cleanupProducts(); } catch (cause) { failures.push(cause); }
    while (cleanup.length > fixtureCleanupCount) {
      const close = cleanup.pop(); if (close !== undefined) try { await close(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Image-Variant test cleanup failed");
  }, 180_000);
  afterAll(async () => {
    vi.restoreAllMocks(); const failures: unknown[] = [];
    for (const close of cleanup.reverse()) try { await close(); } catch (cause) { failures.push(cause); }
    cleanup.length = 0;
    if (failures.length > 0) throw new AggregateError(failures, "Image-Variant fixture cleanup failed");
  }, 180_000);

  it("authenticates the named module and keeps empty native inputs independent of endpoint existence", async () => {
    await expect(connected.prepare(connected.execution, connected.options.revision, connected.product.runtime.workflow))
      .rejects.toMatchObject({ reason: "unsupportedProfile" });
    const host = await connected.prepare(), before = await snapshot();
    for (const input of [{ image_id: "missing" }, { image_id: "missing", add: [], remove: [] }])
      expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual({ added: [], removed: [] });
    expect(await rows()).toEqual(before.rows); expect(await events()).toEqual(before.events);
    await refuse(host.run(host.newRequestKey(), { image_id: "missing", add: ["a", "b", "c", "d", "e"] }), "invalidInput");
  });

  it("preserves duplicate and existing additions, raw ordering and native add/remove intersections", async () => {
    const graph = await connected.seed("image-raw"), selectedDeletes: string[][] = [];
    const module = withWorkflowPolicy(connected.product.runtime.productImageVariantWorkflow, policy => ({ ...policy,
      validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(Effect.tap(() => Effect.sync(() => {
        if (args[0].commandName === "productImageWorkflowDeleteAssignment") selectedDeletes.push(args[1].mutations.map(mutation => {
          const id = mutation.before?.id; if (typeof id !== "string") throw new Error("Missing native assignment delete preimage identity"); return id;
        }));
      }))) }));
    const host = await connected.prepare(connected.execution, connected.options.revision, module), [a, b] = graph.variantIds;
    if (a === undefined || b === undefined) throw new Error("Missing raw-array fixture Variants");
    const add = [b, a, b], nativeAdd = vi.spyOn(ProductModuleService.prototype, "addImageToVariant");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, add }))).toEqual({ added: add, removed: [] });
    expect(nativeAdd).toHaveBeenCalledWith(add.map(variant_id => ({ image_id: graph.imageId, variant_id })), expect.anything());
    expect(readRows(await Effect.runPromise(connected.listAssignments())).map(row => row.variant_id).toSorted()).toEqual([...add].toSorted());
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [b] }))).toEqual({ added: [b], removed: [] });
    expect(readRows(await Effect.runPromise(connected.listAssignments())).filter(row => row.variant_id === b)).toHaveLength(3);
    const beforeIntersection = readRows(await Effect.runPromise(connected.listAssignments()));
    const beforeEvents = await events(), remove = [b, b, "missing"];
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [b], remove })))
      .toEqual({ added: [b], removed: remove });
    const afterIntersection = readRows(await Effect.runPromise(connected.listAssignments()));
    const oldB = beforeIntersection.filter(row => row.variant_id === b), retainedB = afterIntersection.filter(row => row.variant_id === b);
    const addition = nativeAdd.mock.results.at(-1); if (addition === undefined || addition.type !== "return") throw new Error("Native intersection addition did not return");
    const added = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(await addition.value);
    const addedId = first(added).id;
    expect(added).toHaveLength(1); expect(oldB).toHaveLength(3); expect(retainedB.length).toBeLessThanOrEqual(1);
    expect(oldB.every(row => afterIntersection.every(retained => retained.id !== row.id))).toBe(true);
    expect(afterIntersection.filter(row => row.variant_id === a)).toEqual(beforeIntersection.filter(row => row.variant_id === a));
    expect(retainedB.every(row => row.id === addedId)).toBe(true);
    expect(afterIntersection.every(row => row.variant_id === a || row.variant_id === b && row.id === addedId)).toBe(true);
    expect(selectedDeletes).toHaveLength(1);
    expect(new Set(first(selectedDeletes))).toEqual(new Set([...oldB.map(row => row.id), ...(retainedB.length === 0 ? [addedId] : [])]));
    expect(await events()).toEqual(beforeEvents);
  }, 180_000);

  it("executes native query dependencies and clears only URL-matching thumbnails in selector order", async () => {
    const graph = await connected.seed("image-selector"), host = await connected.prepare();
    const [a, b, c] = graph.variantIds; if (a === undefined || b === undefined || c === undefined) throw new Error("Missing selector Variants");
    await connected.assign(graph.imageId, [a, b, c]);
    const list = vi.spyOn(ProductModuleService.prototype, "listProductVariants"), update = vi.spyOn(ProductModuleService.prototype, "updateProductVariants");
    const input = { image_id: graph.imageId, remove: [c, b, "missing", a] }, before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual({ added: [], removed: input.remove });
    const selector = { id: input.remove, thumbnail: "image-url" };
    expect(list).toHaveBeenCalledWith(selector, { select: ["thumbnail"], relations: [] }, expect.anything());
    expect(update).toHaveBeenCalledWith(selector, { thumbnail: null }, expect.anything());
    expect(readRows(await Effect.runPromise(connected.listVariants([a, b, c])))).toMatchObject([
      { id: a, thumbnail: null }, { id: b, thumbnail: "other-url" }, { id: c, thumbnail: null }]);
    expect(await Effect.runPromise(connected.listAssignments())).toEqual([]);
    const emitted = (await events()).slice(before.events.length);
    expect(emitted.map(row => row.envelope.contract)).toEqual([connected.product.runtime.metadata.variant.updatedEvent, connected.product.runtime.metadata.variant.updatedEvent]);
    expect(emitted.map(row => row.envelope.message)).toEqual([
      expect.objectContaining({ data: { id: c } }), expect.objectContaining({ data: { id: a } }),
    ]);
    expect(emitted.every(row => row.envelope.internal)).toBe(true);
  }, 180_000);

  it("keeps no-match native list/update calls and missing Image removal query behavior", async () => {
    const graph = await connected.seed("image-no-match"), host = await connected.prepare();
    const update = vi.spyOn(ProductModuleService.prototype, "updateProductVariants"), before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, remove: ["missing", "missing"] })))
      .toEqual({ added: [], removed: ["missing", "missing"] });
    expect(update).toHaveBeenCalledWith({ id: ["missing", "missing"], thumbnail: "image-url" }, { thumbnail: null }, expect.anything());
    update.mockClear();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: "missing-image", remove: [first(graph.variantIds)] })))
      .toEqual({ added: [], removed: [first(graph.variantIds)] });
    expect(update).not.toHaveBeenCalled(); expect(await rows()).toEqual(before.rows); expect(await events()).toEqual(before.events);
  }, 120_000);

  it("removes assignments for an empty Image URL without clearing Variant thumbnails", async () => {
    const graph = await connected.seed("image-empty-url", { imageUrl: "" }), host = await connected.prepare(), id = first(graph.variantIds);
    await connected.assign(graph.imageId, [id]); const before = await snapshot();
    const update = vi.spyOn(ProductModuleService.prototype, "updateProductVariants");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, remove: [id] })))
      .toEqual({ added: [], removed: [id] });
    expect(update).not.toHaveBeenCalled(); expect(await Effect.runPromise(connected.listAssignments())).toEqual([]);
    expect(readRows(await Effect.runPromise(connected.listVariants([id])))).toMatchObject([{ id, thumbnail: "image-url" }]);
    expect(await events()).toEqual(before.events);
  }, 120_000);

  it("allows same-scope cross-Product endpoints and retains both checked endpoint foreign keys", async () => {
    const graph = await connected.seed("image-endpoints", { parents: 2 }), host = await connected.prepare(), foreign = graph.variantIds.at(-1);
    if (foreign === undefined) throw new Error("Missing cross-Product Variant");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [foreign] })))
      .toEqual({ added: [foreign], removed: [] });
    expect(readRows(await Effect.runPromise(connected.listAssignments()))).toMatchObject([{ image_id: graph.imageId, variant_id: foreign }]);
    await refuse(host.run(host.newRequestKey(), { image_id: "missing-image", add: [foreign] }), "invalidInput");
    await refuse(host.run(host.newRequestKey(), { image_id: graph.imageId, add: ["missing-variant"] }), "invalidInput");
  }, 120_000);

  it("retains the native deleted-Image no-op removal and preserves existing assignment identities", async () => {
    const graph = await connected.seed("image-deleted"), host = await connected.prepare(), id = first(graph.variantIds);
    await connected.assign(graph.imageId, [id]); await connected.arrangeDeleted("image", graph.imageId);
    const before = await snapshot(), assignments = await Effect.runPromise(connected.listAssignments());
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, remove: [id] })))
      .toEqual({ added: [], removed: [id] });
    expect(await Effect.runPromise(connected.listAssignments())).toEqual(assignments);
    expect(await rows()).toEqual(before.rows); expect(await events()).toEqual(before.events);
  }, 120_000);

  it("retains deleted-Variant assignments while invoking the active Image URL's native no-match update", async () => {
    const graph = await connected.seed("variant-deleted-image-removal"), host = await connected.prepare(), id = first(graph.variantIds);
    await connected.assign(graph.imageId, [id]); await connected.arrangeDeleted("variant", id);
    const before = await snapshot(), assignments = await Effect.runPromise(connected.listAssignments());
    const list = vi.spyOn(ProductModuleService.prototype, "listProductVariants"), update = vi.spyOn(ProductModuleService.prototype, "updateProductVariants"),
      restore = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, remove: [id] })))
      .toEqual({ added: [], removed: [id] });
    const selector = { id: [id], thumbnail: "image-url" };
    expect(list).toHaveBeenCalledWith(selector, { select: ["thumbnail"], relations: [] }, expect.anything());
    expect(update).toHaveBeenCalledWith(selector, { thumbnail: null }, expect.anything());
    expect(restore).not.toHaveBeenCalled();
    expect(await Effect.runPromise(connected.listAssignments())).toEqual(assignments);
    expect(await rows()).toEqual(before.rows); expect(await revisions()).toEqual(before.revisions); expect(await events()).toEqual(before.events);
  }, 120_000);

  it("preserves old and newly added assignments when the same pair is removed through a deleted Image", async () => {
    const graph = await connected.seed("image-deleted-intersection"), host = await connected.prepare(), id = first(graph.variantIds);
    await connected.assign(graph.imageId, [id]); await connected.arrangeDeleted("image", graph.imageId);
    const before = await snapshot(), assignments = readRows(await Effect.runPromise(connected.listAssignments()));
    const variant = await Effect.runPromise(connected.listVariants([id]));
    const add = vi.spyOn(ProductModuleService.prototype, "addImageToVariant"), remove = vi.spyOn(ProductModuleService.prototype, "removeImageFromVariant"),
      update = vi.spyOn(ProductModuleService.prototype, "updateProductVariants"), restore = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [id], remove: [id] })))
      .toEqual({ added: [id], removed: [id] });
    expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    const retained = readRows(await Effect.runPromise(connected.listAssignments()));
    expect(retained).toHaveLength(2); expect(retained).toEqual(expect.arrayContaining([...assignments]));
    expect(new Set(retained.map(row => row.id)).size).toBe(2);
    expect(retained.every(row => row.image_id === graph.imageId && row.variant_id === id)).toBe(true);
    expect(await Effect.runPromise(connected.listVariants([id]))).toEqual(variant);
    expect(await rows()).toHaveLength(before.rows.length + 1); expect(await revisions()).toHaveLength(before.revisions.length + 1);
    expect(await events()).toEqual(before.events);
  }, 120_000);

  for (const parents of [1, 4]) it("preserves the complete maximum " + parents + "-Product sixteen-sibling preparation graph", async () => {
    const graph = await connected.seed("image-maximum-" + parents, { parents, siblings: 16, options: 4 });
    const independent = await connected.seedAdditionEndpoints("image-maximum-" + parents);
    const removals = parents === 1 ? graph.variantIds.filter((_id, index) => index % 2 === 0).slice(0, 4)
      : [first(graph.variantIds), ...graph.variantIds.slice(-3)];
    const additions = independent.variantIds;
    await connected.assign(graph.imageId, [...removals, ...removals]);
    const allVariants = [...graph.variantIds, ...independent.variantIds], allProducts = [...graph.productIds, ...independent.productIds];
    const variants = readRows(await Effect.runPromise(connected.listVariants(allVariants))), options = await Effect.runPromise(connected.listOptions(graph.optionIds));
    const products = await Effect.runPromise(connected.listProducts(allProducts)), host = await connected.prepare(), before = await snapshot();
    expect(new Set(graph.productIds).size).toBe(parents); expect(new Set(graph.variantIds).size).toBe(16);
    expect(new Set(allVariants).size).toBe(20); expect(new Set(allProducts).size).toBe(parents + 4);
    expect(additions.every(id => !graph.variantIds.includes(id))).toBe(true);
    const pivotCount = variants.reduce((count, row) => count + (Array.isArray(row.options) ? row.options.length : 0), 0);
    expect(pivotCount).toBe(parents === 1 ? 64 : 52); expect(readRows(options)).toHaveLength(4);
    let calls = 0;
    const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { image_id: graph.imageId, add: additions, remove: removals })
      .pipe(Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => {
        if (name === "BoundedRequest.enter") calls++;
      }).pipe(Effect.andThen(work)) }))));
    if (outcome._tag === "Failure") {
      process.stdout.write(JSON.stringify({ imageMaximumFailure: { parents, siblings: 16, pivots: pivotCount, boundedEntries: calls, causes: failurePath(outcome.failure) } }) + "\n");
      expect(await snapshot()).toEqual(before); throw outcome.failure;
    }
    expect(outcome.success).toEqual({ added: additions, removed: removals });
    expect(await Effect.runPromise(connected.listProducts(allProducts))).toEqual(products);
    expect(await Effect.runPromise(connected.listOptions(graph.optionIds))).toEqual(options);
    const after = readRows(await Effect.runPromise(connected.listVariants(allVariants)));
    expect(after.map(unchangedVariant)).toEqual(variants.map(unchangedVariant));
    expect(after.filter(row => additions.includes(String(row.id)))).toEqual(variants.filter(row => additions.includes(String(row.id))));
    expect(after.filter(row => removals.includes(String(row.id))).every(row => row.thumbnail === null)).toBe(true);
    expect(readRows(await Effect.runPromise(connected.listAssignments())).map(row => row.variant_id).toSorted()).toEqual(additions.toSorted());
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(before.revisions.filter(row => row.isTombstone).length + 8);
    expect(await revisions()).toHaveLength(before.revisions.length + 16);
    const emitted = (await events()).slice(before.events.length); expect(emitted).toHaveLength(4);
    process.stdout.write(JSON.stringify({ imageMaximum: { parents, additionParents: 4, siblings: 16, additionVariants: 4, options: 4, values: 16, pivots: pivotCount,
      removedAssignments: 8, boundedEntries: calls, events: emitted.length } }) + "\n");
  }, 240_000);

  for (const bound of ["siblings", "options", "values", "pivots", "assignments", "intersection"] as const)
    it("refuses the complete over-bound " + bound + " cohort and rolls back earlier assignment changes", async () => {
      const graph = await connected.seed("image-over-" + bound, {
        siblings: bound === "siblings" ? 17 : 4,
        options: ["siblings", "options", "pivots"].includes(bound) ? 4 : 1, values: bound === "values" ? 5 : 4 });
      const removal = first(graph.variantIds), addition = graph.variantIds[1]; if (addition === undefined) throw new Error("Missing over-bound addition");
      if (bound === "options") {
        await connected.seedOptions([{ id: "image-over-options-fifth", title: "Fifth", product_id: first(graph.productIds), values: ["extra"] }]);
        expect(readRows(await Effect.runPromise(connected.listOptions([...graph.optionIds, "image-over-options-fifth"])))).toHaveLength(5);
        expect(readRows(await Effect.runPromise(connected.listVariants([removal])))).toMatchObject([{ options: expect.any(Array) }]);
        expect(first(readRows(await Effect.runPromise(connected.listVariants([removal])))).options).toHaveLength(4);
      }
      if (bound === "pivots") {
        const options = readRows(await Effect.runPromise(connected.listOptions(graph.optionIds)));
        const values = Schema.decodeUnknownSync(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, value: Schema.String }),
          [Schema.Record(Schema.String, Schema.Json)])))(first(options).values);
        const extra = values.find(value => value.value === "value-1"); if (extra === undefined) throw new Error("Missing genuine extra Value");
        await connected.arrangeExtraValuePivot(removal, extra.id);
        expect(first(readRows(await Effect.runPromise(connected.listVariants([removal])))).options).toHaveLength(5);
      }
      if (bound === "assignments" || bound === "intersection")
        await connected.assign(graph.imageId, Array.from({ length: bound === "intersection" ? 8 : 9 }, () => removal));
      else await connected.assign(graph.imageId, [removal]);
      const trace: string[] = [];
      const execution = bound === "intersection" ? await addBeforeRemoveExecution(trace) : connected.execution;
      const host = await connected.prepare(execution);
      await refuse(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [bound === "intersection" ? removal : addition], remove: [removal] }), "unsupportedProfile");
      if (bound === "intersection") expect(trace).toEqual(["added", "remove-enter"]);
    }, 240_000);

  it("rolls back a late result refusal without invoking genuine inverse compensators", async () => {
    const graph = await connected.seed("image-late-refusal"), oldId = first(graph.variantIds), newId = graph.variantIds[1];
    if (newId === undefined) throw new Error("Missing late-refusal Variant");
    await connected.assign(graph.imageId, [oldId]);
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: connected.product.runtime.productImageVariantWorkflow,
      methods: ["addImageToVariant", "removeImageFromVariant", "listProductVariants", "updateProductVariants"], graph: true } }, true));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...connected.options, requestCallLimit: productImageVariantResources.calls,
      modules: { product: { ...connected.options.modules.product, logicalResources: productImageVariantResources } }, operationScheduling: "queued",
      workflow: { name: "imageVariantsInvalidOutput", resources, prepared: Result.getOrThrow(batchImageVariantsWorkflow.prepare()),
        input: ImageVariantsWorkflowInput, output: Schema.Null, events: variantImagesWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(host.close));
    const add = vi.spyOn(ProductModuleService.prototype, "addImageToVariant"), remove = vi.spyOn(ProductModuleService.prototype, "removeImageFromVariant"),
      restore = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants");
    await refuse(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [newId], remove: [oldId] }), "storedCorruption");
    expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled();
  }, 120_000);

  it("retains caught resource refusal and revokes an escaped native callback after rollback", async () => {
    const graph = await connected.seed("image-sticky"), resources = Result.getOrThrow(prepareWorkflowResources({ product: {
      module: connected.product.runtime.productImageVariantWorkflow, methods: ["addImageToVariant"], graph: true } }, false));
    let escaped: (() => Promise<unknown>) | undefined, caught: string[] = [];
    const call = createStep("image-variants-caught-refusal", resources.callback(async (_: unknown, context) => {
      await context.resources.product.addImageToVariant([{ image_id: graph.imageId, variant_id: first(graph.variantIds) }]);
      escaped = () => context.resources.product.addImageToVariant([{ image_id: graph.imageId, variant_id: first(graph.variantIds) }]);
      try { context.container.resolve("transactionManager"); } catch (cause) { caught = failurePath(cause); }
      return null;
    }));
    const flow = createWorkflow("imageVariantsCaughtRefusal", () => new WorkflowResponse(call(undefined)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution, modules: connected.options.modules,
      revision: connected.options.revision, workflow: { name: "imageVariantsCaughtRefusal", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null } }));
    cleanup.push(() => Effect.runPromise(host.close));
    await refuse(host.run(host.newRequestKey(), null), "unsupportedProfile"); expect(caught).toContain("unsupportedProfile");
    if (escaped === undefined) throw new Error("Native pending assignment callback was not reached");
    await escaped().then(() => { throw new Error("Escaped assignment retained authority"); }, cause => expect(failurePath(cause)).toContain("closed"));
  }, 120_000);

  it("cancels actual pending assignment writes and preserves all durable state", async () => {
    const graph = await connected.seed("image-cancel"), reached = await Effect.runPromise(Deferred.make<void>());
    const module = withWorkflowPolicy(connected.product.runtime.productImageVariantWorkflow, policy => ({ ...policy,
      validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(Effect.andThen(args[1].mutations.length > 0
        ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)) : Effect.void)) }));
    const host = await connected.prepare(connected.execution, connected.options.revision, module), before = await snapshot();
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { image_id: graph.imageId, add: [first(graph.variantIds)] }));
      yield* Deferred.await(reached).pipe(Effect.timeout(15_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
    })));
    expect(outcome._tag).toBe("Failure"); if (outcome._tag === "Failure") expect(failurePath(outcome.cause)).toContain("Interrupt");
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("replays once, binds input and revision, and recovers a lost COMMIT acknowledgement", async () => {
    const graph = await connected.seed("image-replay"), fixture = connected.fixture; let lose = true, validations = 0;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "Lost native inverse image COMMIT acknowledgement" })); }),
    ));
    const module = withWorkflowPolicy(connected.product.runtime.productImageVariantWorkflow, policy => ({ ...policy,
      validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(Effect.tap(() => Effect.sync(() => { validations++; }))) }));
    const host = await connected.prepare({ ...connected.execution, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) },
      connected.options.revision, module), key = host.newRequestKey(), input = { image_id: graph.imageId, add: [first(graph.variantIds)] };
    const before = await snapshot(), output = await Effect.runPromise(host.run(key, input)), after = await snapshot(), count = validations;
    expect(lose).toBe(false); expect(output).toEqual({ added: input.add, removed: [] }); expect(count).toBeGreaterThan(0);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(validations).toBe(count); expect(await snapshot()).toEqual(after);
    await refuse(host.run(key, { image_id: graph.imageId, remove: input.add }), "requestConflict");
    const changed = await connected.prepare(connected.execution, "c".repeat(64)); await refuse(changed.run(key, input), "requestConflict");
  }, 120_000);

  it("confines matching endpoints and request keys to independent shop scopes", async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: connected.fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_image_workflow_shop_b", projectId: "project_image_workflow_shop_b", uuidOffset: 120_000 } });
    const other = await prepareLogicalImageVariants(driver, close => cleanup.push(close), fixture);
    const left = await connected.seed("image-scope"), right = await other.seed("image-scope"), host = await connected.prepare(), otherHost = await other.prepare();
    expect(left).toEqual(right); const key = host.newRequestKey(), input = { image_id: left.imageId, add: [first(left.variantIds)] };
    expect(await Effect.runPromise(host.run(key, input))).toEqual({ added: input.add, removed: [] });
    expect(await Effect.runPromise(other.listAssignments())).toEqual([]);
    expect(await Effect.runPromise(otherHost.run(key, input))).toEqual({ added: input.add, removed: [] });
    expect(readRows(await Effect.runPromise(connected.listAssignments()))).toHaveLength(1);
    expect(readRows(await Effect.runPromise(other.listAssignments()))).toHaveLength(1);
    await Effect.runPromise(host.run(host.newRequestKey(), { image_id: left.imageId, remove: input.add }));
    expect(await Effect.runPromise(connected.listAssignments())).toEqual([]);
    expect(readRows(await Effect.runPromise(other.listAssignments()))).toHaveLength(1);
  }, 180_000);

  it.skipIf(driver !== "postgres")("settles one default-OCC root after both native thumbnail updates enter (PostgreSQL only)", async () => {
    const graph = await connected.seed("image-occ"), id = first(graph.variantIds); await connected.assign(graph.imageId, [id]);
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>()); let entered = 0;
    const module = withWorkflowPolicy(connected.product.runtime.productImageVariantWorkflow, policy => ({ ...policy,
      validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(Effect.andThen(
        args[0].commandName === "productImageWorkflowUpdateVariantsBySelector" ? Effect.gen(function* () {
          entered++; if (entered === 2) yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
        }) : Effect.void)) }));
    const host = await connected.prepare(connected.execution, connected.options.revision, module), before = await snapshot();
    try {
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const input = { image_id: graph.imageId, remove: [id] };
        const left = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), input)));
        const right = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), input)));
        yield* Deferred.await(reached).pipe(Effect.timeout(20_000)); expect(entered).toBe(2); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(left), yield* Fiber.join(right)];
      })));
      expect(outcomes.filter(value => value._tag === "Success")).toHaveLength(1);
      expect(outcomes.filter(value => value._tag === "Failure")).toHaveLength(1);
      for (const value of outcomes) if (value._tag === "Failure") expect(failurePath(value.cause)).toContain("writeConflict");
      expect(await commits()).toHaveLength(before.commits.length + 1); expect(await Effect.runPromise(connected.listAssignments())).toEqual([]);
      expect(readRows(await Effect.runPromise(connected.listVariants([id])))).toMatchObject([{ id, thumbnail: null }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 180_000);
});
