import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { CustomerModuleService } from "@medusajs/customer/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareLogicalCustomerSelection, customerDescendants, customerRow } from "./support/logical-customer-selection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalCustomerSelection>>, sharedCleanupCount = 0, scopeOrdinal = 0;
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
function newEvents(before: Inventory, after: Inventory) {
  const identity = (event: Inventory["events"][number]) => JSON.stringify([event.scopeUuid, event.epochUuid, event.commitSeq.toString(), event.eventOrdinal]);
  const previous = new Set(before.events.map(identity));
  return after.events.filter(event => !previous.has(identity(event)));
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine SDK retained-response getter");
  const decodeRetained = Schema.decodeUnknownSync(Schema.Struct({ customerWasCreated: Schema.Boolean,
    customer: Schema.optionalKey(Schema.JsonObject) }), { onExcessProperty: "error" });
  const decodeOutput = Schema.decodeUnknownSync(Schema.Struct({
    customer: Schema.UndefinedOr(Schema.NullOr(Schema.JsonObject)), email: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
  }), { onExcessProperty: "error" });
  const observed: Array<{ response: StepResponse<unknown, unknown>; value: unknown; snapshot: unknown; output: unknown }> = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    observed.push({ response: this, value, snapshot: structuredClone(value), output: this.output }); return value;
  });
  const native = () => {
    const first = observed[0]; if (first === undefined) throw new Error("Missing genuine Customer retained response");
    const retained = decodeRetained(first.value), output = decodeOutput(first.output);
    expect(first.value).toEqual(first.snapshot); expect(Object.keys(output).sort()).toEqual(["customer", "email"]);
    if (retained.customer !== undefined) expect(Object.getOwnPropertyDescriptor(first.value, "customer")?.value)
      .toBe(Object.getOwnPropertyDescriptor(first.output, "customer")?.value);
    if (retained.customerWasCreated) expect(output.customer).toMatchObject({ id: expect.stringMatching(/^cus_/) });
    return first;
  };
  return {
    // The dependent undo callback runs after the SDK reads the native response
    // and before it constructs its own StepResponse. Preserve the actual value.
    get: () => { expect(observed).toHaveLength(1); return native().value; },
    complete: () => {
      expect(observed).toHaveLength(2); const first = native(), undo = observed[1];
      if (undo === undefined) throw new Error("Missing dependent inverse StepResponse");
      expect(undo.response).not.toBe(first.response); expect(undo.output).toBeNull();
      // StepResponse(null) defaults its compensation to the same null output.
      expect(undo.value).toBe(undo.output); expect(undo.snapshot).toBeNull(); return first.value;
    },
    failed: () => { expect(observed).toHaveLength(1); return native().value; },
    restore: () => spy.mockRestore(),
  };
}
async function scenario(name: string, rows: Parameters<typeof prepareLogicalCustomerSelection>[2]) {
  const ordinal = ++scopeOrdinal;
  return prepareLogicalCustomerSelection(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: "customer-selection-" + name + "-" + ordinal, projectId: "customer-selection-162", uuidOffset: 2_500_000 + ordinal * 10_000 } });
}

