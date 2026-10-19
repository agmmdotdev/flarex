import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { sql } from "drizzle-orm";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { PricePreferenceUpdateInput } from "../src/modules/pricing/preference-input";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareUpdatePricePreferencesWorkflow } from "../src/workflows/pricing/update-price-preferences";
import { PricePreferenceUpdateProbeOutput, prepareLogicalPricePreferenceUpdate } from "./support/logical-price-preference-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPricePreferenceUpdate>>;
let primary: Effect.Success<ReturnType<typeof prepareUpdatePricePreferencesWorkflow>> | undefined;
type Input = typeof PricePreferenceUpdateInput.Type;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const a = "prpref150-a", b = "prpref150-b", c = "prpref150-c", d = "prpref150-d";
const ids = (rows: readonly Record<string, unknown>[]) => rows.map(row => row.id);
const run = async (input: Input) => {
  const host = primary ??= await connected.prepare();
  try { return await Effect.runPromise(host.run(host.newRequestKey(), input)); }
  catch (cause) { throw new Error(`Native Price Preference update failed for ${JSON.stringify(input)}`, { cause }); }
};
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(previous =>
  previous.scopeUuid === event.scopeUuid && previous.commitSeq === event.commitSeq && previous.eventOrdinal === event.eventOrdinal));
