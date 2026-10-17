import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStoreMetadata } from "../src/modules/store/schema";
import { compileStoreCreationContracts, decodeStoreCreates } from "../src/modules/store/create-input";
import { prepareStoreCreationGraph } from "../src/modules/store/create-graph";
import { storeCreationPolicy } from "../src/modules/store/create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileStoreCreationContracts>>;
let graph: Result.Result.Success<ReturnType<typeof prepareStoreCreationGraph>>;
let policy: ReturnType<typeof storeCreationPolicy>;
const time = "2026-10-17T00:00:00.000Z";
const store: JsonObject = { id: "store-a", name: "Name", default_sales_channel_id: null, default_region_id: null,
  default_location_id: null, metadata: { keep: true }, created_at: time, updated_at: time, deleted_at: null };
const currency: JsonObject = { id: "currency-a", currency_code: "usd", is_default: true, store_id: "store-a",
  created_at: time, updated_at: time, deleted_at: null };
const locale: JsonObject = { id: "locale-a", locale_code: "EN-us", store_id: "store-a",
  created_at: time, updated_at: time, deleted_at: null };
const event = (object: string, id: string, action = "created"): Json => ({ name: `store.${object.replaceAll("_", "-")}.${action}`,
  metadata: { source: "store", object, action }, data: { id } });
const output: Json = [{ ...store, supported_currencies: [currency], supported_locales: [locale] }];
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const creation = (): Call => ({ commandName: "storeCreateForWorkflow", mode: "write", input: [{ name: " Name ", metadata: { keep: true },
  supported_currencies: [{ currency_code: "USD", is_default: true }], supported_locales: [{ locale_code: "EN-us" }] }], result: output,
  events: [event("store", "store-a"), event("store_currency", "currency-a"), event("store_locale", "locale-a")],
  fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 0 });
// One explicit native graph transcript; no query/replacement simulation.
const evidence = (): Activity => ({ ...empty(), observedRows: [
  { table: "store", row: store }, { table: "store_currency", row: currency }, { table: "store_locale", row: locale }], mutations: [
  { ordinal: 0, table: "store", operation: "insert", before: null, after: store },
  { ordinal: 1, table: "store_currency", operation: "insert", before: null, after: currency },
  { ordinal: 2, table: "store_locale", operation: "insert", before: null, after: locale },
] });
const inverse = (): Call => ({ ...creation(), commandName: "storePhysicalDeleteForWorkflow", input: ["store-a", "missing", "store-a"],
  result: null, events: [event("store", "store-a", "deleted")] });
const physical = (): Activity => ({ ...empty(), observedRows: [
  { table: "store", row: store }, { table: "store_currency", row: { ...currency, deleted_at: time } }, { table: "store_locale", row: locale }],
  mutations: [
    { ordinal: 0, table: "store_locale", operation: "delete", before: locale, after: null },
    { ordinal: 1, table: "store_currency", operation: "delete", before: { ...currency, deleted_at: time }, after: null },
    { ordinal: 2, table: "store", operation: "delete", before: store, after: null },
  ] });
const refused = async (call: Call, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  contracts = Result.getOrThrow(compileStoreCreationContracts((await Effect.runPromise(captureStoreMetadata())).frame));
  graph = Result.getOrThrow(prepareStoreCreationGraph(contracts));
  policy = storeCreationPolicy(contracts);
});

