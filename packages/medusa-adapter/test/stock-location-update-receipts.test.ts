import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStockLocationMetadata } from "../src/modules/stock-location/schema";
import { compileStockLocationUpdateContracts } from "../src/modules/stock-location/update-input";
import { stockLocationUpdateEventPolicy } from "../src/modules/stock-location/update-events";
import { prepareStockLocationUpdateRepository } from "../src/modules/stock-location/update-repository";
import { compileStockLocationUpdateReadReceipt } from "../src/modules/stock-location/update-read-receipt";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceRelationReadQuery } from "../src/query/relations";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../src/value/input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileStockLocationUpdateContracts>>;
let policy: ReturnType<typeof stockLocationUpdateEventPolicy>;
let prepared: Result.Result.Success<ReturnType<typeof prepareStockLocationUpdateRepository>>;
const instant = "2026-10-16T00:00:00.000Z", changed = "2026-10-16T00:01:00.000Z";
const location = (id: string): JsonObject => ({ id, name: "Warehouse", metadata: null, address_id: null,
  created_at: instant, updated_at: instant, deleted_at: null });
const address = (id: string): JsonObject => ({ id, address_1: "Existing street", address_2: null, company: null,
  city: null, country_code: "US", phone: null, province: null, postal_code: null, metadata: null,
  created_at: instant, updated_at: instant, deleted_at: null });
const present = (value: JsonObject) => ({ kind: "present", value });
const event = (object: "stock_location" | "stock_location_address", action: "created" | "updated", id: string | string[]) => ({
  name: "stock_location." + (object === "stock_location" ? "stock-location" : "stock-location-address") + "." + action,
  metadata: { source: "stock_location", object, action }, data: { id },
});
const evidence = (table: string, before: readonly JsonObject[], after: readonly JsonObject[]): Activity => ({
  observedRows: before.map(row => ({ table, row })),
  mutations: after.map((row, ordinal) => ({ ordinal, table, operation: "patch", before: before[ordinal] ?? null, after: row })),
  lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [],
});
const call = (commandName: string, input: Call["input"], result: Call["result"], events: Call["events"]): Call => ({
  commandName, input, result, events, mode: "write", fromAttempt: 0, toAttempt: events.length, fromLifecycle: 0, toLifecycle: 0,
});
const rootCall = (input: Call["input"], result: Call["result"], events: Call["events"] = []) => call("stockLocationUpdateBySelector", input, result, events);
const addressCall = (input: Call["input"], result: Call["result"], events: Call["events"] = []) => call("stockLocationAddressUpsertForWorkflow", input, result, events);
const refused = async (receipt: Call, activity: Activity) => {
  expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))).toBe(true);
};

