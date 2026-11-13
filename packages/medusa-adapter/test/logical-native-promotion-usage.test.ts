import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { compileCoreNativeEventStorageDefinition } from "../../persistence-postgres/src/commit/events/coreDefinition";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makePromotionCheckoutCommands } from "../src/modules/promotion/checkout-service";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { finishOrderFixture } from "./support/core-order-fixture";
import { capturePromotionMetadata, compilePromotionCoreDefinition } from "../src/modules/promotion/schema";
import { preparePromotionUsageRepository } from "../src/modules/promotion/usage-repository";
import { projectNativeRow } from "../src/repository/result";
import { createCoreNativeWorkflowFixture } from "./support/core-native-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [], participant = defineAtomicCommerceParticipant("nativePromotionUsage");
const Seed = Schema.Struct({ type: Schema.Literals(["none", "spend", "usage", "use_by_attribute"]), used: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.String), promotionLimit: Schema.optionalKey(Schema.Number), expired: Schema.optionalKey(Schema.Boolean) });
async function prepare() {
  const promotion = await Effect.runPromise(makePromotionCheckoutCommands());
  const seed = defineCommerceCommand("nativePromotionUsageSeed", "write", (ctx, input) => Effect.gen(function* () {
    const data = yield* Schema.decodeUnknownEffect(Seed)(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    for (const name of ["promotion_campaign_budget_usage", "promotion", "promotion_campaign_budget", "promotion_campaign"]) {
      const table = yield* ctx.table(name), rows = yield* table.find(ctx.manager, { order: { column: "id", direction: "asc" } });
      if (rows.length) yield* table.delete(ctx.manager, rows.map(row => ({ id: row.id })));
    }
    if (data.type !== "none") {
      yield* (yield* ctx.table("promotion_campaign")).write(ctx.manager, "insert", [{ id: "campaign", name: "Usage Campaign", campaign_identifier: "usage-campaign",
        ends_at: data.expired ? "2000-01-01T00:00:00.000Z" : null }]);
      yield* (yield* ctx.table("promotion_campaign_budget")).write(ctx.manager, "insert", [{ id: "budget", campaign_id: "campaign", type: data.type,
        attribute: data.type === "use_by_attribute" ? "customer_id" : null, currency_code: data.type === "spend" ? "usd" : null,
        limit: data.limit ?? "100000000000000000", raw_limit: { value: data.limit ?? "100000000000000000", precision: 20 },
        used: data.used ?? "0", raw_used: { value: data.used ?? "0", precision: 20 } }]);
    }
    yield* (yield* ctx.table("promotion")).write(ctx.manager, "insert", [{ id: "promo", code: "NATIVE", type: "standard", status: "active",
      campaign_id: data.type === "none" ? null : "campaign", limit: data.promotionLimit ?? 100 }]);
    return null;
  }));
  const inspect = defineCommerceCommand("nativePromotionUsageInspect", "read", ctx => Effect.gen(function* () {
    const result: Record<string, Schema.Json> = {};
    for (const table of ["promotion", "promotion_campaign_budget", "promotion_campaign_budget_usage"])
      result[table] = yield* (yield* ctx.table(table)).find(ctx.manager, { order: { column: "id", direction: "asc" } });
    return result;
  }));
  const commands = [...promotion.commands, seed, inspect], target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definition, eventDefinition] = await Effect.runPromise(Effect.all([compilePromotionCoreDefinition(target), compileCoreNativeEventStorageDefinition(target)]));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [{ name: "promotion", definition, initialCommands: commands, rows: [] }] });
  cleanup.push(fixture.close);
  const seedRoot = defineAtomicCommerceCommand("nativePromotionUsageSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const inspectRoot = defineAtomicCommerceCommand("nativePromotionUsageInspectRoot", (ctx, input) => ctx.call(participant, inspect, input));
  const registerRoot = defineAtomicCommerceCommand("nativePromotionRegisterRoot", (ctx, input) => ctx.call(participant, promotion.register, input));
  const revertRoot = defineAtomicCommerceCommand("nativePromotionRevertRoot", (ctx, input) => ctx.call(participant, promotion.revert, input));
  const receipts: { call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }[] = [], policy = promotion.logicalEventPolicy();
  const contracts = ["promotion", "campaign_budget", "campaign_budget_usage"].flatMap(objectName => ["created", "updated", "deleted"].map(action => {
    const name = buildModuleResourceEventName({ prefix: "promotion", objectName, action });
    return { name, token: defineCommerceEventContract({ name, revision: "b".repeat(64), internal: true, decode: policy.capture }) };
  }));
  const host = await Effect.runPromise(fixture.execution.prepare({ identityAndAccessPolicy: fixture.execution.identityAndAccessPolicy,
    executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    commands: [seedRoot, inspectRoot, registerRoot, revertRoot], participants: [{ participant, nativeStorage: fixture.source("promotion"), commands,
      events: { contracts: contracts.map(contract => contract.token), select: message => {
        const selected = isJsonObject(message) ? contracts.find(contract => contract.name === message.name) : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected.token);
      } },
      validateLogicalCall: Effect.fn("PromotionUsageTest.observe")(function* (call, activity, command) {
        if (command === seed || command === inspect) return;
        yield* policy.validateLogicalCall(call, activity); receipts.push({ call, activity });
      }) }], events: { producerRevision: "b".repeat(64), contracts: contracts.map(contract => contract.token),
      subscribers: [{ id: "nativePromotionUsageProbe", revision: "c".repeat(64) }], validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  cleanup.push(() => Effect.runPromise(host.close));
  const run = (command: typeof registerRoot, input: Schema.Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
  return { host, registerRoot, policy, receipts, seed: (input: typeof Seed.Type) => run(seedRoot, input),
    inspect: () => run(inspectRoot, null), register: (input: Schema.Json) => run(registerRoot, input), revert: (input: Schema.Json) => run(revertRoot, input) };
}
let connected: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 180_000);
const registrationContext = { customer_id: "customer", customer_email: "native@example.test" };
const input = (amount: string, repeated = false) => ({ computedActions: [{ code: "NATIVE", amount }, ...(repeated ? [{ code: "NATIVE", amount }] : [])], registrationContext });
const promotionState = Schema.decodeUnknownSync(Schema.Struct({ promotion: Schema.Tuple([Schema.JsonObject]) }));

it("runs genuine native Promotion counters and exact spend usage with replay and inverse", async () => {
  await connected.seed({ type: "spend", used: "9007199254740993.125" });
  const requestKey = connected.host.newRequestKey(), args = input("0.875");
  expect(await Effect.runPromise(connected.host.run(requestKey, connected.registerRoot, args))).toBeNull();
  const calls = connected.receipts.length;
  expect(await Effect.runPromise(connected.host.run(requestKey, connected.registerRoot, args))).toBeNull();
  expect(connected.receipts).toHaveLength(calls);
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 1 }], promotion_campaign_budget: [{ raw_used: { value: "9007199254740994.0000" } }] });
  await connected.revert(args);
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 0 }], promotion_campaign_budget: [{ raw_used: { value: "9007199254740993.1250" } }] });
});

