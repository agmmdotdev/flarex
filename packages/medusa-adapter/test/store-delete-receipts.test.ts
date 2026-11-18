import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStoreMetadata } from "../src/modules/store/schema";
import { compileStoreDeletionContracts, decodeStoreDeletionArguments, decodeStoreDeletionIds,
  decodeStoreDeletionOutput } from "../src/modules/store/delete-input";
import { storeDeletionPolicy } from "../src/modules/store/delete-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileStoreDeletionContracts>>;
let policy: ReturnType<typeof storeDeletionPolicy>;
const time = "2026-10-16T00:00:00.000Z", later = "2026-10-16T00:01:00.000Z";
const store: JsonObject = { id: "store-a", name: "Original", default_sales_channel_id: "channel-kept",
  default_region_id: "region-kept", default_location_id: "location-kept", metadata: { keep: true },
  created_at: time, updated_at: time, deleted_at: null };
const currency: JsonObject = { id: "currency-a", currency_code: "usd", is_default: true, store_id: "store-a",
  created_at: time, updated_at: time, deleted_at: null };
const locale: JsonObject = { id: "locale-a", locale_code: "en-US", store_id: "store-a",
  created_at: time, updated_at: time, deleted_at: null };
const deletedStore: JsonObject = { ...store, deleted_at: later, updated_at: later };
const deletedCurrency: JsonObject = { ...currency, deleted_at: later, updated_at: later };
const deletedLocale: JsonObject = { ...locale, deleted_at: later, updated_at: later };
const output: Json = { store_id: ["store-a"], store_currency_id: ["currency-a"], store_locale_id: ["locale-a"] };
const event = (object: "store" | "store_currency" | "store_locale", id: string, action: "deleted" | "restored" = "deleted"): Json => ({
  name: `store.${object.replaceAll("_", "-")}.${action}`, metadata: { source: "store", object, action }, data: { id },
});
const events = (action: "deleted" | "restored" = "deleted") => [event("store", "store-a", action),
  event("store_currency", "currency-a", action), event("store_locale", "locale-a", action)];
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (restore = false): Call => ({ commandName: restore ? "storeRestoreForWorkflow" : "storeSoftDeleteForWorkflow",
  mode: "write", input: ["store-a", "store-a", "missing"], result: output, events: events(restore ? "restored" : "deleted"),
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
// Explicit fixed transcript: no lifecycle/query planning or storage simulation.
const deletion = (): Activity => ({ ...empty(),
  observedRows: [{ table: "store", row: deletedStore }, { table: "store_currency", row: deletedCurrency }, { table: "store_locale", row: deletedLocale }],
  mutations: [
    { ordinal: 0, table: "store", operation: "patch", before: store, after: deletedStore },
    { ordinal: 1, table: "store_currency", operation: "patch", before: currency, after: deletedCurrency },
    { ordinal: 2, table: "store_locale", operation: "patch", before: locale, after: deletedLocale },
  ], lifecycle: [
    { table: "store", operation: "softDelete", key: { id: "store-a" }, beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal: 0, rowAtOperation: null },
    { table: "store_currency", operation: "softDelete", key: { id: "currency-a" }, beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal: 1, rowAtOperation: null },
    { table: "store_locale", operation: "softDelete", key: { id: "locale-a" }, beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal: 2, rowAtOperation: null },
  ] });
const refused = async (receipt: Call, evidence: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  contracts = Result.getOrThrow(compileStoreDeletionContracts((await Effect.runPromise(captureStoreMetadata())).frame));
  policy = storeDeletionPolicy(contracts);
});

describe("native Store deletion receipts", () => {
  it("retains raw roots while authenticating the complete native map and events", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call(), deletion()));
    expect(Result.getOrThrow(decodeStoreDeletionArguments([["store-a", "store-a", "missing"]])))
      .toEqual([["store-a", "store-a", "missing"]]);
    for (const input of ["store-a", [""], [null], ["a", "b", "c", "d", "e"]])
      expect(Result.isFailure(decodeStoreDeletionIds(input))).toBe(true);
    expect(Result.isFailure(decodeStoreDeletionArguments([["store-a"], {}]))).toBe(true);
    expect(Result.getOrThrow(decodeStoreDeletionOutput(output))).toEqual(output);
    expect(Result.getOrThrow(decodeStoreDeletionOutput({}))).toEqual({});
    for (const result of [{}, { store_id: ["missing"], store_currency_id: ["currency-a"], store_locale_id: ["locale-a"] },
      { store_id: ["store-a"], store_currency_id: ["currency-a", "currency-a"], store_locale_id: ["locale-a"] },
      { store_id: ["store-a"], store_locale_id: ["locale-a"] },
      { store_id: ["store-a"], store_currency_id: ["currency-a"], store_locale_id: ["locale-a"], region_id: ["region-kept"] }])
      await refused({ ...call(), result }, deletion());
    await refused({ ...call(), input: ["unrelated"] }, deletion());
  });

  it("authenticates native deleted events for a predeleted child", async () => {
    const evidence = deletion();
    const historical: Activity = { ...evidence,
      mutations: evidence.mutations.map(mutation => mutation.table === "store_currency"
        ? { ...mutation, before: { ...currency, deleted_at: time } } : mutation),
      lifecycle: evidence.lifecycle.map((transition, index) => index === 1 ? { ...transition, beforeDeletedAt: time } : transition),
    };
    await Effect.runPromise(policy.validateLogicalCall(call(), historical));
    await refused({ ...call(), events: [event("store", "store-a"), event("store_currency", "currency-a", "restored"),
      event("store_locale", "locale-a")] }, historical);
  });

  it("authenticates active restore no-ops and deleted child restoration from full operation rows", async () => {
    const afterLocale: JsonObject = { ...locale, updated_at: later };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "store_locale", row: afterLocale }],
      mutations: [{ ordinal: 0, table: "store_locale", operation: "patch", before: { ...locale, deleted_at: time }, after: afterLocale }],
      lifecycle: [
        { table: "store", operation: "restore", key: { id: "store-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: store },
        { table: "store_currency", operation: "restore", key: { id: "currency-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: currency },
        { table: "store_locale", operation: "restore", key: { id: "locale-a" }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
      ] };
    await Effect.runPromise(policy.validateLogicalCall(call(true), evidence));
    await refused(call(true), { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
    const incomplete = { ...currency }; delete incomplete.currency_code;
    await refused(call(true), { ...evidence, lifecycle: evidence.lifecycle.map(value =>
      value.table === "store_currency" ? { ...value, rowAtOperation: incomplete } : value) });
    await refused({ ...call(true), events: events() }, evidence);
  });

  it("preserves every Store scalar, child field and child Store FK", async () => {
    const evidence = deletion();
    const variants: Array<Readonly<{ table: string; fields: JsonObject }>> = [
      { table: "store", fields: { name: "Forged" } }, { table: "store", fields: { metadata: null } },
      { table: "store", fields: { default_sales_channel_id: "other" } }, { table: "store", fields: { default_region_id: null } },
      { table: "store", fields: { default_location_id: "other" } }, { table: "store", fields: { created_at: later } },
      { table: "store_currency", fields: { currency_code: "eur" } }, { table: "store_currency", fields: { is_default: false } },
      { table: "store_currency", fields: { store_id: null } }, { table: "store_locale", fields: { locale_code: "fr-FR" } },
      { table: "store_locale", fields: { store_id: "unrelated" } }, { table: "store_locale", fields: { extra: true } },
    ];
    for (const variant of variants) await refused(call(), { ...evidence, mutations: evidence.mutations.map(mutation =>
      mutation.table === variant.table && mutation.after !== null ? { ...mutation, after: { ...mutation.after, ...variant.fields } } : mutation) });
    const incomplete = { ...deletedCurrency }; delete incomplete.is_default;
    await refused(call(), { ...evidence, mutations: evidence.mutations.map(mutation => mutation.table === "store_currency"
      ? { ...mutation, after: incomplete } : mutation) });
    for (const owner of [null, "unrelated"]) await refused(call(), { ...evidence,
      mutations: evidence.mutations.map(mutation => mutation.table === "store_currency"
        ? { ...mutation, before: { ...currency, store_id: owner }, after: { ...deletedCurrency, store_id: owner } } : mutation),
      observedRows: evidence.observedRows.map(value => value.table === "store_currency" ? { ...value, row: { ...deletedCurrency, store_id: owner } } : value),
    });
  });

  it("refuses omitted or duplicate transitions, operations, attempt ordinals and unrelated tables", async () => {
    const evidence = deletion();
    await refused(call(), { ...evidence, lifecycle: evidence.lifecycle.slice(0, 2) });
    await refused(call(), { ...evidence, mutations: evidence.mutations.slice(0, 2) });
    await refused(call(), { ...evidence, lifecycle: [...evidence.lifecycle, ...evidence.lifecycle] });
    for (const attemptOrdinal of [null, 1, 99]) await refused(call(), { ...evidence,
      lifecycle: evidence.lifecycle.map((value, index) => index === 0 ? { ...value, attemptOrdinal } : value) });
    await refused(call(), { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, ordinal: 7 })) });
    await refused(call(), { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, before: null })) });
    await refused(call(), { ...evidence, mutations: evidence.mutations.map<Activity["mutations"][number]>(value => ({ ...value, operation: "delete", after: null })) });
    await refused(call(), { ...evidence, observedRows: [{ table: "region", row: store }] });
    await refused(call(), { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, table: "region" })) });
    await refused(call(), { ...evidence, lifecycle: evidence.lifecycle.map<Activity["lifecycle"][number]>(value => ({ ...value, operation: "restore" })) });
    await refused({ ...call(), mode: "read" }, evidence);
    for (const commandName of ["storeCreate", "storeListForSalesChannelGuard", "productSoftDelete"])
      await refused({ ...call(), commandName }, evidence);
  });

  it("binds event identity, family, action and order to the actual lifecycle", async () => {
    const evidence = deletion();
    for (const selected of [[], events().slice(0, 2), [...events(), event("store", "store-a")],
      [event("store", "missing"), event("store_currency", "currency-a"), event("store_locale", "locale-a")],
      [event("store_currency", "currency-a"), event("store", "store-a"), event("store_locale", "locale-a")], events("restored")])
      await refused({ ...call(), events: selected }, evidence);
    for (const malformed of [{ name: "store.store.deleted", metadata: { source: "inventory", object: "store", action: "deleted" }, data: { id: "store-a" } },
      { name: "store.region.deleted", metadata: { source: "store", object: "region", action: "deleted" }, data: { id: "store-a" } },
      { name: "store.store.updated", metadata: { source: "store", object: "store", action: "updated" }, data: { id: "store-a" } },
      { name: "store.store.deleted", metadata: { source: "store", object: "store", action: "deleted" }, data: { id: [] } }])
      expect(await Effect.runPromise(Effect.result(policy.capture(malformed))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });

  it("validates complete native tuple rows and exact root/cascade correspondence before projection", () => {
    const tuple = [[deletedStore], { Store: [deletedStore], StoreCurrency: [deletedCurrency], StoreLocale: [deletedLocale] }];
    expect(Result.getOrThrow(contracts.decodeLifecycleResult(tuple))).toEqual(tuple);
    expect(Result.getOrThrow(contracts.decodeLifecycleResult([[], {}]))).toEqual([[], {}]);
    const incomplete = { ...deletedLocale }; delete incomplete.locale_code;
    for (const malformed of [[], [[deletedStore], {}], [[], { Store: [deletedStore] }],
      [[deletedStore], { Store: [deletedStore], StoreCurrency: [] }],
      [[deletedStore], { Store: [deletedStore], StoreLocale: [incomplete] }],
      [[deletedStore], { Store: [deletedStore], StoreCurrency: [{ ...deletedCurrency, is_default: "true" }] }],
      [[deletedStore], { Store: [deletedStore], Region: [{ id: "region-kept" }] }],
      [[{ ...deletedStore, name: "Forged" }], { Store: [deletedStore] }],
      [[deletedStore], { Store: [deletedStore], StoreLocale: [{ ...deletedLocale, unknown_field: true }] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(malformed))).toBe(true);
  });

  it("retains empty/missing/deleted roots and projects only core document metadata", async () => {
    const absent: Call = { ...call(), input: [], result: {}, events: [] };
    await Effect.runPromise(policy.validateLogicalCall(absent, empty()));
    await Effect.runPromise(policy.validateLogicalCall({ ...absent, input: ["missing"] }, empty()));
    await Effect.runPromise(policy.validateLogicalCall({ ...absent, input: ["store-a"] },
      { ...empty(), observedRows: [{ table: "store", row: deletedStore }] }));
    await refused({ ...absent, input: ["store-a"] }, { ...empty(), observedRows: [{ table: "store", row: store }] });
    const document = (row: JsonObject): JsonObject => ({ ...row, _id: "document-" + row.id, _creationTime: 1_760_572_800_000 });
    const evidence = deletion();
    await Effect.runPromise(policy.validateLogicalCall(call(), { ...evidence,
      observedRows: evidence.observedRows.map(value => ({ ...value, row: document(value.row) })),
      mutations: evidence.mutations.map(value => ({ ...value, before: value.before === null ? null : document(value.before),
        after: value.after === null ? null : document(value.after) })),
    }));
    await refused(call(), { ...evidence, observedRows: evidence.observedRows.map(value => ({ ...value, row: { ...value.row, _revision: "unadmitted" } })) });
  });
});