const eventIds = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (message === undefined || !isJsonObject(message) || message.data === undefined || !isJsonObject(message.data))
    throw new Error("Missing actual Pricing event data");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
});
const business = (rows: readonly Record<string, unknown>[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updated_at")));
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};

describe(`genuine native Price Preference update - ${driver}`, { concurrent: false }, () => {
  let protectedRows: Awaited<ReturnType<typeof connected.read>>;
  beforeAll(async () => {
    connected = await prepareLogicalPricePreferenceUpdate(driver, close => cleanup.push(close));
    protectedRows = await connected.read(connected.protectedIds);
  }, 240_000);
  afterEach(async () => {
    primary = undefined;
    await connected.closeCaseHosts();
    expect(await connected.read(connected.protectedIds)).toEqual(protectedRows);
    await connected.reset();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("executes the complete bounded selector grammar without mutating equal or empty updates", async () => {
    const cases: ReadonlyArray<Readonly<{ selector: Input["selector"]; expected: readonly string[] }>> = [
      { selector: {}, expected: [a, b, c, d] },
      { selector: { id: a }, expected: [a] },
      { selector: { id: [d, b, a] }, expected: [a, b, d] },
      { selector: { attribute: "currency_code" }, expected: [a, b, d] },
      { selector: { value: null }, expected: [c] },
      { selector: { value: { $eq: "usd" } }, expected: [a] },
      { selector: { value: { $ne: "usd" } }, expected: [b, d] },
      { selector: { value: { $in: ["EUR", "usd"] } }, expected: [a, b] },
      { selector: { value: { $in: [] } }, expected: [] },
      { selector: { value: { $nin: ["usd"] } }, expected: [b, d] },
      { selector: { value: { $nin: [] } }, expected: [a, b, c, d] },
      { selector: { value: { $gt: "EUR" } }, expected: [a, d] },
      { selector: { value: { $gte: "EUR" } }, expected: [a, b, d] },
      { selector: { value: { $lt: "usd" } }, expected: [b, d] },
      { selector: { value: { $lte: "usd" } }, expected: [a, b, d] },
      { selector: { value: { $like: "%u%" } }, expected: [a] },
      { selector: { value: { $ilike: "eur" } }, expected: [b] },
      { selector: { value: { $re: "^u[[:alpha:]]+$" } }, expected: [a] },
      { selector: { value: { $exists: false } }, expected: [c] },
      { selector: { value: { $exists: true } }, expected: [a, b, d] },
      { selector: { $or: [{ value: "EUR" }, { value: null }] }, expected: [b, c] },
      { selector: { $and: [{ attribute: "currency_code" }, { value: { $nin: ["usd"] } }] }, expected: [b, d] },
      { selector: { $or: [] }, expected: [a, b, c, d] },
      { selector: { $and: [] }, expected: [a, b, c, d] },
      { selector: { id: "absent150" }, expected: [] },
      { selector: { id: "prpref150-history" }, expected: [] },
    ];
    const before = await connected.snapshot();
    const list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences"), update = vi.spyOn(PricingModuleService.prototype, "updatePricePreferences");
    try {
      for (const item of cases) {
        const previous = update.mock.calls.length;
        expect(ids(await run({ selector: item.selector, update: {} })), JSON.stringify(item.selector)).toEqual(item.expected);
        expect(update.mock.calls.length).toBe(previous + 1);
      }
      expect(list.mock.calls.some(call => Array.isArray(call[1]?.select) && call[1].select.length === 1 && call[1].select[0] === "id")).toBe(true);
      noMutation(before, await connected.snapshot());
    } finally { list.mockRestore(); update.mockRestore(); }
  });

  it("runs the actual facade for equal values and explicit undefined without dirty timestamps or events", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    const update = vi.spyOn(PricingModuleService.prototype, "updatePricePreferences");
    try {
      const equal: readonly Input[] = [
        { selector: { id: a }, update: { attribute: "currency_code" } },
        { selector: { id: a }, update: { value: "usd" } },
        { selector: { id: [a, b] }, update: { is_tax_inclusive: false } },
      ];
      for (const input of equal) expect((await Effect.runPromise(host.run(host.newRequestKey(), input))).length).toBeGreaterThan(0);
      const supplied = { selector: { id: a }, update: { value: undefined } };
      const output: unknown = await Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), supplied]));
      expect(output).toEqual(await connected.read([a]));
      expect(update).toHaveBeenCalledTimes(4);
      expect(update.mock.calls.at(-1)?.[1]).toEqual({});
      expect(Object.hasOwn(supplied.update, "value")).toBe(true);
      noMutation(before, await connected.snapshot());
    } finally { update.mockRestore(); }
  });

  it("retains native PostgreSQL escaping, Unicode characters, case and simple fulltext semantics", async () => {
    // Locale is engine provenance, not an adapter case-folding rule. Probe the
    // same fixture database using ASCII-only SQL and explicit Unicode codepoints.
    const locale = await connected.fixture.persistence.drizzle.select({
      collation: sql<string>`datcollate::text`, ctype: sql<string>`datctype::text`,
      lower_match: sql<boolean>`('caf' || chr(233)) ilike ('CaF' || chr(201))`,
      upper_match: sql<boolean>`('CAF' || chr(201)) ilike ('CaF' || chr(201))`,
      explicit_c_lower_match: sql<boolean>`(('caf' || chr(233)) collate "C") ilike ('CaF' || chr(201))`,
    }).from(sql`pg_catalog.pg_database`).where(sql`datname = current_database()`);
    expect(locale).toEqual([{ collation: "C", ctype: driver === "pglite" ? "C.UTF-8" : "C",
      lower_match: driver === "pglite", upper_match: true, explicit_c_lower_match: false }]);
    // Corpus rows use distinct raw attributes so native immediate uniqueness
    // never depends on another row having moved to its next text value first.
    const values = async (entries: readonly (string | null)[]) => connected.set(connected.targetIds.map((id, index) =>
      ({ id, attribute: `text150-${index}`, value: entries[index] ?? null })));
    await values(["a%b", "a_b", "a\\b", "plain"]);
    for (const [pattern, expected] of [["a\\%b", [a]], ["a\\_b", [b]], ["a\\\\b", [c]]] as const)
      expect(ids(await run({ selector: { value: { $like: pattern } }, update: {} }))).toEqual(expected);
    await values(["é", "😀", "e\u0301", "xx"]);
    expect(ids(await run({ selector: { value: { $like: "_" } }, update: {} }))).toEqual([a, b]);
    expect(ids(await run({ selector: { value: { $like: "__" } }, update: {} }))).toEqual([c, d]);
    await values(["café", "CAFÉ", "cafe\u0301", "fox"]);
    expect(ids(await run({ selector: { value: "café" }, update: {} }))).toEqual([a]);
    // The preserved native PostgreSQL baseline uses ctype C. PGlite's real
    // ctype C.UTF-8 also folds this accented lowercase character.
    expect(ids(await run({ selector: { value: { $ilike: "CaFÉ" } }, update: {} }))).toEqual(driver === "pglite" ? [a, b] : [b]);
    await values(["run", "running", "the fox", "fox"]);
    expect(ids(await run({ selector: { value: { $fulltext: "run" } }, update: {} }))).toEqual([a]);
    expect(ids(await run({ selector: { value: { $fulltext: "the" } }, update: {} }))).toEqual([c]);
    expect(ids(await run({ selector: { value: { $fulltext: '"the fox"' } }, update: {} }))).toEqual([c]);
  });

  it("preserves whole-predicate native regex errors and the observed Boolean suppression cases", async () => {
    const before = await connected.snapshot();
    const regex = { value: { $re: "[" } };
    for (const selector of [regex, { id: "absent150", ...regex }, { value: { $re: "[", $exists: false } }])
      await expect(run({ selector, update: {} })).rejects.toBeDefined();
    expect(await run({ selector: { $and: [{ id: { $in: [] } }, regex] }, update: {} })).toEqual([]);
    expect(ids(await run({ selector: { $or: [{ id: { $nin: [] } }, regex] }, update: {} }))).toEqual([a, b, c, d]);
    expect(await run({ selector: { $and: [{ value: "usd" }, { value: "EUR" }, regex] }, update: {} })).toEqual([]);
    noMutation(before, await connected.snapshot());
  });

  it("omits native empty SQL fragments inside groups while preserving sparse mutation and actual compensation", async () => {
    const cases: ReadonlyArray<Readonly<{ selector: Input["selector"]; expected: readonly string[] }>> = [
      { selector: { $or: [{}, { id: a }] }, expected: [a] },
      { selector: { $or: [{ id: a }, {}] }, expected: [a] },
      { selector: { $or: [{ $or: [] }, { id: a }] }, expected: [a] },
      { selector: { $or: [{ id: a }, { $or: [] }] }, expected: [a] },
      { selector: { $or: [{ $and: [] }, { id: a }] }, expected: [a] },
      { selector: { $or: [{ id: a }, { $and: [] }] }, expected: [a] },
      { selector: { $or: [{ value: {} }, { id: a }] }, expected: [a] },
      { selector: { $or: [{ id: a }, { value: {} }] }, expected: [a] },
      { selector: { $or: [{}, {}] }, expected: [a, b, c, d] },
      { selector: { $or: [{ $or: [] }, { $and: [] }] }, expected: [a, b, c, d] },
      { selector: { $or: [{ value: {} }, { attribute: {} }] }, expected: [a, b, c, d] },
      { selector: { value: {} }, expected: [a, b, c, d] },
      { selector: { $and: [{}, { id: a }] }, expected: [a] },
      { selector: { $and: [{ $or: [] }, { id: a }] }, expected: [a] },
      { selector: { $and: [{ $and: [] }, { id: a }] }, expected: [a] },
      { selector: { $or: [{ value: {}, id: b }, { id: a }] }, expected: [a, b] },
      { selector: { id: a, $or: [{}, { id: b }] }, expected: [] },
      { selector: { id: a, $or: [{ $or: [] }, { id: b }] }, expected: [] },
      { selector: { $or: [{ $and: [{ $or: [] }, {}] }, { id: a }] }, expected: [a] },
    ];
    const before = await connected.snapshot();
    for (const item of cases) expect(ids(await run({ selector: item.selector, update: {} })), JSON.stringify(item.selector)).toEqual(item.expected);
    noMutation(before, await connected.snapshot());
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse(true);
    const original = await connected.read();
    const changed = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { $or: [{}, { id: a }] }, update: { is_tax_inclusive: true } }));
    expect(ids(changed.output)).toEqual([a]);
    expect(changed.compensation).toEqual([{ id: a, is_tax_inclusive: false }]);
    expect(eventIds(eventsSince(before, await connected.snapshot()))).toEqual([a]);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), changed.compensation));
    expect(business(await connected.read())).toEqual(business(original));
    expect(eventIds(eventsSince(before, await connected.snapshot()))).toEqual([a, a]);
    const restored = await connected.snapshot(), late = await connected.prepareWrapped({ lateFailure: true });
    await expect(Effect.runPromise(late.run(late.newRequestKey(), { selector: { $or: [{ $and: [] }, { id: a }] }, update: { value: "empty-late150" } }))).rejects.toBeDefined();
    noMutation(restored, await connected.snapshot());
  });

  it("retains actual regex errors beside empty fragments and suppresses only native decisive predicates", async () => {
    const fragments: readonly Input["selector"][] = [{}, { $or: [] }, { $and: [] }, { attribute: {} }];
    const before = await connected.snapshot();
    for (const fragment of fragments) for (const reverse of [false, true]) {
      const invalid = { value: { $re: "[" } }, valid = { value: { $re: "^usd$" } };
      const invalidChildren = reverse ? [invalid, fragment] : [fragment, invalid];
      const validChildren = reverse ? [valid, fragment] : [fragment, valid];
      for (const operator of ["$and", "$or"] as const) {
        await expect(run({ selector: { [operator]: invalidChildren }, update: {} })).rejects.toBeDefined();
        expect(ids(await run({ selector: { [operator]: validChildren }, update: {} }))).toEqual([a]);
      }
    }
    const regex = { value: { $re: "[" } };
    expect(ids(await run({ selector: { $or: [{}, { id: { $nin: [] } }, regex] }, update: {} }))).toEqual([a, b, c, d]);
    expect(await run({ selector: { $and: [{}, { id: { $in: [] } }, regex] }, update: {} })).toEqual([]);
    noMutation(before, await connected.snapshot());
  });

  it("returns four complete ordered DTOs, mutates only one dirty row and restores its exact sparse preimage", async () => {
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const before = await connected.snapshot(), original = await connected.read();
    let calls = 0;
    const output = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: [d, c, b, a] }, update: { is_tax_inclusive: false } }).pipe(
      Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) })));
    expect(ids(output.output)).toEqual([a, b, c, d]);
    expect(output.compensation).toEqual(connected.initial.map(row => ({ id: row.id, is_tax_inclusive: row.is_tax_inclusive })));
    for (const row of output.output) expect(Object.keys(row).sort()).toEqual(["id", "attribute", "value", "is_tax_inclusive", "created_at", "updated_at", "deleted_at"].sort());
    const after = await connected.snapshot();
    expect(eventIds(eventsSince(before, after))).toEqual([c]);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.compensation));
    expect(business(await connected.read())).toEqual(business(original));
    const restored = await connected.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.compensation));
    noMutation(restored, await connected.snapshot());
  });

  it("captures only requested mutable fields plus IDs, including ID-only empty and undefined-only updates", async () => {
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse(true);
    const list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences"), upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    try {
      const updates: readonly Input["update"][] = [{ attribute: "renamed150" }, { value: "" }, { value: null }, { is_tax_inclusive: true },
        { attribute: "renamed150", value: "new150", is_tax_inclusive: true }, {}];
      for (const update of updates) {
        const original = await connected.read([a]), before = await connected.snapshot();
        const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: a }, update }));
        const fields = Object.entries(update).filter(([, value]) => value !== undefined).map(([key]) => key);
        expect(result.compensation).toEqual([Object.fromEntries(["id", ...fields].map(key => [key, original[0]?.[key]]))]);
        const last = list.mock.calls.findLast(call => Array.isArray(call[1]?.select));
        // The named workflow method preserves native primary-key injection
        // before the module's strict DAL projection admission.
        expect(last?.[1]).toEqual({ select: ["id", ...fields], relations: [], order: { id: "ASC" } });
        await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
        expect(upsert.mock.calls.at(-1)?.[0]).toEqual(result.compensation);
        expect(business(await connected.read([a]))).toEqual(business(original));
        if (fields.length === 0) noMutation(before, await connected.snapshot());
      }
      const before = await connected.snapshot();
      const raw: unknown = await Effect.runPromise(Reflect.apply(forward.run, forward, [forward.newRequestKey(),
        { selector: { id: a }, update: { value: undefined } }]));
      const undefinedOnly = Schema.decodeUnknownSync(PricePreferenceUpdateProbeOutput)(raw);
      expect(undefinedOnly.compensation).toEqual([{ id: a }]);
      await Effect.runPromise(inverse.run(inverse.newRequestKey(), undefinedOnly.compensation));
      noMutation(before, await connected.snapshot());
    } finally { list.mockRestore(); upsert.mockRestore(); }
  });

  it("keeps empty selector results and empty inverse dependency behavior", async () => {
    const forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences"), update = vi.spyOn(PricingModuleService.prototype, "updatePricePreferences"), upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    try {
      const before = await connected.snapshot();
      const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { selector: { id: [] }, update: { value: "none150" } }));
      expect(result).toEqual({ output: [], compensation: [] });
      expect(list).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
      await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
      expect(upsert).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { list.mockRestore(); update.mockRestore(); upsert.mockRestore(); }
  });

  it("preserves nullable uniqueness, raw empty fields and historical pairs while rolling back real active collisions", async () => {
    const before = await connected.snapshot();
    await expect(run({ selector: { id: [a, b] }, update: { value: "collision150" } })).rejects.toBeDefined();
    noMutation(before, await connected.snapshot());
    expect((await run({ selector: { id: [a, b] }, update: { value: null } })).map(row => row.value)).toEqual([null, null]);
    expect(await run({ selector: { id: a }, update: { attribute: "", value: "" } })).toMatchObject([{ id: a, attribute: "", value: "" }]);
    expect(await run({ selector: { id: a }, update: { attribute: "currency_code", value: "history150" } })).toMatchObject([{ id: a, value: "history150" }]);
  });

  it("retains native forward execution under late-parent failure and latches caught resource refusals", async () => {
    const update = vi.spyOn(PricingModuleService.prototype, "updatePricePreferences");
    try {
      for (const configuration of [{ lateFailure: true }, { caughtRefusal: true }]) {
        const host = await connected.prepareWrapped(configuration), before = await connected.snapshot(), count = update.mock.calls.length;
        await expect(Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: a }, update: { value: "late150" } }))).rejects.toBeDefined();
        expect(update.mock.calls.length).toBe(count + 1); noMutation(before, await connected.snapshot());
      }
    } finally { update.mockRestore(); }
  });

  it("exposes only three Pricing methods, binds the profile and revokes escaped methods", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: resources => {
      expect(Object.keys(Object(resources)).sort()).toEqual(["event_bus", "pricing"]);
      expect(Object.keys(Object(Reflect.get(Object(resources), "pricing"))).sort()).toEqual(["listPricePreferences", "updatePricePreferences", "upsertPricePreferences"]);
    }, escape: work => { escaped = work; } });
    await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: a }, update: {} }));
    if (escaped === undefined) throw new Error("Missing authentic escaped Pricing method");
    const before = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" });
    const other = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
    await expect(Effect.runPromise(prepareUpdatePricePreferencesWorkflow({ ...connected.options,
      pricing: { ...connected.options.pricing, module: other.workflow } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    const getter = vi.fn(() => connected.pricing.workflow.methods);
    const forged = Object.defineProperty({ ...connected.pricing.workflow }, "methods", { get: getter, enumerable: true });
    await expect(Effect.runPromise(prepareUpdatePricePreferencesWorkflow({ ...connected.options,
      pricing: { ...connected.options.pricing, module: forged } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
  });

  it("replays the committed result once and binds payload/revision without repeating native calls", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), input: Input = { selector: { id: a }, update: { value: "replay150" } };
    const update = vi.spyOn(PricingModuleService.prototype, "updatePricePreferences");
    const changed = await Effect.runPromise(prepareUpdatePricePreferencesWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    try {
      const output = await Effect.runPromise(host.run(key, input)), after = await connected.snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(update).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ...input, update: {} }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { update.mockRestore(); await Effect.runPromise(changed.close); }
  });

  it("rejects managed fields, getters and unsupported public inputs before durable effects", async () => {
    const host = await connected.prepare(), getter = vi.fn(() => "usd"), before = await connected.snapshot();
    const foreign = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    for (const input of [{ selector: { id: a }, update: foreign }, { selector: { id: a }, update: { id: a } },
      { selector: { id: a }, update: { created_at: "2026-01-01" } }, { selector: { id: a }, update: { extra: true } },
      { selector: { unexpected: "usd" }, update: {} }, { selector: { id: a }, update: { is_tax_inclusive: "false" } }])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
  });

  it("enforces the existing normalized core predicate budget after native selector wrappers", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    const scalar = (count: number): Input["selector"] => ({ $or: Array.from({ length: count }, () => ({ id: a })) });
    const comparison = (count: number): Input["selector"] => ({ $or: Array.from({ length: count }, () => ({ id: { $eq: a } })) });
    const nested = (leaf: Input["selector"]): Input["selector"] => ({ $and: [{ $and: [{ $and: [leaf] }] }] });
    // Native field/group wrappers and the active-row predicate consume the
    // same 64 normalized nodes and depth eight as every admitted core caller.
    for (const selector of [scalar(30), comparison(20), nested({ id: a })])
      expect(ids(await Effect.runPromise(host.run(host.newRequestKey(), { selector, update: {} })))).toEqual([a]);
    for (const selector of [scalar(31), comparison(21), nested({ id: { $eq: a } })]) {
      const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector, update: {} }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Over-budget native selector unexpectedly succeeded");
      expect(reasons(exit.cause)).toContain("limitExceeded");
    }
    noMutation(before, await connected.snapshot());
  });

  it("cancels after genuine native staging through an empty branch and fences the late parent callback", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>();
    const host = await connected.prepareWrapped({ afterNative: async () => {
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      try { await Effect.runPromise(Deferred.await(release)); } finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    } });
    const before = await connected.snapshot();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { $or: [{}, { id: a }] }, update: { value: "cancel150" } }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber); expect(Exit.isFailure(exit)).toBe(true);
      })));
      noMutation(before, await connected.snapshot());
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000)));
      noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 120_000);

  it.skipIf(driver !== "postgres")("runs competing native callbacks and admits only one conflicting update", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(); let count = 0;
    const host = await connected.prepareWrapped({ afterNative: async () => {
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
    } });
    const before = await connected.snapshot();
    try {
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector: { id: a }, update: { value: "race150-first" } })));
        const second = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), { selector: { id: a }, update: { value: "race150-second" } })));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(count).toBe(2); expect(results.filter(result => Exit.isSuccess(result))).toHaveLength(1);
      expect(results.flatMap(result => Exit.isFailure(result) ? reasons(result.cause) : [])).toContain("writeConflict");
      expect(eventsSince(before, await connected.snapshot())).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 120_000);

  it("recovers an uncertain commit acknowledgement without rerunning native update", async () => {
    let lose = true; const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost update acknowledgement") })); })));
    const host = await Effect.runPromise(prepareUpdatePricePreferencesWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const update = vi.spyOn(PricingModuleService.prototype, "updatePricePreferences");
    try {
      const key = host.newRequestKey(), input: Input = { selector: { id: a }, update: { value: "uncertain150" } };
      const output = await Effect.runPromise(host.run(key, input)); expect(lose).toBe(false); expect(update).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toEqual(output);
      expect(update).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
    } finally { update.mockRestore(); await Effect.runPromise(host.close); }
  });
});