describe("genuine Customer selection and guest creation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalCustomerSelection(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it.each([
    [{}, {}], [{ customerId: null, email: null }, { customer: null, email: null }],
    [{ customerId: "" }, { customer: null, email: null }], [{ email: "" }, { customer: null, email: null }],
    [{ customerId: null }, { customer: null, email: null }],
  ] as const)("preserves omitted/null/empty branches for %j without native method calls", async (input, expected) => {
    const host = await connected.prepare(), retrieve = vi.spyOn(CustomerModuleService.prototype, "retrieveCustomer"),
      list = vi.spyOn(CustomerModuleService.prototype, "listCustomers"), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers");
    try {
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual(expected);
      expect(retrieve).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
      expect(after.events).toEqual(before.events);
    } finally { retrieve.mockRestore(); list.mockRestore(); create.mockRestore(); }
  }, 180_000);

  it.each([
    [{ customerId: "cus-account" }, "cus-account", "account@example.invalid"],
    [{ customerId: "cus-guest" }, "cus-guest", "guest@example.invalid"],
    [{ email: "TaRgEt@EXAMPLE.INVALID" }, "cus-target", "target@example.invalid"],
    [{ email: "mixed@example.invalid" }, "cus-a-mixed-guest", "mixed@example.invalid"],
    [{ email: "account-first@example.invalid" }, "cus-a-account-first", "account-first@example.invalid"],
    [{ customerId: "cus-account", email: "target@example.invalid" }, "cus-account", "account@example.invalid"],
    [{ customerId: "cus-guest", email: "TARGET@EXAMPLE.INVALID" }, "cus-target", "target@example.invalid"],
    [{ customerId: "cus-guest", email: "GUEST@EXAMPLE.INVALID" }, "cus-guest", "guest@example.invalid"],
    [{ customerId: "cus-null-email" }, "cus-null-email", null],
  ] as const)("preserves native ID/account/guest ordering for %j", async (input, id, email) => {
    const host = await connected.prepare(), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers");
    try {
      const before = await connected.snapshot(), output = object(await Effect.runPromise(host.run(host.newRequestKey(), input)));
      expect(output.email).toBe(email); expect(output.customer).toEqual((await connected.read([id]))[0]);
      expect(Object.hasOwn(object(output.customer), "groups")).toBe(false); expect(Object.hasOwn(object(output.customer), "addresses")).toBe(false);
      expect(create).not.toHaveBeenCalled(); const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    } finally { create.mockRestore(); }
  }, 180_000);

  it.each(["cus-missing", "cus-deleted"])("fails %s before email fallback and publishes no durable outcome", async id => {
    const host = await connected.prepare(), retrieve = vi.spyOn(CustomerModuleService.prototype, "retrieveCustomer"),
      list = vi.spyOn(CustomerModuleService.prototype, "listCustomers"), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers");
    try {
      const before = await connected.snapshot(), result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { customerId: id, email: "target@example.invalid" }));
      expect(Exit.isFailure(result)).toBe(true); expect(retrieve.mock.calls.map(call => call[0])).toEqual([id]);
      expect(list).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { retrieve.mockRestore(); list.mockRestore(); create.mockRestore(); }
  }, 180_000);

  it.each([undefined, "cus-account", "cus-guest"])("retains native invalid-email failure after optional ID %s", async customerId => {
    const host = await connected.prepare(), list = vi.spyOn(CustomerModuleService.prototype, "listCustomers"), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers"),
      retrieve = vi.spyOn(CustomerModuleService.prototype, "retrieveCustomer");
    try {
      const before = await connected.snapshot(), input = { ...(customerId === undefined ? {} : { customerId }), email: "invalid-email" };
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), input));
      expect(Exit.isFailure(result)).toBe(true); if (Exit.isFailure(result)) expect(reasons(result.cause).join(" ")).toContain("email");
      expect(retrieve).toHaveBeenCalledTimes(customerId === undefined ? 0 : 1); expect(list).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
      expect(await connected.snapshot()).toEqual(before);
    } finally { list.mockRestore(); create.mockRestore(); retrieve.mockRestore(); }
  }, 180_000);

  it.each([false, true])("creates one scalar guest through genuine empty Address calls with original guest %s and replays once", async withOriginal => {
    const host = await connected.prepare(), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers"),
      addresses = vi.spyOn(CustomerModuleService.prototype, "createCustomerAddresses"), list = vi.spyOn(CustomerModuleService.prototype, "listCustomers");
    try {
      const email = (withOriginal ? "new-guest-mismatch" : "new-email-only") + "@example.invalid";
      const before = await connected.snapshot(), key = host.newRequestKey(), input = { ...(withOriginal ? { customerId: "cus-guest" } : {}), email: email.toUpperCase() }; let calls = 0;
      const output = object(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("Customer complete scalar create BoundedRequest.enter", calls); expect(calls).toBeLessThanOrEqual(64);
      const customer = object(output.customer), id = text(customer.id);
      expect(output.email).toBe(email); expect(customer).toMatchObject({ id: expect.stringMatching(/^cus_/),
        email, has_account: false, company_name: null, first_name: null, last_name: null,
        phone: null, metadata: null, created_by: null, groups: [], addresses: [], deleted_at: null,
        created_at: expect.any(String), updated_at: expect.any(String) });
      expect(customer.created_at).toBe(customer.updated_at); expect(create.mock.calls.map(call => call[0])).toEqual([{ email }]);
      expect(addresses.mock.calls.map(call => call[0])).toEqual([[]]);
      expect(list.mock.calls.map(call => call[0])).toEqual([{ email, ...(withOriginal ? { has_account: false } : {}) }]);
      const after = await connected.snapshot(), events = newEvents(before, after);
      expect(events.map(event => event.envelope.contract)).toEqual(["customer.customer.created"]);
      expect(events[0]?.envelope.message).toMatchObject({ data: { id } }); expect(events[0]?.envelope.internal).toBe(true);
      expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
      const { groups: _groups, addresses: _addresses, ...scalar } = customer; expect(await connected.read([id])).toEqual([scalar]);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(create).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { email: "another@example.invalid" }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { create.mockRestore(); addresses.mockRestore(); list.mockRestore(); }
  }, 240_000);

  it.each([
    [{}, false], [{ customerId: "cus-account", email: "target@example.invalid" }, false],
    [{ email: "target@example.invalid" }, false], [{ email: "roundtrip@example.invalid" }, true],
  ] as const)("uses the actual retained creation flag for physical compensation of %j", async (input, created) => {
    const tap = retainedTap(), remove = vi.spyOn(CustomerModuleService.prototype, "deleteCustomers");
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot(), output = object(await Effect.runPromise(host.run(host.newRequestKey(), input)));
      expect(tap.complete()).toMatchObject({ customerWasCreated: created }); expect(remove).toHaveBeenCalledTimes(created ? 1 : 0);
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
      if (created) {
        const id = text(object(output.customer).id); expect(remove.mock.calls.map(call => call[0])).toEqual([id]); expect(await connected.read([id])).toEqual([]);
        expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual(["customer.customer.created", "customer.customer.deleted"]);
      } else expect(newEvents(before, after)).toEqual([]);
    } finally { tap.restore(); remove.mockRestore(); }
  }, 240_000);

  it("rolls back late failure after the genuine create and retained physical inverse", async () => {
    const tap = retainedTap(), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers"), remove = vi.spyOn(CustomerModuleService.prototype, "deleteCustomers");
    try {
      const host = await connected.prepareRoundtrip(tap.get, true), before = await connected.snapshot();
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { email: "late-failure@example.invalid" }));
      expect(Exit.isFailure(result)).toBe(true); if (Exit.isFailure(result)) expect(reasons(result.cause)).toContain("Late genuine Customer retained inverse failure");
      expect(tap.failed()).toMatchObject({ customerWasCreated: true });
      expect(create).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); create.mockRestore(); remove.mockRestore(); }
  }, 240_000);

  it.each([false, true])("selects its complete bounded Address closure for deleted root %s and preserves Groups", async deleted => {
    const prefix = "cus-physical-" + deleted, graph = customerDescendants(prefix, 1, deleted).filter(entry => entry.table !== "customer_group_customer")
      .map(entry => entry.table === "customer_address" && deleted ? { ...entry, row: { ...entry.row, deleted_at: "2026-10-22T00:00:00.000Z" } } : entry),
      protectedRow = customerRow(prefix + "-protected", "protected-" + deleted + "@example.invalid");
    const local = await scenario("physical-" + deleted, [...graph, protectedRow]), host = await local.prepareInverse();
    const ids = graph.map(entry => text(entry.row.id)), groups = graph.filter(entry => entry.table === "customer_group").map(entry => text(entry.row.id));
    const preserved = await local.read([...groups, text(protectedRow.row.id)]), before = await local.snapshot(); let calls = 0;
    expect(await Effect.runPromise(host.run(host.newRequestKey(), prefix).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull();
    console.info("Customer one root plus one Address physical inverse BoundedRequest.enter", calls); expect(calls).toBeLessThanOrEqual(64);
    expect(await local.read(ids.filter(id => !groups.includes(id)))).toEqual([]); expect(await local.read([...groups, text(protectedRow.row.id)])).toEqual(preserved);
    const after = await local.snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual(["customer.customer.deleted"]);
  }, 240_000);

  it.each([false, true])("explicitly refuses a complete historical membership cohort with deleted membership %s before writes", async deleted => {
    const prefix = "cus-membership-" + deleted, graph = customerDescendants(prefix, 1).map(entry => entry.table === "customer_group_customer" && deleted
      ? { ...entry, row: { ...entry.row, deleted_at: "2026-10-22T00:00:00.000Z" } } : entry);
    const local = await scenario("membership-" + deleted, graph), host = await local.prepareInverse(), before = await local.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), prefix));
    expect(Exit.isFailure(result)).toBe(true); if (Exit.isFailure(result)) expect(reasons(result.cause)).toContain("unsupportedProfile");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("refuses an incomplete physical descendant cohort before publishing and rolls back late inverse failure", async () => {
    const graph = customerDescendants("cus-too-many", 2).filter(entry => entry.table !== "customer_group_customer"),
      local = await scenario("oversized", graph), host = await local.prepareInverse(), before = await local.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), "cus-too-many"));
    expect(Exit.isFailure(result)).toBe(true); expect(await local.snapshot()).toEqual(before);
    const late = await scenario("late-inverse", customerDescendants("cus-late-inverse", 1).filter(entry => entry.table !== "customer_group_customer")),
      lateHost = await late.prepareInverse(true), lateBefore = await late.snapshot();
    expect(Exit.isFailure(await Effect.runPromiseExit(lateHost.run(lateHost.newRequestKey(), "cus-late-inverse")))).toBe(true);
    expect(await late.snapshot()).toEqual(lateBefore);
  }, 240_000);

  it("rejects unsupported input fields and non-string values before any native method", async () => {
    const host = await connected.prepare(), create = vi.spyOn(CustomerModuleService.prototype, "createCustomers"), retrieve = vi.spyOn(CustomerModuleService.prototype, "retrieveCustomer"),
      list = vi.spyOn(CustomerModuleService.prototype, "listCustomers");
    try {
      const before = await connected.snapshot();
      for (const input of [{ customerId: 1 }, { email: true }, { has_account: true }, { addresses: [] }, { customerId: "cus-account", extra: null }])
        // Exercise the runtime boundary with malformed external input. The
        // ordinary typed caller deliberately cannot construct these requests.
        await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(create).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { create.mockRestore(); retrieve.mockRestore(); list.mockRestore(); }
  }, 180_000);
});
