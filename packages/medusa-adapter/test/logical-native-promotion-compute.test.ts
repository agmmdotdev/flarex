import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { compilePromotionDefinition } from "../src/modules/promotion/schema";
import { makePromotionComputeCommands } from "../src/modules/promotion/compute-service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";
import { captureCommerceInput } from "../src/value/input";
import { promotionComputeResources } from "../src/workflow/policy";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const participant = defineAtomicCommerceParticipant("nativePromotionCompute");
const Seed = Schema.Struct({ campaign: Schema.optionalKey(Schema.Struct({ start: Schema.NullOr(Schema.String), end: Schema.NullOr(Schema.String) })),
  usage: Schema.optionalKey(Schema.Number), automatic: Schema.Boolean, value: Schema.String, value2: Schema.optionalKey(Schema.String),
  global: Schema.optionalKey(Schema.Struct({ attribute: Schema.String, value: Schema.String })), target: Schema.optionalKey(Schema.String) });
async function prepare() {
  const definition = await Effect.runPromise(compilePromotionDefinition()), promotion = await Effect.runPromise(makePromotionComputeCommands());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.promotion-compute", owner: "medusa", writeProfile: "medusa.promotion-compute",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema }, bindings: definition.schema.tables.map(table => ({
      kind: "definition", localName: table.identity.tableId, table: { namespace: "medusa", logicalName: definition.schema.coordinate.lineageId + "/" + table.identity.tableId },
    })) }));
  const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
  const seed = defineCommerceCommand("nativePromotionComputeSeed", "write", (ctx, input) => Effect.gen(function* () {
    const data = yield* Schema.decodeUnknownEffect(Seed)(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const order = ["promotion_campaign_budget_usage", "promotion_rule_value", "promotion_promotion_rule", "application_method_target_rules", "application_method_buy_rules",
      "promotion_application_method", "promotion", "promotion_rule", "promotion_campaign_budget", "promotion_campaign"];
    for (const name of order) {
      const entity = promotion.prepared.entities.find(entity => entity.table.name === name), table = yield* ctx.table(name);
      if (entity === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const key = entity.primary[0];
      if (key === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const rows = yield* table.find(ctx.manager, { order: { column: key, direction: "asc" } });
      if (rows.length) yield* table.delete(ctx.manager, rows.map(row => Object.fromEntries(entity.primary.map(column => [column, row[column]]))));
    }
    if (data.campaign !== undefined || data.usage !== undefined) {
      yield* (yield* ctx.table("promotion_campaign")).write(ctx.manager, "insert", [{ id: "campaign", name: "Native Campaign", campaign_identifier: "native-campaign",
        starts_at: data.campaign?.start ?? null, ends_at: data.campaign?.end ?? null }]);
      if (data.usage !== undefined) {
        yield* (yield* ctx.table("promotion_campaign_budget")).write(ctx.manager, "insert", [{ id: "budget", campaign_id: "campaign", type: "use_by_attribute", attribute: "customer_id", limit: "2", raw_limit: { value: "2", precision: 20 } }]);
        const used = String(data.usage);
        yield* (yield* ctx.table("promotion_campaign_budget_usage")).write(ctx.manager, "insert", [{ id: "usage", budget_id: "budget", attribute_value: "customer1", used,
          raw_used: { value: used, precision: 20 } }]);
      }
    }
    const values = [data.value, ...(data.value2 === undefined ? [] : [data.value2])];
    for (const [index, value] of values.entries()) {
      const suffix = String(index), id = "promo" + suffix;
      yield* (yield* ctx.table("promotion")).write(ctx.manager, "insert", [{ id, code: "NATIVE" + suffix, type: "standard", status: "active", is_automatic: data.automatic,
        campaign_id: data.campaign !== undefined || data.usage !== undefined ? "campaign" : null }]);
      yield* (yield* ctx.table("promotion_application_method")).write(ctx.manager, "insert", [{ id: "method" + suffix, promotion_id: id, value,
        raw_value: { value, precision: 20 }, currency_code: "usd", type: "fixed", target_type: "items", allocation: "each" }]);
    }
    if (data.global !== undefined) {
      yield* (yield* ctx.table("promotion_rule")).write(ctx.manager, "insert", [{ id: "global", attribute: data.global.attribute, operator: "eq" }]);
      yield* (yield* ctx.table("promotion_rule_value")).write(ctx.manager, "insert", [{ id: "globalValue", promotion_rule_id: "global", value: data.global.value }]);
      yield* (yield* ctx.table("promotion_promotion_rule")).write(ctx.manager, "insert", [{ promotion_id: "promo0", promotion_rule_id: "global" }]);
    }
    if (data.target !== undefined) {
      yield* (yield* ctx.table("promotion_rule")).write(ctx.manager, "insert", [{ id: "target", attribute: "items.product.id", operator: "eq" }]);
      yield* (yield* ctx.table("promotion_rule_value")).write(ctx.manager, "insert", [{ id: "targetValue", promotion_rule_id: "target", value: data.target }]);
      yield* (yield* ctx.table("application_method_target_rules")).write(ctx.manager, "insert", [{ application_method_id: "method0", promotion_rule_id: "target" }]);
    }
    return null;
  }));
  const commands = [...promotion.commands, seed];
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
  const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "native-promotion-compute-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const initializer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands }));
  cleanup.push(() => Effect.runPromise(initializer.close)); await Effect.runPromise(initializer.initialize([]));
  const seedRoot = defineAtomicCommerceCommand("nativePromotionComputeSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const computeRoot = defineAtomicCommerceCommand("nativePromotionComputeRoot", (ctx, input) => ctx.call(participant, promotion.compute, input));
  const module = workflowModuleDefinition(promotion.workflow);
  if (module === undefined) throw new Error("Native Promotion workflow module was not issued");
  const graph = await Effect.runPromise(Effect.fromResult(prepareLocalGraph([{ participant, module: module.graph }])));
  const graphRoot = defineAtomicCommerceCommand("nativePromotionGraphRoot", (ctx, input) => graph.bind(ctx).graph(input)
    .pipe(Effect.flatMap(value => Effect.fromResult(captureCommerceInput(value)))));
  const receipts: { call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }[] = [], policy = promotion.logicalEventPolicy();
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, executionIsolation: "scopeExclusive", commands: [seedRoot, computeRoot, graphRoot],
    participants: [{ participant, logicalStorage, logicalResources: promotionComputeResources, commands, validateLogicalCall: (call, activity) => call.commandName === "nativePromotionComputeSeed"
      ? Effect.void : policy.validateLogicalCall(call, activity).pipe(Effect.andThen(Effect.sync(() => { receipts.push({ call, activity }); }))) }] }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, computeRoot, receipts, policy, seed: (input: typeof Seed.Type) => Effect.runPromise(host.run(host.newRequestKey(), seedRoot, input)),
    compute: (input: Schema.Json) => Effect.runPromise(host.run(host.newRequestKey(), computeRoot, input)),
    graph: (input: Schema.Json) => Effect.runPromise(host.run(host.newRequestKey(), graphRoot, input)) };
}
let connected: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);
const context = { currency_code: "usd", customer: { id: "customer1" }, items: [{ id: "item1", quantity: 1, subtotal: "100", original_total: "100",
  is_discountable: true, product: { id: "product1", collection_id: null, type_id: null } }] };

