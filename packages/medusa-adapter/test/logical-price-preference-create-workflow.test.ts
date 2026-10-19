import { orderNativeIdRows } from "../src/repository/result";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { PricePreferencesInput } from "../src/modules/pricing/input";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareCreatePricePreferencesWorkflow } from "../src/workflows/pricing/create-price-preferences";
import { prepareLogicalPricePreferenceCreation } from "./support/logical-price-preference-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPricePreferenceCreation>>;
let primary: Effect.Success<ReturnType<typeof prepareCreatePricePreferencesWorkflow>> | undefined;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const run = async (input: typeof PricePreferencesInput.Type) => {
  const host = primary ??= await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
};
const ids = (rows: readonly { readonly id: string }[]) => rows.map(row => row.id);
const eventIds = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native preference event data");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
});
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failures(reason.error)
    : reason._tag === "Die" ? failures(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...failures(value.cause)];
}

describe(`genuine native Price Preference creation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalPricePreferenceCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { primary = undefined; await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps the empty native Pricing call, skips its retained inverse, and replays without writes", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), before = await connected.snapshot();
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences"), remove = vi.spyOn(PricingModuleService.prototype, "deletePricePreferences");
    try {
      expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
      expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]);
      expect(await Effect.runPromise(host.run(key, []))).toEqual([]); expect(create).toHaveBeenCalledTimes(1);
      const inverse = await connected.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), []))).toBeNull();
      expect(remove).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { create.mockRestore(); remove.mockRestore(); }
  });

  it("creates four ordered full DTOs within default limits, preserving raw attributes and arbitrary Region IDs", async () => {
    const protectedBefore = await connected.read(connected.protectedIds), before = await connected.snapshot();
    const input = [{ attribute: "currency_code", value: "USD", is_tax_inclusive: true },
      { attribute: "currency_code", value: "usd", is_tax_inclusive: false },
      { attribute: "region_id", value: "unresolved-region149", is_tax_inclusive: null }, { attribute: "", value: "" }];
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences");
    try {
      const host = await connected.prepare(), key = host.newRequestKey(); let calls = 0;
      const output = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(output).toHaveLength(4); expect(output.map(row => row.value)).toEqual(input.map(row => row.value));
      expect(output.map(row => row.is_tax_inclusive)).toEqual([true, false, false, false]);
      for (const row of output) {
        expect(Object.keys(row).sort()).toEqual(["id", "attribute", "value", "is_tax_inclusive", "created_at", "updated_at", "deleted_at"].sort());
        expect(row).toMatchObject({ id: expect.stringMatching(/^prpref_/), created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
      }
      expect(create.mock.calls[0]?.[0]).toEqual(input);
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(eventIds(emitted)).toEqual(ids(output)); expect(emitted).toHaveLength(4);
      expect(emitted.every(event => event.envelope.contract === "pricing.price-preference.created")).toBe(true);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
      console.info("Price Preference creation maximum", { calls, messages: emitted.length });
      expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(create).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, []))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { create.mockRestore(); }
  });

  it("preserves multiple omitted and explicit null values for the same raw attribute", async () => {
    const output = await run([{ attribute: "nullable149" }, { attribute: "nullable149", value: null },
      { attribute: "nullable149", value: null, is_tax_inclusive: null }, { attribute: "nullable149", value: "" }]);
    expect(output.map(row => row.value)).toEqual([null, null, null, ""]); expect(new Set(ids(output)).size).toBe(4);
    expect(output.map(row => row.is_tax_inclusive)).toEqual([false, false, false, false]);
  });

  it.each(["same-batch", "existing"] as const)("refuses a duplicate nonnull active pair (%s) and atomically discards the complete batch", async mode => {
    const input = mode === "same-batch" ? [{ attribute: "duplicate149", value: "same" }, { attribute: "duplicate149", value: "same" }]
      : [{ attribute: "unique-before-refusal149", value: "new" }, { attribute: "currency_code", value: "existing149" }];
    const before = await connected.snapshot(); await expect(run(input)).rejects.toBeDefined(); noMutation(before, await connected.snapshot());
  });

  it("permits a fresh active pair beside an unchanged historical tombstone", async () => {
    const prior = await connected.read([connected.tombstoneId]);
    const output = await run([{ attribute: "currency_code", value: "history149" }]);
    expect(output).toHaveLength(1); expect(output[0]?.id).not.toBe(connected.tombstoneId);
    expect(await connected.read([connected.tombstoneId])).toEqual(prior);
  });

  it("retains genuine created IDs and invokes the native physical inverse, including predeleted and repeated callbacks", async () => {
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const created = await Effect.runPromise(forward.run(forward.newRequestKey(), [{ attribute: "inverse149", value: "a" }, { attribute: "inverse149", value: "b" }]));
    expect(created.compensation).toEqual(created.output.map(row => row.id));
    const before = await connected.snapshot(), remove = vi.spyOn(PricingModuleService.prototype, "deletePricePreferences");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(created.compensation);
      expect(await connected.read(created.compensation)).toEqual([]);
      const after = await connected.snapshot();
      // The native callback receives raw retained IDs. Native DELETE RETURNING
      // specifies no ordering; this adapter's existing physical lifecycle owner
      // emits the selected rows in canonical ID order, independently of input.
      const selected = created.output.map(row => ({ ...row, id: Schema.decodeUnknownSync(Schema.String)(row.id) }));
      expect(eventIds(eventsSince(before, after))).toEqual(orderNativeIdRows(selected, {}).map(row => row.id));
      expect(eventsSince(before, after).every(event => event.envelope.contract === "pricing.price-preference.deleted")).toBe(true);
      const repeatedBefore = await connected.snapshot();
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.compensation))).toBeNull();
      expect(remove.mock.calls[1]?.[0]).toEqual(created.compensation); noMutation(repeatedBefore, await connected.snapshot());
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [connected.tombstoneId]))).toBeNull();
      expect(await connected.read([connected.tombstoneId])).toEqual([]);
    } finally { remove.mockRestore(); }
  });

  it.each(["missing-output-field", "forged-event"] as const)("rejects %s after native staging and discards every durable effect", async mode => {
    const original = PricingModuleService.prototype.createPricePreferences;
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (mode === "missing-output-field") {
        const first: unknown = result[0];
        if (typeof first !== "object" || first === null) throw new Error("Missing complete native Preference result");
        Reflect.deleteProperty(first, "updated_at");
      } else {
        const bus: unknown = Reflect.get(this, "eventBusModuleService_");
        if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine Pricing event bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native event emitter");
        await Reflect.apply(emit, bus, [[{ name: "pricing.price-preference.created", data: { id: "forged149" },
          metadata: { source: "pricing", object: "price_preference", action: "created" } }], { internal: true }]);
      }
      return result;
    });
    try {
      const before = await connected.snapshot(); await expect(run([{ attribute: "invalid-native149", value: mode }])).rejects.toBeDefined();
      noMutation(before, await connected.snapshot());
    } finally { create.mockRestore(); }
  });
  it("keeps genuine forward calls under late-parent rollback and latches caught unknown resources", async () => {
    for (const configuration of [{ lateFailure: true }, { caughtRefusal: true }]) {
      const host = await connected.prepareWrapped(configuration), before = await connected.snapshot();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), [{ attribute: "late149", value: String(configuration.lateFailure) }]))).rejects.toBeDefined();
      noMutation(before, await connected.snapshot());
    }
  });

  it("exposes only Pricing create/delete and the event sink and revokes escaped methods", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: resources => {
      expect(Object.keys(resources ?? {}).sort()).toEqual(["event_bus", "pricing"]);
      const pricing: unknown = Reflect.get(Object(resources), "pricing");
      expect(Object.keys(Object(pricing)).sort()).toEqual(["createPricePreferences", "deletePricePreferences"]);
    }, escape: method => { escaped = method; } });
    await Effect.runPromise(host.run(host.newRequestKey(), [{ attribute: "escape149", value: "new" }]));
    if (escaped === undefined) throw new Error("Missing genuine retained Pricing method");
    const before = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); noMutation(before, await connected.snapshot());
  });

  it("captures detached input without freezing caller values and rejects getters and unsupported fields", async () => {
    const host = await connected.prepare(), supplied = [{ attribute: "ownership149", value: "before" }];
    const original = PricingModuleService.prototype.createPricePreferences;
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      supplied[0]!.value = "after"; return Reflect.apply(original, this, args);
    });
    try { const output = await Effect.runPromise(host.run(host.newRequestKey(), supplied)); expect(output[0]?.value).toBe("before"); }
    finally { create.mockRestore(); }
    expect(Object.isFrozen(supplied)).toBe(false); expect(Object.isFrozen(supplied[0])).toBe(false);
    const getter = vi.fn(() => "getter149"), getterInput = [Object.defineProperty({}, "attribute", { get: getter, enumerable: true })];
    const before = await connected.snapshot();
    for (const input of [getterInput, Array.from({ length: 5 }, (_, index) => ({ attribute: "overflow149", value: String(index) })),
      [{ attribute: "managed149", id: "supplied" }], [{ attribute: "extra149", arbitrary: true }], [{ attribute: 1 }]])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
  });

  it("refuses authentic other Pricing profiles and forged identity before module getters", async () => {
    const other = await Effect.runPromise(makeLocalPricingCommands("create"));
    await expect(Effect.runPromise(prepareCreatePricePreferencesWorkflow({ ...connected.options,
      pricing: { ...connected.options.pricing, module: other.workflow } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    const getter = vi.fn(() => connected.pricing.workflow.methods);
    const forged = Object.defineProperty({ ...connected.pricing.workflow }, "methods", { get: getter, enumerable: true });
    await expect(Effect.runPromise(prepareCreatePricePreferencesWorkflow({ ...connected.options,
      pricing: { ...connected.options.pricing, module: forged } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("recovers a lost commit acknowledgement without native reexecution and binds the revision", async () => {
    let lose = true; const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price Preference commit acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareCreatePricePreferencesWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareCreatePricePreferencesWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences");
    try {
      const key = host.newRequestKey(), input = [{ attribute: "uncertain149", value: "new" }];
      const output = await Effect.runPromise(host.run(key, input)); expect(lose).toBe(false); expect(create).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(create).toHaveBeenCalledTimes(1); await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { create.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels staged native writes and fences their late completion", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const original = PricingModuleService.prototype.createPricePreferences;
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release)); return result;
      } finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), [{ attribute: "cancel149", value: "new" }]));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      noMutation(before, await connected.snapshot()); await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); create.mockRestore(); }
  }, 120_000);

  it.skipIf(driver !== "postgres")("allows competing callbacks and settles only one identical nonnull preference pair", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = PricingModuleService.prototype.createPricePreferences;
    let count = 0;
    const create = vi.spyOn(PricingModuleService.prototype, "createPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), input = [{ attribute: "competing149", value: "new" }];
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), input)));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), input)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(count).toBe(2); expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.flatMap(result => result._tag === "Failure" ? failures(result.cause) : [])).toContain("writeConflict");
      const after = await connected.snapshot(); expect(after.commits.length - before.commits.length).toBe(1);
      expect(eventsSince(before, after)).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); create.mockRestore(); }
  }, 120_000);
});
