import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { JsonObject } from "flarex-protocol/json";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { commerceError, CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { decodeGraphCount } from "../src/local-graph/query";
import { makeCustomerCartCreationCommands } from "../src/modules/customer/cart-creation-service";
import { prepareLogicalCustomerSelection, customerRow, type CustomerInitialRow } from "./support/logical-customer-selection-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const cleanup: Array<() => Promise<void>> = [];
const stamp = "2026-10-22T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const group = (id: string, deleted = false): CustomerInitialRow => ({ table: "customer_group", row: {
  id, name: id, metadata: null, created_by: null, ...managed, ...(deleted ? { deleted_at: stamp } : {}),
} });
const membership = (id: string, customer_group_id: string, deleted = false): CustomerInitialRow => ({ table: "customer_group_customer", row: {
  id, customer_id: "cus-graph", customer_group_id, metadata: null, created_by: null, ...managed, ...(deleted ? { deleted_at: stamp } : {}),
} });
const initial = [customerRow("cus-graph", "graph@example.invalid", true), customerRow("cus-empty", "empty@example.invalid"),
  customerRow("cus-deleted", "deleted-graph@example.invalid", false, true),
  group("cusgroup-z"), group("cusgroup-a"), group("cusgroup-deleted", true),
  membership("cusgc-z", "cusgroup-z", true), membership("cusgc-a", "cusgroup-a"), membership("cusgc-deleted-target", "cusgroup-deleted")];
const query = (id: string): JsonObject => ({ filters: { id }, config: { relations: ["groups"], take: 4, skip: 0, order: { id: "ASC" } } });
const groupIds = (value: unknown) => {
  const [rows] = Result.getOrThrow(decodeGraphCount(value));
  const row = rows[0];
  if (row === undefined) throw new Error("Missing Customer graph result");
  return Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(row.groups).map(group => group.id);
};
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}

async function prepare(rows: readonly CustomerInitialRow[] = initial, shared?: Parameters<typeof prepareLogicalCustomerSelection>[3]) {
  const fixture = await prepareLogicalCustomerSelection(driver, close => cleanup.push(close), rows, shared);
  const customer = await Effect.runPromise(makeCustomerCartCreationCommands()), participant = defineAtomicCommerceParticipant("customerCartCreation");
  const traces: Array<{ call: Parameters<LogicalCommerceCallValidation>[0]; activity: Parameters<LogicalCommerceCallValidation>[1] }> = [];
  let arrangements = 0;
  const arrange = defineCommerceCommand("customerCartArrangePending", "write", (ctx, mode) => Effect.gen(function* () {
    arrangements++;
    if (mode === "orphan") {
      yield* (yield* ctx.table("customer_group_customer")).write(ctx.manager, "insert", [membership("cusgc-orphan", "cusgroup-missing").row]);
      return null;
    }
    yield* (yield* ctx.table("customer_group")).write(ctx.manager, "insert", [group("cusgroup-pending").row]);
    yield* (yield* ctx.table("customer_group_customer")).write(ctx.manager, "insert", [membership("cusgc-pending", "cusgroup-pending").row]);
    return null;
  }));
  const read = defineAtomicCommerceCommand("customerCartCountRoot", (ctx, input) => ctx.call(participant, customer.count, input));
  const inverse = defineAtomicCommerceCommand("customerCartInverseRoot", (ctx, input) => ctx.call(participant, customer.deleteForWorkflow, input));
  const pending = defineAtomicCommerceCommand("customerCartPendingRoot", (ctx, input) => Effect.gen(function* () {
    yield* ctx.call(participant, arrange, input);
    const value = yield* ctx.call(participant, customer.count, query("cus-graph"));
    if (input === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    return value;
  }));
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.gen(function* () {
    // This eventless command is fixture arrangement, not a Group mutation API.
    if (command === arrange) return;
    yield* customer.logicalEventPolicy().validateLogicalCall(call, activity);
    if (command === customer.count) traces.push({ call, activity });
  });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.fixture.hostInput,
    identityAndAccessPolicy: { profile: "customer-cart-creation-read-proof" }, commands: [read, pending, inverse],
    participants: [{ participant, logicalStorage: fixture.installed.logicalStorage, commands: [...customer.commands, arrange],
      allowStorageInsertionOrder: true, validateLogicalCall }] }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, customer, read, inverse, pending, traces, fixture, arrangements: () => arrangements };
}

let ready: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => { ready = await prepare(); }, 180_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

it("loads native complete Customer groups in protected membership order, including deleted pivots and excluding deleted targets", async () => {
  const result = await Effect.runPromise(ready.host.run(ready.host.newRequestKey(), ready.read, query("cus-graph")));
  expect(groupIds(result)).toEqual(["cusgroup-z", "cusgroup-a"]);
  expect(Result.getOrThrow(decodeGraphCount(result))[1]).toBe(1);
  expect(groupIds(await Effect.runPromise(ready.host.run(ready.host.newRequestKey(), ready.read, query("cus-empty"))))).toEqual([]);
  expect(await Effect.runPromise(ready.host.run(ready.host.newRequestKey(), ready.read, query("cus-deleted")))).toEqual([[], 0]);
});

