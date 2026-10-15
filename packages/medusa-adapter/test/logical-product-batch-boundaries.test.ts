import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { Link } from "@medusajs/modules-sdk/link";
import { prepareProductBatchWorkflow, prepareProductVariantBatchWorkflow } from "../src/workflows/product/batch";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { prepareLogicalProductBatch } from "./support/logical-product-batch-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductBatch>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const snapshot = async () => ({ rows: await rows(), events: await events(), commits: await commits() });
const create = (prefix: string) => ({ id: prefix + "-product", title: prefix, handle: prefix + "-handle",
  options: [{ title: "Size", values: ["0"] }], variants: [{ id: prefix + "-variant", title: prefix + " Variant",
    sku: prefix + "-sku", options: { Size: "0" }, manage_inventory: false, prices: [] }] });

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

describe("native Product batch authority, lifetime and settlement boundaries", () => {
  beforeAll(async () => { connected = await prepareLogicalProductBatch(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("refuses forged resources and unselected module profiles for both facades before native mutation", async () => {
    const before = await snapshot(), native = vi.spyOn(ProductModuleService.prototype, "createProducts");
    const attempts = [
      { ...connected.options, link: structuredClone(connected.link) },
      { ...connected.options, modules: { ...connected.modules,
        pricing: { ...connected.modules.pricing, module: structuredClone(connected.modules.pricing.module) } } },
      { ...connected.options, modules: { ...connected.modules,
        product: { ...connected.modules.product, module: structuredClone(connected.modules.product.module) } } },
      { ...connected.options, modules: { ...connected.modules,
        inventory: { ...connected.modules.inventory, module: connected.creation.inventory.inventory.runtime.workflow } } },
      { ...connected.options, modules: { ...connected.modules,
        inventory: { ...connected.modules.inventory, module: connected.inventoryDeletion.workflow } } },
      { ...connected.options, modules: { ...connected.modules,
        product_links: { ...connected.modules.product_links, module: connected.creation.productLinks.runtime.workflow } } },
      { ...connected.options, modules: { ...connected.modules,
        variant_links: { ...connected.modules.variant_links, module: connected.creation.inventory.link.runtime.workflow } } },
    ];
    try {
      for (const options of attempts) {
        const preparations = [prepareProductBatchWorkflow(options).pipe(Effect.map(host => host.close)),
          prepareProductVariantBatchWorkflow(options).pipe(Effect.map(host => host.close))];
        for (const preparation of preparations) {
          const result = await Effect.runPromise(Effect.result(preparation));
          if (result._tag === "Success") await Effect.runPromise(result.success);
          expect(result).toMatchObject({ _tag: "Failure" });
        }
      }
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back actual native creation after a caught unsupported DAL call and revokes the escaped native method", async () => {
    const host = await connected.prepareProduct(), original = ProductModuleService.prototype.createProducts;
    let escaped: (() => Promise<unknown>) | undefined, created = false;
    const caught: string[][] = [];
    const native = vi.spyOn(ProductModuleService.prototype, "createProducts").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      created = true;
      escaped = () => Reflect.apply(original, this, args);
      try { await this.softDeleteProductOptions(["unadmitted-batch-option"], {}, args[1]); }
      catch (cause) { caught.push(failurePath(cause)); }
      return result;
    });
    try {
      const before = await snapshot();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { create: [create("batch-caught")] })));
      expect(created).toBe(true); expect(caught).toHaveLength(1); expect(caught[0]).toContain("unsupportedProfile");
      expect(result).toMatchObject({ _tag: "Failure" });
      if (result._tag === "Failure") expect(failurePath(result.failure)).toContain("unsupportedProfile");
      expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native creation did not expose its borrowed callback to the observation spy");
      await escaped().then(() => { throw new Error("Escaped native creation unexpectedly succeeded"); }, cause => {
        expect(failurePath(cause)).toContain("closed");
      });
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("cancels a mixed batch after native writes, joins its root and denies a late callback before SQL", async () => {
    const old = (await connected.seed("batch-cancel-old"))[0]!, host = await connected.prepareProduct();
    const reached = await Effect.runPromise(Deferred.make<void>()), finished = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const original = ProductModuleService.prototype.createProducts;
    const native = vi.spyOn(ProductModuleService.prototype, "createProducts").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; });
      await Effect.runPromise(Deferred.succeed(finished, undefined));
      return result;
    });
    try {
      const before = await snapshot();
      const interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), {
          create: [create("batch-cancel-new")], update: [{ id: old.id, title: "cancelled sibling update" }],
        }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })));
      expect(interrupted._tag).toBe("Failure");
      if (interrupted._tag === "Failure") expect(failurePath(interrupted.cause)).toContain("Interrupt");
      expect(native).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native creation callback was not reached before cancellation");
      await escaped().then(() => { throw new Error("Late native callback unexpectedly succeeded"); }, cause => {
        expect(failurePath(cause)).toContain("closed");
      });
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("recovers a lost mixed-batch COMMIT acknowledgement once and binds replay input and revision", async () => {
    const old = await connected.seed("batch-uncertain-old", 2), update = old[0]!, removed = old[1]!;
    let lose = true;
    const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost native Product batch COMMIT acknowledgement") }));
      }),
    ));
    const host = await connected.prepareProduct({ ...connected.execution,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) });
    const changed = await connected.prepareProduct(connected.execution, "c".repeat(64));
    const native = vi.spyOn(ProductModuleService.prototype, "createProducts"), deletion = vi.spyOn(ProductModuleService.prototype, "softDeleteProducts");
    try {
      const key = host.newRequestKey(), input = { create: [create("batch-uncertain-new")],
        update: [{ id: update.id, title: "committed batch update" }], delete: [removed.id] }, beforeCommits = await commits();
      const result = await Effect.runPromise(host.run(key, input));
      expect(result).toMatchObject({ created: [{ id: "batch-uncertain-new-product" }], updated: [{ id: update.id }], deleted: [removed.id] });
      expect(lose).toBe(false); expect(native).toHaveBeenCalledTimes(1); expect(deletion).toHaveBeenCalledTimes(1);
      expect((await commits()).length - beforeCommits.length).toBe(1);
      const stored = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      await expect(Effect.runPromise(host.run(key, { ...input, delete: [removed.id, "changed-request"] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(native).toHaveBeenCalledTimes(1); expect(deletion).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(stored);
    } finally { native.mockRestore(); deletion.mockRestore(); }
  }, 120_000);

  it("replays the actual Variant batch without rerunning empty children or native updates", async () => {
    const product = (await connected.seed("variant-batch-replay"))[0]!, variant = product.variants[0]!;
    const host = await connected.prepareVariant(), changed = await connected.prepareVariant(connected.execution, "d".repeat(64));
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProductVariants");
    try {
      const key = host.newRequestKey(), input = { update: [{ id: variant.id, title: "replayed Variant batch" }] };
      const result = await Effect.runPromise(host.run(key, input)), count = native.mock.calls.length;
      expect(result).toMatchObject({ created: [], updated: [{ id: variant.id, title: "replayed Variant batch" }], deleted: [] });
      expect(count).toBeGreaterThan(0);
      const stored = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      await expect(Effect.runPromise(host.run(key, { update: [{ id: variant.id, title: "changed Variant batch" }] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(native).toHaveBeenCalledTimes(count); expect(await snapshot()).toEqual(stored);
    } finally { native.mockRestore(); }
  });

  it.each(["product", "variant"] as const)("refuses the %s batch after a new sibling attaches an Item selected by the old ownership graph", async kind => {
    const prefix = "batch-old-new-shared-" + kind, product = (await connected.seed(prefix, 1, 2))[0]!;
    const oldVariant = product.variants[0]!.id, newVariant = prefix + "-new-variant", sharedItem = prefix + "-inventory-0";
    const deletionReached = await Effect.runPromise(Deferred.make<void>()), attached = await Effect.runPromise(Deferred.make<void>());
    const trace: string[] = [];
    const matchesAttach = Schema.is(Schema.Array(Schema.Struct({ product: Schema.Struct({ variant_id: Schema.Literal(newVariant) }),
      inventory: Schema.Struct({ inventory_item_id: Schema.Literal(sharedItem) }) })).check(Schema.isLengthBetween(1, 1)));
    const matchesDelete = Schema.is(Schema.Struct({ product: Schema.Struct({ variant_id: Schema.Array(Schema.Literal(oldVariant)).check(Schema.isLengthBetween(1, 1)) }) }));
    const matchesCreate = Schema.is(Schema.Array(Schema.Struct({ id: Schema.Literal(newVariant) })).check(Schema.isLengthBetween(1, 1)));
    const originalCreateVariant = ProductModuleService.prototype.createProductVariants;
    const nativeCreate = vi.spyOn(ProductModuleService.prototype, "createProductVariants").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(originalCreateVariant, this, args);
      if (matchesCreate(args[0])) trace.push("nativeVariantCreated");
      return result;
    });
    const originalInventoryDelete = InventoryModuleService.prototype.softDeleteInventoryItems;
    const inventoryDelete = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(originalInventoryDelete, this, args);
      if (Array.isArray(args[0]) && args[0].includes(sharedItem)) trace.push("inventoryDeletedSharedItem");
      return result;
    });
    const originalCreate = Link.prototype.create, originalDelete = Link.prototype.delete;
    const attach = vi.spyOn(Link.prototype, "create").mockImplementation(async function (this: Link, ...args) {
      if (!matchesAttach(args[0])) return Reflect.apply(originalCreate, this, args);
      trace.push("newLinkWaiting");
      await Effect.runPromise(Deferred.await(deletionReached).pipe(Effect.timeout(30_000)));
      try {
        const result = await Reflect.apply(originalCreate, this, args);
        trace.push("newLinkAttached");
        return result;
      } finally { await Effect.runPromise(Deferred.succeed(attached, undefined)); }
    });
    const deletion = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      if (!matchesDelete(args[0])) return Reflect.apply(originalDelete, this, args);
      // Both native deletion children resolve the complete inverse ownership graph
      // before reaching this Link boundary. No participant call is held here.
      trace.push("deletionGraphCaptured");
      await Effect.runPromise(Deferred.succeed(deletionReached, undefined));
      await Effect.runPromise(Deferred.await(attached).pipe(Effect.timeout(30_000)));
      return Reflect.apply(originalDelete, this, args);
    });
    try {
      const before = await snapshot();
      const variant = { id: newVariant, title: "Surviving shared Item owner", sku: prefix + "-new-sku", options: { Size: "1" },
        manage_inventory: true, inventory_items: [{ inventory_item_id: sharedItem, required_quantity: 1 }], prices: [] };
      const createdProduct = { id: prefix + "-new-product", title: prefix, handle: prefix + "-handle",
        options: [{ title: "Size", values: ["1"] }], variants: [variant] };
      const result = kind === "product"
        ? await connected.prepareProduct().then(host => Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
          create: [createdProduct], delete: [product.id],
        }))))
        : await connected.prepareVariant().then(host => Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
          create: [{ ...variant, product_id: product.id }], delete: [oldVariant],
        }))));
      for (const stage of ["nativeVariantCreated", "deletionGraphCaptured", "newLinkWaiting", "newLinkAttached", "inventoryDeletedSharedItem"])
        expect(trace).toContain(stage);
      expect(trace.indexOf("deletionGraphCaptured")).toBeLessThan(trace.indexOf("newLinkAttached"));
      expect(trace.indexOf("nativeVariantCreated")).toBeLessThan(trace.indexOf("newLinkAttached"));
      if (kind === "product") expect(trace.indexOf("inventoryDeletedSharedItem")).toBeLessThan(trace.indexOf("newLinkAttached"));
      else expect(trace.indexOf("newLinkAttached")).toBeLessThan(trace.indexOf("inventoryDeletedSharedItem"));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      if (result._tag === "Failure") expect(failurePath(result.failure)).toEqual(["unsupportedProfile"]);
      expect(await snapshot()).toEqual(before);
    } finally {
      await Effect.runPromise(Deferred.succeed(deletionReached, undefined)); await Effect.runPromise(Deferred.succeed(attached, undefined));
      nativeCreate.mockRestore(); inventoryDelete.mockRestore(); attach.mockRestore(); deletion.mockRestore();
    }
  }, 120_000);

  it.skipIf(driver !== "postgres")("settles one competing native Product batch and rejects the stale root", async () => {
    const trace: string[] = [];
    const atStage = async <A>(stage: string, work: () => Promise<A>): Promise<A> => {
      trace.push(stage + ":start");
      try { const value = await work(); trace.push(stage + ":done"); return value; }
      catch (cause) { throw new Error("Native batch competition " + stage + " failed [" + trace.join(", ") + "]: " + failurePath(cause).join(">"), { cause }); }
    };
    const product = (await atStage("seed", () => connected.seed("batch-competing")))[0]!;
    const host = await atStage("prepare", () => connected.prepareProduct());
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    let count = 0;
    const original = ProductModuleService.prototype.upsertProducts;
    const native = vi.spyOn(ProductModuleService.prototype, "upsertProducts").mockImplementation(async function (this: ProductModuleService, ...args) {
      trace.push("nativeUpsert:entered");
      const result = await Reflect.apply(original, this, args);
      trace.push("nativeUpsert:completed");
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
      return result;
    });
    try {
      const beforeCommits = await atStage("snapshot commits", commits), beforeEvents = await atStage("snapshot events", events);
      const results = await atStage("competing roots", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { update: [{ id: product.id, title: "first competing batch" }] })));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { update: [{ id: product.id, title: "second competing batch" }] })));
        yield* Deferred.await(reached).pipe(Effect.timeout(10_000));
        trace.push("barrier:bothNativeUpsertsCompleted");
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      }))));
      for (const result of results) if (result._tag === "Failure" && !failurePath(result.cause).includes("writeConflict"))
        throw new Error("Native batch competition returned an unexpected root failure [" + trace.join(", ") + "]", { cause: result.cause });
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.flatMap(result => result._tag === "Failure" ? failurePath(result.cause) : [])).toContain("writeConflict");
      expect((await commits()).length - beforeCommits.length).toBe(1);
      expect((await events()).slice(beforeEvents.length).filter(event => event.envelope.contract === "product.updated")).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 120_000);

  it("confines identical IDs, native descendants and batch request keys to their shop", async () => {
    const other = await prepareLogicalProductBatch(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "product_batch_boundary_shop_b", projectId: "product_batch_boundary_shop_b", uuidOffset: 32_000 } });
    const left = (await connected.seed("batch-scoped"))[0]!, right = (await other.seed("batch-scoped"))[0]!;
    expect(left.id).toBe(right.id); expect(left.variants.map(variant => variant.id)).toEqual(right.variants.map(variant => variant.id));
    const first = await connected.prepareProduct(), second = await other.prepareProduct(), key = first.newRequestKey();
    const input = { create: [create("batch-scoped-new")], delete: [left.id] };
    const result = await Effect.runPromise(first.run(key, input));
    expect(result).toMatchObject({ created: [{ id: "batch-scoped-new-product" }], updated: [], deleted: [left.id] });
    expect(await Effect.runPromise(other.pricing.host.read(other.pricing.runtime.list, {
      filters: { id: right.variants.map(variant => variant.price_set_id) }, config: { relations: ["prices"] },
    }))).toMatchObject([{ deleted_at: null, prices: [expect.anything(), expect.anything()] }]);
    expect(await Effect.runPromise(second.run(second.newRequestKey(), { update: [{ id: right.id }] })))
      .toMatchObject({ created: [], updated: [{ id: right.id, title: "batch-scoped0", variants: [{ id: right.variants[0]!.id }] }], deleted: [] });
    const rightResult = await Effect.runPromise(second.run(key, input));
    expect(rightResult).toMatchObject({ created: [{ id: "batch-scoped-new-product" }], updated: [], deleted: [right.id] });
    expect(await Effect.runPromise(second.run(key, input))).toEqual(rightResult);
    expect(await Effect.runPromise(first.run(key, input))).toEqual(result);
  }, 180_000);
});
