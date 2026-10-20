import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { PriceListWorkflowInput } from "../src/modules/pricing/list-input";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareCreatePriceListsWorkflow } from "../src/workflows/pricing/create-price-lists";
import { prepareLogicalPriceListCreation } from "./support/logical-price-list-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListCreation>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
type Input = typeof PriceListWorkflowInput.Type;
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const readObjects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const children = (root: JsonObject, field: string) => readObjects(root[field]);
const ids = (rows: readonly JsonObject[]) => rows.map(row => Schema.decodeUnknownSync(Schema.String)(row.id));
const graphIds = (roots: readonly JsonObject[]) => roots.flatMap(root => [
  ...ids([root]), ...ids(children(root, "price_list_rules")), ...children(root, "prices").flatMap(price => [...ids([price]), ...ids(children(price, "price_rules"))]),
]);
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Pricing event data");
  const values = Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  return values.map(id => [event.envelope.contract, id]);
});
const run = async (input: Input) => {
  const host = await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
};
const single = (title: string, variant = 0): Input => ({ price_lists_data: [{ title, description: title,
  prices: [{ variant_id: connected.variantIds[variant]!, currency_code: "USD", amount: 10 }] }] });
const maximum = (suffix: string): Input => ({ price_lists_data: Array.from({ length: 4 }, (_, index) => ({
  title: "maximum152-" + suffix + index, description: "complete native graph", status: "active" as const,
  starts_at: "2026-04-01T15:30:00+06:30", ends_at: "2026-04-01T09:00:00Z",
  rules: { customer_group_id: ["group-a", "group-a"], arbitrary_attribute: ["", "value"] },
  prices: [{ variant_id: connected.variantIds[index]!, currency_code: "USD", amount: -1.25,
    min_quantity: -2.5, max_quantity: 0, rules: { region_id: "unresolved-region", arbitrary_rule: "" } },
  { variant_id: connected.variantIds[(index + 1) % 4]!, currency_code: "eur", amount: 0,
    min_quantity: null, max_quantity: 4.5, rules: { second: "value", first: "value" } }],
})) });