it("executes genuine native automatic calculation through the complete graph and replays one outcome", async () => {
  await connected.seed({ automatic: true, value: "10", global: { attribute: "currency_code", value: "usd" }, target: "product1" });
  const key = connected.host.newRequestKey(), input = { codes: [], context };
  const result = await Effect.runPromise(connected.host.run(key, connected.computeRoot, input));
  expect(result).toEqual([{ action: "addItemAdjustment", item_id: "item1", code: "NATIVE0", amount: "10.000000000000000000", is_tax_inclusive: false }]);
  const calls = connected.receipts.length;
  expect(await Effect.runPromise(connected.host.run(key, connected.computeRoot, input))).toEqual(result);
  expect(connected.receipts).toHaveLength(calls);
});

it("preserves manual selection, exact large amounts, and existing-adjustment removal", async () => {
  await connected.seed({ automatic: false, value: "9007199254740993.125" });
  const exact = { ...context, items: [{ ...context.items[0], subtotal: "9007199254741000", original_total: "9007199254741000" }] };
  expect(await connected.compute({ codes: ["NATIVE0"], context: exact, options: { prevent_auto_promotions: true } })).toEqual([
    { action: "addItemAdjustment", item_id: "item1", code: "NATIVE0", amount: "9007199254740993.1250", is_tax_inclusive: false },
  ]);
  expect(await connected.compute({ codes: [], context: { ...context, items: [{ ...context.items[0], adjustments: [{ id: "adj1", code: "NATIVE0", item_id: "item1" }] }] }, options: { prevent_auto_promotions: true } })).toEqual([
    { action: "removeItemAdjustment", item_id: "item1", code: "NATIVE0", adjustment_id: "adj1" },
  ]);
});

