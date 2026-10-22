import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRateCreationContracts } from "../src/modules/tax/rate-create-input";
import { taxRateCreationPolicy } from "../src/modules/tax/rate-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileTaxRateCreationContracts>>;
let policy: ReturnType<typeof taxRateCreationPolicy>;
const managed = { created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null };
const rate: JsonObject = { id: "txr164-receipt", tax_region_id: "txreg164-receipt", name: "receipt", code: "receipt", rate: 0.1,
  is_default: false, is_combinable: false, metadata: null, created_by: "parent", ...managed };
const rule: JsonObject = { id: "txrule164-receipt", tax_rate_id: "txr164-receipt", reference: "product", reference_id: "prod-one",
  metadata: { retained: true }, created_by: "parent", ...managed };
const input = [{ tax_region_id: "txreg164-receipt", name: "receipt", code: "receipt", rate: 0.1, created_by: "parent",
  rules: [{ reference: "product", reference_id: "prod-one", metadata: { retained: true }, created_by: "overwritten" }] }];
const event = (object: "tax_rate" | "tax_rate_rule", id: string): JsonObject => ({
  name: object === "tax_rate" ? "tax.tax-rate.created" : "tax.tax-rate-rule.created",
  metadata: { source: "tax", object, action: "created" }, data: { id },
});
beforeAll(async () => {
  contracts = Result.getOrThrow(compileTaxRateCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame));
  policy = taxRateCreationPolicy(contracts);
});
function transcript(): { call: Call; activity: Activity } {
  return { call: { commandName: "taxRateCreateForWorkflow", mode: "write", input, result: [{ ...rate, rules: [] }],
    events: [event("tax_rate", "txr164-receipt"), event("tax_rate_rule", "txrule164-receipt")],
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 },
  activity: { mutations: [{ ordinal: 0, table: "tax_rate", operation: "insert", before: null, after: rate },
    { ordinal: 1, table: "tax_rate_rule", operation: "insert", before: null, after: rule }],
    lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [],
    observedRows: [{ table: "tax_rate", row: rate }, { table: "tax_rate_rule", row: rule }] } };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure" });

describe("native Tax Rate creation complete receipts", () => {
  it("binds complete native defaults, Rule creator overwrite, observations and ordered events without calling the service again", async () => {
    const { call, activity } = transcript(), native = vi.spyOn(TaxModuleService.prototype, "createTaxRates");
    try { await Effect.runPromise(policy.validateLogicalCall(call, activity)); expect(native).not.toHaveBeenCalled(); }
    finally { native.mockRestore(); }
  });

  it("accepts the genuine empty-create receipt", async () => {
    const { call, activity } = transcript();
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], result: [], events: [], toAttempt: 0 },
      { ...activity, mutations: [], observedRows: [] }));
  });

  it("refuses partial, additional, altered and nonempty-Rules immediate DTOs", async () => {
    const { call, activity } = transcript();
    if (typeof rate.id !== "string") throw new Error("Missing fixed Rate identity");
    for (const result of [[], [{ ...rate, rules: [], rate: 99 }], [{ ...rate, rules: [rule] }],
      [{ ...rate, rules: [], extra: true }], [{ id: rate.id, rules: [] }], [{ ...rate, rules: [] }, { ...rate, rules: [] }]])
      await refused({ ...call, result }, activity);
  });

  it("binds inputs to the original parent and Rule writes including metadata and parent creator", async () => {
    const { call, activity } = transcript(), first = input[0];
    if (first === undefined) throw new Error("Missing fixed parent input");
    for (const changed of [{ ...first, name: "other" }, { ...first, tax_region_id: "foreign" }, { ...first, created_by: "other" },
      { ...first, rules: [{ reference: "product", reference_id: "prod-other", metadata: { retained: true } }] },
      { ...first, rules: [{ reference: "product", reference_id: "prod-one", metadata: { retained: false } }] }])
      await refused({ ...call, input: [changed] }, activity);
    const parent = activity.mutations[0], child = activity.mutations[1];
    if (parent === undefined || child === undefined) throw new Error("Missing fixed parent and Rule mutations");
    await refused(call, { ...activity, mutations: [parent, { ...child, after: { ...rule, created_by: "overwritten" } }] });
  });

  it("refuses incomplete, reordered and altered SQL mutations", async () => {
    const { call, activity } = transcript(), parent = activity.mutations[0], child = activity.mutations[1];
    if (parent === undefined || child === undefined) throw new Error("Missing complete insert transcript");
    for (const mutations of [[parent], [child, parent], [{ ...parent, ordinal: 1 }, child],
      [{ ...parent, operation: "patch" as const, before: rate }, child], [{ ...parent, table: "tax_provider" }, child],
      [{ ...parent, after: { ...rate, rate: 99 } }, child], [parent, { ...child, after: { ...rule, tax_rate_id: "foreign" } }]])
      await refused(call, { ...activity, mutations });
  });

  it("requires complete matching observed rows and forbids unrelated reads", async () => {
    const { call, activity } = transcript();
    for (const observedRows of [activity.observedRows.slice(1), [...activity.observedRows, { table: "tax_provider", row: { id: "foreign" } }],
      [{ table: "tax_rate", row: { ...rate, rate: 99 } }, { table: "tax_rate_rule", row: rule }]])
      await refused(call, { ...activity, observedRows });
    await refused(call, { ...activity, relationalReads: [{ table: "tax_rate", query: {}, total: 0, returned: 0 }] });
  });

  it("rejects missing, additional, reordered, foreign and wrong-action events", async () => {
    const { call, activity } = transcript(), childEvent = call.events[1];
    if (childEvent === undefined) throw new Error("Missing fixed Rule event");
    for (const events of [[], call.events.slice(1), [...call.events].reverse(), [...call.events, event("tax_rate", "foreign")],
      [event("tax_rate", "foreign"), event("tax_rate_rule", "txrule164-receipt")],
      [{ name: "tax.tax-rate.deleted", metadata: { source: "tax", object: "tax_rate", action: "deleted" }, data: { id: "txr164-receipt" } }, childEvent],
      [{ ...event("tax_rate", "txr164-receipt"), name: "foreign.created" }, childEvent]])
      await refused({ ...call, events }, activity);
  });

  it("refuses foreign commands, read mode and unsupported conversion-map fields", async () => {
    const { call, activity } = transcript(), parent = activity.mutations[0], child = activity.mutations[1];
    if (parent === undefined || child === undefined) throw new Error("Missing complete insert transcript");
    await refused({ ...call, commandName: "taxOtherCreate" }, activity);
    await refused({ ...call, mode: "read" }, activity);
    await refused(call, { ...activity, mutations: [{ ...parent, realNormalization: { rate: 99 } }, child] });
    await refused(call, { ...activity, mutations: [{ ...parent, realNormalization: { rate: 0.1, name: "receipt" } }, child] });
    await refused(call, { ...activity, mutations: [parent, { ...child, realNormalization: { rate: 0.1 } }] });
  });
});
