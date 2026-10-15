import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { Link } from "@medusajs/modules-sdk/link";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { productTypeResources } from "../src/workflow/policy";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductType } from "./support/logical-product-type-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductType>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)
  .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq);
const snapshot = async () => ({ rows: await rows(), events: await events(), commits: await commits() });
const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]; if (value === undefined) throw new Error("Expected a native Type result"); return value;
};

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

async function remove(ids: readonly string[]) {
  const host = await connected.prepareDelete();
  for (let offset = 0; offset < ids.length; offset += 4)
    await Effect.runPromise(host.run(host.newRequestKey(), { ids: ids.slice(offset, offset + 4) }));
}

describe("native Product Type workflows on shared logical storage", () => {
  beforeAll(async () => { connected = await prepareLogicalProductType(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes native empty and four-Type creation, all admitted selectors and missing object selection", async () => {
    const seen: string[][] = [], native = vi.spyOn(ProductModuleService.prototype, "createProductTypes");
    const host = await connected.prepareCreate({ productTypesCreated: async (input, context) => {
      seen.push(input.product_types.map(type => type.id));
      expect(input.additional_data).toEqual({ witness: "create" });
      if (input.product_types.length === 0) return;
      const graph = await context.resources.query.graph({ entity: "product_type", fields: ["id", "value"],
        filters: { id: input.product_types.map(type => type.id) }, pagination: { take: 4 } });
      // Graph ordering is independent of the native creation result order.
      expect(graph.data).toHaveLength(input.product_types.length);
      expect(graph.data).toEqual(expect.arrayContaining(input.product_types.map(type => ({ id: type.id, value: type.value }))));
    } });
    try {
      const beforeEmpty = await events();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { product_types: [], additional_data: { witness: "create" } }))).toEqual([]);
      expect(native).toHaveBeenCalledTimes(1); expect(seen).toEqual([[]]); expect(await events()).toEqual(beforeEmpty);
      const beforeEvents = await events(), beforeCommits = await commits();
      let calls = 0;
      const product_types = [0, 1, 2, 3].map(index => ({ value: "type-max-" + index,
        metadata: { nested: { index, enabled: true }, payload: "x".repeat(1024) } }));
      const created = await Effect.runPromise(host.run(host.newRequestKey(), {
        product_types, additional_data: { witness: "create" },
      }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(productTypeResources.calls);
      expect(created).toHaveLength(4); expect(new Set(created.map(type => type.id)).size).toBe(4);
      expect(created.map(type => type.value)).toEqual([0, 1, 2, 3].map(index => "type-max-" + index));
      expect(created.map(type => type.metadata)).toEqual(product_types.map(type => type.metadata));
      expect(seen).toEqual([[], created.map(type => type.id)]); expect(native).toHaveBeenCalledTimes(2);
      const emitted = (await events()).slice(beforeEvents.length), moduleName = connected.product.runtime.metadata.type.createdEvent;
      expect(emitted.map(event => event.envelope.contract)).toEqual([...created.map(() => moduleName), ...created.map(() => "product-type.created")]);
      expect(emitted.filter(event => event.envelope.contract === "product-type.created").map(event => event.envelope.message))
        .toEqual(created.map(type => expect.objectContaining({ data: { id: type.id } })));
      expect(emitted).toHaveLength(8); expect(emitted.length).toBeLessThanOrEqual(productTypeResources.eventMessages);
      console.info("Product Type four-entry maximum", { calls, events: emitted.length });
      expect((await commits()).length - beforeCommits.length).toBe(1);
      const updated = await connected.prepareUpdate();
      const one = first(created);
      expect(await Effect.runPromise(updated.run(updated.newRequestKey(), { selector: { id: one.id }, update: { value: "type-max-renamed" } })))
        .toMatchObject([{ id: one.id, value: "type-max-renamed" }]);
      expect(await Effect.runPromise(updated.run(updated.newRequestKey(), { selector: { value: "type-max-renamed" }, update: { metadata: { by: "value" } } })))
        .toMatchObject([{ id: one.id, metadata: { by: "value" } }]);
      expect(await Effect.runPromise(updated.run(updated.newRequestKey(), { selector: { id: created.map(type => type.id) }, update: {} })))
        .toHaveLength(4);
      expect(await Effect.runPromise(updated.run(updated.newRequestKey(), { selector: {}, update: { metadata: { selected: "all" } } })))
        .toHaveLength(4);
      const missingEvents = await events();
      expect(await Effect.runPromise(updated.run(updated.newRequestKey(), { selector: { id: "ptype-workflow-missing" }, update: { value: "missing" } }))).toEqual([]);
      expect(await events()).toEqual(missingEvents);
      await remove(created.map(type => type.id));
    } finally { native.mockRestore(); }
  }, 120_000);

  it("refuses five entries and a complete five-Type selector without publishing a prefix", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate(), deletion = await connected.prepareDelete();
    const seeded = [...await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [0, 1, 2, 3].map(index => ({ value: "five-types-" + index })) })),
      ...await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [{ value: "five-types-4" }] }))];
    const before = await snapshot();
    const complete = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), { selector: {}, update: { metadata: { wrong: true } } })));
    expect(complete._tag).toBe("Failure");
    if (complete._tag === "Failure") expect(failurePath(complete.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before);
    const invalid = [create.run(create.newRequestKey(), { product_types: [0, 1, 2, 3, 4].map(index => ({ value: "overflow-" + index })) }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: seeded.map(type => type.id) }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: seeded.map(type => type.id) }, update: {} }).pipe(Effect.asVoid)];
    for (const work of invalid) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("invalidInput");
      expect(await snapshot()).toEqual(before);
    }
    await remove(seeded.map(type => type.id));
  }, 120_000);

  it("uses native metadata merge, key removal and nested replacement, and rolls back active value conflicts", async () => {
    const create = await connected.prepareCreate(), update = await connected.prepareUpdate();
    const types = await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [
      { value: "metadata-type", metadata: { keep: "yes", drop: "old", nested: { left: 1, right: 2 } } }, { value: "metadata-conflict" },
    ] }));
    const selected = first(types), selector = { id: selected.id }, beforeChanged = await events();
    const changed = await Effect.runPromise(update.run(update.newRequestKey(), { selector,
      update: { metadata: { drop: "", nested: { left: 3 } } } }));
    expect(changed).toMatchObject([{ id: selected.id, metadata: { keep: "yes", nested: { left: 3 } } }]);
    expect(first(changed).metadata).toEqual({ keep: "yes", nested: { left: 3 } });
    const emitted = (await events()).slice(beforeChanged.length);
    expect(emitted.map(event => event.envelope.contract))
      .toEqual([connected.product.runtime.metadata.type.updatedEvent, "product-type.updated"]);
    expect(emitted.map(event => event.envelope.message)).toEqual([
      expect.objectContaining({ data: { id: selected.id } }), expect.objectContaining({ data: { id: selected.id } }),
    ]);
    const omitted = await Effect.runPromise(update.run(update.newRequestKey(), { selector, update: {} }));
    expect(first(omitted).metadata).toEqual({ keep: "yes", nested: { left: 3 } });
    // Native isPresent({}) is false: the internal service skips mergeMetadata
    // and passes the explicit empty object through to repository.update.
    const empty = await Effect.runPromise(update.run(update.newRequestKey(), { selector, update: { metadata: {} } }));
    expect(first(empty).metadata).toEqual({});
    expect(await Effect.runPromise(update.run(update.newRequestKey(), { selector, update: { metadata: null } })))
      .toMatchObject([{ id: selected.id, metadata: null }]);
    const before = await snapshot();
    for (const work of [update.run(update.newRequestKey(), { selector, update: { value: "metadata-conflict" } }),
      create.run(create.newRequestKey(), { product_types: [{ value: "metadata-new-before-conflict" }, { value: "metadata-conflict" }] })]) {
      const result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      // The shared logical participant classifies uniqueConflict as invalidInput.
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("invalidInput");
      expect(await snapshot()).toEqual(before);
    }
    await remove(types.map(type => type.id));
  }, 120_000);

  it("soft-deletes requested IDs through genuine empty Link routing and preserves Product references and reused values", async () => {
    const create = await connected.prepareCreate();
    const types = await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [{ value: "referenced-type" }, { value: "other-deleted-type" }] }));
    const type = first(types), other = types[1]; if (other === undefined) throw new Error("Missing second Type");
    const productIds = await connected.seedProducts("type-reference", type.id);
    const productsBefore = await Effect.runPromise(connected.listProducts(productIds));
    expect(productsBefore).toHaveLength(4);
    expect(productsBefore).toEqual(expect.arrayContaining(productIds.map(id => expect.objectContaining({ id, type_id: type.id }))));
    const requested = [type.id, type.id, "ptype-deletion-missing", other.id], observed: string[][] = [];
    const deletion = await connected.prepareDelete({ productTypesDeleted: async (input, context) => {
      observed.push([...input.ids]);
      expect(await context.resources.query.graph({ entity: "product_type", fields: ["id"],
        filters: { id: [type.id, other.id] }, pagination: { take: 4 } })).toMatchObject({ data: [] });
    } });
    const native = vi.spyOn(Link.prototype, "delete");
    try {
      const beforeEvents = await events(), beforeCommits = await commits();
      expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: requested }))).toBeNull();
      expect(observed).toEqual([requested]); expect(native).toHaveBeenCalledExactlyOnceWith({ product: { product_type_id: requested } });
      expect(await native.mock.results[0]?.value).toEqual([null, {}]);
      expect(await Effect.runPromise(connected.listProducts(productIds))).toEqual(productsBefore);
      const emitted = (await events()).slice(beforeEvents.length), moduleName = connected.product.runtime.metadata.type.deletedEvent;
      expect(emitted.map(event => event.envelope.contract)).toEqual([moduleName, moduleName, ...requested.map(() => "product-type.deleted")]);
      // The native lifecycle loads canonical keys in ID order; module events
      // describe those unique transitions rather than requested deletion order.
      expect(emitted.filter(event => event.envelope.contract === moduleName).map(event => event.envelope.message))
        .toEqual(expect.arrayContaining([type.id, other.id].map(id => expect.objectContaining({ data: { id } }))));
      expect(emitted.filter(event => event.envelope.contract === "product-type.deleted").map(event => event.envelope.message))
        .toEqual(requested.map(id => expect.objectContaining({ data: { id } })));
      expect((await commits()).length - beforeCommits.length).toBe(1);
      expect(await Effect.runPromise(connected.listTypes([type.id, other.id]))).toEqual([]);
      expect(await Effect.runPromise(connected.listTypes([type.id, other.id], true)))
        .toEqual(expect.arrayContaining([type.id, other.id].map(id => expect.objectContaining({ id, deleted_at: expect.any(String) }))));
      const repeatEvents = await events();
      expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: requested }))).toBeNull();
      expect((await events()).slice(repeatEvents.length).map(event => event.envelope.contract)).toEqual(requested.map(() => "product-type.deleted"));
      const emptyEvents = await events();
      expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: [] }))).toBeNull();
      expect(native).toHaveBeenLastCalledWith({ product: { product_type_id: [] } }); expect(await events()).toEqual(emptyEvents);
      const reused = first(await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [{ value: type.value }] })));
      expect(reused.id).not.toBe(type.id); expect(await Effect.runPromise(connected.listProducts(productIds))).toEqual(productsBefore);
      await remove([reused.id]);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("rolls back each native mutation when its hook fails and revokes an escaped borrowed method", async () => {
    let escaped: (() => Promise<unknown>) | undefined, reached = 0;
    const create = await connected.prepareCreate({ productTypesCreated: async (input, context) => {
      expect(input.product_types).toHaveLength(1); reached++;
      escaped = () => context.resources.product.createProductTypes([{ value: "escaped-type" }]);
      throw new Error("Type creation hook rejected actual native mutation");
    } });
    const seed = await connected.prepareCreate();
    const type = first(await Effect.runPromise(seed.run(seed.newRequestKey(), { product_types: [{ value: "hook-seed" }] })));
    const update = await connected.prepareUpdate({ productTypesUpdated: async input => {
      expect(input.product_types).toMatchObject([{ id: type.id, value: "hook-updated" }]); reached++;
      throw new Error("Type update hook rejected actual native mutation");
    } });
    const deletion = await connected.prepareDelete({ productTypesDeleted: async (input, context) => {
      expect(input.ids).toEqual([type.id]);
      expect(await context.resources.query.graph({ entity: "product_type", fields: ["id"], filters: { id: [type.id] }, pagination: { take: 1 } }))
        .toMatchObject({ data: [] }); reached++;
      throw new Error("Type deletion hook rejected actual native mutation");
    } });
    for (const work of [create.run(create.newRequestKey(), { product_types: [{ value: "hook-created" }] }).pipe(Effect.asVoid),
      update.run(update.newRequestKey(), { selector: { id: type.id }, update: { value: "hook-updated" } }).pipe(Effect.asVoid),
      deletion.run(deletion.newRequestKey(), { ids: [type.id] }).pipe(Effect.asVoid)]) {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(work)); expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("adapterFailure");
      expect(await snapshot()).toEqual(before);
    }
    expect(reached).toBe(3);
    if (escaped === undefined) throw new Error("Creation hook did not expose the borrowed Type method");
    const beforeLate = await snapshot();
    await escaped().then(() => { throw new Error("Escaped Type mutation unexpectedly succeeded"); }, cause => {
      expect(failurePath(cause)).toContain("closed");
    });
    expect(await snapshot()).toEqual(beforeLate); await remove([type.id]);
  }, 120_000);

  it("recovers the complete native Type result after a committed transaction loses its acknowledgement", async () => {
    const fixture = connected.fixture;
    let lose = true, acknowledgementFailures = 0, hooks = 0;
    let committedAtAck: Awaited<ReturnType<typeof snapshot>> | undefined, hookOutput: unknown;
    const deliveries = () => fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)
      .orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId);
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        // The genuine owner has completed COMMIT. Observe its durable rows and
        // publication before replacing only that successful acknowledgement.
        return Effect.tryPromise({ try: snapshot,
          catch: cause => new RelationalSessionError({ reason: "resourceFailure", cause }),
        }).pipe(Effect.flatMap(observed => {
          committedAtAck = observed; acknowledgementFailures++;
          return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost native Product Type COMMIT acknowledgement") }));
        }));
      }),
    ));
    const host = await connected.prepareCreate({ productTypesCreated: input => {
      hooks++; hookOutput = structuredClone(input.product_types);
    } }, { ...connected.execution, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const native = vi.spyOn(ProductModuleService.prototype, "createProductTypes");
    try {
      const before = await snapshot(), beforeDeliveries = await deliveries(), key = host.newRequestKey();
      const input = { product_types: [{ value: "type-uncertain-ack", metadata: { nested: { retained: true }, witness: "complete native DTO" } }] };
      const result = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(acknowledgementFailures).toBe(1);
      if (committedAtAck === undefined) throw new Error("The actual committed Type transaction did not reach the ACK interception");
      expect(committedAtAck.commits.length - before.commits.length).toBe(1);
      expect(committedAtAck.rows.length - before.rows.length).toBe(1);
      const emitted = committedAtAck.events.slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([connected.product.runtime.metadata.type.createdEvent, "product-type.created"]);
      expect(result).toEqual(hookOutput);
      expect(result).toMatchObject([{ id: expect.any(String), value: "type-uncertain-ack",
        metadata: input.product_types[0]?.metadata, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null }]);
      expect(await Effect.runPromise(connected.listTypes(result.map(type => type.id)))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1); expect(hooks).toBe(1);
      expect(await snapshot()).toEqual(committedAtAck);
      const afterDeliveries = await deliveries(), publishedDeliveries = afterDeliveries.slice(beforeDeliveries.length);
      expect(publishedDeliveries).toHaveLength(2);
      expect(publishedDeliveries.map(delivery => ({ commitSeq: delivery.commitSeq, eventOrdinal: delivery.eventOrdinal, state: delivery.state })))
        .toEqual(emitted.map(event => ({ commitSeq: event.commitSeq, eventOrdinal: event.eventOrdinal, state: "pending" })));
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1); expect(hooks).toBe(1);
      expect(await snapshot()).toEqual(committedAtAck); expect(await deliveries()).toEqual(afterDeliveries);
      await remove(result.map(type => type.id));
    } finally { native.mockRestore(); }
  }, 120_000);

  it("replays each native workflow once and binds creation input and revision", async () => {
    let createdHooks = 0, updatedHooks = 0, deletedHooks = 0;
    const create = await connected.prepareCreate({ productTypesCreated: () => { createdHooks++; } });
    const input = { product_types: [{ value: "type-replay" }], additional_data: { once: true } }, key = create.newRequestKey();
    const result = await Effect.runPromise(create.run(key, input)), afterCreate = await snapshot();
    expect(await Effect.runPromise(create.run(key, input))).toEqual(result); expect(createdHooks).toBe(1); expect(await snapshot()).toEqual(afterCreate);
    const conflict = await Effect.runPromise(Effect.result(create.run(key, { ...input, additional_data: { once: false } })));
    expect(conflict._tag).toBe("Failure"); if (conflict._tag === "Failure") expect(failurePath(conflict.failure)).toContain("requestConflict");
    const changed = await connected.prepareCreate({}, connected.execution, "c".repeat(64));
    const revision = await Effect.runPromise(Effect.result(changed.run(key, input)));
    expect(revision._tag).toBe("Failure"); if (revision._tag === "Failure") expect(failurePath(revision.failure)).toContain("requestConflict");
    expect(await snapshot()).toEqual(afterCreate);
    const type = first(result), update = await connected.prepareUpdate({ productTypesUpdated: () => { updatedHooks++; } });
    const updateKey = update.newRequestKey(), patch = { selector: { id: type.id }, update: { value: "type-replayed-update" } };
    const updated = await Effect.runPromise(update.run(updateKey, patch)), afterUpdate = await snapshot();
    expect(await Effect.runPromise(update.run(updateKey, patch))).toEqual(updated); expect(updatedHooks).toBe(1); expect(await snapshot()).toEqual(afterUpdate);
    const deletion = await connected.prepareDelete({ productTypesDeleted: () => { deletedHooks++; } });
    const deleteKey = deletion.newRequestKey(), ids = { ids: [type.id, type.id, "ptype-replay-missing"] };
    expect(await Effect.runPromise(deletion.run(deleteKey, ids))).toBeNull(); const afterDelete = await snapshot();
    expect(await Effect.runPromise(deletion.run(deleteKey, ids))).toBeNull(); expect(deletedHooks).toBe(1); expect(await snapshot()).toEqual(afterDelete);
  }, 120_000);

  it("refuses an extra native Type mutation from a hook even when matching workflow events are emitted", async () => {
    const create = await connected.prepareCreate();
    const types = await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [0, 1, 2].map(index => ({ value: "extra-hook-type-" + index })) }));
    let hookIds: readonly string[] = [];
    const update = await connected.prepareUpdate({ productTypesUpdated: async (input, context) => {
      const changed = await context.resources.product.updateProductTypes({ id: input.product_types.map(type => type.id) }, { metadata: { hook: true } });
      hookIds = changed.map(type => type.id);
      expect(hookIds).toEqual(input.product_types.map(type => type.id));
      await context.resources.event_bus.emit(changed.map(type => ({ name: "product-type.updated", data: { id: type.id },
        metadata: { eventGroupId: context.eventGroupId } })));
    } });
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(update.run(update.newRequestKey(), {
      selector: { id: types.map(type => type.id) }, update: { metadata: { parent: true } },
    })));
    expect(hookIds).toHaveLength(3);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
    expect(await snapshot()).toEqual(before); await remove(types.map(type => type.id));
  }, 120_000);

  it("cancels after genuine creation, rolls back pending events and denies the late hook callback", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>()), finished = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const create = await connected.prepareCreate({ productTypesCreated: async (input, context) => {
      expect(input.product_types).toHaveLength(1);
      escaped = () => context.resources.product.createProductTypes([{ value: "cancelled-late-type" }]);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined));
    } });
    try {
      const before = await snapshot();
      const interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(create.run(create.newRequestKey(), { product_types: [{ value: "cancelled-type" }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      })));
      expect(interrupted._tag).toBe("Failure"); if (interrupted._tag === "Failure") expect(failurePath(interrupted.cause)).toContain("Interrupt");
      expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native Type creation did not reach its hook before cancellation");
      await escaped().then(() => { throw new Error("Cancelled hook unexpectedly retained mutation authority"); }, cause => {
        expect(failurePath(cause)).toContain("closed");
      });
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); }
  }, 120_000);

  it("confines identical values and request keys to each shop", async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: connected.fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_product_type_workflow_shop_b", projectId: "project_product_type_workflow_shop_b", uuidOffset: 80_000 } });
    const other = await prepareLogicalProductType(driver, close => cleanup.push(close), fixture);
    const create = await connected.prepareCreate(), otherCreate = await other.prepareCreate(), key = create.newRequestKey();
    const input = { product_types: [{ value: "scope-type" }] };
    const left = first(await Effect.runPromise(create.run(key, input))), right = first(await Effect.runPromise(otherCreate.run(key, input)));
    const otherUpdate = await other.prepareUpdate(), before = await snapshot();
    expect(await Effect.runPromise(otherUpdate.run(otherUpdate.newRequestKey(), { selector: { id: left.id }, update: { value: "foreign-scope-value" } }))).toEqual([]);
    expect(await Effect.runPromise(connected.listTypes([left.id]))).toMatchObject([{ id: left.id, value: "scope-type" }]);
    expect(await Effect.runPromise(other.listTypes([right.id]))).toMatchObject([{ id: right.id, value: "scope-type" }]);
    expect(await Effect.runPromise(create.run(key, input))).toMatchObject([{ id: left.id }]);
    expect(await Effect.runPromise(otherCreate.run(key, input))).toMatchObject([{ id: right.id }]);
    // Empty foreign selection emits no Type events or row mutations. Its durable
    // request outcome may be recorded, so compare application rows and events.
    expect(await rows()).toEqual(before.rows); expect(await events()).toEqual(before.events);
    await remove([left.id]); const deletion = await other.prepareDelete();
    await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: [right.id] }));
  }, 180_000);

  it.skipIf(driver !== "postgres")("settles one competing default-OCC Type update after both native hooks enter (PostgreSQL only)", async () => {
    const create = await connected.prepareCreate();
    const type = first(await Effect.runPromise(create.run(create.newRequestKey(), { product_types: [{ value: "competing-type" }] })));
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    const observed: string[] = [];
    const host = await connected.prepareUpdate({ productTypesUpdated: async input => {
      // Native update has already returned its actual DTO before this hook.
      expect(input.product_types).toHaveLength(1); expect(first(input.product_types).id).toBe(type.id);
      observed.push(first(input.product_types).value);
      if (observed.length === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
    } });
    const deliveries = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)
      .orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId);
    try {
      const before = await snapshot(), beforeDeliveries = await deliveries();
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const left = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), {
          selector: { id: type.id }, update: { value: "competing-type-left" },
        })));
        const right = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), {
          selector: { id: type.id }, update: { value: "competing-type-right" },
        })));
        yield* Deferred.await(reached).pipe(Effect.timeout(10_000));
        expect(observed).toHaveLength(2);
        expect(new Set(observed)).toEqual(new Set(["competing-type-left", "competing-type-right"]));
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(left), yield* Fiber.join(right)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.filter(result => result._tag === "Failure")).toHaveLength(1);
      for (const result of results) if (result._tag === "Failure" && !failurePath(result.cause).includes("writeConflict"))
        throw new Error("Competing Type root failed outside the real OCC conflict boundary", { cause: result.cause });
      const winner = results.find(result => result._tag === "Success");
      if (winner === undefined || winner._tag !== "Success") throw new Error("Missing successful Type update root");
      expect(await Effect.runPromise(connected.listTypes([type.id]))).toMatchObject([{ id: type.id, value: first(winner.value).value }]);
      const after = await snapshot(), published = after.events.slice(before.events.length), committed = after.commits.slice(before.commits.length);
      expect(committed).toHaveLength(1);
      expect(published.map(event => event.envelope.contract)).toEqual([connected.product.runtime.metadata.type.updatedEvent, "product-type.updated"]);
      expect(published.map(event => event.envelope.message)).toEqual([
        expect.objectContaining({ data: { id: type.id } }), expect.objectContaining({ data: { id: type.id } }),
      ]);
      expect(published.every(event => event.commitSeq === first(committed).commitSeq)).toBe(true);
      const publishedDeliveries = (await deliveries()).slice(beforeDeliveries.length);
      expect(publishedDeliveries).toHaveLength(2);
      expect(publishedDeliveries.map(delivery => ({ commitSeq: delivery.commitSeq, eventOrdinal: delivery.eventOrdinal, state: delivery.state })))
        .toEqual(published.map(event => ({ commitSeq: event.commitSeq, eventOrdinal: event.eventOrdinal, state: "pending" })));
      expect(after.rows).toHaveLength(before.rows.length);
      // rowId is a bytea value. Separate reads own distinct byte arrays, so
      // pointer equality would mistake every unchanged row for a new identity.
      const compared = after.rows.map(row => ({ row, previous: before.rows.find(previous =>
        previous.scopeUuid === row.scopeUuid && previous.tableId === row.tableId && isDeepStrictEqual(previous.rowId, row.rowId)) }));
      const changed = compared.filter(({ row, previous }) => !isDeepStrictEqual(row, previous));
      expect(compared.filter(value => value.previous !== undefined)).toHaveLength(before.rows.length);
      expect(changed).toHaveLength(1);
      await remove([type.id]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 120_000);
});