it("preserves native per-code usage deduplication and minimum-zero inverse", async () => {
  await connected.seed({ type: "usage" });
  await connected.register(input("3", true));
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 1 }], promotion_campaign_budget: [{ used: "1.0000000000000000000" }] });
  await connected.revert(input("3", true)); await connected.revert(input("3"));
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 0 }], promotion_campaign_budget: [{ used: "0.0000000000000000000" }] });
});

it("runs genuine native finite Promotion counters without a Campaign and preserves their inverse", async () => {
  await connected.seed({ type: "none", promotionLimit: 3 });
  await connected.register(input("4"));
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 1, campaign_id: null }],
    promotion_campaign_budget: [], promotion_campaign_budget_usage: [] });
  await connected.revert(input("4"));
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 0, campaign_id: null }],
    promotion_campaign_budget: [], promotion_campaign_budget_usage: [] });
});

it("admits an absent Campaign relation only when its DML foreign key is null", async () => {
  await connected.seed({ type: "none", promotionLimit: 3 });
  const row = projectNativeRow(promotionState(await connected.inspect()).promotion[0]);
  const metadata = await Effect.runPromise(capturePromotionMetadata());
  const prepared = Result.getOrThrow(preparePromotionUsageRepository(metadata.frame));
  expect(await Effect.runPromise(prepared.captureEntity("promotion", { ...row, campaign: null }))).toEqual(row);
  for (const extra of [{ campaign: { id: "forged" } }, { campaign: null, campaign_id: "forged" }, { unrelated_relation: null }])
    expect(await Effect.runPromise(Effect.result(prepared.captureEntity("promotion", { ...row, ...extra }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
});

it("preserves native attribute row creation, increment, decrement and deletion inverses", async () => {
  await connected.seed({ type: "use_by_attribute", limit: "2" });
  await connected.register(input("7")); await connected.register(input("9"));
  expect(await connected.inspect()).toMatchObject({ promotion_campaign_budget_usage: [{ attribute_value: "customer", used: "2.0000000000000000000" }], promotion_campaign_budget: [{ used: "2.0000000000000000000" }] });
  await connected.revert(input("9"));
  expect(await connected.inspect()).toMatchObject({ promotion_campaign_budget_usage: [{ used: "1.0000000000000000000" }] });
  await connected.revert(input("7"));
  expect(await connected.inspect()).toMatchObject({ promotion_campaign_budget_usage: [], promotion_campaign_budget: [{ used: "0.0000000000000000000" }] });
});

it("rolls native budget refusals back and retains active-campaign and missing-attribute decisions", async () => {
  await connected.seed({ type: "spend", limit: "1" });
  expect(Result.isFailure(await Effect.runPromise(Effect.result(connected.host.run(connected.host.newRequestKey(), connected.registerRoot, input("2")))))).toBe(true);
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 0 }], promotion_campaign_budget: [{ used: "0" }] });
  await connected.seed({ type: "usage", expired: true }); await connected.register(input("2"));
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 0 }], promotion_campaign_budget: [{ used: "0" }] });
  await connected.seed({ type: "use_by_attribute" });
  await connected.register({ ...input("2"), registrationContext: { customer_id: null, customer_email: null } });
  expect(await connected.inspect()).toMatchObject({ promotion_campaign_budget_usage: [], promotion_campaign_budget: [{ used: "0.0000000000000000000" }] });
});

