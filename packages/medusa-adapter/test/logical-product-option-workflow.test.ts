import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { Link } from "@medusajs/modules-sdk/link";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { productOptionCreationResources, productOptionUpdateResources, productOptionDeletionResources } from "../src/workflow/policy";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductOption } from "./support/logical-product-option-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductOption>>;
let fixtureCleanupCount = 0;
const readRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const Values = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, value: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
const decodeValues = Schema.decodeUnknownSync(Values);
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)
  .orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq);
const deliveries = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)
  .orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId);
const revisions = () => connected.fixture.persistence.drizzle.select().from(fxAppRowRevisions)
  .orderBy(fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq);
const snapshot = async () => ({ rows: await rows(), revisions: await revisions(), events: await events(), commits: await commits(), deliveries: await deliveries() });
const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]; if (value === undefined) throw new Error("Expected an authentic native Option result"); return value;
};
const WorkflowEvent = Schema.Struct({ name: Schema.Literals(["product-option.created", "product-option.updated", "product-option.deleted"]) });
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
function containsCause(value: unknown, expected: Error): boolean {
  if (value === expected) return true;
  if (Cause.isCause(value)) return value.reasons.some(reason => {
    switch (reason._tag) {
      case "Fail": return containsCause(reason.error, expected);
      case "Die": return containsCause(reason.defect, expected);
      case "Interrupt": return false;
    }
  });
  if (value === null || typeof value !== "object") return false;
  const cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return cause !== undefined && containsCause(cause, expected);
}
function observe(trace: string[], count?: { calls: number }): ExecutionDiagnosticPolicy {
  return { observe: (name, work) => Effect.sync(() => {
    if (count !== undefined && name === "BoundedRequest.enter") count.calls++;
  }).pipe(Effect.andThen(work), Effect.tap(value => Effect.sync(() => {
    if (name === "AtomicEvents.retain" && Schema.is(WorkflowEvent)(value)) trace.push(value.name);
  }))) };
}

async function seedGraph(prefix: string, optionCount = 4, valueCount = 4, variantCount = 8) {
  const productId = first(await connected.seedProducts(prefix));
  const options = Array.from({ length: optionCount }, (_, n) => ({ id: prefix + "-option-" + n,
    title: "Option " + n, product_id: productId, values: Array.from({ length: valueCount }, (_, v) => "value-" + v) }));
  await connected.seedOptions(options);
  const variants = Array.from({ length: variantCount }, (_, n) => ({ id: prefix + "-variant-" + n, title: "Variant " + n,
    product_id: productId, manage_inventory: false,
    options: Object.fromEntries(options.map((option, index) => [option.title, "value-" + ((n + (n >= valueCount ? index : 0)) % valueCount)])) }));
  for (let offset = 0; offset < variants.length; offset += 4) await connected.seedVariants(variants.slice(offset, offset + 4));
  return { productId, options, variants };
}

