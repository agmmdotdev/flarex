import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CoreNativeForeignKeyError, CoreNativeUniqueConflict } from "../../persistence-postgres/src/core/api";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { compileFulfillmentCreationCoreDefinition, compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionRuleBatchWorkflow } from "../src/workflows/fulfillment/batch-shipping-option-rules";
import { shippingOptionRuleBatchResources } from "../src/workflow/policy";
import { maximumShippingOptionRuleBatch, prepareCoreShippingOptionRuleBatch, ruleGraph,
  type RuleInverse } from "./support/core-shipping-option-rule-batch-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreShippingOptionRuleBatch>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), record = Schema.decodeUnknownSync(Schema.JsonObject);
const text = Schema.decodeUnknownSync(Schema.String);
const marker = { __type: "Symbol(WorkflowWorkflowData)" };
const create = (id: string, parent = ruleGraph.optionIds[0]!) => ({ id, attribute: "native.attribute", operator: "eq", value: "native.value", shipping_option_id: parent });
const update = (id: string, value: string) => ({ id, attribute: "native.attribute", operator: "eq", value });
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
function newEvents(before: Inventory, after: Inventory) {
  const identity = (event: Inventory["events"][number]) => JSON.stringify([event.familyId, event.ordinal]);
  const previous = new Set(before.events.map(identity)); return after.events.filter(event => !previous.has(identity(event)));
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine SDK retained-response getter");
  const values = new Map<RuleInverse, unknown>();
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []), output = this.output;
    if (!Array.isArray(value)) throw new Error("Expected genuine Rule retained array");
    const kind: RuleInverse = Array.isArray(output) && typeof output[0] === "string" ? "delete"
      : value.length === 0 || typeof value[0] === "string" ? "create" : "update";
    if (values.has(kind)) throw new Error("Repeated genuine Rule retained response: " + kind);
    values.set(kind, structuredClone(value)); return value;
  });
  return { get: (kind: RuleInverse) => { if (!values.has(kind)) throw new Error("Missing actual Rule retained response: " + kind); return values.get(kind); },
    restore: () => spy.mockRestore() };
}
async function scenario() {
  return prepareCoreShippingOptionRuleBatch(driver, close => cleanup.push(close), connected.fixture.physical);
}
const nativeBusinessFields = (row: Record<string, unknown>) => ({ id: row.id, attribute: row.attribute, operator: row.operator,
  value: row.value, shipping_option_id: row.shipping_option_id, deleted_at: row.deleted_at });

