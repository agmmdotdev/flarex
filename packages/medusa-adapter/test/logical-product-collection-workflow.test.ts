import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { Link } from "@medusajs/modules-sdk/link";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { productCollectionResources, productCollectionUpdateResources } from "../src/workflow/policy";
import { prepareProductCollectionCreationWorkflow, prepareProductCollectionDeletionWorkflow } from "../src/workflows/product/collection-workflows";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductCollection } from "./support/logical-product-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductCollection>>;
let fixtureCleanupCount = 0;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)
  .orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq);
const deliveries = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)
  .orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId);
const snapshot = async () => ({ rows: await rows(), events: await events(), commits: await commits(), deliveries: await deliveries() });
const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]; if (value === undefined) throw new Error("Expected a native Collection result"); return value;
};
const last = <Value>(values: readonly Value[]): Value => {
  const value = values[values.length - 1]; if (value === undefined) throw new Error("Expected a final native Collection result"); return value;
};
const memberIds = (value: unknown) => Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  products: Schema.Array(Schema.Struct({ id: Schema.String })) }))(value).products.map(product => product.id);
const productReferences = (value: unknown) => new Map(Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  id: Schema.String, collection_id: Schema.NullOr(Schema.String),
})))(value).map(product => [product.id, product.collection_id]));
const WorkflowEvent = Schema.Struct({ name: Schema.Literals(["product-collection.created", "product-collection.updated", "product-collection.deleted"]) });

function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return failurePath(reason.error);
      case "Die": return failurePath(reason.defect);
      case "Interrupt": return [reason._tag];
    }
  });
  if (value === null || typeof value !== "object") return [];
  const reason = Object.getOwnPropertyDescriptor(value, "reason")?.value;
  const cause = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : failurePath(cause))];
}

function observe(trace: string[], count?: { calls: number }): ExecutionDiagnosticPolicy {
  return { observe: (name, work) => Effect.sync(() => {
    if (count !== undefined && name === "BoundedRequest.enter") count.calls++;
  }).pipe(Effect.andThen(work), Effect.tap(value => Effect.sync(() => {
    // Observe successful real capture, including the queued root's prepaid
    // path. The diagnostic does not emit, validate or settle any event.
    if (name === "AtomicEvents.retain" && Schema.is(WorkflowEvent)(value)) trace.push(value.name);
  }))) };
}

async function atStage<Value>(stage: string, work: () => Promise<Value>): Promise<Value> {
  try { return await work(); }
  catch (cause) { throw new Error("Collection " + stage + " failed: " + failurePath(cause).join(">"), { cause }); }
}

async function remove(ids: readonly string[]) {
  const host = await connected.prepareDelete();
  for (let offset = 0; offset < ids.length; offset += 4)
    await Effect.runPromise(host.run(host.newRequestKey(), { ids: ids.slice(offset, offset + 4) }));
}