it("refuses changed outputs, missing or reordered read evidence, order tampering and foreign observations", async () => {
  await Effect.runPromise(ready.host.run(ready.host.newRequestKey(), ready.read, query("cus-graph")));
  const trace = ready.traces.at(-1);
  if (trace === undefined) throw new Error("Missing genuine Customer graph trace");
  expect(trace.activity.relationalReads.map(read => read.table)).toEqual(["customer", "customer_group_customer", "customer_group"]);
  const [rows, count] = Result.getOrThrow(decodeGraphCount(trace.call.result));
  const changed = [{ ...rows[0], groups: [] }];
  const variants = [
    { call: { ...trace.call, result: [changed, count] }, activity: trace.activity },
    { call: trace.call, activity: { ...trace.activity, relationalReads: trace.activity.relationalReads.slice(1) } },
    { call: trace.call, activity: { ...trace.activity, relationalReads: [...trace.activity.relationalReads].reverse() } },
    { call: trace.call, activity: { ...trace.activity, relationalReads: trace.activity.relationalReads.map((read, index) => index !== 1 ? read :
      { ...read, query: { ...Schema.decodeUnknownSync(Schema.JsonObject)(read.query), order: { column: "customer_group_id", direction: "asc" } } }) } },
    { call: trace.call, activity: { ...trace.activity, observedRows: trace.activity.observedRows.filter(row => row.table !== "customer_group") } },
    { call: trace.call, activity: { ...trace.activity, observedRows: trace.activity.observedRows.map(row => row.table !== "customer_group" ? row : { ...row, table: "unadmitted_group" }) } },
  ];
  for (const { call, activity } of variants) expect(Exit.isFailure(await Effect.runPromiseExit(ready.customer.logicalEventPolicy().validateLogicalCall(call, activity)))).toBe(true);
});

it("uses genuine pending membership rows, rolls them back and suppresses callbacks on durable replay", async () => {
  expect(await Effect.runPromise(Effect.result(ready.host.run(ready.host.newRequestKey(), ready.pending, "rollback"))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(await ready.fixture.read(["cusgroup-pending", "cusgc-pending"])).toEqual([]);
  const key = ready.host.newRequestKey(), value = await Effect.runPromise(ready.host.run(key, ready.pending, "commit"));
  expect(groupIds(value)).toEqual(["cusgroup-z", "cusgroup-a", "cusgroup-pending"]);
  const calls = ready.arrangements(), traces = ready.traces.length;
  expect(await Effect.runPromise(ready.host.run(key, ready.pending, "commit"))).toEqual(value);
  expect(ready.arrangements()).toBe(calls); expect(ready.traces).toHaveLength(traces);
});

it("retains existing Customer selection inverse refusal before membership-bearing deletion", async () => {
  const before = await ready.fixture.read(["cus-graph", "cusgc-z", "cusgc-a"]);
  const result = await Effect.runPromiseExit(ready.host.run(ready.host.newRequestKey(), ready.inverse, "cus-graph"));
  expect(Exit.isFailure(result)).toBe(true);
  if (Exit.isFailure(result)) expect(reasons(result.cause)).toContain("unsupportedProfile");
  expect(await ready.fixture.read(["cus-graph", "cusgc-z", "cusgc-a"])).toEqual(before);
});

it("keeps identically named Customer cohorts in their authenticated scope", async () => {
  const other = await prepare([customerRow("cus-graph", "other@example.invalid"), group("cusgroup-other"), membership("cusgc-other", "cusgroup-other")],
    { resource: ready.fixture.fixture.resource, fixtureIdentity: { deploymentId: "customer-cart-other-scope", projectId: "customer-cart-creation",
      uuidOffset: 8_500_000 } });
  expect(groupIds(await Effect.runPromise(other.host.run(other.host.newRequestKey(), other.read, query("cus-graph"))))).toEqual(["cusgroup-other"]);
  expect(groupIds(await Effect.runPromise(ready.host.run(ready.host.newRequestKey(), ready.read, query("cus-graph")))))
    .toEqual(["cusgroup-z", "cusgroup-a", "cusgroup-pending"]);
});

it("retains genuine source foreign-key enforcement instead of admitting an orphan membership", async () => {
  const before = await ready.fixture.snapshot();
  expect(Exit.isFailure(await Effect.runPromiseExit(ready.host.run(ready.host.newRequestKey(), ready.pending, "orphan")))).toBe(true);
  expect(await ready.fixture.read(["cusgc-orphan"])).toEqual([]);
  expect(await ready.fixture.snapshot()).toEqual(before);
});