describe("Stock Location update checked contracts and logical receipts", () => {
  beforeAll(async () => {
    const metadata = await Effect.runPromise(captureStockLocationMetadata());
    const root = metadata.frame.tables.find(table => table.name === "stock_location");
    const child = metadata.frame.tables.find(table => table.name === "stock_location_address");
    if (root === undefined || child === undefined) throw new Error("Missing genuine checked Stock Location DML");
    contracts = await Effect.runPromise(Effect.fromResult(compileStockLocationUpdateContracts(root, child)));
    prepared = await Effect.runPromise(Effect.fromResult(prepareStockLocationUpdateRepository(root, child)));
    const validateRead = await Effect.runPromise(Effect.fromResult(compileStockLocationUpdateReadReceipt(root, child, prepared.reads)));
    policy = stockLocationUpdateEventPolicy(contracts, validateRead);
  });

  it("distinguishes genuine selected preimages from complete native rows and refuses unknown/corrupt values", () => {
    expect(prepared.table.foreignKeys).toContain("address_id");
    expect(prepared.reads.relation.join.foreignKeys).toEqual(["address_id"]);
    expect(Result.isSuccess(contracts.decodePreimages([{ id: "a" }]))).toBe(true);
    expect(Result.isSuccess(contracts.decodeAddressPreimages([{ id: "a", city: null }]))).toBe(true);
    expect(Result.isSuccess(contracts.decodeAddressPreimages([{ id: "a", metadata: { retained: true } }]))).toBe(true);
    for (const preimage of [{ city: "Missing key" }, { id: "a", country_code: null }, { id: "a", city: 42 }, { id: "a", invented: true }])
      expect(Result.isFailure(contracts.decodeAddressPreimages([preimage]))).toBe(true);
    for (const value of [{ id: "a" }, { ...location("a"), name: 42 }, { ...location("a"), invented: true }])
      expect(Result.isFailure(contracts.decodeOutput(present(value)))).toBe(true);
    for (const value of [{ id: "a" }, { ...address("a"), country_code: null }, { ...address("a"), invented: true }])
      expect(Result.isFailure(contracts.decodeAddresses([value]))).toBe(true);
    expect(Result.isSuccess(contracts.decodeOutput(present(location("a"))))).toBe(true);
    expect(Result.isSuccess(contracts.decodeAddresses([address("a")]))).toBe(true);
  });

  it("accepts only the private optional envelope around scalar Location results", () => {
    expect(contracts.decodeOutput({ kind: "absent" })).toEqual(Result.succeed(undefined));
    for (const malformed of [null, [], location("a"), { kind: "missing" }, { kind: "absent", value: location("a") },
      { kind: "present" }, { kind: "present", value: [location("a")] }, { kind: "present", value: location("a"), extra: true }])
      expect(Result.isFailure(contracts.decodeOutput(malformed))).toBe(true);
  });

  it("authenticates native ID-filter order, every actual write and the first scalar result", async () => {
    const before = [location("b"), location("a")], after = before.map(row => ({ ...row, name: "Updated", updated_at: changed }));
    const activity = evidence("stock_location", before, after);
    const receipt = rootCall({ selector: { id: ["b", "a", "b"] }, update: { name: "Updated" } }, present(after[0]!),
      [event("stock_location", "updated", "b"), event("stock_location", "updated", "a")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    for (const result of [present(after[1]!), present({ ...after[0]!, name: "Invented" }), present({ ...after[0]!, id: "outside" }), { kind: "absent" }])
      await refused({ ...receipt, result }, activity);
    await refused(receipt, { ...activity, mutations: activity.mutations.slice(0, 1) });
    await refused(receipt, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, table: "stock_location_address" })) });
  });

  it("refuses missing, extra, reversed and forged module event identities", async () => {
    const before = [location("a"), location("b")], after = before.map(row => ({ ...row, name: "Updated", updated_at: changed }));
    const activity = evidence("stock_location", before, after);
    const first = event("stock_location", "updated", "a"), second = event("stock_location", "updated", "b");
    const receipt = rootCall({ selector: {}, update: { name: "Updated" } }, present(after[0]!), [first, second]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    for (const events of [[], [first], [first, second, first], [second, first], [event("stock_location", "updated", ["b", "a"])],
      [event("stock_location", "updated", "outside"), second], [event("stock_location_address", "updated", "a"), second],
      [event("stock_location", "created", "a"), second]])
      await refused({ ...receipt, events }, activity);
  });

  it("requires real observed rows for no-op output and forbids invented no-op writes/events", async () => {
    const before = [location("a"), location("b")], activity = evidence("stock_location", before, []);
    const receipt = rootCall({ selector: { id: ["b", "a"] }, update: {} }, present(before[1]!));
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: present(before[0]!) }, activity);
    await refused({ ...receipt, result: present({ ...before[1]!, updated_at: changed }) }, activity);
    await refused({ ...receipt, events: [event("stock_location", "updated", "b")] }, activity);
    await refused(receipt, evidence("stock_location", before, [{ ...before[0]! }]));
    const empty = rootCall({ selector: { id: "missing" }, update: { name: "No match" } }, { kind: "absent" });
    await Effect.runPromise(policy.validateLogicalCall(empty, evidence("stock_location", [], [])));
    await refused({ ...empty, result: present(location("missing")) }, evidence("stock_location", [], []));
    await refused(rootCall({ selector: {}, update: {} }, { kind: "absent" }), evidence("stock_location", before, []));
  });

  it("retains the witnessed shared selector metadata object instead of inventing independent per-row merges", async () => {
    const before = [{ ...location("a"), metadata: { keep: "first", drop: "old-first", first: true } },
      { ...location("b"), metadata: { keep: "second", drop: "old-second", second: true } }];
    const finalMetadata = { keep: "first", drop: "old-second", second: true, first: true, added: true };
    const after = before.map(row => ({ ...row, metadata: finalMetadata, updated_at: changed }));
    const receipt = rootCall({ selector: { id: ["a", "b"] }, update: { metadata: { drop: "", added: true } } }, present(after[0]!),
      [event("stock_location", "updated", "a"), event("stock_location", "updated", "b")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence("stock_location", before, after)));
    const invented = [{ ...after[0]!, metadata: { keep: "first", first: true, added: true } },
      { ...after[1]!, metadata: { keep: "second", second: true, added: true } }];
    await refused({ ...receipt, result: present(invented[0]!) }, evidence("stock_location", before, invented));
    const forged = after.map(row => ({ ...row, address_id: "Unrequested relink" }));
    await refused({ ...receipt, result: present(forged[0]!) }, evidence("stock_location", before, forged));
  });

  it("accepts standalone Address creation and creation-before-update result ordering", async () => {
    const before = { ...address("attached"), metadata: { keep: true } };
    const created = { ...address("standalone"), address_1: "New street", country_code: "GB", created_at: changed, updated_at: changed };
    const updated = { ...before, city: "London", updated_at: changed };
    const activity: Activity = { ...evidence("stock_location_address", [before], []), mutations: [
      { ordinal: 0, table: "stock_location_address", operation: "insert", before: null, after: created },
      { ordinal: 1, table: "stock_location_address", operation: "patch", before, after: updated },
    ] };
    const input = [{ id: "attached", city: "London" }, { address_1: "New street", country_code: "GB" }];
    const receipt = addressCall(input, [created, updated], [event("stock_location_address", "created", "standalone"), event("stock_location_address", "updated", "attached")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [updated, created] }, activity);
    await refused({ ...receipt, result: [{ ...created, city: "Invented" }, updated] }, activity);
    await refused(receipt, { ...activity, mutations: activity.mutations.slice(1) });
    await refused({ ...receipt, events: [...receipt.events].reverse() }, activity);
  });

  it("binds partial Address metadata patches and keyed no-op results without inventing Location facts", async () => {
    const before = { ...address("a"), metadata: { keep: true, drop: "old" } };
    const after = { ...before, metadata: { keep: true, added: true }, updated_at: changed };
    const receipt = addressCall([{ id: "a", metadata: { drop: "", added: true } }], [after], [event("stock_location_address", "updated", "a")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence("stock_location_address", [before], [after])));
    const forged = { ...after, country_code: "Unrequested" };
    await refused({ ...receipt, result: [forged] }, evidence("stock_location_address", [before], [forged]));
    const noOp = addressCall([{ id: "a" }], [before]);
    await Effect.runPromise(policy.validateLogicalCall(noOp, evidence("stock_location_address", [before], [])));
    await refused({ ...noOp, result: [{ ...before, city: "Invented" }] }, evidence("stock_location_address", [before], []));
    await refused({ ...noOp, events: [event("stock_location_address", "updated", "a")] }, evidence("stock_location_address", [before], []));
    await refused(receipt, evidence("stock_location", [before], [after]));
    const empty = addressCall([], []);
    await Effect.runPromise(policy.validateLogicalCall(empty, evidence("stock_location_address", [], [])));
    await refused({ ...empty, result: [before] }, evidence("stock_location_address", [], []));
  });

  it("refuses receipt activity from sibling lifecycle operations and read-side mutations", async () => {
    const row = location("a"), activity = evidence("stock_location", [row], []);
    const receipt = rootCall({ selector: { id: "a" }, update: {} }, present(row));
    await refused({ ...receipt, commandName: "stockLocationUnadmittedWrite" }, activity);
    await refused({ ...receipt, mode: "read", events: [event("stock_location", "updated", "a")] }, activity);
    await refused({ ...receipt, mode: "read" }, evidence("stock_location", [row], [row]));
    await refused(receipt, { ...activity, mutations: [{ ordinal: 3, table: "stock_location", operation: "patch", before: row, after: row }] });
  });

  it("refuses invented scalar and nested read results without correlated selection evidence", async () => {
    const activity = evidence("stock_location", [], []);
    const scalar = { ...call("stockLocationListForUpdate", { filters: { id: "missing" } },
      [location("missing")], []), mode: "read" as const };
    await refused(scalar, activity);
    const nested = { ...scalar, input: { filters: { id: "missing" }, config: { relations: ["address"] } },
      result: [{ ...location("missing"), address_id: "invented-address", address: address("invented-address") }] };
    await refused(nested, activity);
  });

  it("refuses uncorrelated read evidence and forged counts", async () => {
    const row = location("selected");
    const receipt = { ...call("stockLocationCountForUpdate", { filters: { id: "selected" } }, [[row], 2], []), mode: "read" as const };
    await refused(receipt, evidence("stock_location", [row], []));
    await refused({ ...receipt, result: [[], 0] }, evidence("stock_location_address", [address("unrelated")], []));
  });

  it("authenticates selected nested Address values, the FK, pagination count and both complete-set reads", async () => {
    const a = { ...location("a"), address_id: "address-a" }, b = location("b"), child = address("address-a");
    const input = { filters: { id: ["a", "b"] }, config: { select: ["id", "address.city"], relations: ["address"], take: 1 } };
    const result = [[{ id: "a", address_id: "address-a", address: { id: "address-a", city: null } }], 2];
    const receipt = { ...call("stockLocationCountForUpdate", input, result, []), mode: "read" as const };
    const query = await Effect.runPromise(Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config))
      .pipe(Result.flatMap(query => prepared.reads.query("stock_location", query)))));
    const activity: Activity = { ...evidence("stock_location", [b, a], []),
      observedRows: [...evidence("stock_location", [b, a], []).observedRows, { table: "stock_location_address", row: child }],
      relationalReads: [
        { table: "stock_location", query: commerceRelationReadQuery(defaultCommerceResources, query.plan.query.predicate), total: 2, returned: 2 },
        { table: "stock_location_address", query: commerceRelationReadQuery(defaultCommerceResources,
          { kind: "and", children: [{ kind: "in", column: "id", values: ["address-a"] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 },
      ] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    for (const forged of [
      [[{ id: "a", address_id: "address-a", address: { id: "address-a", city: "Invented" } }], 2],
      [[{ id: "a", address_id: "outside", address: { id: "address-a", city: null } }], 2],
      [[{ id: "a", address_id: "address-a", address: null }], 2],
      [[{ id: "a", address_id: "address-a", address: { id: "address-a", city: null, country_code: "US" } }], 2],
      [[], 2], [result[0]!, 1],
    ]) await refused({ ...receipt, result: forged }, activity);
    for (const relationalReads of [[], activity.relationalReads.slice(0, 1), [...activity.relationalReads].reverse(),
      [...activity.relationalReads, activity.relationalReads[0]!], activity.relationalReads.map(read => ({ ...read, returned: 0 }))])
      await refused(receipt, { ...activity, relationalReads });
    for (const observedRows of [activity.observedRows.slice(0, 2), [...activity.observedRows, { table: "stock_location_address", row: address("outside") }],
      [...activity.observedRows, activity.observedRows[0]!], [{ table: "stock_location", row: { ...a, invented: true } }, ...activity.observedRows.slice(1)]])
      await refused(receipt, { ...activity, observedRows });
  });

  it("authenticates nullable or deleted Address population without inventing omitted reads", async () => {
    for (const attached of [false, true]) {
      const row = { ...location("a"), address_id: attached ? "deleted" : null };
      const child = { ...address("deleted"), deleted_at: instant };
      const input = { filters: { id: "a" }, config: { relations: ["address"] } };
      const query = await Effect.runPromise(Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config))
        .pipe(Result.flatMap(query => prepared.reads.query("stock_location", query)))));
      const activity: Activity = { ...evidence("stock_location", [row], []),
        observedRows: [{ table: "stock_location", row }, ...(attached ? [{ table: "stock_location_address", row: child }] : [])],
        relationalReads: [{ table: "stock_location", query: commerceRelationReadQuery(defaultCommerceResources, query.plan.query.predicate), total: 1, returned: 1 },
          ...(attached ? [{ table: "stock_location_address", query: commerceRelationReadQuery(defaultCommerceResources,
            { kind: "and", children: [{ kind: "in", column: "id", values: ["deleted"] }, { kind: "isNull", column: "deleted_at" }] }), total: 0, returned: 0 }] : [])] };
      const receipt = { ...call("stockLocationListForUpdate", input, [{ ...row, address: null }], []), mode: "read" as const };
      await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
      await refused({ ...receipt, result: [{ ...row, address: child }] }, activity);
      await refused(receipt, { ...activity, relationalReads: [] });
    }
  });

  it("uses native ID-filter ordering, deleted residuals and the same standalone Address projection", async () => {
    const a = location("a"), b = location("b"), deleted = { ...location("deleted"), deleted_at: instant };
    const input = { filters: { id: ["b", "a", "deleted"] }, config: { select: ["id"], skip: 1, take: 1 } };
    const query = await Effect.runPromise(Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config))
      .pipe(Result.flatMap(query => prepared.reads.query("stock_location", query)))));
    const activity: Activity = { ...evidence("stock_location", [a, deleted, b], []),
      relationalReads: [{ table: "stock_location", query: commerceRelationReadQuery(defaultCommerceResources, query.plan.query.predicate), total: 2, returned: 2 }] };
    const receipt = { ...call("stockLocationCountForUpdate", input, [[{ id: "a" }], 2], []), mode: "read" as const };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [[{ id: "b" }], 2] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "stock_location", row: location("unselected") }] });
    const child = { ...address("child"), deleted_at: instant }, addressInput = { filters: { id: "child" }, config: { select: ["id", "city"], withDeleted: true } };
    const addressPlan = await Effect.runPromise(Effect.fromResult(captureCommerceInput(buildQuery(addressInput.filters, addressInput.config))
      .pipe(Result.flatMap(query => prepared.reads.query("stock_location_address", query)))));
    const addressActivity: Activity = { ...evidence("stock_location_address", [child], []), relationalReads: [
      { table: "stock_location_address", query: commerceRelationReadQuery(defaultCommerceResources, addressPlan.plan.query.predicate), total: 1, returned: 1 }] };
    const addressReceipt = { ...call("stockLocationAddressListForUpdate", addressInput, [{ id: "child", city: null }], []), mode: "read" as const };
    await Effect.runPromise(policy.validateLogicalCall(addressReceipt, addressActivity));
    await refused({ ...addressReceipt, result: [{ id: "child", city: "Forged" }] }, addressActivity);
    await refused({ ...addressReceipt, commandName: "stockLocationInventedRead" }, addressActivity);
    await refused(addressReceipt, { ...addressActivity, observedRows: [...addressActivity.observedRows, { table: "stock_location", row: a }] });
  });

  it("authenticates name residuals over identity candidates and complete-range observations", async () => {
    const a = location("a"), b = { ...location("b"), name: "Matching warehouse" };
    for (const filters of [{ id: ["a"], name: "Nonmatching warehouse" }, { name: "Nonmatching warehouse", id: "a" }]) {
      const input = { filters, config: { select: ["id"] } };
      const query = await Effect.runPromise(Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config))
        .pipe(Result.flatMap(query => prepared.reads.query("stock_location", query)))));
      const activity: Activity = { ...evidence("stock_location", [a], []), relationalReads: [
        { table: "stock_location", query: commerceRelationReadQuery(defaultCommerceResources, query.plan.query.predicate), total: 0, returned: 0 }] };
      const receipt = { ...call("stockLocationCountForUpdate", input, [[], 0], []), mode: "read" as const };
      await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
      await refused({ ...receipt, result: [[{ id: "a" }], 1] }, activity);
      await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "stock_location", row: b }] });
    }
    const input = { filters: { name: "Matching warehouse" }, config: { select: ["id"] } };
    const query = await Effect.runPromise(Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config))
      .pipe(Result.flatMap(query => prepared.reads.query("stock_location", query)))));
    const activity: Activity = { ...evidence("stock_location", [a, b], []), relationalReads: [
      { table: "stock_location", query: commerceRelationReadQuery(defaultCommerceResources, query.plan.query.predicate), total: 1, returned: 1 }] };
    const receipt = { ...call("stockLocationCountForUpdate", input, [[{ id: "b" }], 1], []), mode: "read" as const };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [[{ id: "a" }], 1] }, activity);
    await refused({ ...receipt, result: [[{ id: "a" }, { id: "b" }], 2] }, activity);
  });
});