describe("native Product Collection workflows on shared logical storage", () => {
  beforeAll(async () => {
    connected = await prepareLogicalProductCollection(driver, close => cleanup.push(close));
    fixtureCleanupCount = cleanup.length;
  }, 180_000);
  afterEach(async () => {
    // Keep the shared database and base readers, but release each test's real
    // prepared hosts before the next case borrows the fixture's finite capacity.
    while (cleanup.length > fixtureCleanupCount) await cleanup.pop()?.();
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates empty and four-Collection graphs with native handles, disjoint references and events captured before hooks", async () => {
    const products = await atStage("maximum creation Product seed", () => connected.seedProducts("collection-create-max"));
    const trace: string[] = [], seen: string[][] = [], count = { calls: 0 };
    const host = await connected.prepareCreate({ collectionsCreated: async (input, context) => {
      expect(input.additional_data).toEqual({ witness: "maximum" });
      expect(trace).toEqual(input.collections.map(() => "product-collection.created"));
      trace.push("hook"); seen.push(input.collections.map(collection => collection.id));
      if (input.collections.length === 0) return;
      const graph = await context.resources.query.graph({ entity: "product_collection", fields: ["id", "title", "products.id"],
        filters: { id: input.collections.map(collection => collection.id) }, pagination: { take: 4 } });
      expect(graph.data).toHaveLength(4);
      expect(graph.data).toEqual(expect.arrayContaining(input.collections.map((collection, index) => ({
        id: collection.id, title: collection.title, products: [{ id: products[index] }],
      }))));
    } });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductCollections");
    try {
      const beforeEmpty = await snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { collections: [], additional_data: { witness: "maximum" } })
        .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))))).toEqual([]);
      expect(trace).toEqual(["hook"]); expect(seen).toEqual([[]]); expect(native).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(beforeEmpty.rows); expect(await events()).toEqual(beforeEmpty.events);
      trace.length = 0;
      const collections = [0, 1, 2, 3].map(index => ({ title: "Collection maximum " + index,
        ...(index === 1 ? { handle: "" } : index === 3 ? { handle: "collection-explicit-handle" } : {}),
        product_ids: [products[index]!], metadata: { nested: { index, enabled: true }, payload: "x".repeat(1024) } }));
      const before = await snapshot();
      const created = await atStage("maximum creation root", () => Effect.runPromise(host.run(host.newRequestKey(), {
        collections, additional_data: { witness: "maximum" },
      }).pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count)))));
      expect(created).toHaveLength(4); expect(new Set(created.map(collection => collection.id)).size).toBe(4);
      expect(created.map(collection => collection.title)).toEqual(collections.map(collection => collection.title));
      expect(created.map(collection => collection.handle)).toEqual(["collection-maximum-0", "collection-maximum-1", "collection-maximum-2", "collection-explicit-handle"]);
      expect(created.map(collection => collection.metadata)).toEqual(collections.map(collection => collection.metadata));
      expect(seen).toEqual([[], created.map(collection => collection.id)]); expect(native).toHaveBeenCalledTimes(2);
      expect(productReferences(await Effect.runPromise(connected.listProducts(products))))
        .toEqual(new Map(created.map((collection, index) => [products[index], collection.id])));
      const emitted = (await events()).slice(before.events.length);
      expect(emitted).toHaveLength(12);
      expect(emitted.filter(event => event.envelope.contract === "product-collection.created").map(event => event.envelope.message))
        .toEqual(created.map(collection => expect.objectContaining({ data: { id: collection.id } })));
      expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.product.updatedEvent).map(event => event.envelope.message))
        .toEqual(expect.arrayContaining(products.map(id => expect.objectContaining({ data: { id } }))));
      expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.collection.createdEvent)).toHaveLength(4);
      expect((await commits()).length - before.commits.length).toBe(1);
      expect(count.calls).toBeGreaterThan(0); expect(count.calls).toBeLessThanOrEqual(productCollectionResources.calls);
      expect(emitted.length).toBeLessThanOrEqual(productCollectionResources.eventMessages);
      console.info("Collection four-entry creation", { calls: count.calls, events: emitted.length });
      await remove(created.map(collection => collection.id));
    } finally { native.mockRestore(); }
  }, 120_000);

  it("uses ID, title, handle, empty and missing selectors with native metadata and stable handles", async () => {
    const create = await connected.prepareCreate(), trace: string[] = [];
    const collections = await Effect.runPromise(create.run(create.newRequestKey(), { collections: [
      { title: "Collection metadata", metadata: { keep: "yes", drop: "old", nested: { left: 1, right: 2 } } },
      { title: "Collection second", handle: "collection-second-explicit" },
    ] }));
    const selected = first(collections), selector = { id: selected.id };
    const update = await connected.prepareUpdate({ collectionsUpdated: input => {
      expect(trace).toEqual(input.collections.map(() => "product-collection.updated")); trace.push("hook");
    } });
    const patch = async (selection: Parameters<typeof update.run>[1]["selector"], data: Parameters<typeof update.run>[1]["update"]) => {
      trace.length = 0;
      return Effect.runPromise(update.run(update.newRequestKey(), { selector: selection, update: data })
        .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))));
    };
    const changed = await patch(selector, { title: "Collection renamed", metadata: { drop: "", nested: { left: 3 } } });
    expect(first(changed)).toMatchObject({ id: selected.id, title: "Collection renamed", handle: selected.handle });
    expect(first(changed).metadata).toEqual({ keep: "yes", nested: { left: 3 } });
    expect(first(await patch({ title: "Collection renamed" }, {})).metadata).toEqual({ keep: "yes", nested: { left: 3 } });
    expect(first(await patch({ handle: selected.handle }, { metadata: {} })).metadata).toEqual({});
    expect(first(await patch(selector, { metadata: null })).metadata).toBeNull();
    expect(await patch({ id: collections.map(collection => collection.id) }, { metadata: { all: true } })).toHaveLength(2);
    expect(await patch({}, {})).toHaveLength(2);
    const beforeMissing = await snapshot();
    expect(await patch({ id: "pcol-workflow-missing" }, { title: "Missing" })).toEqual([]);
    expect(await rows()).toEqual(beforeMissing.rows); expect(await events()).toEqual(beforeMissing.events);
    const beforeConflict = await snapshot();
    for (const work of [update.run(update.newRequestKey(), { selector, update: { handle: "collection-second-explicit" } }).pipe(Effect.asVoid),
      create.run(create.newRequestKey(), { collections: [{ title: "Must roll back" }, { title: "Conflict", handle: "collection-second-explicit" }] }).pipe(Effect.asVoid)]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("invalidInput");
      expect(await snapshot()).toEqual(beforeConflict);
    }
    await remove(collections.map(collection => collection.id));
  }, 120_000);

  it("refuses a complete fifth Collection and oversized root inputs before publishing a prefix", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate(), deletion = await connected.prepareDelete();
    const collections = [...await Effect.runPromise(create.run(create.newRequestKey(), { collections: [0, 1, 2, 3].map(index => ({ title: "Collection five " + index })) })),
      ...await Effect.runPromise(create.run(create.newRequestKey(), { collections: [{ title: "Collection five 4" }] }))];
    const before = await snapshot();
    const complete = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: {}, update: { metadata: { wrong: true } } })));
    expect(complete._tag).toBe("Failure"); if (complete._tag === "Failure") expect(failurePath(complete.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    for (const work of [create.run(create.newRequestKey(), { collections: [0, 1, 2, 3, 4].map(index => ({ title: "Overflow " + index })) }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: collections.map(collection => collection.id) }, update: {} }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: collections.map(collection => collection.id) }).pipe(Effect.asVoid)]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("invalidInput");
      expect(await snapshot()).toEqual(before);
    }
    await remove(collections.map(collection => collection.id));
  }, 120_000);

  it("distinguishes requested membership stubs from actual moved, omitted and cleared Product references", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate();
    const collections = await Effect.runPromise(create.run(create.newRequestKey(), { collections: [{ title: "Membership target" }, { title: "Membership source" }] }));
    const target = first(collections), source = last(collections);
    const old = await connected.seedProducts("collection-membership-old", target.id);
    const moved = first(await connected.seedProducts("collection-membership-moved", source.id, 1));
    const neutral = first(await connected.seedProducts("collection-membership-neutral", undefined, 1));
    const desired = [moved, neutral, "prod-collection-membership-missing"], before = await snapshot();
    const result = await atStage("membership update native preimage and root", () => Effect.runPromise(update.run(update.newRequestKey(), {
      selector: { id: target.id }, update: { product_ids: desired },
    })));
    expect(first(result).products).toEqual(desired.map(id => ({ id })));
    expect(new Set(memberIds(await Effect.runPromise(connected.collectionMembers(target.id))))).toEqual(new Set([moved, neutral]));
    expect(memberIds(await Effect.runPromise(connected.collectionMembers(source.id)))).toEqual([]);
    expect(productReferences(await Effect.runPromise(connected.listProducts([...old, moved, neutral]))))
      .toEqual(new Map<string, string | null>([...old.map(id => [id, null] as const), [moved, target.id], [neutral, target.id]]));
    const emitted = (await events()).slice(before.events.length);
    expect(emitted).toHaveLength(8);
    expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.product.updatedEvent).map(event => event.envelope.message))
      .toEqual(expect.arrayContaining([...old, moved, neutral].map(id => expect.objectContaining({ data: { id } }))));
    const omitted = await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: target.id }, update: { title: "Membership retained" } }));
    expect(first(omitted).products).toEqual([]);
    expect(new Set(memberIds(await Effect.runPromise(connected.collectionMembers(target.id))))).toEqual(new Set([moved, neutral]));
    expect(first(await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: target.id }, update: { product_ids: [] } }))).products).toEqual([]);
    expect(memberIds(await Effect.runPromise(connected.collectionMembers(target.id)))).toEqual([]);
    const beforeMissing = await snapshot();
    const missing = await Effect.runPromise(Effect.result(create.run(create.newRequestKey(), { collections: [
      { title: "Missing create reference", product_ids: ["prod-collection-membership-missing"] },
    ] })));
    expect(missing._tag).toBe("Failure"); if (missing._tag === "Failure") expect(failurePath(missing.failure)).toContain("adapterFailure");
    expect(await snapshot()).toEqual(beforeMissing);
    const repeated = await Effect.runPromise(Effect.result(create.run(create.newRequestKey(), { collections: [
      { title: "Repeated create reference A", product_ids: [neutral] }, { title: "Repeated create reference B", product_ids: [neutral] },
    ] })));
    expect(repeated._tag).toBe("Failure"); if (repeated._tag === "Failure") expect(failurePath(repeated.failure)).toContain("invalidInput");
    expect(await snapshot()).toEqual(beforeMissing); await remove(collections.map(collection => collection.id));
  }, 120_000);

  it("replaces four prior member cohorts with four desired Products through the real native selector order", async () => {
    const create = await connected.prepareCreate();
    const collections = await Effect.runPromise(create.run(create.newRequestKey(), { collections: [0, 1, 2, 3].map(index => ({ title: "Collection group maximum " + index })) }));
    const prior: string[] = [];
    for (const [index, collection] of collections.entries()) prior.push(...await atStage("four-root prior members " + index,
      () => connected.seedProducts("collection-group-prior-" + index, collection.id)));
    const desired = await atStage("four-root desired members", () => connected.seedProducts("collection-group-desired"));
    const selectorIds = collections.map(collection => collection.id).sort().reverse();
    expect(selectorIds).not.toEqual([...selectorIds].sort());
    const trace: string[] = [], count = { calls: 0 };
    const update = await connected.prepareUpdate({ collectionsUpdated: async (input, context) => {
      expect(trace).toEqual(input.collections.map(() => "product-collection.updated")); trace.push("hook");
      const selected = await context.resources.product.listProductCollections({ id: selectorIds }, { select: ["id"], relations: [] });
      expect(input.collections.map(collection => collection.id)).toEqual(selected.map(collection => collection.id));
      const graph = await context.resources.query.graph({ entity: "product_collection", fields: ["id", "products.id"],
        filters: { id: input.collections.map(collection => collection.id) }, pagination: { take: 4 } });
      expect(graph.data).toHaveLength(4);
    } });
    const before = await snapshot();
    const result = await atStage("four-root membership replacement", async () => {
      try {
        return await Effect.runPromise(update.run(update.newRequestKey(), {
          selector: { id: selectorIds }, update: { product_ids: desired, metadata: { nested: { maximum: true } } },
        }).pipe(Effect.provideService(ExecutionDiagnostics, observe(trace, count))));
      } catch (cause) {
        expect(await snapshot()).toEqual(before);
        console.info("Collection maximum refusal rolled back rows, commits, events and deliveries", { calls: count.calls });
        throw cause;
      }
    });
    expect(result).toHaveLength(4); expect(result.map(collection => collection.products)).toEqual(result.map(() => desired.map(id => ({ id }))));
    const winner = last(result).id;
    expect(productReferences(await Effect.runPromise(connected.listProducts([...prior, ...desired]))))
      .toEqual(new Map<string, string | null>([...prior.map(id => [id, null] as const), ...desired.map(id => [id, winner] as const)]));
    for (const collection of result) expect(new Set(memberIds(await Effect.runPromise(connected.collectionMembers(collection.id)))))
      .toEqual(new Set(collection.id === winner ? desired : []));
    const emitted = (await events()).slice(before.events.length);
    expect(emitted).toHaveLength(28);
    expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.collection.updatedEvent)).toHaveLength(4);
    expect(emitted.filter(event => event.envelope.contract === "product-collection.updated").map(event => event.envelope.message))
      .toEqual(result.map(collection => expect.objectContaining({ data: { id: collection.id } })));
    expect(emitted.filter(event => event.envelope.contract === connected.product.runtime.metadata.product.updatedEvent).map(event => event.envelope.message))
      .toEqual(expect.arrayContaining([...prior, ...desired].map(id => expect.objectContaining({ data: { id } }))));
    expect((await commits()).length - before.commits.length).toBe(1);
    expect(count.calls).toBeGreaterThan(0); expect(count.calls).toBeLessThanOrEqual(productCollectionUpdateResources.calls);
    console.info("Collection four-root membership maximum", { calls: count.calls, events: emitted.length, prior: prior.length, desired: desired.length });
    await remove(collections.map(collection => collection.id));
  }, 180_000);

  it("refuses a complete fifth prior member and oversized desired membership without partial writes", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate();
    const collection = first(await Effect.runPromise(create.run(create.newRequestKey(), { collections: [{ title: "Collection prior five" }] })));
    const prior = [...await connected.seedProducts("collection-prior-five-a", collection.id), ...await connected.seedProducts("collection-prior-five-b", collection.id, 1)];
    expect(memberIds(await Effect.runPromise(connected.collectionMembers(collection.id)))).toHaveLength(5);
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: { id: collection.id }, update: { product_ids: [] } })));
    expect(result._tag).toBe("Failure"); if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    const invalid = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: { id: collection.id }, update: { product_ids: prior } })));
    expect(invalid._tag).toBe("Failure"); if (invalid._tag === "Failure") expect(failurePath(invalid.failure)).toContain("invalidInput");
    expect(await snapshot()).toEqual(before); await remove([collection.id]);
  }, 120_000);

  it("preserves references under native soft deletion, requested event IDs and handle reuse, unlike physical deletion", async () => {
    const create = await connected.prepareCreate();
    const collections = await Effect.runPromise(create.run(create.newRequestKey(), { collections: [{ title: "Collection referenced" }, { title: "Collection also deleted" }] }));
    const collection = first(collections), other = last(collections), products = await connected.seedProducts("collection-reference", collection.id);
    const productsBefore = await Effect.runPromise(connected.listProducts(products));
    expect(productReferences(productsBefore)).toEqual(new Map(products.map(id => [id, collection.id])));
    const requested = [collection.id, collection.id, "pcol-deletion-missing", other.id], trace: string[] = [];
    const deletion = await connected.prepareDelete({ collectionsDeleted: async (input, context) => {
      expect(input.ids).toEqual(requested); expect(trace.filter(entry => entry === "product-collection.deleted")).toHaveLength(4);
      expect(trace).toContain("native-link-completed"); trace.push("hook");
      expect(await context.resources.query.graph({ entity: "product_collection", fields: ["id"],
        filters: { id: [collection.id, other.id] }, pagination: { take: 4 } })).toMatchObject({ data: [] });
    } });
    const original = Link.prototype.delete;
    const native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args); trace.push("native-link-completed"); return result;
    });
    try {
      const before = await snapshot();
      expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: requested })
        .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))))).toBeNull();
      expect(native).toHaveBeenCalledExactlyOnceWith({ product: { product_collection_id: requested } });
      expect(await native.mock.results[0]?.value).toEqual([null, {}]); expect(trace[trace.length - 1]).toBe("hook");
      expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
      const emitted = (await events()).slice(before.events.length), moduleName = connected.product.runtime.metadata.collection.deletedEvent;
      expect(emitted.map(event => event.envelope.contract)).toEqual([moduleName, moduleName, ...requested.map(() => "product-collection.deleted")]);
      expect(emitted.filter(event => event.envelope.contract === moduleName).map(event => event.envelope.message))
        .toEqual(expect.arrayContaining([collection.id, other.id].map(id => expect.objectContaining({ data: { id } }))));
      expect(emitted.filter(event => event.envelope.contract === "product-collection.deleted").map(event => event.envelope.message))
        .toEqual(requested.map(id => expect.objectContaining({ data: { id } })));
      expect((await commits()).length - before.commits.length).toBe(1);
      const plainDelete = await connected.prepareDelete(), repeatedEvents = await events();
      expect(await Effect.runPromise(plainDelete.run(plainDelete.newRequestKey(), { ids: requested }))).toBeNull();
      expect((await events()).slice(repeatedEvents.length).map(event => event.envelope.contract)).toEqual(requested.map(() => "product-collection.deleted"));
      const emptyEvents = await events();
      expect(await Effect.runPromise(plainDelete.run(plainDelete.newRequestKey(), { ids: [] }))).toBeNull();
      expect(native).toHaveBeenLastCalledWith({ product: { product_collection_id: [] } }); expect(await events()).toEqual(emptyEvents);
      expect(await Effect.runPromise(connected.listCollections([collection.id, other.id]))).toEqual([]);
      expect(await Effect.runPromise(connected.listCollections([collection.id, other.id], true)))
        .toEqual(expect.arrayContaining([collection.id, other.id].map(id => expect.objectContaining({ id, deleted_at: expect.any(String) }))));
      const reused = first(await Effect.runPromise(create.run(create.newRequestKey(), { collections: [{ title: "Reused Collection handle", handle: collection.handle }] })));
      expect(reused.id).not.toBe(collection.id); expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
      const physical = first(await Effect.runPromise(create.run(create.newRequestKey(), { collections: [{ title: "Physical Collection contrast" }] })));
      const physicalProducts = await connected.seedProducts("collection-physical-reference", physical.id);
      expect(productReferences(await Effect.runPromise(connected.listProducts(physicalProducts))))
        .toEqual(new Map(physicalProducts.map(id => [id, physical.id])));
      await connected.physicallyDelete([physical.id]);
      expect(productReferences(await Effect.runPromise(connected.listProducts(physicalProducts))))
        .toEqual(new Map(physicalProducts.map(id => [id, null])));
      expect(await Effect.runPromise(connected.listProducts(products))).toEqual(productsBefore);
      await remove([reused.id]);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("refuses forged Collection module and Link tokens before native mutation", async () => {
    const native = vi.spyOn(ProductModuleService.prototype, "createProductCollections"), before = await snapshot();
    try {
      const forgedModule = { ...connected.options, modules: { product: { ...connected.options.modules.product,
        module: structuredClone(connected.options.modules.product.module) } } };
      const results = [prepareProductCollectionCreationWorkflow(forgedModule).pipe(Effect.asVoid),
        prepareProductCollectionDeletionWorkflow({ ...connected.options, link: structuredClone(connected.link) }).pipe(Effect.asVoid)];
      for (const work of results) {
        const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
      }
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back each native mutation and already captured workflow events when a hook fails", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const trace: string[] = [], seed = await connected.prepareCreate();
    const collection = first(await Effect.runPromise(seed.run(seed.newRequestKey(), { collections: [{ title: "Collection hook seed" }] })));
    const create = await connected.prepareCreate({ collectionsCreated: async (input, context) => {
      expect(input.collections).toHaveLength(1); expect(trace).toEqual(["product-collection.created"]); trace.push("hook");
      escaped = () => context.resources.product.createProductCollections([{ title: "Escaped Collection" }]);
      throw new Error("Collection create hook rejected after captured workflow event");
    } });
    const update = await connected.prepareUpdate({ collectionsUpdated: input => {
      expect(input.collections).toMatchObject([{ id: collection.id, title: "Collection hook changed" }]);
      expect(trace).toEqual(["product-collection.updated"]); trace.push("hook");
      throw new Error("Collection update hook rejected after captured workflow event");
    } });
    const deletion = await connected.prepareDelete({ collectionsDeleted: async (input, context) => {
      expect(input.ids).toEqual([collection.id]); expect(trace).toEqual(["product-collection.deleted"]); trace.push("hook");
      expect(await context.resources.query.graph({ entity: "product_collection", fields: ["id"],
        filters: { id: [collection.id] }, pagination: { take: 1 } })).toMatchObject({ data: [] });
      throw new Error("Collection delete hook rejected after captured workflow event");
    } });
    for (const work of [create.run(create.newRequestKey(), { collections: [{ title: "Collection hook created" }] }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: collection.id }, update: { title: "Collection hook changed" } }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: [collection.id] }).pipe(Effect.asVoid)]) {
      trace.length = 0; const before = await snapshot();
      const result = await Effect.runPromise(Effect.result(work.pipe(Effect.provideService(ExecutionDiagnostics, observe(trace)))));
      expect(result._tag).toBe("Failure"); if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("adapterFailure");
      expect(trace[trace.length - 1]).toBe("hook"); expect(await snapshot()).toEqual(before);
    }
    if (escaped === undefined) throw new Error("The actual Collection creation hook was not reached");
    const beforeLate = await snapshot();
    await escaped().then(() => { throw new Error("Escaped Collection creation unexpectedly succeeded"); }, cause => {
      expect(failurePath(cause)).toContain("closed");
    });
    expect(await snapshot()).toEqual(beforeLate); await remove([collection.id]);
  }, 120_000);

  it("refuses a hook's extra native Collection write despite correctly grouped additional events", async () => {
    let written = 0;
    const host = await connected.prepareCreate({ collectionsCreated: async (_input, context) => {
      const extra = await context.resources.product.createProductCollections([{ title: "Extra hook Collection" }]); written = extra.length;
      await context.resources.event_bus.emit(extra.map(collection => ({ name: "product-collection.created", data: { id: collection.id },
        metadata: { eventGroupId: context.eventGroupId } })));
    } });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { collections: [{ title: "Parent hook Collection" }] })));
    expect(written).toBe(1); expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("retains a caught forbidden-resource refusal after native work and revokes escaped reads", async () => {
    let caught: string[] = [], escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareCreate({ collectionsCreated: (input, context) => {
      expect(input.collections).toHaveLength(1);
      escaped = () => context.resources.query.graph({ entity: "product_collection", fields: ["id"], pagination: { take: 1 } });
      try { context.container.resolve("transactionManager"); }
      catch (cause) { caught = failurePath(cause); }
    } });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { collections: [{ title: "Caught Collection refusal" }] })));
    expect(caught).toContain("unsupportedProfile"); expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    if (escaped === undefined) throw new Error("Native Collection hook was not reached before the refusal");
    await escaped().then(() => { throw new Error("Escaped Collection read unexpectedly succeeded"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("recovers complete Collection DTOs after the real committed transaction loses its acknowledgement", async () => {
    const fixture = connected.fixture;
    let lose = true, failures = 0, hooks = 0, committedAtAck: Awaited<ReturnType<typeof snapshot>> | undefined, hookOutput: unknown;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value); lose = false;
        return Effect.tryPromise({ try: snapshot, catch: cause => new RelationalSessionError({ reason: "resourceFailure", cause }) })
          .pipe(Effect.flatMap(observed => {
            committedAtAck = observed; failures++;
            return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost native Collection COMMIT acknowledgement") }));
          }));
      }),
    ));
    const host = await connected.prepareCreate({ collectionsCreated: input => { hooks++; hookOutput = structuredClone(input.collections); } },
      { ...connected.execution, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductCollections");
    try {
      const key = host.newRequestKey(), input = { collections: [{ title: "Collection uncertain ack", metadata: { nested: { retained: true } } }] }, before = await snapshot();
      const result = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(failures).toBe(1);
      if (committedAtAck === undefined) throw new Error("Actual Collection COMMIT was not observed before ACK loss");
      expect(committedAtAck.commits.length - before.commits.length).toBe(1); expect(committedAtAck.rows.length - before.rows.length).toBe(1);
      const emitted = committedAtAck.events.slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([connected.product.runtime.metadata.collection.createdEvent, "product-collection.created"]);
      expect(committedAtAck.deliveries.length - before.deliveries.length).toBe(2);
      expect(result).toEqual(hookOutput); expect(result).toMatchObject([{ id: expect.any(String), title: input.collections[0]?.title,
        handle: "collection-uncertain-ack", metadata: input.collections[0]?.metadata, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null }]);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(native).toHaveBeenCalledTimes(1); expect(hooks).toBe(1);
      expect(await snapshot()).toEqual(committedAtAck); await remove(result.map(collection => collection.id));
    } finally { native.mockRestore(); }
  }, 120_000);

  it("replays all three Collection roots once and binds input and revision", async () => {
    let creates = 0, updates = 0, deletes = 0;
    const create = await connected.prepareCreate({ collectionsCreated: () => { creates++; } });
    const changed = await connected.prepareCreate({}, connected.execution, "c".repeat(64));
    const key = create.newRequestKey(), input = { collections: [{ title: "Collection replay" }], additional_data: { once: true } };
    const created = await Effect.runPromise(create.run(key, input)), afterCreate = await snapshot();
    expect(await Effect.runPromise(create.run(key, input))).toEqual(created); expect(creates).toBe(1); expect(await snapshot()).toEqual(afterCreate);
    for (const work of [create.run(key, { ...input, additional_data: { once: false } }), changed.run(key, input)]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("requestConflict");
      expect(await snapshot()).toEqual(afterCreate);
    }
    const collection = first(created), update = await connected.prepareUpdate({ collectionsUpdated: () => { updates++; } });
    const updateKey = update.newRequestKey(), patch = { selector: { id: collection.id }, update: { title: "Collection replay changed" } };
    const updated = await Effect.runPromise(update.run(updateKey, patch)), afterUpdate = await snapshot();
    expect(await Effect.runPromise(update.run(updateKey, patch))).toEqual(updated); expect(updates).toBe(1); expect(await snapshot()).toEqual(afterUpdate);
    const deletion = await connected.prepareDelete({ collectionsDeleted: () => { deletes++; } });
    const deleteKey = deletion.newRequestKey(), ids = { ids: [collection.id, collection.id, "pcol-replay-missing"] };
    expect(await Effect.runPromise(deletion.run(deleteKey, ids))).toBeNull(); const afterDelete = await snapshot();
    expect(await Effect.runPromise(deletion.run(deleteKey, ids))).toBeNull(); expect(deletes).toBe(1); expect(await snapshot()).toEqual(afterDelete);
  }, 120_000);

  it("cancels after native creation and workflow capture and denies a late hook callback", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>()), finished = await Effect.runPromise(Deferred.make<void>());
    const trace: string[] = []; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const host = await connected.prepareCreate({ collectionsCreated: async (input, context) => {
      expect(input.collections).toHaveLength(1); expect(trace).toEqual(["product-collection.created"]); trace.push("hook");
      escaped = () => context.resources.product.createProductCollections([{ title: "Cancelled late Collection" }]);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined));
    } });
    try {
      const before = await snapshot();
      const interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { collections: [{ title: "Cancelled Collection" }] })
          .pipe(Effect.provideService(ExecutionDiagnostics, observe(trace))));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      })));
      expect(interrupted._tag).toBe("Failure"); if (interrupted._tag === "Failure") expect(failurePath(interrupted.cause)).toContain("Interrupt");
      expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Actual Collection creation did not reach its hook before cancellation");
      await escaped().then(() => { throw new Error("Cancelled Collection callback retained authority"); }, cause => { expect(failurePath(cause)).toContain("closed"); });
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); }
  }, 120_000);

  it("confines matching Collection and Product identities, membership and request keys to each shop", async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: connected.fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_collection_workflow_shop_b", projectId: "project_collection_workflow_shop_b", uuidOffset: 90_000 } });
    const other = await prepareLogicalProductCollection(driver, close => cleanup.push(close), fixture);
    const create = await connected.prepareCreate(), otherCreate = await other.prepareCreate(), key = create.newRequestKey();
    const input = { collections: [{ id: "pcol-workflow-shared", title: "Collection shared" }] };
    const left = first(await Effect.runPromise(create.run(key, input))), right = first(await Effect.runPromise(otherCreate.run(key, input)));
    const leftProducts = await connected.seedProducts("collection-scope-products", left.id), rightProducts = await other.seedProducts("collection-scope-products", right.id);
    expect(leftProducts).toEqual(rightProducts);
    const update = await connected.prepareUpdate();
    await Effect.runPromise(update.run(update.newRequestKey(), { selector: { id: left.id }, update: { product_ids: [] } }));
    expect(productReferences(await Effect.runPromise(connected.listProducts(leftProducts)))).toEqual(new Map(leftProducts.map(id => [id, null])));
    expect(productReferences(await Effect.runPromise(other.listProducts(rightProducts)))).toEqual(new Map(rightProducts.map(id => [id, right.id])));
    expect(memberIds(await Effect.runPromise(connected.collectionMembers(left.id)))).toEqual([]);
    expect(new Set(memberIds(await Effect.runPromise(other.collectionMembers(right.id))))).toEqual(new Set(rightProducts));
    expect(await Effect.runPromise(create.run(key, input))).toMatchObject([{ id: left.id }]);
    expect(await Effect.runPromise(otherCreate.run(key, input))).toMatchObject([{ id: right.id }]);
    await remove([left.id]); const deletion = await other.prepareDelete();
    await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: [right.id] }));
  }, 180_000);

  for (const mode of ["scalar", "membership"] as const) it.skipIf(driver !== "postgres")(
    "settles one competing default-OCC Collection " + mode + " root after both native hooks enter (PostgreSQL only)", async () => {
      const create = await connected.prepareCreate();
      const collections = await Effect.runPromise(create.run(create.newRequestKey(), { collections:
        Array.from({ length: mode === "scalar" ? 1 : 4 }, (_, index) => ({ title: "Collection competing " + mode + " " + index })),
      }));
      const prior: string[] = [], leftProducts: string[] = [], rightProducts: string[] = [];
      if (mode === "membership") {
        for (const [index, collection] of collections.entries()) prior.push(...await connected.seedProducts("collection-competing-old-" + index, collection.id));
        leftProducts.push(...await connected.seedProducts("collection-competing-left"));
        rightProducts.push(...await connected.seedProducts("collection-competing-right"));
      }
      const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>()), observed: string[] = [];
      const host = await connected.prepareUpdate({ collectionsUpdated: async input => {
        expect(input.collections).toHaveLength(collections.length);
        observed.push(first(input.collections).title);
        if (observed.length === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release));
      } });
      try {
        const before = await snapshot(), selector = { id: collections.map(collection => collection.id).sort().reverse() };
        const results = await atStage("competing " + mode + " roots", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const left = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector,
            update: { title: "Collection competing left " + mode, ...(mode === "membership" ? { product_ids: leftProducts } : {}) },
          })));
          const right = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector,
            update: { title: "Collection competing right " + mode, ...(mode === "membership" ? { product_ids: rightProducts } : {}) },
          })));
          yield* Deferred.await(reached).pipe(Effect.timeout(10_000));
          expect(new Set(observed)).toEqual(new Set(["Collection competing left " + mode, "Collection competing right " + mode]));
          yield* Deferred.succeed(release, undefined);
          return [yield* Fiber.join(left), yield* Fiber.join(right)];
        }))));
        expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
        expect(results.filter(result => result._tag === "Failure")).toHaveLength(1);
        for (const result of results) if (result._tag === "Failure" && !failurePath(result.cause).includes("writeConflict"))
          throw new Error("Competing Collection root failed outside the actual OCC boundary", { cause: result.cause });
        const winner = results.find(result => result._tag === "Success");
        if (winner === undefined || winner._tag !== "Success") throw new Error("Missing successful Collection root");
        const storedCollections = await Effect.runPromise(connected.listCollections(collections.map(collection => collection.id)));
        expect(storedCollections).toHaveLength(collections.length);
        expect(storedCollections).toEqual(expect.arrayContaining(winner.value.map(collection =>
          expect.objectContaining({ id: collection.id, title: collection.title, handle: collection.handle }))));
        const after = await snapshot(), emitted = after.events.slice(before.events.length), committed = after.commits.slice(before.commits.length);
        expect(committed).toHaveLength(1); expect(emitted).toHaveLength(mode === "scalar" ? 2 : 28);
        expect(emitted.filter(event => event.envelope.contract === "product-collection.updated").map(event => event.envelope.message))
          .toEqual(winner.value.map(collection => expect.objectContaining({ data: { id: collection.id } })));
        expect(emitted.every(event => event.commitSeq === first(committed).commitSeq)).toBe(true);
        const published = after.deliveries.slice(before.deliveries.length);
        expect(published).toHaveLength(emitted.length);
        expect(published.map(delivery => ({ commitSeq: delivery.commitSeq, eventOrdinal: delivery.eventOrdinal, state: delivery.state })))
          .toEqual(emitted.map(event => ({ commitSeq: event.commitSeq, eventOrdinal: event.eventOrdinal, state: "pending" })));
        if (mode === "membership") {
          const desired = first(winner.value).title === "Collection competing left membership" ? leftProducts : rightProducts;
          const losing = desired === leftProducts ? rightProducts : leftProducts;
          expect(productReferences(await Effect.runPromise(connected.listProducts([...prior, ...desired, ...losing]))))
            .toEqual(new Map<string, string | null>([...prior.map(id => [id, null] as const), ...desired.map(id => [id, last(winner.value).id] as const), ...losing.map(id => [id, null] as const)]));
        }
        expect(after.rows).toHaveLength(before.rows.length);
        const compared = after.rows.map(row => ({ row, previous: before.rows.find(previous =>
          previous.scopeUuid === row.scopeUuid && previous.tableId === row.tableId && isDeepStrictEqual(previous.rowId, row.rowId)) }));
        expect(compared.filter(value => value.previous !== undefined)).toHaveLength(before.rows.length);
        expect(compared.filter(({ row, previous }) => !isDeepStrictEqual(row, previous))).toHaveLength(mode === "scalar" ? 1 : 24);
        await remove(collections.map(collection => collection.id));
      } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
    }, 180_000,
  );
});