describe("native Product Option workflows on shared logical storage", () => {
  beforeAll(async () => {
    connected = await prepareLogicalProductOption(driver, close => cleanup.push(close)); fixtureCleanupCount = cleanup.length;
  }, 180_000);
  afterEach(async () => {
    vi.restoreAllMocks(); await connected.cleanupProducts();
    while (cleanup.length > fixtureCleanupCount) await cleanup.pop()?.();
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates empty and four complete native Option graphs and exposes pending reads before workflow events", async () => {
    const products = await connected.seedProducts("option-create-maximum", 4), trace: string[] = [], count = { calls: 0 };
    const host = await connected.prepareCreate({ productOptionsCreated: async (input, context) => {
      expect(trace).toEqual([]); expect(input.additional_data).toEqual({ witness: "maximum" }); trace.push("hook");
      if (!input.product_options.length) return;
      const found = await context.resources.query.graph({ entity: "product_option", fields: ["id", "title", "values.id", "values.value"],
        filters: { id: input.product_options.map(row => row.id) }, pagination: { take: 4 } });
      expect(found.data).toHaveLength(4);
      expect(found.data.map(row => row.id).toSorted()).toEqual(input.product_options.map(row => row.id).toSorted());
    } });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductOptions"), beforeEmpty = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { product_options: [], additional_data: { witness: "maximum" } })
      .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))))).toEqual([]);
    expect(trace).toEqual(["hook"]); expect(await rows()).toEqual(beforeEmpty.rows); expect(await events()).toEqual(beforeEmpty.events);
    trace.length = 0;
    const input = products.map((product_id, n) => ({ id: "maximum-option-" + n, title: "Size " + n, product_id,
      values: ["a", "b", "c", "d"], metadata: { nested: { n } } })), before = await snapshot();
    const creation = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { product_options: input, additional_data: { witness: "maximum" } })
      .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count)))));
    if (creation._tag === "Failure") {
      process.stdout.write(JSON.stringify({ optionMaximumCreationFailure: { boundedEntries: count.calls, causes: failurePath(creation.failure) } }) + "\n");
      expect(await snapshot()).toEqual(before); throw creation.failure;
    }
    const created = creation.success;
    expect(created.map(row => row.id)).toEqual(input.map(row => row.id)); expect(native).toHaveBeenCalledTimes(2);
    expect(created.every(row => row.values.length === 4)).toBe(true);
    expect(trace).toEqual(["hook", ...input.map(() => "product-option.created")]);
    const emitted = (await events()).slice(before.events.length);
    expect(emitted.filter(row => row.envelope.contract === "product-option.created").map(row => row.envelope.message))
      .toEqual(created.map(row => expect.objectContaining({ data: { id: row.id } })));
    expect(count.calls).toBeLessThanOrEqual(productOptionCreationResources.calls); expect(count.calls).toBeGreaterThan(0);
    expect(emitted.length).toBeLessThanOrEqual(productOptionCreationResources.eventMessages);
    process.stdout.write(JSON.stringify({ optionMaximumCreation: { boundedEntries: count.calls, events: emitted.length } }) + "\n");
  }, 180_000);

  it("keeps selector first-occurrence order, native preimages, metadata replacement and empty/missing behavior", async () => {
    const product_id = first(await connected.seedProducts("option-select")), create = await connected.prepareCreate();
    await Effect.runPromise(create.run(create.newRequestKey(), { product_options: ["c", "a", "b"].map(id => ({ id: "option-select-" + id,
      title: "Size " + id, product_id, values: ["keep"], metadata: { stale: true } })) }));
    const nativeList = vi.spyOn(ProductModuleService.prototype, "listProductOptions"), trace: string[] = [];
    const host = await connected.prepareUpdate({ productOptionsUpdated: input => {
      expect(trace).toEqual([]); trace.push("hook"); expect(input.product_options.map(row => row.id)).toEqual(["option-select-b", "option-select-a"]);
    } });
    const input = { selector: { id: ["option-select-b", "option-select-a", "option-select-b", "missing"] }, update: { metadata: {} } };
    const changed = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))));
    expect(changed.map(row => row.id)).toEqual(["option-select-b", "option-select-a"]);
    expect(changed.map(row => row.metadata)).toEqual([{}, {}]); expect(changed.every(row => row.values.length === 1)).toBe(true);
    expect(nativeList).toHaveBeenCalledWith(input.selector, { select: ["id"], relations: [], order: { id: "ASC" } }, expect.anything());
    expect(trace).toEqual(["hook", "product-option.updated", "product-option.updated"]);
    const update = await connected.prepareUpdate();
    const before = await snapshot();
    for (const id of [[], ["missing"]]) expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id }, update: {} }))).toEqual([]);
    expect(await rows()).toEqual(before.rows); expect(await events()).toEqual(before.events);
    expect(first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: "option-select-c" }, update: { metadata: null } }))).metadata).toBeNull();
  }, 120_000);

  it("retains matching Value identities and pivots for omitted Values, then physically clears requested Values", async () => {
    const graph = await seedGraph("option-values", 2, 2, 2), ids = graph.options.map(row => row.id);
    const beforeRows = readRows(await Effect.runPromise(connected.listOptions(ids))), original = first(beforeRows);
    const originalValues = decodeValues(original.values), update = await connected.prepareUpdate();
    const products = await Effect.runPromise(connected.listProducts([graph.productId]));
    const variants = readRows(await Effect.runPromise(connected.listVariants(graph.productId)));
    const retained = first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: first(ids) }, update: { metadata: { only: true } } })));
    expect(retained.values.map(value => value.id)).toEqual(originalValues.map(value => value.id));
    expect(await Effect.runPromise(connected.listVariants(graph.productId))).toEqual(variants);
    const same = first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: first(ids) }, update: { values: originalValues.map(value => value.value) } })));
    expect(same.values.map(value => value.id)).toEqual(originalValues.map(value => value.id));
    const tombstones = (await revisions()).filter(row => row.isTombstone).length;
    expect(first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: first(ids) }, update: { values: [] } }))).values).toEqual([]);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones + 4);
    expect(await Effect.runPromise(connected.listProducts([graph.productId]))).toEqual(products);
    const afterVariants = readRows(await Effect.runPromise(connected.listVariants(graph.productId)));
    expect(afterVariants.map(({ options: _options, ...row }) => row)).toEqual(variants.map(({ options: _options, ...row }) => row));
    expect(afterVariants.every(row => Array.isArray(row.options) && row.options.length === 1)).toBe(true);
  }, 180_000);

  it("replaces four Options across four Products and thirty-two distinct Variant endpoints while preserving discriminator links", async () => {
    const graph = await connected.seedMaximumReplacementGraph("option-replace-maximum"), ids = graph.targetIds;
    const targets = readRows(await Effect.runPromise(connected.listOptions(ids)));
    const old = targets.flatMap(row => decodeValues(row.values).map(value => value.id));
    const products = await Effect.runPromise(connected.listProducts(graph.productIds));
    const discriminators = readRows(await Effect.runPromise(connected.listOptions(graph.discriminatorIds)));
    const variants: Array<ReturnType<typeof readRows>[number]> = [];
    for (const id of graph.productIds) variants.push(...readRows(await Effect.runPromise(connected.listVariants(id))));
    expect(new Set(graph.productIds).size).toBe(4); expect(new Set(graph.variantIds).size).toBe(32);
    expect(targets).toHaveLength(4); expect(new Set(targets.map(row => row.product_id))).toEqual(new Set(graph.productIds));
    expect(old).toHaveLength(16); expect(new Set(old).size).toBe(16);
    expect(variants.map(row => row.id).toSorted()).toEqual(graph.variantIds.toSorted());
    expect(new Set(variants.map(row => row.product_id))).toEqual(new Set(graph.productIds));
    const targetPivots = variants.flatMap(row => decodeValues(row.options).filter(value => old.includes(value.id)));
    expect(targetPivots).toHaveLength(32);
    for (const id of old) expect(targetPivots.filter(value => value.id === id)).toHaveLength(2);
    const preservedVariants = variants.map(row => ({ ...row, options: decodeValues(row.options).filter(value => !old.includes(value.id)) }));
    expect(preservedVariants.every(row => row.options.length === 1)).toBe(true);
    const tombstones = (await revisions()).filter(row => row.isTombstone).length, before = await snapshot(), count = { calls: 0 };
    const host = await connected.prepareUpdate(), replacement = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: ids },
      update: { values: ["new-a", "new-b", "new-c", "new-d"] } }).pipe(Effect.provideService(ExecutionDiagnostics, observe([], count)))));
    if (replacement._tag === "Failure") {
      process.stdout.write(JSON.stringify({ optionMaximumReplacementFailure: { boundedEntries: count.calls, causes: failurePath(replacement.failure) } }) + "\n");
      expect(await snapshot()).toEqual(before); throw replacement.failure;
    }
    const changed = replacement.success;
    expect(changed).toHaveLength(4); expect(changed.every(row => row.values.length === 4)).toBe(true);
    expect(changed.flatMap(row => row.values.map(value => value.id)).some(id => old.includes(id))).toBe(false);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones + 48);
    expect(await revisions()).toHaveLength(before.revisions.length + 68);
    expect(await Effect.runPromise(connected.listProducts(graph.productIds))).toEqual(products);
    expect(readRows(await Effect.runPromise(connected.listOptions(graph.discriminatorIds)))).toEqual(discriminators);
    const afterVariants: Array<ReturnType<typeof readRows>[number]> = [];
    for (const id of graph.productIds) afterVariants.push(...readRows(await Effect.runPromise(connected.listVariants(id))));
    expect(afterVariants).toEqual(preservedVariants);
    const emitted = (await events()).slice(before.events.length);
    expect(count.calls).toBeLessThanOrEqual(productOptionUpdateResources.calls); expect(count.calls).toBeGreaterThan(0);
    expect(emitted.length).toBeLessThanOrEqual(productOptionUpdateResources.eventMessages);
    process.stdout.write(JSON.stringify({ optionMaximumReplacement: { products: 4, variants: 32, targetPivots: 32,
      boundedEntries: count.calls, events: emitted.length, removed: 48 } }) + "\n");
  }, 180_000);

  it("keeps duplicate and missing delete requests while authenticating actual cascades and preserving pivots", async () => {
    const graph = await seedGraph("option-soft-delete", 2, 2, 2), id = first(graph.options).id;
    const product = await Effect.runPromise(connected.listProducts([graph.productId]));
    const variants = readRows(await Effect.runPromise(connected.listVariants(graph.productId)));
    const nativeDelete = vi.spyOn(ProductModuleService.prototype, "softDeleteProductOptions"), nativeLink = vi.spyOn(Link.prototype, "delete");
    const trace: string[] = [], count = { calls: 0 }, ids = [id, "missing-option", id];
    const host = await connected.prepareDelete({ productOptionsDeleted: async (input, context) => {
      expect(input.ids).toEqual(ids); expect(trace).toEqual([]); expect(nativeLink).not.toHaveBeenCalled(); trace.push("hook");
      const pending = await context.resources.query.graph({ entity: "product_option", fields: ["id"], filters: { id }, pagination: { take: 1 } });
      expect(pending.data).toEqual([]);
    } });
    const tombstones = (await revisions()).filter(row => row.isTombstone).length, before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }).pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count))))).toBeNull();
    expect(nativeLink).toHaveBeenCalledExactlyOnceWith({ product: { product_option_id: ids } });
    expect(await nativeDelete.mock.results[0]?.value).toEqual({ product_option_id: [id],
      product_option_value_id: decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id], true)))).values).map(value => value.id) });
    expect(trace).toEqual(["hook", ...ids.map(() => "product-option.deleted")]);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones);
    expect(await revisions()).toHaveLength(before.revisions.length + 3);
    expect(await Effect.runPromise(connected.listProducts([graph.productId]))).toEqual(product);
    const afterVariants = readRows(await Effect.runPromise(connected.listVariants(graph.productId)));
    expect(afterVariants.map(({ options: _options, ...row }) => row)).toEqual(variants.map(({ options: _options, ...row }) => row));
    expect(afterVariants.every(row => Array.isArray(row.options) && row.options.length === 1)).toBe(true);
    const emitted = (await events()).slice(before.events.length);
    expect(count.calls).toBeLessThanOrEqual(productOptionDeletionResources.calls);
    process.stdout.write(JSON.stringify({ optionDeletion: { boundedEntries: count.calls, events: emitted.length } }) + "\n");
    nativeLink.mockClear(); const empty = await connected.prepareDelete();
    for (const requested of [[], ["missing"], [id]]) {
      const beforeNoop = await snapshot(); expect(await Effect.runPromise(empty.run(empty.newRequestKey(), { ids: requested }))).toBeNull();
      expect(await rows()).toEqual(beforeNoop.rows);
      expect((await events()).slice(beforeNoop.events.length).map(event => event.envelope.contract)).toEqual(requested.map(() => "product-option.deleted"));
    }
  }, 180_000);

  it("soft-deletes the full four-Option sixteen-Value graph while retaining thirty-two physical pivots", async () => {
    const graph = await seedGraph("option-delete-maximum"), ids = graph.options.map(row => row.id);
    const products = await Effect.runPromise(connected.listProducts([graph.productId]));
    const variants = readRows(await Effect.runPromise(connected.listVariants(graph.productId)));
    const tombstones = (await revisions()).filter(row => row.isTombstone).length, before = await snapshot(), count = { calls: 0 };
    const host = await connected.prepareDelete();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }).pipe(Effect.provideService(ExecutionDiagnostics, observe([], count))))).toBeNull();
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones);
    expect(await revisions()).toHaveLength(before.revisions.length + 20);
    expect(await Effect.runPromise(connected.listOptions(ids))).toEqual([]);
    const deleted = readRows(await Effect.runPromise(connected.listOptions(ids, true)));
    expect(deleted).toHaveLength(4); expect(deleted.every(row => typeof row.deleted_at === "string" && decodeValues(row.values).length === 4)).toBe(true);
    expect(await Effect.runPromise(connected.listProducts([graph.productId]))).toEqual(products);
    const remaining = readRows(await Effect.runPromise(connected.listVariants(graph.productId)));
    expect(remaining.map(({ options: _options, ...row }) => row)).toEqual(variants.map(({ options: _options, ...row }) => row));
    const emitted = (await events()).slice(before.events.length);
    expect(count.calls).toBeLessThanOrEqual(productOptionDeletionResources.calls);
    expect(emitted.length).toBeLessThanOrEqual(productOptionDeletionResources.eventMessages);
    process.stdout.write(JSON.stringify({ optionMaximumDeletion: { boundedEntries: count.calls, events: emitted.length } }) + "\n");
  }, 180_000);

  it("retimestamps already-deleted owned Values on Option soft-delete without removing their pivots", async () => {
    const graph = await seedGraph("option-deleted-child", 2, 2, 2), id = first(graph.options).id;
    const value = first(decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id])))).values));
    await connected.arrangeDeletedValue(value.id);
    const beforeValue = decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id], true)))).values).find(row => row.id === value.id);
    if (beforeValue === undefined) throw new Error("Missing arranged deleted native Value");
    const tombstones = (await revisions()).filter(row => row.isTombstone).length, before = await snapshot(), deletion = await connected.prepareDelete();
    await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: [id] }));
    const afterValue = decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id], true)))).values).find(row => row.id === value.id);
    expect(afterValue?.deleted_at).not.toEqual(beforeValue.deleted_at); expect(typeof afterValue?.deleted_at).toBe("string");
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones);
    expect((await events()).slice(before.events.length).filter(row => row.envelope.contract === connected.product.runtime.metadata.value.updatedEvent))
      .toHaveLength(1);
  }, 180_000);

  it("preserves a deleted Value for omitted Values but replaces its identity and pivots for an explicit matching string", async () => {
    const graph = await seedGraph("option-deleted-replace", 2, 2, 2), id = first(graph.options).id;
    const value = first(decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id])))).values));
    await connected.arrangeDeletedValue(value.id);
    const update = await connected.prepareUpdate(), tombstones = (await revisions()).filter(row => row.isTombstone).length;
    const deletedBefore = decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id], true)))).values).find(row => row.id === value.id);
    await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id }, update: { metadata: { only: true } } }));
    expect(decodeValues(first(readRows(await Effect.runPromise(connected.listOptions([id], true)))).values).find(row => row.id === value.id)).toEqual(deletedBefore);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones);
    const changed = first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id }, update: { values: ["value-0", "value-1"] } })));
    expect(changed.values.some(row => row.id === value.id)).toBe(false); expect(changed.values).toHaveLength(2);
    expect((await revisions()).filter(row => row.isTombstone)).toHaveLength(tombstones + 2);
  }, 180_000);

  it("refuses a fifth selected root and five old Values with no committed prefix", async () => {
    const product_id = first(await connected.seedProducts("option-bounds")), host = await connected.prepareUpdate();
    for (const offset of [0, 4]) await connected.seedOptions(Array.from({ length: offset === 0 ? 4 : 1 }, (_, n) => ({
      id: "option-bounds-" + (offset + n), title: "Size " + (offset + n), product_id, values: [] })));
    const before = await snapshot();
    const fifth = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { product_id }, update: { metadata: { mustNotApply: true } } })));
    expect(fifth._tag).toBe("Failure"); if (fifth._tag === "Failure") expect(failurePath(fifth.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    const creation = await connected.prepareCreate(), deletion = await connected.prepareDelete();
    for (const work of [
      creation.run(creation.newRequestKey(), { product_options: Array.from({ length: 5 }, (_, n) => ({ title: "Rejected " + n, product_id, values: [] })) }).pipe(Effect.asVoid),
      host.run(host.newRequestKey(), { selector: { id: ["a", "b", "c", "d", "e"] }, update: {} }).pipe(Effect.asVoid),
      host.run(host.newRequestKey(), { selector: { id: "option-bounds-0" }, update: { values: ["a", "b", "c", "d", "e"] } }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: ["a", "b", "c", "d", "e"] }).pipe(Effect.asVoid),
    ]) { expect((await Effect.runPromise(Effect.result(work)))._tag).toBe("Failure"); expect(await snapshot()).toEqual(before); }
    await connected.seedOptions([{ id: "option-five-values", title: "Five Values", product_id, values: ["a", "b", "c", "d", "e"] }]);
    const beforeValues = await snapshot();
    for (const work of [host.run(host.newRequestKey(), { selector: { id: "option-five-values" }, update: {} }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: ["option-five-values"] }).pipe(Effect.asVoid)]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile"); expect(await snapshot()).toEqual(beforeValues);
    }
  }, 180_000);

  it("bounds only pivots actually removed and refuses a third removed-Value pivot with full rollback", async () => {
    const product_id = first(await connected.seedProducts("option-pivot-bounds"));
    await connected.seedOptions([{ id: "option-pivot-target", title: "Target", product_id, values: ["gone", "keep"] },
      { id: "option-pivot-other", title: "Other", product_id, values: ["x", "y", "z"] }]);
    await connected.seedVariants(["x", "y", "z"].map((value, n) => ({ id: "option-pivot-variant-" + n,
      title: "Variant " + n, product_id, manage_inventory: false, options: { Target: "gone", Other: value } })));
    const update = await connected.prepareUpdate(), before = await snapshot();
    const result = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: { id: "option-pivot-target" }, update: { values: ["keep"] } })));
    expect(result._tag).toBe("Failure"); if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    // All three pivots of retained "gone" are outside removal admission.
    const retained = await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: "option-pivot-target" }, update: { values: ["gone"] } }));
    expect(first(retained).values.map(row => row.value)).toEqual(["gone"]);
    expect(readRows(await Effect.runPromise(connected.listVariants(product_id))).every(row => Array.isArray(row.options) && row.options.length === 2)).toBe(true);
  }, 180_000);

  it("rolls back native create, update and deletion when hooks fail before workflow events", async () => {
    const product_id = first(await connected.seedProducts("option-hook-failure")), seed = await connected.prepareCreate();
    const option = first(await Effect.runPromise(seed.run(seed.newRequestKey(), { product_options: [{ title: "Seed", product_id, values: ["a"] }] })));
    const trace: string[] = [], hookFailure = new Error("option hook failure"); let escaped: (() => Promise<unknown>) | undefined;
    const create = await connected.prepareCreate({ productOptionsCreated: (_input, context) => {
      expect(trace).toEqual([]); trace.push("hook");
      escaped = () => context.resources.product.createProductOptions([{ title: "Escaped", product_id, values: [] }]);
      throw hookFailure;
    } });
    const update = await connected.prepareUpdate({ productOptionsUpdated: () => {
      expect(trace).toEqual([]); trace.push("hook"); throw hookFailure;
    } });
    const nativeLink = vi.spyOn(Link.prototype, "delete"), deletion = await connected.prepareDelete({ productOptionsDeleted: () => {
      expect(trace).toEqual([]); expect(nativeLink).not.toHaveBeenCalled(); trace.push("hook"); throw hookFailure;
    } });
    for (const work of [create.run(create.newRequestKey(), { product_options: [{ title: "Failed", product_id, values: [] }] }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: option.id }, update: { values: [] } }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: [option.id] }).pipe(Effect.asVoid)]) {
      trace.length = 0; const before = await snapshot();
      const result = await Effect.runPromise(Effect.result(work.pipe(Effect.provideService(ExecutionDiagnostics, observe(trace)))));
      expect(result._tag).toBe("Failure"); if (result._tag === "Failure") expect(containsCause(result.failure, hookFailure)).toBe(true);
      expect(trace).toEqual(["hook"]); expect(await snapshot()).toEqual(before);
    }
    if (escaped === undefined) throw new Error("Creation hook did not capture an escaped callback");
    await escaped().then(() => { throw new Error("Escaped Option callback retained authority"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
  }, 180_000);

  it("refuses a hook's extra native Option write even with correctly grouped additional workflow events", async () => {
    const product_id = first(await connected.seedProducts("option-extra-hook")); let written = 0;
    const host = await connected.prepareCreate({ productOptionsCreated: async (_input, context) => {
      const extra = await context.resources.product.createProductOptions([{ title: "Extra", product_id, values: [] }]); written = extra.length;
      await context.resources.event_bus.emit(extra.map(option => ({ name: "product-option.created", data: { id: option.id },
        metadata: { eventGroupId: context.eventGroupId } })));
    } });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(),
      { product_options: [{ title: "Outer", product_id, values: [] }] })));
    expect(written).toBe(1); expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile"); expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("retains caught forbidden-resource refusal and revokes an escaped pending read", async () => {
    const product_id = first(await connected.seedProducts("option-caught-hook"));
    let caught: string[] = [], escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareCreate({ productOptionsCreated: (_input, context) => {
      escaped = () => context.resources.query.graph({ entity: "product_option", fields: ["id"], pagination: { take: 1 } });
      try { context.container.resolve("transactionManager"); } catch (cause) { caught = failurePath(cause); }
    } });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(),
      { product_options: [{ title: "Caught", product_id, values: [] }] })));
    expect(caught).toContain("unsupportedProfile"); expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile"); expect(await snapshot()).toEqual(before);
    if (escaped === undefined) throw new Error("Native Option hook was not reached");
    await escaped().then(() => { throw new Error("Escaped Option read retained authority"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("recovers the actual committed Option graph after its acknowledgement is lost", async () => {
    const product_id = first(await connected.seedProducts("option-uncertain")), fixture = connected.fixture;
    let lose = true, hooks = 0, committedAtAck: Awaited<ReturnType<typeof snapshot>> | undefined;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value); lose = false;
        return Effect.tryPromise({ try: snapshot, catch: cause => new RelationalSessionError({ reason: "resourceFailure", cause }) }).pipe(
          Effect.flatMap(observed => { committedAtAck = observed;
            return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost native Option COMMIT acknowledgement") }));
          }));
      }),
    ));
    const host = await connected.prepareCreate({ productOptionsCreated: () => { hooks++; } },
      { ...connected.execution, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductOptions"), key = host.newRequestKey();
    const input = { product_options: [{ title: "Acknowledged", product_id, values: ["one"] }] }, before = await snapshot();
    const result = await Effect.runPromise(host.run(key, input));
    if (committedAtAck === undefined) throw new Error("The actual Option COMMIT did not reach ACK-loss boundary");
    expect(lose).toBe(false); expect(committedAtAck.commits).toHaveLength(before.commits.length + 1);
    expect(result).toMatchObject([{ title: "Acknowledged", product_id, values: [{ value: "one" }] }]);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(hooks).toBe(1); expect(native).toHaveBeenCalledTimes(1);
    expect(await snapshot()).toEqual(committedAtAck);
  }, 120_000);

  it("replays all three roots once and binds the original input and prepared revision", async () => {
    const product_id = first(await connected.seedProducts("option-replay")); let creates = 0, updates = 0, deletes = 0;
    const create = await connected.prepareCreate({ productOptionsCreated: () => { creates++; } });
    const changed = await connected.prepareCreate({}, connected.execution, "c".repeat(64));
    const key = create.newRequestKey(), input = { product_options: [{ title: "Replay", product_id, values: ["one"] }], additional_data: { once: true } };
    const created = await Effect.runPromise(create.run(key, input)), afterCreate = await snapshot();
    expect(await Effect.runPromise(create.run(key, input))).toEqual(created); expect(creates).toBe(1); expect(await snapshot()).toEqual(afterCreate);
    for (const work of [create.run(key, { ...input, additional_data: { once: false } }), changed.run(key, input)]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("requestConflict"); expect(await snapshot()).toEqual(afterCreate);
    }
    const option = first(created), update = await connected.prepareUpdate({ productOptionsUpdated: () => { updates++; } });
    const updateKey = update.newRequestKey(), patch = { selector: { id: option.id }, update: { title: "Changed" } };
    const updated = await Effect.runPromise(update.run(updateKey, patch)), afterUpdate = await snapshot();
    expect(await Effect.runPromise(update.run(updateKey, patch))).toEqual(updated); expect(updates).toBe(1); expect(await snapshot()).toEqual(afterUpdate);
    const deletion = await connected.prepareDelete({ productOptionsDeleted: () => { deletes++; } });
    const deleteKey = deletion.newRequestKey(), deleted = { ids: [option.id, option.id] };
    expect(await Effect.runPromise(deletion.run(deleteKey, deleted))).toBeNull(); const afterDelete = await snapshot();
    expect(await Effect.runPromise(deletion.run(deleteKey, deleted))).toBeNull(); expect(deletes).toBe(1); expect(await snapshot()).toEqual(afterDelete);
  }, 180_000);

  it("cancels pending native creation before workflow events and denies late hook work", async () => {
    const product_id = first(await connected.seedProducts("option-cancellation"));
    const reached = await Effect.runPromise(Deferred.make<void>()), finished = await Effect.runPromise(Deferred.make<void>()), trace: string[] = [];
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const host = await connected.prepareCreate({ productOptionsCreated: async (_input, context) => {
      expect(trace).toEqual([]); trace.push("hook");
      escaped = () => context.resources.product.createProductOptions([{ title: "Late", product_id, values: [] }]);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined));
    } });
    try {
      const before = await snapshot(), interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { product_options: [{ title: "Cancelled", product_id, values: [] }] })
          .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      })));
      expect(interrupted._tag).toBe("Failure"); if (interrupted._tag === "Failure") expect(failurePath(interrupted.cause)).toContain("Interrupt");
      expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native creation hook did not reach cancellation boundary");
      await escaped().then(() => { throw new Error("Cancelled Option hook retained authority"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); }
  }, 120_000);

  it("confines matching Option/Product identities and request keys to each shop", async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: connected.fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_option_workflow_shop_b", projectId: "project_option_workflow_shop_b", uuidOffset: 110_000 } });
    const other = await prepareLogicalProductOption(driver, close => cleanup.push(close), fixture);
    const product_id = first(await connected.seedProducts("option-scope")); expect(await other.seedProducts("option-scope")).toEqual([product_id]);
    const create = await connected.prepareCreate(), otherCreate = await other.prepareCreate(), key = create.newRequestKey();
    const input = { product_options: [{ id: "option-shared", title: "Shared", product_id, values: ["one"] }] };
    const left = first(await Effect.runPromise(create.run(key, input))), right = first(await Effect.runPromise(otherCreate.run(key, input)));
    expect(left.id).toBe(right.id);
    const update = await connected.prepareUpdate();
    await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: left.id }, update: { metadata: { scope: "left" } } }));
    expect(readRows(await Effect.runPromise(connected.listOptions([left.id])))).toMatchObject([{ metadata: { scope: "left" } }]);
    expect(readRows(await Effect.runPromise(other.listOptions([right.id])))).toMatchObject([{ metadata: null }]);
    expect(await Effect.runPromise(create.run(key, input))).toEqual([left]); expect(await Effect.runPromise(otherCreate.run(key, input))).toEqual([right]);
    const deletion = await connected.prepareDelete(); await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: [left.id] }));
    expect(await Effect.runPromise(connected.listOptions([left.id]))).toEqual([]);
    expect(readRows(await Effect.runPromise(other.listOptions([right.id])))).toMatchObject([{ id: right.id }]);
  }, 180_000);

  it.skipIf(driver !== "postgres")("settles one competing default-OCC Option root after both hooks enter (PostgreSQL only)", async () => {
    const product_id = first(await connected.seedProducts("option-concurrent")), create = await connected.prepareCreate();
    const option = first(await Effect.runPromise(create.run(create.newRequestKey(), { product_options: [{ title: "Competing", product_id, values: [] }] })));
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>()), observed: string[] = [];
    const host = await connected.prepareUpdate({ productOptionsUpdated: async input => {
      observed.push(first(input.product_options).title); if (observed.length === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
    } });
    try {
      const before = await snapshot(), selector = { id: option.id };
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const left = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector, update: { title: "Left" } })));
        const right = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector, update: { title: "Right" } })));
        yield* Deferred.await(reached).pipe(Effect.timeout(15_000)); expect(new Set(observed)).toEqual(new Set(["Left", "Right"]));
        yield* Deferred.succeed(release, undefined); return [yield* Fiber.join(left), yield* Fiber.join(right)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1); expect(results.filter(result => result._tag === "Failure")).toHaveLength(1);
      for (const result of results) if (result._tag === "Failure" && !failurePath(result.cause).includes("writeConflict"))
        throw new Error("Competing Option root failed outside the actual OCC boundary", { cause: result.cause });
      const winner = results.find(result => result._tag === "Success");
      if (winner === undefined || winner._tag !== "Success") throw new Error("Missing successful Option root");
      expect(readRows(await Effect.runPromise(connected.listOptions([option.id])))).toEqual(winner.value);
      const after = await snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(emitted).toHaveLength(2);
      expect(after.deliveries).toHaveLength(before.deliveries.length + 2);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 180_000);
});
