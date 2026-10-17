import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStoreMetadata } from "../src/modules/store/schema";
import { prepareStoreUpdateRepository } from "../src/modules/store/update-repository";
import { storeUpdatePolicy } from "../src/modules/store/update-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof storeUpdatePolicy>;
const time = "2026-10-17T00:00:00.000Z";
const managed = { created_at: time, updated_at: time, deleted_at: null };
const store: JsonObject = { id: "store-a", name: "Name", default_sales_channel_id: null, default_region_id: null,
  default_location_id: null, metadata: null, ...managed };
const currencyA: JsonObject = { id: "currency-a", currency_code: "usd", is_default: true, store_id: "store-a", ...managed };
const currencyB: JsonObject = { id: "currency-b", currency_code: "eur", is_default: false, store_id: "store-a", ...managed };
const currencyHistory: JsonObject = { ...currencyA, id: "currency-history", deleted_at: time };
const localeA: JsonObject = { id: "locale-a", locale_code: "en", store_id: "store-a", ...managed };
const localeB: JsonObject = { id: "locale-b", locale_code: "my", store_id: "store-a", ...managed };
const localeHistory: JsonObject = { ...localeA, id: "locale-history", deleted_at: time };
const observations: Activity["observedRows"] = [
  { table: "store_locale", row: localeB }, { table: "store_currency", row: currencyHistory },
  { table: "store_currency", row: currencyB }, { table: "store_locale", row: localeHistory },
  { table: "store", row: store }, { table: "store_locale", row: localeA }, { table: "store_currency", row: currencyA },
];
const activity = (observedRows = observations): Activity => ({ observedRows, mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const read = (): Call => ({ commandName: "storeListForUpdate", mode: "read",
  input: { filters: { id: "store-a" }, config: { select: [], relations: ["supported_currencies", "supported_locales"] } },
  result: [{ id: "store-a", supported_currencies: [currencyA, currencyB], supported_locales: [localeA, localeB] }], events: [],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const updatedStore: JsonObject = { ...store, name: "Updated", updated_at: "2026-10-17T01:00:00.000Z" };
const scalarUpdate = (): Call => ({ commandName: "storeUpdateForWorkflow", mode: "write",
  input: { selector: { id: "store-a" }, update: { name: " Updated " } },
  result: [{ ...updatedStore, supported_currencies: [currencyA, currencyB], supported_locales: [localeA, localeB] }],
  events: [{ name: "store.store.updated", metadata: { source: "store", object: "store", action: "updated" }, data: { id: "store-a" } }],
  fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 });
const scalarActivity = (observedRows = observations): Activity => ({ ...activity(observedRows),
  mutations: [{ ordinal: 0, table: "store", operation: "patch", before: store, after: updatedStore }] });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureStoreMetadata());
  policy = storeUpdatePolicy(Result.getOrThrow(prepareStoreUpdateRepository(metadata.frame)));
});

describe("native Store read receipt relation ordering", () => {
  // Scripted receipt evidence tests presentation correlation only. It does not
  // claim that a test-created observation grants core history authority.
  it("accepts two-child public id order across permuted complete candidate observations", async () => {
    for (const selected of [observations, [...observations].reverse(), [...observations.slice(3), ...observations.slice(0, 3)]])
      await Effect.runPromise(policy.validateLogicalCall(read(), activity(selected)));
  });

  it("refuses reversed native result children while keeping the same complete evidence", async () => {
    for (const result of [
      [{ id: "store-a", supported_currencies: [currencyB, currencyA], supported_locales: [localeA, localeB] }],
      [{ id: "store-a", supported_currencies: [currencyA, currencyB], supported_locales: [localeB, localeA] }],
    ]) expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...read(), result }, activity()))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("authenticates scalar-only write hydration of two unchanged children using replacement load order", async () => {
    for (const selected of [observations, [...observations].reverse(), [...observations.slice(3), ...observations.slice(0, 3)]])
      await Effect.runPromise(policy.validateLogicalCall(scalarUpdate(), scalarActivity(selected)));
  });

  it("refuses scalar-only output reordering and unexpected child effects", async () => {
    for (const result of [
      [{ ...updatedStore, supported_currencies: [currencyB, currencyA], supported_locales: [localeA, localeB] }],
      [{ ...updatedStore, supported_currencies: [currencyA, currencyB], supported_locales: [localeB, localeA] }],
    ]) expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...scalarUpdate(), result }, scalarActivity()))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(scalarUpdate(), { ...scalarActivity(), mutations: [
      ...scalarActivity().mutations,
      { ordinal: 1, table: "store_currency", operation: "patch", before: currencyA, after: { ...currencyA, is_default: false } },
    ] })))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
