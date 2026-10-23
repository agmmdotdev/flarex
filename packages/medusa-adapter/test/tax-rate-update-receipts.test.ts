import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { prepareUpdateMetadata } from "@medusajs/utils/modules-sdk/prepare-update-metadata";
import { assignNativeJsonObject } from "@medusajs/utils/dal/json-assignment";
import { isJsonObject } from "flarex-protocol/json";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { prepareTaxRateUpdateRepository } from "../src/modules/tax/rate-update-repository";
import { prepareTaxRuleReplacementRepository } from "../src/modules/tax/rule-replacement-repository";
import { taxRateUpdatePolicy } from "../src/modules/tax/rate-update-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Fixture = { readonly call: Call; readonly activity: Activity };
let prepared: Result.Result.Success<ReturnType<typeof prepareTaxRateUpdateRepository>>;
let policy: ReturnType<typeof taxRateUpdatePolicy>;
const stamp = "2020-01-02T03:04:05.000Z", changedStamp = "2020-01-02T03:05:05.000Z";
const scalar = (id: string, extra: JsonObject = {}): JsonObject => ({ id, rate: 7, code: "CODE", name: `Rate ${id}`,
  is_default: false, is_combinable: false, tax_region_id: "region-a", metadata: { nested: { original: true }, retained: 1 },
  created_by: "original-creator", created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const region = (id: string, extra: JsonObject = {}): JsonObject => ({ id, country_code: "us", province_code: null,
  metadata: null, created_by: null, provider_id: "tp_system", parent_id: null,
  created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const output = (row: JsonObject, actor?: string, children = false): JsonObject =>
  Result.getOrThrow(prepared.contracts.present(row, actor, children));
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string | string[], action = "updated"): Json => ({ name: `tax.tax-rate.${action}`,
  metadata: { source: "tax", object: "tax_rate", action }, data: { id } });
const call = (commandName: string, mode: "read" | "write", input: Json, result: Json, events: readonly Json[] = [], attempts = 0): Call => ({
  commandName, mode, input, result, events, fromAttempt: 0, toAttempt: attempts, fromLifecycle: 0, toLifecycle: 0 });
function read(filters: JsonObject, count: number, config: { readonly select?: readonly string[]; readonly relations?: readonly string[] } = {}): Activity["relationalReads"][number] {
  const plan = Result.getOrThrow(captureCommerceInput(buildQuery(filters, { order: { id: "ASC" },
    ...(config.select === undefined ? {} : { select: [...config.select] }),
    ...(config.relations === undefined ? {} : { relations: [...config.relations] }),
  })).pipe(Result.flatMap(prepared.query)));
  return { table: "tax_rate", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: count, returned: count };
}
function regionRead(rows: readonly JsonObject[], count: number): Activity["relationalReads"][number] {
  return { table: "tax_region", query: commerceRelationReadQuery(defaultCommerceResources,
    Result.getOrThrow(prepared.regionPredicate(rows))), total: count, returned: count };
}
const observedRegions = (rows: readonly JsonObject[]): Activity["observedRows"] => rows.map(row => ({ table: "tax_region", row }));
const observed = (rows: readonly JsonObject[]): Activity["observedRows"] => rows.map(row => ({ table: "tax_rate", row }));
function projected(): Fixture {
  const filters = { id: ["rate-z", "rate-a"] }, config = { select: ["name", "metadata.nested", "updated_by"], relations: [] };
  return { call: call("taxRateListForUpdate", "read", { filters, config }, [
    { id: "rate-a", name: "Rate rate-a", metadata: { nested: { original: true }, retained: 1 } },
    { id: "rate-z", name: "Rate rate-z", metadata: { nested: { original: true }, retained: 1 } },
  ]), activity: { ...empty(), observedRows: observed([scalar("rate-z"), scalar("rate-a")]), relationalReads: [read(filters, 2, config)] } };
}
function scalarUpdate(): Fixture {
  const before = [scalar("rate-a"), scalar("rate-z")], after = before.map(row => ({ ...row, name: "Updated", updated_at: changedStamp }));
  const selector = { id: ["rate-z", "rate-a"] };
  return { call: call("taxRateUpdateForWorkflow", "write", { selector, update: { name: "Updated" } }, after.map(row => output(row)),
    [event("rate-a"), event("rate-z")], 2), activity: { ...empty(),
    observedRows: [...observed([...before].reverse()), ...observedRegions([region("region-a")])],
    relationalReads: [read(selector, 2), regionRead(before, 1)], mutations: before.map((row, ordinal) => ({ ordinal, table: "tax_rate", operation: "patch",
      before: row, after: after[ordinal] ?? null })) } };
}
function actorOnly(): Fixture {
  const selector = { id: ["rate-z", "rate-a"] }, rows = [scalar("rate-a"), scalar("rate-z")];
  return { call: call("taxRateUpdateForWorkflow", "write", { selector, update: { updated_by: "actor-only" } },
    rows.map(row => output(row, "actor-only"))), activity: { ...empty(),
    observedRows: [...observed([...rows].reverse()), ...observedRegions([region("region-a")])],
    relationalReads: [read(selector, 2), regionRead(rows, 1)] } };
}
function inverseMetadata(): Fixture {
  const before = scalar("rate-a", { metadata: { current: true, nested: { later: true } } });
  const after = { ...before, metadata: { restored: 1 }, updated_at: changedStamp };
  return { call: call("taxRateUpsertForUpdateInverse", "write", [{ id: "rate-a", metadata: { restored: 1 } }], [output(after)], [event("rate-a")], 1),
    activity: { ...empty(), observedRows: [...observed([before]), ...observedRegions([region("region-a")])],
      relationalReads: [read({ id: ["rate-a"] }, 1), regionRead([before], 1)],
      mutations: [{ ordinal: 0, table: "tax_rate", operation: "patch", before, after }] } };
}
function normalizedRate(): Fixture {
  const before = scalar("rate-a"), submitted = 0.10000000000000002;
  const after = { ...before, rate: 0.10000000149011612, updated_at: changedStamp };
  return { call: call("taxRateUpdateForWorkflow", "write", { selector: { id: "rate-a" }, update: { rate: submitted } },
    [output({ ...after, rate: submitted })], [event("rate-a")], 1), activity: { ...empty(),
    observedRows: [...observed([before]), ...observedRegions([region("region-a")])],
    relationalReads: [read({ id: "rate-a" }, 1), regionRead([before], 1)], mutations: [{ ordinal: 0, table: "tax_rate", operation: "patch", before, after,
      realNormalization: { rate: submitted } }] } };
}
function mixedParents(config: { readonly select?: readonly string[]; readonly relations?: readonly string[] } = {}): Fixture {
  const active = scalar("rate-a"), rows = [active, scalar("rate-z", { tax_region_id: "region-deleted" })], filters = { id: ["rate-z", "rate-a"] };
  const full = config.select === undefined || config.select.length === 0;
  const result = config.select === undefined ? [output(active)] : config.select.length === 0
    ? [{ id: "rate-a", tax_region_id: "region-a", tax_region: { id: "region-a" } }]
    : config.select.includes("name") ? [{ id: "rate-a", name: "Rate rate-a" }, { id: "rate-z", name: "Rate rate-z" }]
      : [{ id: "rate-a" }, { id: "rate-z" }];
  return { call: call("taxRateListForUpdate", "read", { filters, config }, result), activity: { ...empty(),
    observedRows: [...observed([...rows].reverse()), ...observedRegions([
      region("region-a"), region("region-deleted", { country_code: "ca", deleted_at: stamp }),
      region("region-unrelated", { country_code: "gb" }),
    ])], relationalReads: [read(filters, 2, config), ...(full ? [regionRead(rows, 1)] : [])] } };
}
function mixedParentUpdate(): Fixture {
  const before = scalar("rate-a"), after = { ...before, name: "Updated", updated_at: changedStamp }, fixture = mixedParents();
  return { call: call("taxRateUpdateForWorkflow", "write", { selector: { id: ["rate-z", "rate-a"] }, update: { name: "Updated" } },
    [output(after)], [event("rate-a")], 1), activity: { ...fixture.activity,
    mutations: [{ ordinal: 0, table: "tax_rate", operation: "patch", before, after }] } };
}
const accepted = (fixture: Fixture) => Effect.runPromise(policy.validateLogicalCall(fixture.call, fixture.activity));
const refused = async (fixture: Fixture) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(fixture.call, fixture.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const replaceResult = (fixture: Fixture, result: Json): Fixture => ({ ...fixture, call: { ...fixture.call, result } });
const resultRows = (fixture: Fixture) => Result.getOrThrow(prepared.contracts.decodeRows(fixture.call.result));

beforeAll(async () => {
  const metadata = (await Effect.runPromise(captureTaxMetadata())).frame;
  prepared = Result.getOrThrow(prepareTaxRateUpdateRepository(metadata));
  policy = taxRateUpdatePolicy(prepared, Result.getOrThrow(prepareTaxRuleReplacementRepository(metadata)));
});

describe("native Tax Rate update semantic receipt correlation", () => {
  // Fixed transcripts authenticate receipts. Connected database witnesses prove
  // actual SQL activity, REAL normalization, native issuers and root settlement.
  it("authenticates complete projected preimages after decoding deleted and unrelated support rows", async () => {
    const fixture = projected();
    await accepted({ ...fixture, activity: { ...fixture.activity, observedRows: [...fixture.activity.observedRows,
      ...observed([scalar("historical", { deleted_at: stamp }),
        ...Array.from({ length: 9 }, (_, index) => scalar(`unrelated-${index}`, { tax_region_id: "other-region" }))])] } });
    expect(fixture.call.result).toEqual([
      { id: "rate-a", name: "Rate rate-a", metadata: { nested: { original: true }, retained: 1 } },
      { id: "rate-z", name: "Rate rate-z", metadata: { nested: { original: true }, retained: 1 } },
    ]);
  });

  it("authenticates actor-only native output without persistent writes or events", async () => {
    const fixture = actorOnly();
    await accepted(fixture);
    expect(resultRows(fixture)[0]).toMatchObject({ id: "rate-a", updated_by: "actor-only", tax_region: { id: "region-a" }, updated_at: stamp });
    expect(resultRows(fixture)[0]).not.toHaveProperty("rules");
    expect(fixture.activity.mutations).toEqual([]);
    expect(fixture.call.events).toEqual([]);
  });

  it("authenticates ordered complete scalar results and consistent before/after observations", async () => {
    const fixture = scalarUpdate();
    await accepted({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observed(fixture.activity.mutations.flatMap(mutation => mutation.after === null ? [] : [mutation.after]))] } });
    await accepted({ ...fixture, call: { ...fixture.call, events: [event(["rate-a", "rate-z"])] } });
  });

  it("retains the four-Rate native shared metadata mutation using its genuine helpers", async () => {
    const before = [
      { ...scalar("rate-a"), metadata: { owner: "a", only_a: 1, remove_me: "a" } },
      { ...scalar("rate-b"), metadata: { owner: "b", only_b: 2, remove_me: "b" } },
      { ...scalar("rate-c", { tax_region_id: "region-b" }), metadata: { owner: "c", only_c: 3, remove_me: "c" } },
      { ...scalar("rate-d", { tax_region_id: "region-b" }), metadata: { owner: "d", only_d: 4, remove_me: "d" } },
    ];
    const update = { metadata: { patch: true, remove_me: "" }, updated_by: "metadata-actor" };
    const input = structuredClone(update), pairs = before.map(entity => ({ entity: structuredClone(entity), update }));
    prepareUpdateMetadata(pairs);
    const lastPair = pairs[3];
    if (lastPair === undefined) throw new Error("Missing fourth native metadata fixture");
    expect(lastPair.entity.metadata).toBe(update.metadata);
    expect(pairs[0]?.update).toBe(lastPair.update);
    expect(update.metadata).toEqual({ owner: "a", only_a: 1, only_b: 2, only_c: 3, only_d: 4, remove_me: "b", patch: true });
    const after = pairs.map(pair => Result.getOrThrow(captureCommerceInput({ ...pair.entity,
      metadata: assignNativeJsonObject(pair.entity.metadata, update.metadata), updated_at: changedStamp })
      .pipe(Result.flatMap(prepared.contracts.decodeRateRow))));
    expect(after.map(row => row.metadata)).toEqual(Array.from({ length: 4 }, () =>
      ({ owner: "a", only_a: 1, only_b: 2, only_c: 3, only_d: 4, remove_me: "b", patch: true })));
    const selector = { id: ["rate-d", "rate-b", "rate-c", "rate-a"] };
    const fixture: Fixture = { call: call("taxRateUpdateForWorkflow", "write", { selector, update: input },
      after.map(row => output(row, "metadata-actor")), [event(["rate-a", "rate-b", "rate-c", "rate-d"])], 4),
      activity: { ...empty(), observedRows: [...observed([...before].reverse()),
        ...observedRegions([region("region-a"), region("region-b", { country_code: "ca" })])],
        relationalReads: [read(selector, 4), regionRead(before, 2)],
        mutations: before.map((row, ordinal) => ({ ordinal, table: "tax_rate", operation: "patch", before: row, after: after[ordinal] ?? null })) } };
    await accepted(fixture);
    await refused(replaceResult(fixture, after.map(row => output(row, "forged-actor"))));
  });

  it("authenticates sparse inverse JSON replacement rather than forward metadata merging", async () => {
    const fixture = inverseMetadata();
    await accepted(fixture);
    expect(fixture.call.result).toEqual([output(scalar("rate-a", { metadata: { restored: 1 }, updated_at: changedStamp }))]);
    const merged = scalar("rate-a", { metadata: { current: true, nested: { later: true }, restored: 1 }, updated_at: changedStamp });
    await refused({ ...replaceResult(fixture, [output(merged)]), activity: { ...fixture.activity,
      mutations: fixture.activity.mutations.map(mutation => ({ ...mutation, after: merged })) } });
  });

  it("retains the empty-select Region preimage and empty-children inverse presentation", async () => {
    const filters = { id: "rate-a" }, config = { select: [], relations: [] }, row = scalar("rate-a");
    const preimage = { id: "rate-a", tax_region_id: "region-a", tax_region: { id: "region-a" } };
    await accepted({ call: call("taxRateListForUpdate", "read", { filters, config }, [preimage]),
      activity: { ...empty(), observedRows: [...observed([row]), ...observedRegions([region("region-a")])],
        relationalReads: [read(filters, 1, config), regionRead([row], 1)] } });
    const fixture: Fixture = { call: call("taxRateUpsertForUpdateInverse", "write", [preimage], [output(row, undefined, true)]),
      activity: { ...empty(), observedRows: [...observed([row]), ...observedRegions([region("region-a")])],
        relationalReads: [read({ id: ["rate-a"] }, 1), regionRead([row], 1)] } };
    await accepted(fixture);
    expect(fixture.call.result).toEqual([{ ...row, tax_region: { id: "region-a", children: [] } }]);
    await refused(replaceResult(fixture, [output(row)]));
    await refused(replaceResult(fixture, [output(row, "forged-inverse-actor", true)]));
  });

  it("retains the explicit no-match read for an empty forward cohort", async () => {
    const selector = { id: [] };
    const fixture: Fixture = { call: call("taxRateUpdateForWorkflow", "write", { selector, update: { name: "No match" } }, []),
      activity: { ...empty(), relationalReads: [read(selector, 0)] } };
    await accepted(fixture);
    await refused({ ...fixture, activity: empty() });
  });

  it("retains the empty inverse with no query, writes or events", async () => {
    const fixture: Fixture = { call: call("taxRateUpsertForUpdateInverse", "write", [], []), activity: empty() };
    await accepted(fixture);
    await refused({ ...fixture, activity: { ...empty(), relationalReads: [read({ id: [] }, 0)] } });
  });

  it("correlates original submitted REAL presentation with shared-owner normalization evidence", async () => {
    const fixture = normalizedRate();
    await accepted(fixture);
    expect(fixture.activity.mutations[0]?.after?.rate).toBe(0.10000000149011612);
    expect(resultRows(fixture)[0]?.rate).toBe(0.10000000000000002);
    for (const realNormalization of [{ rate: 0.2 }, { rate: 0.10000000000000002, name: "extra" }, { name: "unrelated" }])
      await refused({ ...fixture, activity: { ...fixture.activity, mutations: fixture.activity.mutations.map(mutation => ({ ...mutation, realNormalization })) } });
  });

  it("authenticates unchanged REAL columns from the complete merged assignment during a name-only write", async () => {
    const fixture = scalarUpdate();
    await accepted({ ...fixture, activity: { ...fixture.activity,
      mutations: fixture.activity.mutations.map(mutation => ({ ...mutation, realNormalization: { rate: 7 } })) } });
    for (const realNormalization of [{ rate: 8 }, { rate: 7, name: "extra" }, {}])
      await refused({ ...fixture, activity: { ...fixture.activity,
        mutations: fixture.activity.mutations.map(mutation => ({ ...mutation, realNormalization })) } });
  });

  it.each<[string, { readonly select?: readonly string[]; readonly relations?: readonly string[] }]>([
    ["full default", {}], ["empty select", { select: [], relations: [] }],
    ["narrow name", { select: ["name"] }], ["narrow actor", { select: ["updated_by"] }],
  ])("authenticates mixed active/deleted parent %s preimages", async (_name, config) => {
    const fixture = mixedParents(config);
    await accepted(fixture);
    expect(fixture.activity.relationalReads[0]).toMatchObject({ table: "tax_rate", total: 2, returned: 2 });
    const full = config.select === undefined || config.select.length === 0;
    expect(fixture.activity.relationalReads).toHaveLength(full ? 2 : 1);
    expect(fixture.call.result).toHaveLength(full ? 1 : 2);
    if (full) expect(fixture.activity.relationalReads[1]).toMatchObject({ table: "tax_region", total: 1, returned: 1 });
    else expect(fixture.call.result).toEqual(config.select?.includes("name")
      ? [{ id: "rate-a", name: "Rate rate-a" }, { id: "rate-z", name: "Rate rate-z" }]
      : [{ id: "rate-a" }, { id: "rate-z" }]);
  });

  it("authenticates a full update only for Rates with active parents", async () => {
    const fixture = mixedParentUpdate();
    await accepted(fixture);
    expect(fixture.call.result).toEqual([output(scalar("rate-a", { name: "Updated", updated_at: changedStamp }))]);
    expect(fixture.activity.mutations.map(mutation => mutation.after?.id)).toEqual(["rate-a"]);
    expect(fixture.call.events).toEqual([event("rate-a")]);
  });

  it("authenticates an empty full cohort after reading a Rate under a deleted parent", async () => {
    const row = scalar("rate-z", { tax_region_id: "region-deleted" }), filters = { id: "rate-z" };
    const activity: Activity = { ...empty(), observedRows: [...observed([row]),
      ...observedRegions([region("region-deleted", { deleted_at: stamp })])],
      relationalReads: [read(filters, 1), regionRead([row], 0)] };
    await accepted({ call: call("taxRateListForUpdate", "read", { filters, config: {} }, []), activity });
    await accepted({ call: call("taxRateUpdateForWorkflow", "write", { selector: filters, update: { name: "Skipped" } }, []), activity });
    await refused({ call: call("taxRateUpsertForUpdateInverse", "write", [{ id: "rate-z", name: "Restored" }], [output(row)]),
      activity: { ...activity, relationalReads: [read({ id: ["rate-z"] }, 1), regionRead([row], 0)] } });
  });

  it("decodes complete valid deleted and unrelated Region and Rate support bodies", async () => {
    const fixture = mixedParents();
    await accepted({ ...fixture, activity: { ...fixture.activity, observedRows: [...fixture.activity.observedRows,
      ...observed([scalar("historical", { deleted_at: stamp }), scalar("unrelated", { tax_region_id: "region-unrelated" })]),
      ...observedRegions([region("region-historical", { country_code: "fr", deleted_at: stamp }), region("region-a")])] } });
  });

  it("applies selected Rate bounds after the complete raw parent-filtered read", async () => {
    const active = scalar("rate-a"), rows = [active, ...["rate-b", "rate-c", "rate-d", "rate-e"].map(id =>
      scalar(id, { tax_region_id: "region-deleted" }))], filters = { id: ["rate-e", "rate-d", "rate-c", "rate-b", "rate-a"] };
    await accepted({ call: call("taxRateListForUpdate", "read", { filters, config: {} }, [output(active)]),
      activity: { ...empty(), observedRows: [...observed(rows),
        ...observedRegions([region("region-a"), region("region-deleted", { country_code: "ca", deleted_at: stamp })])],
        relationalReads: [read(filters, 5), regionRead(rows, 1)] } });
  });

  it.each<[string, (fixture: Fixture) => Fixture]>([
    ["missing Region read", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: fixture.activity.relationalReads.slice(0, 1) } })],
    ["Region read before Rate read", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: [...fixture.activity.relationalReads].reverse() } })],
    ["wrong Region table", fixture => ({ ...fixture, activity: { ...fixture.activity,
      relationalReads: fixture.activity.relationalReads.map(value => value.table === "tax_region" ? { ...value, table: "tax_rate_rule" } : value) } })],
    ["wrong Region predicate", fixture => ({ ...fixture, activity: { ...fixture.activity,
      relationalReads: fixture.activity.relationalReads.map(value => value.table === "tax_region" ? { ...value,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "isNull", column: "deleted_at" }) } : value) } })],
    ["wrong Region count", fixture => ({ ...fixture, activity: { ...fixture.activity,
      relationalReads: fixture.activity.relationalReads.map(value => value.table === "tax_region" ? { ...value, total: 2, returned: 2 } : value) } })],
    ["truncated Region returned count", fixture => ({ ...fixture, activity: { ...fixture.activity,
      relationalReads: fixture.activity.relationalReads.map(value => value.table === "tax_region" ? { ...value, returned: 0 } : value) } })],
    ["Rate count after parent filtering", fixture => ({ ...fixture, activity: { ...fixture.activity,
      relationalReads: fixture.activity.relationalReads.map(value => value.table === "tax_rate" ? { ...value, total: 1, returned: 1 } : value) } })],
    ["missing active Region observation", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: fixture.activity.observedRows.filter(value => value.table !== "tax_region" || value.row.id !== "region-a") } })],
    ["malformed unrelated Region body", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observedRegions([region("bad-unrelated", { country_code: 7 })])] } })],
    ["malformed deleted Region body", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observedRegions([region("bad-deleted", { deleted_at: stamp, provider_id: 7 })])] } })],
    ["conflicting active Region observations", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observedRegions([region("region-a", { metadata: { contradiction: true } })])] } })],
    ["conflicting unrelated Region observations", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observedRegions([region("region-unrelated", { country_code: "gb", metadata: { contradiction: true } })])] } })],
    ["deleted parent returned", fixture => replaceResult(fixture, [output(scalar("rate-a")), output(scalar("rate-z", { tax_region_id: "region-deleted" }))])],
    ["forged parent reference", fixture => replaceResult(fixture, [{ ...output(scalar("rate-a")), tax_region: { id: "region-deleted" } }])],
  ])("refuses parent-filter receipt %s", async (_name, change) => { await refused(change(mixedParents())); });

  it("refuses Region queries with modified limits, ordering, columns or identity mode", async () => {
    const fixture = mixedParents();
    const changes: readonly JsonObject[] = [{ take: 1 }, { order: { column: "id", direction: "desc" } }, { fields: ["id"] }, { includeIdentities: true }];
    for (const extra of changes)
      await refused({ ...fixture, activity: { ...fixture.activity, relationalReads: fixture.activity.relationalReads.map(value => {
        if (value.table !== "tax_region") return value;
        if (!isJsonObject(value.query)) throw new Error("Expected Region read query object fixture");
        return { ...value, query: { ...value.query, ...extra } };
      }) } });
  });

  it("refuses a Region query or parent filtering for narrow name preimages", async () => {
    const fixture = mixedParents({ select: ["name"] });
    await refused({ ...fixture, activity: { ...fixture.activity, relationalReads: mixedParents().activity.relationalReads } });
    await refused(replaceResult(fixture, [{ id: "rate-a", name: "Rate rate-a" }]));
    await refused({ ...fixture, activity: { ...fixture.activity, observedRows: [...fixture.activity.observedRows,
      ...observedRegions([region("malformed-narrow", { country_code: false })])] } });
  });

  it("refuses mutations of Region rows or a Rate filtered by its deleted parent", async () => {
    const fixture = mixedParentUpdate(), before = scalar("rate-z", { tax_region_id: "region-deleted" });
    await refused({ ...fixture, activity: { ...fixture.activity, mutations: fixture.activity.mutations.map(value => ({ ...value, table: "tax_region" })) } });
    await refused({ ...fixture, activity: { ...fixture.activity, mutations: [...fixture.activity.mutations,
      { ordinal: 1, table: "tax_rate", operation: "patch", before, after: { ...before, name: "Updated", updated_at: changedStamp } }] } });
  });

  it.each<[string, (fixture: Fixture) => Fixture]>([
    ["missing read", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: [] } })],
    ["extra read", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: [...fixture.activity.relationalReads, ...fixture.activity.relationalReads] } })],
    ["wrong total", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: fixture.activity.relationalReads.map(value => ({ ...value, total: 3 })) } })],
    ["truncated returned count", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: fixture.activity.relationalReads.map(value => ({ ...value, returned: 1 })) } })],
    ["forged query", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: fixture.activity.relationalReads.map(value => ({ ...value, query: {} })) } })],
    ["missing selected observation", fixture => ({ ...fixture, activity: { ...fixture.activity, observedRows: fixture.activity.observedRows.slice(1) } })],
    ["foreign observation table", fixture => ({ ...fixture, activity: { ...fixture.activity, observedRows: fixture.activity.observedRows.map(value => ({ ...value, table: "tax_region" })) } })],
    ["malformed unselected raw support", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observed([scalar("unselected", { rate: "bad", deleted_at: stamp })])] } })],
    ["conflicting selected observation", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observed([scalar("rate-a", { name: "contradiction" })])] } })],
    ["conflicting unrelated support", fixture => ({ ...fixture, activity: { ...fixture.activity,
      observedRows: [...fixture.activity.observedRows, ...observed([scalar("unrelated"), scalar("unrelated", { code: "contradiction" })])] } })],
    ["missing selected output", fixture => replaceResult(fixture, [{ id: "rate-a", name: "Rate rate-a", metadata: { nested: { original: true }, retained: 1 } }])],
    ["reordered selected Rates", fixture => replaceResult(fixture, [
      { id: "rate-z", name: "Rate rate-z", metadata: { nested: { original: true }, retained: 1 } },
      { id: "rate-a", name: "Rate rate-a", metadata: { nested: { original: true }, retained: 1 } },
    ])],
    ["unexpected projected actor", fixture => replaceResult(fixture, [
      { id: "rate-a", name: "Rate rate-a", metadata: { nested: { original: true }, retained: 1 }, updated_by: "forged" },
      { id: "rate-z", name: "Rate rate-z", metadata: { nested: { original: true }, retained: 1 } },
    ])],
    ["read event", fixture => ({ ...fixture, call: { ...fixture.call, events: [event("rate-a")] } })],
    ["read mutation", fixture => ({ ...fixture, activity: { ...fixture.activity, mutations: scalarUpdate().activity.mutations } })],
  ])("refuses projected receipt %s", async (_name, change) => { await refused(change(projected())); });

  it.each<[string, (fixture: Fixture) => Fixture]>([
    ["missing complete output", fixture => replaceResult(fixture, resultRows(fixture).slice(1))],
    ["reordered complete Rates", fixture => replaceResult(fixture, [...resultRows(fixture)].reverse())],
    ["forged actor", fixture => replaceResult(fixture, resultRows(fixture).map(row => ({ ...row, updated_by: "forged" })))],
    ["forged FK reference", fixture => replaceResult(fixture, resultRows(fixture).map(row => ({ ...row, tax_region: { id: "foreign" } })))],
    ["unexpected Rules output", fixture => replaceResult(fixture, resultRows(fixture).map(row => ({ ...row, rules: [] })))],
    ["missing mutation", fixture => ({ ...fixture, activity: { ...fixture.activity, mutations: fixture.activity.mutations.slice(1) } })],
    ["extra mutation", fixture => ({ ...fixture, activity: { ...fixture.activity, mutations: [...fixture.activity.mutations, ...fixture.activity.mutations] } })],
    ["wrong mutation ordinal", fixture => ({ ...fixture, activity: { ...fixture.activity,
      mutations: fixture.activity.mutations.map(value => ({ ...value, ordinal: value.ordinal + 1 })) } })],
    ["foreign mutation table", fixture => ({ ...fixture, activity: { ...fixture.activity,
      mutations: fixture.activity.mutations.map(value => ({ ...value, table: "tax_rate_rule" })) } })],
    ["insert instead of patch", fixture => ({ ...fixture, activity: { ...fixture.activity,
      mutations: fixture.activity.mutations.map(value => ({ ...value, operation: "insert", before: null })) } })],
    ["unexpected scalar write", fixture => ({ ...fixture, activity: { ...fixture.activity,
      mutations: fixture.activity.mutations.map(value => ({ ...value, after: { ...value.after, code: "unrequested" } })) } })],
    ["missing updated event", fixture => ({ ...fixture, call: { ...fixture.call, events: [] } })],
    ["duplicate updated event", fixture => ({ ...fixture, call: { ...fixture.call, events: [...fixture.call.events, event("rate-a")] } })],
    ["reordered updated events", fixture => ({ ...fixture, call: { ...fixture.call, events: [event("rate-z"), event("rate-a")] } })],
    ["wrong event identity", fixture => ({ ...fixture, call: { ...fixture.call, events: [event("outside"), event("rate-z")] } })],
    ["wrong event action", fixture => ({ ...fixture, call: { ...fixture.call, events: [event("rate-a", "created"), event("rate-z")] } })],
    ["wrong event source", fixture => ({ ...fixture, call: { ...fixture.call, events: [{ name: "tax.tax-rate.updated",
      metadata: { source: "other", object: "tax_rate", action: "updated" }, data: { id: ["rate-a", "rate-z"] } }] } })],
    ["extra query", fixture => ({ ...fixture, activity: { ...fixture.activity, relationalReads: [...fixture.activity.relationalReads, ...fixture.activity.relationalReads] } })],
    ["wrong complete count", fixture => ({ ...fixture, activity: { ...fixture.activity,
      relationalReads: fixture.activity.relationalReads.map(value => ({ ...value, total: 1, returned: 1 })) } })],
    ["unknown command", fixture => ({ ...fixture, call: { ...fixture.call, commandName: "taxRateUnadmittedExtraCommand" } })],
  ])("refuses update receipt %s", async (_name, change) => { await refused(change(scalarUpdate())); });

  it("refuses unrelated lifecycle, set-null and relationship replacement activity", async () => {
    const fixture = scalarUpdate();
    await refused({ ...fixture, activity: { ...fixture.activity, lifecycle: [{ table: "tax_rate", operation: "softDelete", key: { id: "rate-a" },
      beforeDeletedAt: null, afterDeletedAt: stamp, attemptOrdinal: 0, rowAtOperation: null }] } });
    const reference = { sourceTable: "tax_rate_rule", sourceColumn: "tax_rate_id", targetTable: "tax_rate", targetColumn: "id", targetKey: "rate-a" };
    await refused({ ...fixture, activity: { ...fixture.activity, setNull: [{ ...reference, managedUpdate: "advance" }] } });
    await refused({ ...fixture, activity: { ...fixture.activity, referenceReplacements: [{ ...reference, desiredKeys: [] }] } });
  });

  it("refuses writes or events attributed to an actor-only no-op", async () => {
    const fixture = actorOnly();
    await refused({ ...fixture, call: { ...fixture.call, events: [event("rate-a")] } });
    await refused({ ...fixture, activity: { ...fixture.activity, mutations: scalarUpdate().activity.mutations } });
  });
});