it("uses the native active Campaign temporal boundaries and attribute budget checks", async () => {
  await connected.seed({ automatic: false, value: "10", campaign: { start: "2000-01-01T00:00:00.000Z", end: "2001-01-01T00:00:00.000Z" } });
  expect(await connected.compute({ codes: ["NATIVE0"], context, options: { prevent_auto_promotions: true } })).toEqual([]);
  await connected.seed({ automatic: false, value: "10", usage: 2 });
  expect(await connected.compute({ codes: ["NATIVE0"], context, options: { prevent_auto_promotions: true } })).toEqual([{ action: "campaignBudgetExceeded", code: "NATIVE0" }]);
});

it("refuses changed calculation results and incomplete or reordered read evidence", async () => {
  await connected.seed({ automatic: false, value: "10" });
  await connected.compute({ codes: ["NATIVE0"], context, options: { prevent_auto_promotions: true } });
  const receipt = connected.receipts.at(-1);
  if (receipt === undefined) throw new Error("The genuine compute call did not retain its receipt");
  const { call, activity } = receipt;
  const changedResult = { ...call, result: [{ action: "addItemAdjustment", item_id: "item1", code: "NATIVE0", amount: "42", is_tax_inclusive: false }] };
  expect(await Effect.runPromise(Effect.result(connected.policy.validateLogicalCall(changedResult, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  for (const relationalReads of [activity.relationalReads.slice(1), [...activity.relationalReads].reverse(),
    [...activity.relationalReads, ...activity.relationalReads.slice(0, 1)]]) {
    expect(await Effect.runPromise(Effect.result(connected.policy.validateLogicalCall(call, { ...activity, relationalReads }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  }
  const index = activity.relationalReads.findIndex(read => read.orderedIdentities?.length), selected = activity.relationalReads[index], identity = selected?.orderedIdentities?.[0];
  if (selected === undefined || identity === undefined) throw new Error("The genuine compute call did not select a Promotion");
  const duplicate = { ...selected, total: 2, returned: 2, orderedIdentities: [identity, identity] };
  expect(await Effect.runPromise(Effect.result(connected.policy.validateLogicalCall(call, { ...activity,
    relationalReads: activity.relationalReads.map((read, current) => current === index ? duplicate : read) }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
});

it("uses one genuine native Promotion public read for Cart code and identity graph selections", async () => {
  await connected.seed({ automatic: false, value: "10" });
  expect(await connected.graph({ entity: "promotion", fields: ["code"], filters: { code: ["NATIVE0"] }, pagination: { take: 4 } })).toEqual({
    data: [{ code: "NATIVE0" }], metadata: { count: 1, skip: 0, take: 4 },
  });
  expect(await connected.graph({ entity: "promotion", fields: ["id", "code"], filters: { code: ["NATIVE0", "NATIVE0"] }, pagination: { take: 4 } })).toEqual({
    data: [{ id: "promo0", code: "NATIVE0" }], metadata: { count: 1, skip: 0, take: 4 },
  });
  expect(await connected.graph({ entity: "promotion", fields: ["id", "code"], filters: { code: ["MISSING"] }, pagination: { take: 4 } })).toEqual({
    data: [], metadata: { count: 0, skip: 0, take: 4 },
  });
});