describe("native Store creation contracts and receipts", () => {
  it("preserves native raw strings, omission, empty arrays and business-validation inputs", () => {
    for (const input of [[], [{}], [{ name: "   ", supported_currencies: [], supported_locales: [] }],
      [{ supported_currencies: [{ currency_code: "", is_default: true }], supported_locales: [{ locale_code: "" }] }],
      [{ supported_currencies: [{ currency_code: "USD" }, { currency_code: "usd" }] }]])
      expect(Result.getOrThrow(decodeStoreCreates(input))).toEqual(input);
    for (const input of [[{ id: "supplied" }], [{ created_at: time }], [{ supported_currencies: [{ currency_code: "usd", is_tax_inclusive: true }] }],
      [{ supported_locales: [{ locale_code: "en-US", store_id: "other" }] }], Array.from({ length: 5 }, () => ({})),
      [{ supported_currencies: [{ currency_code: "a" }, { currency_code: "b" }, { currency_code: "c" }] }]])
      expect(Result.isFailure(decodeStoreCreates(input))).toBe(true);
  });

  it("admits exactly two declared hasMany replacements with generated identities", () => {
    expect(graph.profile.allowedRelations(graph.store)).toEqual(["supported_currencies", "supported_locales"]);
    expect(Result.getOrThrow(graph.catalog.decodeRow(graph.store, {}))).toEqual({ supplied: {}, key: undefined });
    for (const entity of graph.catalog.entities) {
      expect(Result.isFailure(graph.catalog.decodeRow(entity, { id: "forged" }))).toBe(true);
      if (entity === graph.store) continue;
      expect(graph.profile.allowedRelations(entity)).toEqual([]);
      const name = entity.table.name === "store_currency" ? "supported_currencies" : "supported_locales";
      expect(Result.getOrThrow(graph.profile.toManyMode(graph.store, name, entity))).toBe("replace");
      expect(Result.isFailure(graph.profile.toManyMode(entity, name, graph.store))).toBe(true);
    }
    expect(Result.isFailure(graph.catalog.decodeAssociation(graph.store, { id: "other" }))).toBe(true);
    expect(Result.isFailure(graph.profile.admitSelection(contracts.lifecycle.store, Array.from({ length: 5 }, () => store)))).toBe(true);
  });

  it("authenticates normalized native outputs/defaults and performed actions without copying normalization", async () => {
    await Effect.runPromise(policy.validateLogicalCall(creation(), evidence()));
    expect(Result.getOrThrow(contracts.decodeRows(output))).toEqual(output);
    expect(Result.getOrThrow(Schema.decodeUnknownResult(contracts.Output)(output))).toEqual(output);
    const actions = { created: { Store: [{ id: "store-a" }], StoreCurrency: [{ id: "currency-a" }], StoreLocale: [{ id: "locale-a" }] }, updated: {}, deleted: {} };
    expect(Result.getOrThrow(contracts.decodePerformedActions(actions, Result.getOrThrow(contracts.decodeRows(output))))).toEqual(actions);
    for (const forged of [{ ...actions, created: { Store: [{ id: "store-a" }] } }, { ...actions, updated: { Store: [{ id: "store-a" }] } },
      { ...actions, deleted: { Store: [{ id: "store-a" }] } }, { ...actions, updated: [] }, { ...actions, deleted: null },
      { ...actions, created: { ...actions.created, Region: [{ id: "other" }] } },
      { ...actions, created: { ...actions.created, StoreCurrency: [{ id: "wrong" }] } }])
      expect(Result.isFailure(contracts.decodePerformedActions(forged, Result.getOrThrow(contracts.decodeRows(output))))).toBe(true);
    expect(Result.isFailure(contracts.decodeUpsert({ input: [{}], config: { relations: ["supported_locales", "supported_currencies"] } }))).toBe(true);
  });

  it("handles empty creation and omitted relation defaults without inventing rows", async () => {
    await Effect.runPromise(policy.validateLogicalCall({ ...creation(), input: [], result: [], events: [] }, empty()));
    const defaultStore = { ...store, name: "Medusa Store", metadata: null };
    const defaultEvidence: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "store", operation: "insert", before: null, after: defaultStore }] };
    const call: Call = { ...creation(), input: [{}], result: [{ ...defaultStore, supported_currencies: [], supported_locales: [] }], events: [event("store", "store-a")] };
    await Effect.runPromise(policy.validateLogicalCall(call, defaultEvidence));
    await refused({ ...call, result: [{ ...defaultStore }] }, defaultEvidence);
    const blankStore = { ...defaultStore, name: "" };
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [{ name: "   " }],
      result: [{ ...blankStore, supported_currencies: [], supported_locales: [] }] },
    { ...defaultEvidence, mutations: [{ ordinal: 0, table: "store", operation: "insert", before: null, after: blankStore }] }));
  });

  it("refuses full DTO, generated ID, child FK and raw/default field tampering", async () => {
    for (const result of [[], [{ ...store, supported_currencies: [], supported_locales: [locale] }],
      [{ ...store, supported_currencies: [{ ...currency, store_id: "other" }], supported_locales: [locale] }],
      [{ ...store, supported_currencies: [currency], supported_locales: [{ ...locale, extra: true }] }]])
      await refused({ ...creation(), result }, evidence());
    for (const [table, changes] of [["store", { name: " Name " }], ["store", { metadata: null }],
      ["store", { default_region_id: "other" }], ["store_currency", { currency_code: "USD" }],
      ["store_currency", { is_default: false }], ["store_locale", { locale_code: "en-us" }],
      ["store_locale", { store_id: "other" }]] satisfies ReadonlyArray<readonly [string, JsonObject]>)
      await refused(creation(), { ...evidence(), mutations: evidence().mutations.map(value => value.table === table && value.after !== null
        ? { ...value, after: { ...value.after, ...changes } } : value) });
    await refused(creation(), { ...evidence(), mutations: evidence().mutations.map(value => ({ ...value, ordinal: 7 })) });
    await refused(creation(), { ...evidence(), mutations: evidence().mutations.slice(0, 2) });
    await refused(creation(), { ...evidence(), mutations: [...evidence().mutations, ...evidence().mutations] });
    await refused({ ...creation(), input: [] }, evidence());
    const raw = Result.getOrThrow(decodeStoreCreates(creation().input))[0];
    if (raw === undefined) throw new Error("Missing raw creation request");
    for (const fields of [{ name: "Other" }, { metadata: null }, { default_region_id: "other" },
      { supported_currencies: [{ currency_code: "EUR", is_default: true }] }, { supported_locales: [{ locale_code: "en-us" }] }])
      await refused({ ...creation(), input: [{ ...raw, ...fields }] }, evidence());
  });

  it("binds event identity/order and rejects wrong profile commands and native event grammar", async () => {
    for (const events of [[], [event("store", "store-a")], [event("store_currency", "currency-a"), event("store", "store-a"), event("store_locale", "locale-a")],
      [event("store", "forged"), event("store_currency", "currency-a"), event("store_locale", "locale-a")]])
      await refused({ ...creation(), events }, evidence());
    for (const commandName of ["storeListForSalesChannelGuard", "storeSoftDeleteForWorkflow", "storeUpdateForWorkflow"])
      await refused({ ...creation(), commandName }, evidence());
    await refused({ ...creation(), mode: "read" }, evidence());
    expect(await Effect.runPromise(Effect.result(policy.capture(event("store", "store-a", "updated")))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
    await refused(creation(), { ...evidence(), observedRows: [{ table: "region", row: store }] });
  });

  it("physically deletes complete child history and announces only Store roots", async () => {
    await Effect.runPromise(policy.validateLogicalCall(inverse(), physical()));
    await refused({ ...inverse(), result: {} }, physical());
    await refused({ ...inverse(), events: [event("store", "store-a", "deleted"), event("store_currency", "currency-a", "deleted")] }, physical());
    await refused({ ...inverse(), input: ["other"] }, physical());
    await refused(inverse(), { ...physical(), mutations: physical().mutations.slice(1) });
    const root = physical().mutations[2], child = physical().mutations[0];
    if (root === undefined || child === undefined) throw new Error("Missing explicit physical transcript");
    await refused(inverse(), { ...physical(), mutations: [{ ...root, ordinal: 0 }, { ...child, ordinal: 1 }] });
    await refused(inverse(), { ...physical(), mutations: physical().mutations.map(value => ({ ...value, ordinal: 7 })) });
    await refused(inverse(), { ...physical(), observedRows: [{ table: "region", row: store }] });
    await refused(inverse(), { ...physical(), observedRows: physical().observedRows.map(value => value.table === "store_currency"
      ? { ...value, row: { ...currency, store_id: "other", deleted_at: time } } : value) });
  });
});
