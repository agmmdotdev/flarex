import { preparePricingPreferencePolicy } from "./support/logical-pricing-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { pricingLogicalProductUpdateEventPolicy } from "../src/modules/pricing/lifecycle-events";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalPricingHost, seedLogicalPricingLists } from "./support/logical-pricing-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const config = { returnLinkableKeys: Object.keys(pricingStaticResources.joinerConfig?.linkableKeys ?? {}) };
type Receipt = { call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] };
let receipt: Receipt | undefined;

async function connect() {
  const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includePricing: true });
  const pricing = await prepareLogicalPricingHost(fixture, "product-updates");
  await Effect.runPromise(pricing.host.initialize([]));
  cleanup.push(() => Effect.runPromise(pricing.host.close));
  const runtime = pricing.runtime, softDelete = runtime.softDeletePriceSets;
  if (softDelete === undefined) throw new Error("Missing Pricing lifecycle admission");
  const participant = defineAtomicCommerceParticipant("pricing");
  const policy = pricingLogicalProductUpdateEventPolicy(await preparePricingPreferencePolicy());
  const names = ["pricing.price-set.created", "pricing.price-set.deleted", "pricing.price-list.created", "pricing.price-list-rule.created", "pricing.price-preference.created",
    ...["price", "price-rule"].flatMap(object => ["created", "updated", "deleted"].map(action => "pricing." + object + "." + action))];
  const contracts = names.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
  const create = defineAtomicCommerceCommand("pricingLifecycleSeed", (ctx, input) => ctx.call(participant, runtime.create, input));
  const remove = defineAtomicCommerceCommand("pricingNativeSoftDelete", (ctx, input) => ctx.call(participant, softDelete, input));
  const failure = defineAtomicCommerceCommand("pricingLifecycleLateFailure", (ctx, input) => ctx.call(participant, softDelete, input)
    .pipe(Effect.andThen(Effect.fail(commerceError("invalidInput")))));
  const writer = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, requestCallLimit: 256,
    participants: [{ participant, logicalStorage: pricing.hostInput.logicalStorage, commands: runtime.commands,
      validateLogicalCall: (call, activity) => policy.validateLogicalCall(call, activity).pipe(Effect.tap(() => Effect.sync(() => {
        if (call.commandName === "pricingSoftDeletePriceSets") receipt = { call, activity };
      }))), events: { contracts: contracts.map(item => item.token), select: message => {
        const contract = isJsonObject(message) ? contracts.find(item => item.name === message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract.token);
      } } }], commands: [create, remove, failure],
    events: { producerRevision: "a".repeat(64), contracts: contracts.map(item => item.token),
      subscribers: [{ id: "pricing-lifecycle", revision: "b".repeat(64) }], validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  cleanup.push(() => Effect.runPromise(writer.close));
  return { fixture, pricing, writer, create, remove, failure, policy };
}
let connected: Awaited<ReturnType<typeof connect>>;
describe("native PriceSet lifecycle for Product-update Link cascades", () => {
  beforeAll(async () => { connected = await connect(); }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });
  const run = (command: typeof connected.create, input: Parameters<typeof connected.writer.run>[2]) =>
    Effect.runPromise(connected.writer.run(connected.writer.newRequestKey(), command, input));
  const remove = (id: string | string[]) => run(connected.remove, { selector: { id }, config });
  const seedList = async (id: string, set: string, prices: string[]) => {
    const seeded = await seedLogicalPricingLists(connected.fixture, connected.pricing, [{ id, title: "sale", description: "sale", status: "active", type: "sale",
      // Native hashPrice deduplicates equal set/currency/quantity/rule tuples;
      // explicit IDs and amounts do not distinguish two prices.
      prices: prices.map((price, index) => ({ id: price, price_set_id: set, currency_code: index === 0 ? "USD" : "EUR", amount: 5,
        rules: { region_id: "sale" } })) }]);
    expect(seeded.activity.mutations.flatMap(mutation => mutation.table === "price" ? [mutation.after?.id] : []).sort())
      .toEqual([...prices].sort());
    expect(seeded.activity.mutations.filter(mutation => mutation.table === "price_rule")).toHaveLength(prices.length);
  };

  it("keeps lifecycle unavailable in the creation and Variant-update profiles", async () => {
    for (const profile of ["create", "variant-updates"] as const) {
      const old = await Effect.runPromise(makeLocalPricingCommands(profile));
      expect(old.workflow.methods).not.toHaveProperty("softDeletePriceSets");
      expect(old).not.toHaveProperty("softDeletePriceSets");
    }
    expect(connected.pricing.runtime.workflow.methods).toHaveProperty("softDeletePriceSets");
    expect(connected.pricing.runtime.workflow.methods).not.toHaveProperty("restorePriceSets");
  });

  it("soft-deletes base and PriceList descendants and returns native linkable IDs", async () => {
    await run(connected.create, [{ id: "lifecycle-full", prices: [
      { id: "lifecycle-base-a", currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "r" } },
      { id: "lifecycle-base-b", currency_code: "EUR", amount: 20, rules: { region_id: "r" } },
    ] }]);
    await seedList("lifecycle-sale", "lifecycle-full", ["lifecycle-sale-a", "lifecycle-sale-b"]);
    const result = await remove("lifecycle-full");
    expect(result).toMatchObject({ price_set_id: ["lifecycle-full"],
      price_id: ["lifecycle-base-a", "lifecycle-base-b", "lifecycle-sale-a", "lifecycle-sale-b"],
      price_rule_id: Array.from({ length: 4 }, () => expect.any(String)) });
    const captured = receipt;
    if (captured === undefined) throw new Error("Missing lifecycle receipt");
    expect(captured.activity.lifecycle).toHaveLength(9);
    expect(captured.activity.mutations.every(mutation => mutation.operation === "patch" && typeof mutation.after?.deleted_at === "string")).toBe(true);
    expect(captured.activity.mutations.some(mutation => mutation.table === "price_list")).toBe(false);
    const base = captured.activity.mutations.find(mutation => mutation.before?.id === "lifecycle-base-a");
    expect(base?.after?.raw_amount).toEqual(base?.before?.raw_amount);
    expect(captured.call.events).toHaveLength(9);
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list, { filters: { id: "lifecycle-full" } }))).toEqual([]);
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: "lifecycle-full" }, config: { withDeleted: true } }))).toMatchObject([{ id: "lifecycle-full", deleted_at: expect.any(String) }]);
    const beforeEvents = await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    expect(await remove("lifecycle-full")).toEqual({});
    expect(await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
  });

  it("preserves empty input, missing IDs and native returnLinkableKeys projection", async () => {
    expect(await remove([])).toEqual({});
    expect(await remove("lifecycle-missing")).toEqual({});
    await run(connected.create, [{ id: "lifecycle-pick", prices: [{ id: "lifecycle-pick-price", currency_code: "USD", amount: 10 }] }]);
    expect(await run(connected.remove, { selector: ["lifecycle-pick"], config: { returnLinkableKeys: ["price_set_id"] } }))
      .toEqual({ price_set_id: ["lifecycle-pick"] });
  });

  it("supports the four-set native selector bound and refuses a fifth root", async () => {
    const ids = Array.from({ length: 4 }, (_, index) => "lifecycle-batch-" + index);
    await run(connected.create, ids.map(id => ({ id, prices: [] })));
    expect(await remove(ids)).toEqual({ price_set_id: ids });
    expect(await Effect.runPromise(Effect.result(connected.writer.run(connected.writer.newRequestKey(), connected.remove,
      { selector: { id: [...ids, "lifecycle-fifth"] }, config })))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("rolls back every descendant and event after a late root failure", async () => {
    await run(connected.create, [{ id: "lifecycle-rollback", prices: [{ id: "lifecycle-rollback-price", currency_code: "USD", amount: 10, rules: { region_id: "r" } }] }]);
    await seedList("lifecycle-rollback-list", "lifecycle-rollback", ["lifecycle-rollback-sale"]);
    const beforeRows = await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    expect(await Effect.runPromise(Effect.result(connected.writer.run(connected.writer.newRequestKey(), connected.failure,
      { selector: { id: ["lifecycle-rollback"] }, config })))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
    expect(await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
  });

  it("refuses a full closure with more than two PriceList prices without truncation", async () => {
    await run(connected.create, [{ id: "lifecycle-bound", prices: [] }]);
    await seedList("lifecycle-bound-list-a", "lifecycle-bound", ["lifecycle-bound-sale-a", "lifecycle-bound-sale-b"]);
    await seedList("lifecycle-bound-list-b", "lifecycle-bound", ["lifecycle-bound-sale-c"]);
    const beforeRows = await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    expect(await Effect.runPromise(Effect.result(connected.writer.run(connected.writer.newRequestKey(), connected.remove,
      { selector: { id: "lifecycle-bound" }, config })))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
    expect(await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
  });

  it("rejects a forged native result, omitted descendant and missing lifecycle event", async () => {
    await run(connected.create, [{ id: "lifecycle-receipt", prices: [{ id: "lifecycle-receipt-price", currency_code: "USD", amount: 10, rules: { region_id: "r" } }] }]);
    await remove("lifecycle-receipt");
    const captured = receipt;
    if (captured === undefined) throw new Error("Missing lifecycle receipt");
    const policy = connected.policy;
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...captured.call, result: { price_set_id: ["foreign"] } }, captured.activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(captured.call,
      { ...captured.activity, lifecycle: captured.activity.lifecycle.filter(item => item.table !== "price_rule") }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...captured.call, events: captured.call.events.slice(1) }, captured.activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