describe(`genuine native Price List creation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalPriceListCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("resolves the native empty root without module writes and skips the genuine empty inverse", async () => {
    const before = await connected.snapshot(), create = vi.spyOn(PricingModuleService.prototype, "createPriceLists"),
      remove = vi.spyOn(PricingModuleService.prototype, "deletePriceLists");
    try {
      const host = await connected.prepare(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { price_lists_data: [] }))).toEqual([]);
      expect(await Effect.runPromise(host.run(key, { price_lists_data: [] }))).toEqual([]);
      const inverse = await connected.prepareInverse();
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
      expect(create).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { create.mockRestore(); remove.mockRestore(); }
  });

  it("keeps the required genuine graph read for nonempty priceless lists and native defaults", async () => {
    const create = vi.spyOn(PricingModuleService.prototype, "createPriceLists");
    try {
      const output = await run({ price_lists_data: [{ title: "", description: "" }, { title: "priceless152", description: "", prices: [], rules: {} }] });
      expect(output).toHaveLength(2);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]?.[0]).toEqual([{ title: "", description: "", prices: [] }, { title: "priceless152", description: "", prices: [], rules: {} }]);
      for (const root of output) expect(root).toMatchObject({ status: "draft", type: "sale", starts_at: null,
        ends_at: null, rules_count: 0, prices: [], price_list_rules: [], deleted_at: null });
    } finally { create.mockRestore(); }
  });

  it("creates the complete 36-row graph with native order, generic rules and one publication under existing limits", async () => {
    const host = await connected.prepare(), input = maximum("forward"), before = await connected.snapshot();
    const protectedBefore = await connected.read(connected.protectedIds), create = vi.spyOn(PricingModuleService.prototype, "createPriceLists");
    let calls = 0;
    try {
      const key = host.newRequestKey(), output = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(output.map(root => root.title)).toEqual(input.price_lists_data.map(root => root.title));
      expect(graphIds(output)).toHaveLength(36); expect(new Set(graphIds(output)).size).toBe(36);
      output.forEach((root, index) => {
        expect(root).toMatchObject({ status: "active", type: "sale", starts_at: "2026-04-01T09:00:00.000Z",
          ends_at: "2026-04-01T09:00:00.000Z", rules_count: 2, deleted_at: null });
        const prices = children(root, "prices"); expect(prices).toHaveLength(2);
        expect(prices.map(price => price.currency_code)).toEqual(["USD", "eur"]);
        expect(prices.map(price => price.amount)).toEqual([-1.25, 0]);
        expect(prices.map(price => price.price_set_id)).toEqual([connected.setIds[index], connected.setIds[(index + 1) % 4]]);
        expect(prices[0]).toMatchObject({ min_quantity: -2.5, max_quantity: 0, rules_count: 2, price_list_id: root.id,
          raw_amount: { value: expect.any(String), precision: expect.any(Number) } });
        expect(children(prices[0]!, "price_rules").map(rule => [rule.attribute, rule.value, rule.operator, rule.priority]))
          .toEqual([["region_id", "unresolved-region", "eq", 0], ["arbitrary_rule", "", "eq", 1]]);
        expect(children(root, "price_list_rules").map(rule => [rule.attribute, rule.value]))
          .toEqual([["customer_group_id", ["group-a", "group-a"]], ["arbitrary_attribute", ["", "value"]]]);
      });
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(after.rows.length - before.rows.length).toBe(36); expect(emitted).toHaveLength(36);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(eventVector(emitted)).toEqual([
        ...ids(output).map(id => ["pricing.price-list.created", id]),
        ...output.flatMap(root => ids(children(root, "price_list_rules"))).map(id => ["pricing.price-list-rule.created", id]),
        ...output.flatMap(root => ids(children(root, "prices"))).map(id => ["pricing.price.created", id]),
        ...output.flatMap(root => children(root, "prices").flatMap(price => ids(children(price, "price_rules")))).map(id => ["pricing.price-rule.created", id]),
      ]);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
      console.info("Price List creation maximum", { calls, messages: emitted.length });
      expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(create).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { price_lists_data: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { create.mockRestore(); }
  });

  it("preserves native price-key deduplication and rule insertion order", async () => {
    const variant_id = connected.variantIds[0]!;
    const output = await run({ price_lists_data: [{ title: "dedup152", description: "dedup", prices: [
      { variant_id, currency_code: "", amount: 1, rules: { a: "A", b: "B" } },
      { variant_id, currency_code: "", amount: 2, rules: { a: "A", b: "B" } },
    ] }, { title: "rule-order152", description: "order", prices: [
      { variant_id, currency_code: "USD", amount: 3, rules: { a: "A", b: "B" } },
      { variant_id, currency_code: "USD", amount: 4, rules: { b: "B", a: "A" } },
    ] }] });
    expect(children(output[0]!, "prices")).toHaveLength(1);
    expect(children(output[0]!, "prices")[0]).toMatchObject({ currency_code: "", amount: 2 });
    expect(children(output[1]!, "prices")).toHaveLength(2);
    expect(children(output[1]!, "prices").map(price => children(price, "price_rules").map(rule => rule.attribute))).toEqual([["a", "b"], ["b", "a"]]);
  });

  it("preserves empty and duplicate list-rule members and reversed valid date ranges", async () => {
    const output = await run({ price_lists_data: [{ title: "rules152", description: "", rules: { "": [], generic: ["", ""] },
      starts_at: "2026-12-31T00:00:00Z", ends_at: "2026-01-01T00:00:00Z" }] });
    expect(output[0]).toMatchObject({ rules_count: 2, starts_at: "2026-12-31T00:00:00.000Z", ends_at: "2026-01-01T00:00:00.000Z" });
    expect(children(output[0]!, "price_list_rules").map(rule => [rule.attribute, rule.value])).toEqual([["", []], ["generic", ["", ""]]]);
  });

  it.each(["missing152", "", "plist152-variant-history"])("keeps native missing-link failure for raw variant %j and discards the batch", async variant_id => {
    const input: Input = { price_lists_data: [{ title: "missing152", description: "", prices: [
      { variant_id: connected.variantIds[0]!, currency_code: "USD", amount: 1 }, { variant_id, currency_code: "USD", amount: 2 },
    ] }] };
    const before = await connected.snapshot(), create = vi.spyOn(PricingModuleService.prototype, "createPriceLists");
    try { await expect(run(input)).rejects.toBeDefined(); expect(create).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot()); }
    finally { create.mockRestore(); }
  });

  it.each(["not-a-date", ""])("keeps native date failure %j without partial rows or events", async starts_at => {
    const before = await connected.snapshot();
    await expect(run({ price_lists_data: [{ title: "valid-before152", description: "valid" },
      { title: "invalid-date152", description: "invalid", starts_at }] })).rejects.toBeDefined();
    noMutation(before, await connected.snapshot());
  });

  it("retains actual created root IDs and physically deletes every descendant with root-only events", async () => {
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), maximum("inverse")));
    expect(created.compensation).toEqual(ids(created.output)); const all = graphIds(created.output);
    expect(await connected.read(all)).toHaveLength(36);
    const before = await connected.snapshot(), protectedBefore = await connected.read(connected.protectedIds);
    const remove = vi.spyOn(PricingModuleService.prototype, "deletePriceLists");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(created.compensation); expect(await connected.read(all)).toEqual([]);
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(emitted).toHaveLength(4); expect(emitted.every(event => event.envelope.contract === "pricing.price-list.deleted")).toBe(true);
      expect(eventVector(emitted)).toEqual(created.compensation.map(id => ["pricing.price-list.deleted", id]));
      expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
      const repeated = await connected.snapshot();
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
      expect(remove).toHaveBeenCalledTimes(2); noMutation(repeated, await connected.snapshot());
    } finally { remove.mockRestore(); }
  });

  it("uses the genuine inverse to delete a stored historical root with more children than the forward creation bounds", async () => {
    // This is separately labeled initializer comparison data. Actual retained
    // IDs from genuine forward creation are exercised in the preceding case.
    const comparison = await connected.read(connected.historicalIds);
    expect(comparison).toHaveLength(16);
    const prices = comparison.filter(row => row.price_list_id === connected.historicalRootId && typeof row.price_set_id === "string");
    expect(prices).toHaveLength(3);
    expect(comparison.filter(row => row.price_list_id === connected.historicalRootId && typeof row.attribute === "string")).toHaveLength(3);
    for (const price of prices) expect(comparison.filter(row => row.price_id === price.id)).toHaveLength(3);
    expect(comparison.some(row => row.deleted_at === null)).toBe(true);
    expect(comparison.some(row => typeof row.deleted_at === "string")).toBe(true);
    const protectedBefore = await connected.read(connected.protectedIds), before = await connected.snapshot(), inverse = await connected.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [connected.historicalRootId]))).toBeNull();
    expect(await connected.read(connected.historicalIds)).toEqual([]);
    expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
    const emitted = eventsSince(before, await connected.snapshot());
    expect(emitted).toHaveLength(1); expect(emitted[0]?.envelope.contract).toBe("pricing.price-list.deleted");
  });

  it("keeps observed storage traversal for reverse-lexical historical roots despite a reversed raw inverse selector", async () => {
    const observed = await connected.readStorageOrder(connected.insertionRootIds);
    expect(observed).toEqual(connected.insertionRootIds);
    expect(observed).not.toEqual([...observed].sort());
    const requested = [...observed].reverse(), before = await connected.snapshot(), inverse = await connected.prepareInverse();
    const remove = vi.spyOn(PricingModuleService.prototype, "deletePriceLists");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), requested))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(requested);
      expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual(observed.map(id => ["pricing.price-list.deleted", id]));
      expect(await connected.read(connected.insertionRootIds)).toEqual([]);
    } finally { remove.mockRestore(); }
  });

  it.each(["missing-output-field", "forged-event"] as const)("rejects %s after native staging and discards every durable effect", async mode => {
    const original = PricingModuleService.prototype.createPriceLists;
    const create = vi.spyOn(PricingModuleService.prototype, "createPriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (mode === "missing-output-field") {
        const first: unknown = result[0]; if (typeof first !== "object" || first === null) throw new Error("Missing native PriceList");
        Reflect.deleteProperty(first, "updated_at");
      } else {
        const bus: unknown = Reflect.get(this, "eventBusModuleService_");
        if (typeof bus !== "object" || bus === null) throw new Error("Missing native Pricing event bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native event emitter");
        await Reflect.apply(emit, bus, [[{ name: "pricing.price-list.created", data: { id: "forged152" },
          metadata: { source: "pricing", object: "price_list", action: "created" } }], { internal: true }]);
      }
      return result;
    });
    try { const before = await connected.snapshot(); await expect(run(single(mode))).rejects.toBeDefined(); noMutation(before, await connected.snapshot()); }
    finally { create.mockRestore(); }
  });

  it("rolls back the full pending graph once on the known late-parent failure and latches a caught resource refusal", async () => {
    const create = vi.spyOn(PricingModuleService.prototype, "createPriceLists"), remove = vi.spyOn(PricingModuleService.prototype, "deletePriceLists");
    try {
      const late = await connected.prepareWrapped({ lateFailure: true }), before = await connected.snapshot();
      await expect(Effect.runPromise(late.run(late.newRequestKey(), maximum("late")))).rejects.toMatchObject({
        reason: "adapterFailure", cause: { message: "Late parent failure after genuine Price List creation" },
      });
      expect(create).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
      const created = create.mock.results[0];
      if (!created || created.type !== "return") throw new Error("Missing completed genuine native Price List creation");
      const staged = readObjects(await created.value);
      expect(staged).toHaveLength(4); expect(graphIds(staged)).toHaveLength(36);
      const failed = await connected.snapshot(); noMutation(before, failed);
      expect(failed.outcomes).toEqual(before.outcomes); expect(failed.commits).toEqual(before.commits);
      const caught = await connected.prepareWrapped({ caughtRefusal: true });
      await expect(Effect.runPromise(caught.run(caught.newRequestKey(), single("caught152")))).rejects.toBeDefined();
      expect(create).toHaveBeenCalledTimes(2); expect(remove).not.toHaveBeenCalled();
      const refused = await connected.snapshot(); noMutation(before, refused);
      expect(refused.outcomes).toEqual(before.outcomes); expect(refused.commits).toEqual(before.commits);
    } finally { create.mockRestore(); remove.mockRestore(); }
  });

  it("exposes only selected Pricing methods and Query, preserves protected data, and revokes escaped methods", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const escapedQueries: Array<() => Promise<unknown>> = [];
    const host = await connected.prepareWrapped({ inspect: resources => {
      expect(Object.keys(Object(resources)).sort()).toEqual(["event_bus", "pricing", "query", "remoteQuery"]);
      const pricing: unknown = Reflect.get(Object(resources), "pricing");
      expect(Object.keys(Object(pricing)).sort()).toEqual(["createPriceLists", "deletePriceLists"]);
      const query: unknown = Reflect.get(Object(resources), "query"), remoteQuery: unknown = Reflect.get(Object(resources), "remoteQuery");
      expect(query).toBe(remoteQuery);
      if (typeof query !== "function" || typeof remoteQuery !== "function") throw new Error("Missing authentic callable Query aliases");
      for (const alias of [query, remoteQuery]) escapedQueries.push(async () => Reflect.apply(alias, undefined, [{
        entryPoint: "product_variant_price_set", fields: ["variant_id", "price_set_id"], variables: { variant_id: [] },
      }]));
    }, escape: work => { escaped = work; } });
    await Effect.runPromise(host.run(host.newRequestKey(), single("escape152")));
    if (!escaped) throw new Error("Missing retained Pricing method");
    const before = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" });
    expect(escapedQueries).toHaveLength(2);
    for (const query of escapedQueries) await expect(query()).rejects.toMatchObject({ reason: "closed" });
    noMutation(before, await connected.snapshot());
  });

  it("captures caller-owned input and refuses getters, managed fields and oversized graphs", async () => {
    const host = await connected.prepare(), input = { price_lists_data: [{ title: "ownership152", description: "",
      prices: [{ variant_id: connected.variantIds[0]!, currency_code: "USD", amount: 1 }] }] }, original = PricingModuleService.prototype.createPriceLists;
    const create = vi.spyOn(PricingModuleService.prototype, "createPriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      input.price_lists_data[0]!.title = "changed152"; return Reflect.apply(original, this, args);
    });
    try { expect((await Effect.runPromise(host.run(host.newRequestKey(), input)))[0]?.title).toBe("ownership152"); }
    finally { create.mockRestore(); }
    expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(input.price_lists_data[0])).toBe(false);
    const getter = vi.fn(() => "getter152"), before = await connected.snapshot();
    for (const data of [{ price_lists_data: [Object.defineProperty({ description: "" }, "title", { get: getter, enumerable: true })] },
      { price_lists_data: Array.from({ length: 5 }, () => ({ title: "overflow152", description: "" })) },
      { price_lists_data: [{ title: "managed152", description: "", id: "supplied152" }] },
      { price_lists_data: [{ title: "type152", description: "", type: "override" }] },
      { price_lists_data: [{ title: "rules-overflow152", description: "", rules: { a: [], b: [], c: [] } }] }])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), data]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
  });

  it("refuses other authentic Pricing profiles and forged module identity before getters", async () => {
    const other = await Effect.runPromise(makeLocalPricingCommands("create"));
    await expect(Effect.runPromise(prepareCreatePriceListsWorkflow({ ...connected.options, modules: { ...connected.options.modules,
      pricing: { ...connected.options.modules.pricing, module: other.workflow } } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    const getter = vi.fn(() => connected.pricing.workflow.methods), forged = Object.defineProperty({ ...connected.pricing.workflow }, "methods", { get: getter, enumerable: true });
    await expect(Effect.runPromise(prepareCreatePriceListsWorkflow({ ...connected.options, modules: { ...connected.options.modules,
      pricing: { ...connected.options.modules.pricing, module: forged } } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("recovers a lost acknowledgement without native reexecution and binds the revision", async () => {
    const fixture = connected.fixture; let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price List commit acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareCreatePriceListsWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareCreatePriceListsWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const create = vi.spyOn(PricingModuleService.prototype, "createPriceLists");
    try {
      const key = host.newRequestKey(), input = single("uncertain152"), output = await Effect.runPromise(host.run(key, input));
      expect(lose).toBe(false); expect(create).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(create).toHaveBeenCalledTimes(1); await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { create.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels native staged writes and fences their late callback completion", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const original = PricingModuleService.prototype.createPriceLists;
    const create = vi.spyOn(PricingModuleService.prototype, "createPriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release)); return output;
      } finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), single("cancel152")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      noMutation(before, await connected.snapshot()); await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); create.mockRestore(); }
  }, 120_000);
});
