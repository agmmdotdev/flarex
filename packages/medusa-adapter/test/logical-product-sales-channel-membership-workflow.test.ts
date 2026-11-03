import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { StepResponse } from "@medusajs/workflows-sdk";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { isNonArrayRecord } from "@flarex/utils/records";
import { prepareProductSalesChannelMembershipWorkflow, ProductSalesChannelMembershipInput } from "../src/workflows/product/sales-channel-membership";
import { prepareCoreProductSalesChannelMembership } from "./support/core-product-sales-channel-membership-fixture";
import { expectWorkflowDefect, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductSalesChannelMembership>>;
let primary: Effect.Success<ReturnType<typeof prepareProductSalesChannelMembershipWorkflow>> | undefined;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.familyId === event.familyId && prior.ordinal === event.ordinal));
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const key of ["rows", "revisions", "indexes", "events", "families", "deliveries"] as const)
    expect(after[key], key).toEqual(before[key]);
};
const run = async (input: typeof ProductSalesChannelMembershipInput.Type) => {
  const host = primary ??= await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
};
/** Observe the native callbacks' real retained definitions. Inverses below use
 * these values rather than reconstructing a supposed preimage from stored rows. */
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine StepResponse retained getter");
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (Array.isArray(value)) values.push(value); return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    if (values.length !== 2) throw new Error("Expected both actual native membership retained definitions");
    return values;
  } };
}