describe("genuine ShippingOptionRule batch and all retained inverses", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreShippingOptionRuleBatch(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => {
    await connected?.closeCaseHosts();
    for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains native supplied-ID aliases after Rule normalization with one canonical create and physical inverse", async () => {
    const local = await scenario(), host = await local.prepare(), before = await local.snapshot();
    const input = { create: [
      { ...create("sorul-identity-alias"), value: true },
      { ...create("sorul-identity-alias", "ignored-missing-option"), attribute: "ignored", value: "ignored" },
    ] }, original = structuredClone(input);
    const output = record(await Effect.runPromise(host.run(host.newRequestKey(), input))), created = rows(output.created);
    expect(input).toEqual(original); expect(created).toHaveLength(2); expect(created[1]).toEqual(created[0]);
    expect(created[0]).toMatchObject({ id: "sorul-identity-alias", attribute: "native.attribute", value: "true", shipping_option_id: ruleGraph.optionIds[0] });
    expect(await local.read(["sorul-identity-alias"])).toHaveLength(1);
    expect(newEvents(before, await local.snapshot()).map(event => event.envelope.contract)).toEqual(["fulfillment.shipping-option-rule.created"]);
    const inverse = await local.prepareInverse("create");
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.map(row => text(row.id))));
    expect(await local.read(["sorul-identity-alias"])).toEqual([]);
  }, 240_000);

  it("runs complete four-create/four-update/four-delete native branches, events and exact replay", async () => {
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64));
    const input = maximumShippingOptionRuleBatch("rule-forward"), original = structuredClone(input);
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules"), provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      const output = record(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ShippingOptionRule complete4/4/4 forward BoundedRequest.enter", calls))))));
      expect(calls).toBeLessThanOrEqual(shippingOptionRuleBatchResources.calls);
      const created = rows(output.created), updated = rows(output.updated);
      expect(created).toHaveLength(4); expect(updated).toHaveLength(4); expect(output.deleted).toEqual(input.delete);
      expect(created[0]).toMatchObject({ ...input.create?.[0], value: "true", created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
      for (const row of [...created, ...updated]) expect(Object.keys(row).sort()).toEqual(["id", "attribute", "operator", "value", "shipping_option_id", "created_at", "updated_at", "deleted_at"].sort());
      expect(updated.map(row => row.id)).toEqual(ruleGraph.ruleIds.slice(0, 4));
      expect(input).toEqual(original); expect(provider).not.toHaveBeenCalled(); expect(native).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(), emitted = newEvents(before, after);
      const timestamp = expectCheckoutSettlement(before, after, key);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(12);
      expect(emitted).toHaveLength(12);
      expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.filter(event => event.envelope.contract === "fulfillment.shipping-option-rule.created")).toHaveLength(4);
      expect(emitted.filter(event => event.envelope.contract === "fulfillment.shipping-option-rule.updated")).toHaveLength(4);
      expect(emitted.filter(event => event.envelope.contract === "fulfillment.shipping-option-rule.deleted")).toHaveLength(4);
      expect(await connected.read(ruleGraph.ruleIds.slice(4))).toEqual([]);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, {}))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("executes complete genuine root plus all actual retained callbacks with fresh delete-inverse timestamps", async () => {
    const fixture = await scenario(), tap = retainedTap();
    try {
      const beforeRows = await fixture.read(ruleGraph.ruleIds), before = await fixture.snapshot();
      const host = await fixture.prepareRoundtrip(tap.get); let calls = 0;
      const key = host.newRequestKey();
      const output = record(await Effect.runPromise(host.run(key, maximumShippingOptionRuleBatch("rule-roundtrip")).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
        Effect.ensuring(Effect.sync(() => console.info("ShippingOptionRule complete4/4/4 root plus actual retained callbacks BoundedRequest.enter", calls))),
      )));
      expect(calls).toBeLessThanOrEqual(shippingOptionRuleBatchResources.calls);
      expect(tap.get("create")).toEqual(rows(output.created).map(row => row.id));
      expect(rows(tap.get("delete")).map(row => row.id)).toEqual(ruleGraph.ruleIds.slice(4));
      expect(rows(tap.get("update")).map(row => row.id)).toEqual(ruleGraph.ruleIds.slice(0, 4));
      const afterRows = await fixture.read(ruleGraph.ruleIds);
      expect(afterRows.map(nativeBusinessFields)).toEqual(beforeRows.map(nativeBusinessFields));
      for (const row of afterRows.filter(row => ruleGraph.ruleIds.slice(4).includes(text(row.id)))) {
        expect(row.created_at).toBe(row.updated_at); expect(row.created_at).not.toBe("2026-10-18T00:00:00.000Z");
      }
      expect(await fixture.read(rows(output.created).map(row => text(row.id)))).toEqual([]);
      const after = await fixture.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
      const revisions = after.revisions.filter(revision => revision.timestamp === timestamp);
      expect(revisions).toHaveLength(16);
      expect(revisions.filter(revision => revision.deleted && revision.previous === null)).toHaveLength(4);
      expect(newEvents(before, after)).toHaveLength(24);
    } finally { tap.restore(); }
  }, 240_000);

  it("preserves native void-reference marker output for omitted, nullish and explicit empty branches", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules"),
      updating = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionRules"), deleting = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingOptionRules");
    try {
      const before = await connected.snapshot();
      for (const value of [{}, { create: [], update: [], delete: [] }, { create: null, update: null, delete: null }])
        expect(await Effect.runPromise(host.run(host.newRequestKey(), value))).toEqual({ created: [], deleted: marker, updated: marker });
      expect(native.mock.calls.map(call => call[0])).toEqual([[], [], []]); expect(updating).not.toHaveBeenCalled(); expect(deleting).not.toHaveBeenCalled();
      expect(newEvents(before, await connected.snapshot())).toEqual([]);
    } finally { native.mockRestore(); updating.mockRestore(); deleting.mockRestore(); }
  }, 180_000);

  it("preserves raw duplicate update order, last patch and native projected retained order", async () => {
    const fixture = await scenario(), tap = retainedTap();
    try {
      const z = ruleGraph.ruleIds[1]!, a = ruleGraph.ruleIds[0]!, host = await fixture.prepare();
      const output = record(await Effect.runPromise(host.run(host.newRequestKey(), { update: [update(z, "first"), update(a, "second"), update(z, "last")] })));
      expect(rows(output.updated).map(row => [row.id, row.value])).toEqual([[a, "second"], [z, "last"]]);
      expect(rows(tap.get("update")).map(row => row.id)).toEqual([z, a]);
      expect(rows(tap.get("update")).every(row => !Object.hasOwn(row, "created_at") && !Object.hasOwn(row, "updated_at") && !Object.hasOwn(row, "deleted_at"))).toBe(true);
    } finally { tap.restore(); }
  }, 180_000);

  it("physically deletes historical/missing/duplicate IDs but retains only active preimages for recreation", async () => {
    const fixture = await scenario(), tap = retainedTap();
    try {
      const active = ruleGraph.ruleIds[4]!, ids = [ruleGraph.historicalId, active, "missing", active], host = await fixture.prepare();
      const before = await fixture.snapshot(), output = record(await Effect.runPromise(host.run(host.newRequestKey(), { delete: ids })));
      expect(output.deleted).toEqual(ids); expect(rows(tap.get("delete")).map(row => row.id)).toEqual([active]);
      expect(await fixture.read([active, ruleGraph.historicalId])).toEqual([]);
      expect(newEvents(before, await fixture.snapshot())).toHaveLength(2);
      const inverse = await fixture.prepareInverse("delete");
      await Effect.runPromise(inverse.run(inverse.newRequestKey(), tap.get("delete")));
      expect(await fixture.read([ruleGraph.historicalId])).toEqual([]);
      const recreated = await fixture.read([active]); expect(recreated).toHaveLength(1);
      expect(recreated[0]?.created_at).toBe(recreated[0]?.updated_at); expect(recreated[0]?.created_at).not.toBe("2026-10-18T00:00:00.000Z");
    } finally { tap.restore(); }
  }, 180_000);

  it("preserves native physical delete event order across committed recreation generations", async () => {
    const fixture = await scenario(), host = await fixture.prepare();
    const inserted = ["rule-order-z", "rule-order-A", "rule-order-é"], raw = [inserted[2]!, "rule-order-missing", inserted[0]!, inserted[1]!];
    const expectedRetained = [inserted[2]!, inserted[0]!, inserted[1]!];
    const eventIds = (before: Inventory, after: Inventory) => newEvents(before, after)
      .map(event => text(record(record(event.envelope.message).data).id));
    const creationTap = retainedTap();
    let creationRetained: string[] = [];
    try {
      await Effect.runPromise(host.run(host.newRequestKey(), { create: inserted.map(id => create(id)) }));
      creationRetained = Schema.decodeUnknownSync(Schema.Array(Schema.String).pipe(Schema.mutable))(creationTap.get("create"));
      expect(creationRetained).toEqual(inserted);
    } finally { creationTap.restore(); }
    const firstGeneration = await fixture.snapshot();
    const originals = inserted.map(id => {
      const revision = firstGeneration.revisions.find(entry => entry.value?.id === id);
      if (revision === undefined) throw new Error("Missing first Rule insertion generation");
      return revision;
    });
    const parentBefore = await fixture.read(ruleGraph.optionIds), deletionTap = retainedTap();
    let deletionRetained: ReturnType<typeof rows> = [];
    try {
      const before = await fixture.snapshot(), output = record(await Effect.runPromise(host.run(host.newRequestKey(), { delete: raw })));
      deletionRetained = rows(deletionTap.get("delete"));
      expect(output.deleted).toEqual(raw); expect(deletionRetained.map(row => row.id)).toEqual(expectedRetained);
      // Native SQLite's actual DELETE RETURNING event order follows physical
      // row insertion, independently of the raw output and projected preimage.
      expect(eventIds(before, await fixture.snapshot())).toEqual(inserted);
      expect(await fixture.read(inserted)).toEqual([]);
    } finally { deletionTap.restore(); }
    const inverse = await fixture.prepareInverse("delete"), beforeRecreate = await fixture.snapshot();
    for (const original of originals) expect(beforeRecreate.revisions.filter(entry => entry.id === original.id))
      .toMatchObject([{ timestamp: original.timestamp, previous: null, deleted: false },
        { previous: original.timestamp, deleted: true, value: null }]);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), deletionRetained));
    const recreated = await fixture.snapshot();
    expect(eventIds(beforeRecreate, recreated)).toEqual(expectedRetained);
    for (const original of originals) {
      const generation = recreated.revisions.findLast(entry => entry.value?.id === original.value?.id);
      expect(generation).toMatchObject({ previous: null, deleted: false });
      expect(generation?.id).not.toBe(original.id);
      expect(recreated.revisions.filter(entry => entry.id === original.id)).toEqual(beforeRecreate.revisions.filter(entry => entry.id === original.id));
    }
    const remove = await fixture.prepareInverse("create"), beforeRemove = await fixture.snapshot();
    await Effect.runPromise(remove.run(remove.newRequestKey(), creationRetained));
    // The same external IDs now have fresh physical insertion generations.
    expect(eventIds(beforeRemove, await fixture.snapshot())).toEqual(expectedRetained);
    expect(await fixture.read(inserted)).toEqual([]); expect(await fixture.read(ruleGraph.optionIds)).toEqual(parentBefore);
  }, 240_000);

  it("preserves real native validation, missing-update and missing-parent refusals without durable prefixes", async () => {
    const fixture = await scenario(), host = await fixture.prepare();
    for (const value of [false, 0, null, "", [], { opaque: true }]) {
      const before = await fixture.fixture.inventory(), key = host.newRequestKey();
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, { create: [{ ...create("invalid-rule"), value }] })))).toBe(true);
      await expectCheckoutRollback(fixture.fixture, before, key);
    }
    for (const input of [{ update: [{ id: ruleGraph.ruleIds[0]!, value: "partial" }] },
      { update: [update(ruleGraph.ruleIds[0]!, "valid"), update("missing", "invalid")] },
      { update: [update(ruleGraph.historicalId, "historical")] },
      { create: [create("missing-parent-rule", "missing-option")] },
      { create: [create(ruleGraph.ruleIds[0]!)] }]) {
      const before = await fixture.fixture.inventory(), key = host.newRequestKey();
      expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, input)))).toBe(true);
      await expectCheckoutRollback(fixture.fixture, before, key);
    }
  }, 240_000);

  it("retains required physical FK behavior for a historical Option parent and native retarget", async () => {
    const fixture = await scenario(), host = await fixture.prepare();
    const historical = ruleGraph.optionIds[3]!;
    const output = record(await Effect.runPromise(host.run(host.newRequestKey(), { create: [create("historical-parent-rule", historical)],
      update: [{ ...update(ruleGraph.ruleIds[0]!, "retarget"), shipping_option_id: historical }] })));
    expect(rows(output.created)[0]?.shipping_option_id).toBe(historical);
    expect(rows(output.updated)[0]?.shipping_option_id).toBe(historical);
    expect((await fixture.read([historical]))[0]?.deleted_at).not.toBeNull();
  }, 180_000);

  it.each(["create-delete", "retarget-delete", "missing-first", "occupied-first"] as const)(
    "rejects native statement failure before later branch work: %s", async kind => {
      const fixture = await scenario(), host = await fixture.prepare(), id = "invalid-statement-rule";
      const missing = create(id, "missing-statement-option"), occupied = create(ruleGraph.ruleIds[0]!);
      const input = kind === "create-delete" ? { create: [missing], delete: [id] }
        : kind === "retarget-delete" ? { update: [{ ...update(ruleGraph.ruleIds[0]!, "invalid-retarget"), shipping_option_id: missing.shipping_option_id }], delete: [ruleGraph.ruleIds[0]!] }
        : { create: kind === "missing-first" ? [missing, occupied] : [occupied, missing] };
      const before = await fixture.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromiseExit(host.run(key, input));
      let failure: CommerceTransactionError;
      if (kind === "create-delete") {
        if (Exit.isSuccess(outcome)) throw new Error("Expected the native required-parent refusal");
        // The genuine Effect.all scheduler interrupts the pending delete
        // branch. Keep that sibling cancellation and the original typed cause.
        expect(outcome.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Interrupt", "Fail"]);
        const [original, interrupted, sealed] = outcome.cause.reasons;
        if (original === undefined || !Cause.isFailReason(original) || !(original.error instanceof CommerceTransactionError) ||
          interrupted === undefined || !Cause.isInterruptReason(interrupted) || sealed === undefined || !Cause.isFailReason(sealed))
          throw new Error("Lost the complete native parallel failure Cause");
        expect(original.error.reason).toBe("invalidInput");
        expect(sealed.error).toBeInstanceOf(CommerceTransactionError);
        expect(sealed.error).toMatchObject({ reason: "rollbackOnly" });
        failure = original.error;
      } else failure = expectWorkflowRefusal(outcome, "invalidInput");
      if (kind === "occupied-first") {
        expect(failure.cause).toBeInstanceOf(CoreNativeUniqueConflict);
        expect(failure.cause).toMatchObject({ reason: "uniqueConflict", fields: ["id"] });
      } else {
        expect(failure.cause).toBeInstanceOf(CoreNativeForeignKeyError);
        expect(failure.cause).toMatchObject({ reason: "targetMissing", sourceFields: ["shipping_option_id"], targetFields: ["id"] });
      }
      await expectCheckoutRollback(fixture.fixture, before, key);
    }, 240_000);

  it("preserves intersecting update/delete native forward success and genuine inverse update refusal", async () => {
    const fixture = await scenario(), host = await fixture.prepare(), id = ruleGraph.ruleIds[0]!;
    const input = { update: [update(id, "overlap")], delete: [id] };
    const output = record(await Effect.runPromise(host.run(host.newRequestKey(), input)));
    expect(rows(output.updated)[0]).toMatchObject({ id, value: "overlap" }); expect(output.deleted).toEqual([id]); expect(await fixture.read([id])).toEqual([]);
    const second = await scenario(), tap = retainedTap();
    try {
      const inverse = await second.prepareRoundtrip(tap.get), before = await second.fixture.inventory(), key = inverse.newRequestKey();
      expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(key, input)))).toBe(true);
      await expectCheckoutRollback(second.fixture, before, key);
    } finally { tap.restore(); }
  }, 240_000);

  it.each(["update", "delete"] as const)("retains the genuine %s inverse validator refusal for older valid-DML Rule values", async kind => {
    const fixture = await scenario(), tap = retainedTap();
    const id = kind === "update" ? ruleGraph.legacyNullId : ruleGraph.legacyObjectId;
    const nativeUpdate = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingOptionRules"),
      nativeCreate = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules");
    try {
      const parentBefore = await fixture.read(ruleGraph.optionIds), before = await fixture.fixture.inventory();
      const host = await fixture.prepareRoundtrip(action => action === kind || action === "create" ? tap.get(action) : undefined);
      const input = kind === "update" ? { update: [update(id, "valid-forward")] } : { delete: [id] };
      const key = host.newRequestKey(), outcome = await Effect.runPromiseExit(host.run(key, input));
      expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(reasons(outcome.cause).some(message => message.includes(kind === "update"
        ? "Rule must have an attribute, an operator and a value" : "Rule value must be a string, bool, number value"))).toBe(true);
      const retained = rows(tap.get(kind));
      expect(retained).toHaveLength(1); expect(retained[0]).toMatchObject({ id,
        value: kind === "update" ? null : { opaque: true }, shipping_option_id: ruleGraph.optionIds[3] });
      expect(retained[0]).not.toHaveProperty("created_at"); expect(retained[0]).not.toHaveProperty("updated_at");
      if (kind === "update") {
        expect(nativeUpdate).toHaveBeenCalledTimes(2); expect(nativeUpdate.mock.calls[0]?.[0]).toEqual([update(id, "valid-forward")]);
        expect(nativeUpdate.mock.calls[1]?.[0]).toEqual(retained);
      } else {
        expect(nativeCreate).toHaveBeenCalledTimes(2); expect(nativeCreate.mock.calls[0]?.[0]).toEqual([]);
        expect(nativeCreate.mock.calls[1]?.[0]).toEqual(retained);
      }
      await expectCheckoutRollback(fixture.fixture, before, key);
      expect(await fixture.read(ruleGraph.optionIds)).toEqual(parentBefore);
    } finally { tap.restore(); nativeUpdate.mockRestore(); nativeCreate.mockRestore(); }
  }, 240_000);

  it("preserves new same-ID create/delete branch interaction without an adapter overlap ban", async () => {
    const fixture = await scenario(), host = await fixture.prepare(), id = "new-overlapping-rule";
    const before = await fixture.snapshot(), key = host.newRequestKey();
    const output = record(await Effect.runPromise(host.run(key, { create: [create(id)], delete: [id] })));
    expect(rows(output.created).map(row => row.id)).toEqual([id]); expect(output.deleted).toEqual([id]);
    expect(await fixture.read([id])).toEqual([]);
    const after = await fixture.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
    expect(after.revisions.filter(revision => revision.timestamp === timestamp))
      .toMatchObject([{ previous: null, deleted: true, value: null }]);
    expect(after.indexes).toEqual(before.indexes);
    expect(newEvents(before, after)).toHaveLength(2);
  }, 180_000);

  it("rolls back a late genuine root or retained-inverse failure with all events suppressed", async () => {
    const fixture = await scenario(), host = await fixture.prepareLateFailure(), before = await fixture.fixture.inventory(), key = host.newRequestKey();
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(key, maximumShippingOptionRuleBatch("rule-late-root"))))).toBe(true);
    await expectCheckoutRollback(fixture.fixture, before, key);
    const inverseFixture = await scenario(), tap = retainedTap();
    try {
      const inverse = await inverseFixture.prepareRoundtrip(tap.get, true), baseline = await inverseFixture.fixture.inventory(), inverseKey = inverse.newRequestKey();
      expect(Exit.isFailure(await Effect.runPromiseExit(inverse.run(inverseKey, maximumShippingOptionRuleBatch("rule-late-inverse"))))).toBe(true);
      await expectCheckoutRollback(inverseFixture.fixture, baseline, inverseKey);
    } finally { tap.restore(); }
  }, 240_000);

  it("refuses forged native complete result after actual storage writes", async () => {
    const fixture = await scenario(), host = await fixture.prepare();
    const original = FulfillmentModuleService.prototype.createShippingOptionRules;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args);
      if (!Array.isArray(output) || output[0] === undefined || !Reflect.set(output[0], "value", "forged"))
        throw new Error("Could not forge the actual native Rule result");
      return output;
    });
    try {
      const before = await fixture.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, { create: [create("forged-result")] })), "receiptMismatch");
      expect(native).toHaveBeenCalledTimes(1);
      await expectCheckoutRollback(fixture.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("keeps caught sibling repository denial sticky and native handles unusable after settlement", async () => {
    const fixture = await scenario(), host = await fixture.prepare(), original = FulfillmentModuleService.prototype.createShippingOptionRules;
    let denied = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.createShippingProfiles([{ name: "forbidden-sibling", type: "default" }]); } catch { denied = true; }
      return output;
    });
    try {
      const before = await fixture.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, { create: [create("sticky-rule")] })), "rollbackOnly");
      expect(denied).toBe(true);
      await expectCheckoutRollback(fixture.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing actual native service handle");
      await expect(escaped()).rejects.toBeDefined();
      await expectCheckoutRollback(fixture.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels after actual Rule mutation and suppresses publication while draining the native callback", async () => {
    const fixture = await scenario(), host = await fixture.prepare(), original = FulfillmentModuleService.prototype.createShippingOptionRules;
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const before = await fixture.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, { create: [create("cancelled-rule")] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt");
      await expectCheckoutRollback(fixture.fixture, before, key); finish?.();
      await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      await expectCheckoutRollback(fixture.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("binds workflow module identity, resource selection and scoped same-ID data", async () => {
    const left = await scenario(), right = await scenario(), host = await left.prepare(), id = ruleGraph.ruleIds[0]!;
    const beforeRight = await right.read([id]);
    await Effect.runPromise(host.run(host.newRequestKey(), { update: [update(id, "left-only")] }));
    expect((await left.read([id]))[0]?.value).toBe("left-only"); expect(await right.read([id])).toEqual(beforeRight);
    const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
    const definitions = await Effect.runPromise(Effect.all([
      compileShippingProfileCoreDefinition(target), compileFulfillmentCreationCoreDefinition(target),
    ]));
    const wrongSources = definitions.map(definition => Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", definition)));
    for (const fulfillment of [{ ...left.installed, module: { ...left.fulfillment.workflow } },
      { ...left.installed, nativeStorage: { ...left.installed.nativeStorage } },
      ...wrongSources.map(nativeStorage => ({ ...left.installed, nativeStorage }))])
      expect(await Effect.runPromise(Effect.result(prepareShippingOptionRuleBatchWorkflow({ ...left.options, fulfillment }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const override = { ...left.installed, logicalResources: { ...shippingOptionRuleBatchResources, calls: shippingOptionRuleBatchResources.calls + 1 } };
    expect(await Effect.runPromise(Effect.result(prepareShippingOptionRuleBatchWorkflow({ ...left.options,
      // @ts-expect-error A foreign resource policy must also be refused at runtime.
      fulfillment: override }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }, 240_000);

  it("settles one competing same-native-ID creation with winner-only durable evidence", async () => {
    const fixture = await scenario(), left = await fixture.prepare(), right = await fixture.prepare();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createShippingOptionRules;
    let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await fixture.snapshot(), keys = [left.newRequestKey(), right.newRequestKey()] as const;
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const input = { create: [create("competing-rule")] };
        const first = yield* Effect.forkChild(left.run(keys[0], input).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(keys[1], input).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      const loser = outcomes.find(Exit.isFailure);
      if (loser === undefined) throw new Error("Missing losing native root");
      expect(expectWorkflowTypedFailures(loser).map(failure => failure.reason)).toEqual(["writeConflict"]);
      expect(await fixture.read(["competing-rule"])).toHaveLength(1);
      const after = await fixture.snapshot(), inventory = await fixture.fixture.inventory();
      const durable = inventory.outcomes.filter(outcome => keys.includes(text(outcome.value.key)));
      expect(durable).toHaveLength(2);
      for (const [index, key] of keys.entries()) expect(durable.find(outcome => outcome.value.key === key)?.value.state)
        .toBe(Exit.isSuccess(outcomes[index]!) ? "committed" : "failed");
      const winner = durable.find(outcome => outcome.value.state === "committed");
      if (winner === undefined) throw new Error("Missing committed native root");
      expect(after.revisions.filter(revision => revision.timestamp > before.revisions.reduce((latest, entry) => entry.timestamp > latest ? entry.timestamp : latest, 0n)))
        .toMatchObject([{ timestamp: winner.timestamp, deleted: false }]);
      expect(newEvents(before, after)).toMatchObject([{ timestamp: winner.timestamp }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("invalidates observed Rule parent dependencies when canonical Option deletion commits", async () => {
    const fixture = await scenario(), host = await fixture.prepare(), removal = await fixture.prepareUnusedParentRemoval();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    let closures = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules");
    try {
      const before = await fixture.snapshot(), key = host.newRequestKey(), removalKey = removal.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, { create: [create("orphan-race-rule", ruleGraph.unusedParentId)] }).pipe(
          Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => name === "AtomicEvents.close"
            ? work.pipe(Effect.tap(() => Effect.gen(function* () {
              // The genuine close has now read and authenticated the required
              // parent and frozen its dependency. Pause before publication.
              closures++; yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
            }))) : work }), Effect.timeout(45_000),
        ));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removalKey).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(closures).toBe(1); expect(native).toHaveBeenCalledTimes(1);
      expect(expectWorkflowTypedFailures(outcome).map(failure => failure.reason)).toEqual(["writeConflict"]);
      expect(await fixture.read([ruleGraph.unusedParentId, "orphan-race-rule"])).toEqual([]);
      const after = await fixture.snapshot(), winner = after.outcomes.find(entry => entry.value.key === removalKey);
      expect(winner?.value.state).toBe("committed");
      expect((await fixture.fixture.inventory()).outcomes.find(entry => entry.value.key === key)?.value.state).toBe("failed");
      expect(after.revisions.filter(revision => revision.timestamp === winner?.timestamp))
        .toMatchObject([{ deleted: true, value: null }]);
      expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(newEvents(before, after)).toEqual([]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("retains authentic targetMissing when canonical Option deletion precedes the first parent probe", async () => {
    const fixture = await scenario(), host = await fixture.prepare(), removal = await fixture.prepareUnusedParentRemoval();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createShippingOptionRules;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingOptionRules").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      // Freeze at the actual native method entry, before any Rule statement or
      // parent probe. The committed deletion must therefore be observed as a miss.
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
      return Reflect.apply(original, this, args);
    });
    try {
      const before = await fixture.snapshot(), key = host.newRequestKey(), removalKey = removal.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, { create: [create("first-probe-missing-rule", ruleGraph.unusedParentId)] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removalKey).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      const failure = expectWorkflowRefusal(outcome, "invalidInput");
      expect(failure.cause).toBeInstanceOf(CoreNativeForeignKeyError);
      expect(failure.cause).toMatchObject({ reason: "targetMissing", sourceFields: ["shipping_option_id"], targetFields: ["id"] });
      expect(native).toHaveBeenCalledTimes(1);
      expect(await fixture.read([ruleGraph.unusedParentId, "first-probe-missing-rule"])).toEqual([]);
      const after = await fixture.snapshot(), winner = after.outcomes.find(entry => entry.value.key === removalKey);
      expect(winner?.value.state).toBe("committed");
      expect((await fixture.fixture.inventory()).outcomes.find(entry => entry.value.key === key)?.value.state).toBe("failed");
      expect(after.revisions.filter(revision => revision.timestamp === winner?.timestamp)).toMatchObject([{ deleted: true, value: null }]);
      expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(newEvents(before, after)).toEqual([]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