it("preserves native Promotion and attribute budget limit refusals after successful calls", async () => {
  await connected.seed({ type: "none", promotionLimit: 0 });
  expect(await Effect.runPromise(Effect.result(connected.host.run(connected.host.newRequestKey(), connected.registerRoot, input("1")))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: "Promotion usage exceeds the limit." } } });
  expect(await connected.inspect()).toMatchObject({ promotion: [{ used: 0 }] });
  await connected.seed({ type: "use_by_attribute", limit: "1" }); await connected.register(input("1"));
  const before = await connected.inspect();
  expect(await Effect.runPromise(Effect.result(connected.host.run(connected.host.newRequestKey(), connected.registerRoot, input("1")))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: "Promotion usage exceeds the budget limit." } } });
  expect(await connected.inspect()).toEqual(before);
});

it("rejects forged native writes, omitted reads and changed native usage events", async () => {
  await connected.seed({ type: "spend" }); await connected.register(input("5"));
  const receipt = connected.receipts.at(-1);
  if (receipt === undefined) throw new Error("Native usage receipt missing");
  const { call, activity } = receipt;
  const mutations = activity.mutations.map(change => change.table === "promotion_campaign_budget" && change.after !== null
    ? { ...change, after: { ...change.after, used: "6", raw_used: { value: "6", precision: 20 } } } : change);
  for (const changed of [{ ...activity, mutations }, { ...activity, relationalReads: activity.relationalReads.slice(1) }])
    expect(Result.isFailure(await Effect.runPromise(Effect.result(connected.policy.validateLogicalCall(call, changed))))).toBe(true);
  expect(Result.isFailure(await Effect.runPromise(Effect.result(connected.policy.validateLogicalCall({ ...call, events: [] }, activity))))).toBe(true);
});
