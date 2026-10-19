import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { Link } from "@medusajs/modules-sdk/link";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareDeletePricePreferencesWorkflow } from "../src/workflows/pricing/delete-price-preferences";
import { prepareLogicalPricePreferenceDeletion } from "./support/logical-price-preference-delete-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPricePreferenceDeletion>>;
let primary: Effect.Success<ReturnType<typeof prepareDeletePricePreferencesWorkflow>> | undefined;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const a = "prpref151-a", b = "prpref151-b", c = "prpref151-c", d = "prpref151-d", missing = "prpref151-missing";
const run = async (input: string[]) => {
  const host = primary ??= await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
};
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventIds = (events: Snapshot["events"]) => events.map(event => {
  const message = event.envelope.message;
  if (message === undefined || !isJsonObject(message) || message.data === undefined || !isJsonObject(message.data) || typeof message.data.id !== "string")
    throw new Error("Missing genuine native preference deletion event");
  return message.data.id;
});
const stable = (rows: readonly Record<string, unknown>[]) => rows.map(row => Object.fromEntries(Object.entries(row)
  .filter(([key]) => key !== "updated_at" && key !== "deleted_at")));
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};

describe(`genuine native Price Preference deletion - ${driver}`, { concurrent: false }, () => {
  let protectedRows: Awaited<ReturnType<typeof connected.read>>;
  beforeAll(async () => {
    connected = await prepareLogicalPricePreferenceDeletion(driver, close => cleanup.push(close));
    protectedRows = await connected.read(connected.protectedIds);
  }, 240_000);
  afterEach(async () => {
    primary = undefined; await connected.closeCaseHosts();
    expect(await connected.read(connected.protectedIds)).toEqual(protectedRows);
    await connected.reset();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps both native empty dependencies and restores Link even when Pricing inverse skips", async () => {
    expect(connected.native.nodes.filter(node => node.kind === "step").map(node => node.name))
      .toEqual(["delete-price-preferences", "remove-remote-links"]);
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences"), restore = vi.spyOn(PricingModuleService.prototype, "restorePricePreferences");
    const unlink = vi.spyOn(Link.prototype, "delete"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      const host = await connected.prepare(), key = host.newRequestKey(), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(key, []))).toBeNull();
      expect(remove).toHaveBeenCalledTimes(1); expect(remove.mock.calls[0]?.[0]).toEqual([]);
      expect(await remove.mock.results[0]?.value).toEqual({});
      expect(unlink).toHaveBeenCalledTimes(1); expect(unlink.mock.calls[0]?.[0]).toEqual({ pricing: { price_preference_id: [] } });
      expect(await unlink.mock.results[0]?.value).toEqual([null, {}]);
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(unlink.mock.invocationCallOrder[0] ?? 0);
      expect(await Effect.runPromise(host.run(key, []))).toBeNull(); expect(remove).toHaveBeenCalledTimes(1); expect(unlink).toHaveBeenCalledTimes(1);
      const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), []));
      expect(retained).toEqual({ pricing: [], link: { pricing: { price_preference_id: [] } } });
      const inverse = await connected.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(restore).not.toHaveBeenCalled(); expect(relink).toHaveBeenCalledTimes(1);
      expect(relink.mock.calls[0]?.[0]).toEqual(retained.link); noMutation(before, await connected.snapshot());
    } finally { remove.mockRestore(); restore.mockRestore(); unlink.mockRestore(); relink.mockRestore(); }
  });

  it("deletes four complete rows under default budgets with native ID ordering and only deleted events", async () => {
    const beforeRows = await connected.read(), before = await connected.snapshot(), input = [d, b, a, c];
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      let calls = 0; const host = await connected.prepare();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(input);
      expect(await remove.mock.results[0]?.value).toEqual({ price_preference_id: [a, b, c, d] });
      expect(unlink.mock.calls[0]?.[0]).toEqual({ pricing: { price_preference_id: input } });
      const rows = await connected.read(), after = await connected.snapshot(), events = eventsSince(before, after);
      expect(stable(rows)).toEqual(stable(beforeRows));
      expect(rows.every(row => typeof row.deleted_at === "string" && typeof row.updated_at === "string")).toBe(true);
      expect(rows.map(row => row.updated_at)).not.toEqual(beforeRows.map(row => row.updated_at));
      expect(eventIds(events)).toEqual([a, b, c, d]); expect(events.every(event => event.envelope.contract === "pricing.price-preference.deleted")).toBe(true);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(events).toHaveLength(4);
      console.info("Price Preference deletion maximum", { calls, messages: events.length });
    } finally { remove.mockRestore(); unlink.mockRestore(); }
  });

  it("retains duplicate raw IDs while native matched rows, maps and events are deduplicated", async () => {
    const forward = await connected.prepareForward(), input = [b, a, b, missing], before = await connected.snapshot();
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences"), restore = vi.spyOn(PricingModuleService.prototype, "restorePricePreferences");
    const relink = vi.spyOn(Link.prototype, "restore");
    try {
      const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), input));
      expect(retained).toEqual({ pricing: input, link: { pricing: { price_preference_id: input } } });
      expect(await remove.mock.results[0]?.value).toEqual({ price_preference_id: [a, b] });
      const deleted = await connected.snapshot(); expect(eventIds(eventsSince(before, deleted))).toEqual([a, b]);
      const inverse = await connected.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(restore.mock.calls[0]?.[0]).toEqual(input); expect(await restore.mock.results[0]?.value).toEqual({ price_preference_id: [a, b] });
      expect(relink.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
      expect((await connected.read([a, b])).every(row => row.deleted_at === null)).toBe(true);
      expect(eventsSince(deleted, await connected.snapshot())).toEqual([]);
    } finally { remove.mockRestore(); restore.mockRestore(); relink.mockRestore(); }
  });

  it("keeps missing, empty and arbitrary public ID strings as no-match without changing rows or events", async () => {
    const host = await connected.prepare(), before = await connected.snapshot(), input = [missing, "", "not a preference / 151", "x".repeat(256)];
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(input); expect(await remove.mock.results[0]?.value).toEqual({});
      noMutation(before, await connected.snapshot());
    } finally { remove.mockRestore(); }
  });

  it("does not dirty a repeated soft deletion or an already-active native restore, while retaining selected map IDs", async () => {
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a, b]));
    const deleted = await connected.snapshot(), deletedRows = await connected.read([a, b]);
    expect(await run([a, b])).toBeNull(); noMutation(deleted, await connected.snapshot()); expect(await connected.read([a, b])).toEqual(deletedRows);
    await connected.restore([a, b]);
    const active = await connected.snapshot(), activeRows = await connected.read([a, b]), restore = vi.spyOn(PricingModuleService.prototype, "restorePricePreferences");
    try {
      const inverse = await connected.prepareInverse(true);
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(restore).toHaveBeenCalledTimes(2);
      for (const result of restore.mock.results) expect(await result.value).toEqual({ price_preference_id: [a, b] });
      expect(await connected.read([a, b])).toEqual(activeRows); noMutation(active, await connected.snapshot());
    } finally { restore.mockRestore(); }
  });

  it("preserves raw-ID native compensation that resurrects a requested preexisting tombstone without events", async () => {
    const historyBefore = await connected.read([connected.historyId]), before = await connected.snapshot();
    expect(historyBefore[0]?.deleted_at).toEqual(expect.any(String));
    const forward = await connected.prepareForward(), input = [connected.historyId, missing, connected.historyId];
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), input));
    noMutation(before, await connected.snapshot()); expect(retained.pricing).toEqual(input);
    const inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePricePreferences");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(await restore.mock.results[0]?.value).toEqual({ price_preference_id: [connected.historyId] });
      const rows = await connected.read([connected.historyId]); expect(rows[0]?.deleted_at).toBeNull();
      expect(stable(rows)).toEqual(stable(historyBefore)); expect(rows[0]?.updated_at).not.toEqual(historyBefore[0]?.updated_at);
      expect(eventsSince(before, await connected.snapshot())).toEqual([]);
    } finally { restore.mockRestore(); }
  });

  it("restores mixed active/history/nullable targets with the actual retained pair and allows another NULL unique key", async () => {
    const forward = await connected.prepareForward(), before = await connected.snapshot(), input = [c, connected.historyId, a, missing];
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), input));
    expect(eventIds(eventsSince(before, await connected.snapshot()))).toEqual([a, c]);
    const neighbor = await connected.create([{ attribute: "region_id", value: null }]); expect(neighbor).toHaveLength(1);
    const deleted = await connected.snapshot(), inverse = await connected.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
    expect((await connected.read([a, c, connected.historyId])).every(row => row.deleted_at === null)).toBe(true);
    expect(eventsSince(deleted, await connected.snapshot())).toEqual([]);
  });

  it("retries rolled-back atomic inverse requests and replays only the committed success without callbacks", async () => {
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a, b]));
    const collision = (await connected.create([{ attribute: "currency_code", value: "usd" }]))[0]?.id;
    if (collision === undefined) throw new Error("Missing genuine native collision fixture ID");
    const before = await connected.snapshot(), deletedRows = await connected.read([a, b]);
    const inverse = await connected.prepareInverse(), key = inverse.newRequestKey();
    const restore = vi.spyOn(PricingModuleService.prototype, "restorePricePreferences"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      const result = await Effect.runPromise(Effect.exit(inverse.run(key, retained)));
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Native unique restore unexpectedly succeeded");
      const firstAttempt = await connected.snapshot();
      noMutation(before, firstAttempt); expect(firstAttempt.outcomes).toEqual(before.outcomes);
      expect(await connected.read([a, b])).toEqual(deletedRows);
      const failureReasons = reasons(result.cause);
      // The existing commerce boundary maps uniqueness to invalidInput and
      // preserves the enclosing rollbackOnly failure; no uniqueConflict tag exists.
      expect(failureReasons, failureReasons.join(" -> ")).toEqual(expect.arrayContaining(["invalidInput", "rollbackOnly"]));
      expect(restore).toHaveBeenCalledTimes(1); expect(relink).toHaveBeenCalledTimes(1);
      // Failed finite atomic attempts retain no outcome. Retrying their key
      // executes these actual callbacks again; it is not native SDK.cancel.
      const retry = await Effect.runPromise(Effect.exit(inverse.run(key, retained)));
      expect(retry._tag).toBe("Failure");
      if (retry._tag !== "Failure") throw new Error("Native unique restoration retry unexpectedly succeeded");
      const retryReasons = reasons(retry.cause);
      expect(retryReasons, retryReasons.join(" -> ")).toEqual(expect.arrayContaining(["invalidInput", "rollbackOnly"]));
      expect(restore).toHaveBeenCalledTimes(2); expect(relink).toHaveBeenCalledTimes(2);
      const secondAttempt = await connected.snapshot();
      noMutation(before, secondAttempt); expect(secondAttempt.outcomes).toEqual(before.outcomes);
      expect(await connected.read([a, b])).toEqual(deletedRows);
      await connected.hardRemove([collision]);
      const repaired = await connected.snapshot();
      expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
      expect(restore).toHaveBeenCalledTimes(3); expect(relink).toHaveBeenCalledTimes(3);
      expect(restore.mock.calls.map(args => args[0])).toEqual([retained.pricing, retained.pricing, retained.pricing]);
      expect(relink.mock.calls.map(args => args[0])).toEqual([retained.link, retained.link, retained.link]);
      const restored = await connected.read([a, b]);
      expect(restored.every(row => row.deleted_at === null)).toBe(true); expect(stable(restored)).toEqual(stable(deletedRows));
      const committed = await connected.snapshot();
      expect(committed.outcomes.length - repaired.outcomes.length).toBe(1); expect(eventsSince(repaired, committed)).toEqual([]);
      expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
      expect(restore).toHaveBeenCalledTimes(3); expect(relink).toHaveBeenCalledTimes(3);
      expect(await connected.snapshot()).toEqual(committed);
    } finally { restore.mockRestore(); relink.mockRestore(); }
  });

  it("preserves the native historical-only collision rather than changing or filtering the retained IDs", async () => {
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [connected.historyId]));
    await connected.create([{ attribute: "currency_code", value: "history151" }]);
    const before = await connected.snapshot(), inverse = await connected.prepareInverse();
    const result = await Effect.runPromise(Effect.exit(inverse.run(inverse.newRequestKey(), retained)));
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Native historical unique restore unexpectedly succeeded");
    noMutation(before, await connected.snapshot());
    const failureReasons = reasons(result.cause);
    // The same stable boundary mapping applies to a preexisting-history collision.
    expect(failureReasons, failureReasons.join(" -> ")).toEqual(expect.arrayContaining(["invalidInput", "rollbackOnly"]));
    expect((await connected.read([connected.historyId]))[0]?.deleted_at).toEqual(expect.any(String));
  });

  it("leaves a genuinely physically removed row absent during original retained restoration", async () => {
    const created = await connected.create([{ attribute: "physical151", value: "remove" }]), id = created[0]?.id;
    if (id === undefined) throw new Error("Missing actual native fixture-created ID");
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [id]));
    await connected.hardRemove([id]);
    const before = await connected.snapshot(), inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePricePreferences");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(await restore.mock.results[0]?.value).toEqual({}); expect(await connected.read([id])).toEqual([]);
      noMutation(before, await connected.snapshot());
    } finally { restore.mockRestore(); }
  });

  it("runs the complete child graph before a late parent failure and publishes no staged native mutation or event", async () => {
    const host = await connected.prepareWrapped({ lateFailure: true }), before = await connected.snapshot();
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      await expect(Effect.runPromise(host.run(host.newRequestKey(), [d, connected.historyId, a, missing]))).rejects.toBeDefined();
      expect(remove).toHaveBeenCalledTimes(1); expect(unlink).toHaveBeenCalledTimes(1); noMutation(before, await connected.snapshot());
    } finally { remove.mockRestore(); unlink.mockRestore(); }
  });

  it("exposes only the admitted lifecycle, event sink and real Link; revokes escaped native methods", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: resources => {
      expect(Object.keys(Object(resources)).sort()).toEqual(["event_bus", "link", "pricing"]);
      expect(Object.keys(Object(Reflect.get(Object(resources), "pricing"))).sort()).toEqual(["restorePricePreferences", "softDeletePricePreferences"]);
      expect(Object.keys(Object(Reflect.get(Object(resources), "link"))).sort()).toEqual(["delete", "restore"]);
    }, escape: method => { escaped = method; } });
    expect(await Effect.runPromise(host.run(host.newRequestKey(), []))).toBeNull();
    if (escaped === undefined) throw new Error("Missing genuine escaped native lifecycle method");
    const before = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); noMutation(before, await connected.snapshot());
    const caught = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(caught.run(caught.newRequestKey(), [a]))).rejects.toMatchObject({ reason: "unsupportedProfile" });
    noMutation(before, await connected.snapshot());
  });

  it("captures raw input ownership and refuses invalid arrays without reading getters or widening the native type", async () => {
    const host = await connected.prepare(), supplied = [a], original = PricingModuleService.prototype.softDeletePricePreferences;
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      supplied[0] = b; return Reflect.apply(original, this, args);
    });
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), supplied))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual([a]); expect((await connected.read([a]))[0]?.deleted_at).toEqual(expect.any(String));
      expect((await connected.read([b]))[0]?.deleted_at).toBeNull();
    } finally { remove.mockRestore(); }
    expect(supplied).toEqual([b]); expect(Object.isFrozen(supplied)).toBe(false);
    const getter = vi.fn(() => a), getterArray = Object.defineProperty([], "0", { enumerable: true, get: getter });
    const before = await connected.snapshot();
    for (const input of [getterArray, [a, b, c, d, missing], ["x".repeat(257)], [null], [1], null, a, { ids: [a] }])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
  });

  it("refuses other authentic Pricing profiles, forged identities and omitted Link before native execution", async () => {
    for (const profile of ["price-preferences", "price-preference-updates", "create"] as const) {
      const other = await Effect.runPromise(makeLocalPricingCommands(profile));
      await expect(Effect.runPromise(prepareDeletePricePreferencesWorkflow({ ...connected.options,
        pricing: { ...connected.options.pricing, module: other.workflow } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    }
    const getter = vi.fn(() => connected.pricing.workflow.methods), forged = Object.defineProperty({ ...connected.pricing.workflow }, "methods", { get: getter, enumerable: true });
    await expect(Effect.runPromise(prepareDeletePricePreferencesWorkflow({ ...connected.options,
      pricing: { ...connected.options.pricing, module: forged } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(getter).not.toHaveBeenCalled();
    const withoutLink = Object.fromEntries(Object.entries(connected.options).filter(([name]) => name !== "link"));
    await expect(Effect.runPromise(Reflect.apply(prepareDeletePricePreferencesWorkflow, undefined, [withoutLink]))).rejects.toBeDefined();
  });

  it("recovers a lost commit acknowledgement and binds both raw payload and workflow revision without reexecuting native calls", async () => {
    let lose = true; const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost preference deletion commit acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareDeletePricePreferencesWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareDeletePricePreferencesWorkflow({ ...connected.options, revision: "f".repeat(64) }));
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      const key = host.newRequestKey(), input = [b, a, b];
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(lose).toBe(false);
      expect(remove).toHaveBeenCalledTimes(1); expect(unlink).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(remove).toHaveBeenCalledTimes(1); expect(unlink).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, [a, b]))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { remove.mockRestore(); unlink.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels staged deletion before Link executes and fences native late completion", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const original = PricingModuleService.prototype.softDeletePricePreferences;
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release)); return result;
      } finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    const unlink = vi.spyOn(Link.prototype, "delete");
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), [a]));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      expect(unlink).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); remove.mockRestore(); unlink.mockRestore(); }
  }, 120_000);

  it.skipIf(driver !== "postgres")("lets competing native callbacks stage deletion and settles a single event with a write conflict", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = PricingModuleService.prototype.softDeletePricePreferences;
    let count = 0;
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), [a])));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), [a])));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(count).toBe(2); expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.flatMap(result => result._tag === "Failure" ? reasons(result.cause) : [])).toContain("writeConflict");
      const after = await connected.snapshot(); expect(after.commits.length - before.commits.length).toBe(1);
      expect(eventIds(eventsSince(before, after))).toEqual([a]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); remove.mockRestore(); }
  }, 120_000);
});