describe(`genuine native Product–Sales Channel membership - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreProductSalesChannelMembership(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { primary = undefined; await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("runs four additions and four removals in native order, protects other membership and endpoints, and replays once", async () => {
    const prior = await connected.seed("membership148-maximum-prior"), added = await connected.seed("membership148-maximum-add");
    const protectedLinks = await connected.read({ sales_channel_id: added.id }), endpoints = await connected.readEndpoints();
    const before = await connected.snapshot(), host = await connected.prepare(), requestKey = host.newRequestKey();
    const input = { id: prior.id, add: added.products, remove: prior.products };
    const create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      let calls = 0;
      expect(await Effect.runPromise(host.run(requestKey, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      expect(create).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1);
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(dismiss.mock.invocationCallOrder[0]!);
      expect(create.mock.calls[0]?.[0]).toEqual(added.products.map(product_id => ({ product: { product_id }, sales_channel: { sales_channel_id: prior.id } })));
      expect(dismiss.mock.calls[0]?.[0]).toEqual(prior.products.map(product_id => ({ product: { product_id }, sales_channel: { sales_channel_id: prior.id } })));
      expect((await connected.read({ sales_channel_id: prior.id })).map(row => row.product_id)).toEqual(added.products);
      expect(await connected.read({ sales_channel_id: added.id })).toEqual(protectedLinks);
      expect(await connected.readEndpoints()).toEqual(endpoints);
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(emitted.map(event => event.envelope.contract)).toEqual(["LinkProductSalesChannel.attached", "LinkProductSalesChannel.detached"]);
      expect(after.outcomes.length - before.outcomes.length).toBe(1); expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
      console.info("Product Sales Channel membership maximum", { calls, messages: emitted.length });
      expect(await Effect.runPromise(host.run(requestKey, input))).toBeNull();
      expect(create).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(requestKey, { ...input, remove: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { create.mockRestore(); dismiss.mockRestore(); }
  }, 240_000);

  it.each([
    { id: "membership148-empty-omitted" }, { id: "membership148-empty-add", add: [] },
    { id: "membership148-empty-remove", remove: [] }, { id: "membership148-empty-both", add: [], remove: [] },
  ])("preserves omitted/empty forward input $id without native Link writes", async input => {
    const before = await connected.snapshot(), create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      expect(await run(input)).toBeNull(); expect(create).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
      noMutation(before, await connected.snapshot());
    } finally { create.mockRestore(); dismiss.mockRestore(); }
  });

  it("preserves singleton attachment, active and tombstone ID replacement, and unmatched removal", async () => {
    const input = { id: "membership148-cycle", add: ["membership148-cycle-product"] };
    expect(await run(input)).toBeNull();
    const original = (await connected.read({ sales_channel_id: input.id }))[0]!;
    await run(input); const replacement = (await connected.read({ sales_channel_id: input.id }))[0]!;
    expect(replacement.id).not.toBe(original.id); expect(replacement.deleted_at).toBeNull();
    await run({ id: input.id, remove: input.add });
    const historical = await connected.read({ sales_channel_id: input.id }, true);
    expect(historical).toMatchObject([{ id: replacement.id, deleted_at: expect.any(String) }]);
    const before = await connected.snapshot();
    await run({ id: input.id, remove: [...input.add, "membership148-absent"] });
    noMutation(before, await connected.snapshot());
    await run(input); const restored = (await connected.read({ sales_channel_id: input.id }))[0]!;
    expect(restored.id).not.toBe(replacement.id); expect(restored.deleted_at).toBeNull();
  });

  it.each([false, true])("passes duplicate additions unchanged and rolls back all durable changes (prior pair %s)", async existing => {
    const id = "membership148-duplicate-add-" + existing, product = id + "-product";
    if (existing) await run({ id, add: [product] });
    const before = await connected.snapshot(), create = vi.spyOn(Link.prototype, "create");
    try {
      await expect(run({ id, add: [product, product] })).rejects.toBeDefined();
      expect(create.mock.calls[0]?.[0]).toEqual(Array.from({ length: 2 }, () => ({ product: { product_id: product }, sales_channel: { sales_channel_id: id } })));
      noMutation(before, await connected.snapshot());
    } finally { create.mockRestore(); }
  });

  it.each([false, true])("retains raw duplicate removals and genuine native inverse refusal (prior pair %s)", async existing => {
    const id = "membership148-duplicate-remove-" + existing, product = id + "-product";
    if (existing) await run({ id, add: [product] });
    const dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      expect(await run({ id, remove: [product, product] })).toBeNull();
      expect(dismiss.mock.calls[0]?.[0]).toHaveLength(2);
      expect(await connected.read({ sales_channel_id: id })).toEqual([]);
    } finally { dismiss.mockRestore(); }
    const before = await connected.snapshot(), tap = retainedTap(), create = vi.spyOn(Link.prototype, "create");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { id, remove: [product, product] }))).rejects.toBeDefined();
      expect(create.mock.calls[0]?.[0]).toHaveLength(2);
      expect(tap.get()[1]).toEqual(Array.from({ length: 2 }, () => ({ product: { product_id: product }, sales_channel: { sales_channel_id: id } })));
      noMutation(before, await connected.snapshot());
    } finally { tap.restore(); create.mockRestore(); }
  });

  it.each([false, true])("runs add/remove intersection in order and preserves its non-snapshot inverse (prior pair %s)", async existing => {
    const id = "membership148-overlap-" + existing, product = id + "-product";
    if (existing) await run({ id, add: [product] });
    const tap = retainedTap(), create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id, add: [product], remove: [product] }))).toBeNull();
      expect(create).toHaveBeenCalledTimes(2); expect(dismiss).toHaveBeenCalledTimes(2);
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(dismiss.mock.invocationCallOrder[0]!);
      expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[1]!);
      expect(create.mock.invocationCallOrder[1]).toBeLessThan(dismiss.mock.invocationCallOrder[1]!);
      expect(await connected.read({ sales_channel_id: id })).toEqual([]);
      expect(await connected.read({ sales_channel_id: id }, true)).toMatchObject([{ deleted_at: expect.any(String) }]);
    } finally { tap.restore(); create.mockRestore(); dismiss.mockRestore(); }
  });

  it.each(["absent", "tombstone", "active"] as const)("inverse of %s removal creates the submitted pair with a new identity", async prior => {
    const id = "membership148-inverse-remove-" + prior, product = id + "-product";
    let oldId: unknown;
    if (prior !== "absent") {
      await run({ id, add: [product] }); oldId = (await connected.read({ sales_channel_id: id }))[0]?.id;
      if (prior === "tombstone") await run({ id, remove: [product] });
    }
    const tap = retainedTap(), create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id, remove: [product] }))).toBeNull();
      expect(tap.get()[0]).toEqual([]);
      expect(tap.get()[1]).toEqual([{ product: { product_id: product }, sales_channel: { sales_channel_id: id } }]);
      const current = await connected.read({ sales_channel_id: id });
      expect(current).toMatchObject([{ product_id: product, deleted_at: null }]); expect(current[0]?.id).not.toBe(oldId);
      expect(create).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(2);
      expect(dismiss.mock.calls[1]?.[0]).toEqual([]);
    } finally { tap.restore(); create.mockRestore(); dismiss.mockRestore(); }
  });

  it.each([false, true])("inverse of an addition dismisses its submitted pair including prior attachment (%s)", async existing => {
    const id = "membership148-inverse-add-" + existing, product = id + "-product";
    if (existing) await run({ id, add: [product] });
    const tap = retainedTap();
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      await Effect.runPromise(host.run(host.newRequestKey(), { id, add: [product] }));
      expect(await connected.read({ sales_channel_id: id })).toEqual([]);
      expect(await connected.read({ sales_channel_id: id }, true)).toMatchObject([{ deleted_at: expect.any(String) }]);
      expect(tap.get()[1]).toEqual([]);
    } finally { tap.restore(); }
  });

  it("retains the empty association inverse Link.dismiss([]) and repeated actual native callbacks", async () => {
    const tap = retainedTap(), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const before = await connected.snapshot(), host = await connected.prepareWrapped({ retained: tap.get, repeat: true });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: "membership148-empty-inverse" }))).toBeNull();
      expect(tap.get()).toEqual([[], []]); expect(dismiss.mock.calls.map(call => call[0])).toEqual([[], []]);
      noMutation(before, await connected.snapshot());
    } finally { tap.restore(); dismiss.mockRestore(); }
    const repeated = retainedTap(), create = vi.spyOn(Link.prototype, "create");
    try {
      const host = await connected.prepareWrapped({ retained: repeated.get, repeat: true });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: "membership148-repeat-inverse", remove: ["membership148-repeat-product"] }))).toBeNull();
      expect(create).toHaveBeenCalledTimes(2);
      expect(await connected.read({ sales_channel_id: "membership148-repeat-inverse" })).toHaveLength(1);
      const first = create.mock.results[0], second = create.mock.results[1];
      if (first?.type !== "return" || second?.type !== "return") throw new Error("Missing native repeated create results");
      expect(await first.value).not.toEqual(await second.value);
    } finally { repeated.restore(); create.mockRestore(); }
  });

  it("executes both genuine maximum retained callbacks within the default allowance and preserves the submitted-definition inverse", async () => {
    const id = "membership148-maximum-inverse", removed = Array.from({ length: 4 }, (_, index) => id + "-prior-" + index);
    const added = Array.from({ length: 4 }, (_, index) => id + "-new-" + index);
    await run({ id, add: removed });
    const originals = await connected.read({ sales_channel_id: id }), tap = retainedTap();
    const create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      let calls = 0;
      const host = await connected.prepareWrapped({ retained: tap.get });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id, add: added, remove: removed }).pipe(
        Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
        }),
      ))).toBeNull();
      expect(create).toHaveBeenCalledTimes(2); expect(dismiss).toHaveBeenCalledTimes(2);
      expect(tap.get()[0]).toHaveLength(4); expect(tap.get()[1]).toHaveLength(4);
      const restored = await connected.read({ sales_channel_id: id });
      expect(restored.map(row => row.product_id)).toEqual(removed);
      expect(restored.map(row => row.id)).not.toEqual(originals.map(row => row.id));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
      console.info("Product Sales Channel membership maximum inverse", { calls });
    } finally { tap.restore(); create.mockRestore(); dismiss.mockRestore(); }
  });

  it.each(["unknown", "product-history", "channel-history", "both-history"] as const)("preserves native %s endpoint behavior without granting endpoint resources", async mode => {
    const seeded = mode === "unknown" ? { id: "membership148-unknown-channel", products: ["membership148-unknown-product"] }
      : await connected.seed("membership148-endpoint-" + mode, 1);
    const product = seeded.products[0]!;
    if (mode === "product-history" || mode === "both-history") await connected.softDeleteEndpoint("product", product);
    if (mode === "channel-history" || mode === "both-history") await connected.softDeleteEndpoint("sales_channel", seeded.id);
    const endpoints = await connected.readEndpoints();
    expect(await run({ id: seeded.id, add: [product] })).toBeNull();
    expect(await connected.read({ sales_channel_id: seeded.id })).toMatchObject([{ product_id: product, deleted_at: null }]);
    expect(await connected.readEndpoints()).toEqual(endpoints);
    const host = await connected.prepareWrapped({ inspectResources: resources => {
      if (!isNonArrayRecord(resources)) throw new Error("Missing actual native membership resources");
      expect(Object.keys(resources)).toEqual(["link", "event_bus"]);
    } });
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: seeded.id, remove: [product] }))).toBeNull();
  }, 120_000);

  it.each(["new-add", "existing-remove", "mixed", "replacement"] as const)("rolls back rows, history, facts and events after late parent failure: %s", async mode => {
    const id = "membership148-late-" + mode, product = id + "-prior", added = id + "-new";
    if (mode !== "new-add") await run({ id, add: [product] });
    const input = mode === "new-add" ? { id, add: [added] } : mode === "existing-remove" ? { id, remove: [product] }
      : mode === "mixed" ? { id, add: [added], remove: [product] } : { id, add: [product] };
    const original = new Error("Late native Product membership parent failure");
    const before = await connected.snapshot(), host = await connected.prepareWrapped({ lateFailure: original });
    expectWorkflowDefect(await Effect.runPromiseExit(host.run(host.newRequestKey(), input)), original);
    noMutation(before, await connected.snapshot());
  });

  it("refuses malformed, oversized and managed-field input before native methods", async () => {
    const host = await connected.prepare(), create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      for (const input of [{ id: "" }, { id: "x".repeat(257) }, { id: "bounded", add: Array(5).fill("product") },
        { id: "bounded", remove: Array(5).fill("product") }, { id: "bounded", add: [""] },
        { id: "bounded", add: null }, { id: "bounded", data: { id: "forged148" } }]) {
        const before = await connected.snapshot();
        expectWorkflowTypedFailures(await Effect.runPromiseExit(Reflect.apply(host.run, host, [host.newRequestKey(), input])), "invalidInput");
        noMutation(before, await connected.snapshot());
      }
      expect(create).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
    } finally { create.mockRestore(); dismiss.mockRestore(); }
  });

  it("captures caller arrays before native calls and rejects getters without evaluating them", async () => {
    const input = { id: "membership148-owned", add: ["membership148-owned-original"] }, original = Link.prototype.create;
    const create = vi.spyOn(Link.prototype, "create").mockImplementation(async function (this: Link, ...args) {
      input.add[0] = "membership148-owned-mutated"; return Reflect.apply(original, this, args);
    });
    try {
      await run(input);
      expect(input.add).toEqual(["membership148-owned-mutated"]);
      expect(await connected.read({ sales_channel_id: input.id })).toMatchObject([{ product_id: "membership148-owned-original" }]);
    } finally { create.mockRestore(); }
    const getter = vi.fn(() => ["getter-product"]), host = await connected.prepare();
    const supplied = Object.defineProperty({ id: "membership148-getter" }, "add", { get: getter, enumerable: true });
    const before = await connected.snapshot();
    await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), supplied]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
  });

  it("authenticates Link tokens before getters and refuses additional facade resources", async () => {
    const getter = vi.fn(() => connected.link.runtime.workflow.methods);
    const forged = Object.defineProperty({ ...connected.link.runtime.workflow }, "methods", { get: getter, enumerable: true });
    const prepare = vi.fn(() => Effect.die("Unexpected membership execution preparation"));
    await expect(Effect.runPromise(prepareProductSalesChannelMembershipWorkflow({ ...connected.options,
      execution: { identityAndAccessPolicy: {}, prepare }, link: { ...connected.options.link, module: forged } })))
      .rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
    await expect(Effect.runPromise(Reflect.apply(prepareProductSalesChannelMembershipWorkflow, undefined,
      [{ ...connected.options, product: connected.product.runtime.workflow }]))).rejects.toMatchObject({ reason: "unsupportedProfile" });
  });

  it.each(["calls", "events"] as const)("keeps whole-root rollback after the trusted %s budget is exhausted", async budget => {
    const id = "membership148-budget-" + budget;
    await run({ id, add: [id + "-prior"] });
    const before = await connected.snapshot(), host = await connected.prepareWrapped(budget === "calls" ? { calls: 1 } : { eventMessages: 1 });
    await expect(Effect.runPromise(host.run(host.newRequestKey(), { id, add: [id + "-new"], remove: [id + "-prior"] }))).rejects.toBeDefined();
    noMutation(before, await connected.snapshot());
  });

  it("revokes the captured Link capability after its root closes", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ escape: create => { escaped = create; } });
    await Effect.runPromise(host.run(host.newRequestKey(), { id: "membership148-escape", add: ["membership148-escape-product"] }));
    if (escaped === undefined) throw new Error("Missing captured Link capability");
    await expect(escaped()).rejects.toMatchObject({ reason: "closed" });
  });

  it("latches a caught native resource refusal after pending membership writes", async () => {
    const before = await connected.snapshot(), host = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(host.run(host.newRequestKey(), { id: "membership148-caught", add: ["membership148-caught-product"] })))
      .rejects.toBeDefined();
    noMutation(before, await connected.snapshot());
  });

  it("cancels after native pending writes and fences their late completion", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    const settled = await Effect.runPromise(Deferred.make<void>()), original = Link.prototype.create;
    const create = vi.spyOn(Link.prototype, "create").mockImplementation(async function (this: Link, ...args) {
      try {
        const result = await Reflect.apply(original, this, args);
        await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release)); return result;
      } finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const before = await connected.snapshot(), host = await connected.prepare();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { id: "membership148-cancel", add: ["membership148-cancel-product"] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      noMutation(before, await connected.snapshot());
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000)));
      noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); create.mockRestore(); }
  }, 120_000);

  it("recovers a lost acknowledgement without native re-execution and binds revision identity", async () => {
    const fixture = connected.fixture;
    const host = await connected.prepare();
    const changed = await Effect.runPromise(prepareProductSalesChannelMembershipWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const create = vi.spyOn(Link.prototype, "create");
    try {
      const key = host.newRequestKey(), input = { id: "membership148-uncertain", add: ["membership148-uncertain-product"] };
      const fault = fixture.loseNextNativeRootAcknowledgement();
      expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(fault.armed).toBe(false); expect(fault.failures).toBe(1); expect(create).toHaveBeenCalledTimes(1);
      expect(fault.evidence?.inventory).toEqual(await fixture.inventory());
      const after = await connected.snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(create).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { create.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it.skipIf(driver !== "postgres")("retains overlapping default callbacks and rejects the stale same-pair root", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    const original = Link.prototype.create; let count = 0;
    const create = vi.spyOn(Link.prototype, "create").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const host = await connected.prepare(), input = { id: "membership148-competing", add: ["membership148-competing-product"] };
      const before = await connected.snapshot();
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), input)));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), input)));
        yield* Deferred.await(reached).pipe(Effect.timeout(15_000)); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      for (const result of results) if (result._tag === "Failure") expectWorkflowTypedFailures(result, "writeConflict");
      expect(await connected.read({ sales_channel_id: input.id })).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.outcomes.length - before.outcomes.length).toBe(1);
      expect(eventsSince(before, after)).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); create.mockRestore(); }
  }, 120_000);
});
