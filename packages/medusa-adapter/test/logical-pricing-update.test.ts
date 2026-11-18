import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalPricingHost } from "./support/logical-pricing-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Schema.String, prices: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, amount: Schema.Number,
    currency_code: Schema.String }), [Schema.Record(Schema.String, Schema.Json)])),
}), [Schema.Record(Schema.String, Schema.Json)])));
async function connect() {
  const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includePricing: true });
  const pricing = await prepareLogicalPricingHost(fixture, "variant-updates");
  await Effect.runPromise(pricing.host.initialize([]));
  cleanup.push(() => Effect.runPromise(pricing.host.close));
  const runtime = pricing.runtime;
  if (!runtime.upsert || !runtime.update) throw new Error("Missing Pricing mutation admission");
  const upsertCommand = runtime.upsert, updateCommand = runtime.update;
  const participant = defineAtomicCommerceParticipant("pricing");
  const policy = workflowModuleDefinition(runtime.workflow)?.logical;
  if (policy === undefined) throw new Error("Missing authenticated Pricing mutation policy");
  const names = ["pricing.price-set.created", "pricing.price-list.created", "pricing.price-list-rule.created", "pricing.price-preference.created",
    ...["price", "price-rule"].flatMap(object => ["created", "updated", "deleted"].map(action => "pricing." + object + "." + action))];
  const contracts = names.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
  const create = defineAtomicCommerceCommand("pricingUpdateSeed", (ctx, input) => ctx.call(participant, runtime.create, input));
  const upsert = defineAtomicCommerceCommand("pricingNativeUpsert", (ctx, input) => ctx.call(participant, upsertCommand, input));
  const update = defineAtomicCommerceCommand("pricingNativeUpdate", (ctx, input) => ctx.call(participant, updateCommand, input));
  const lists = defineAtomicCommerceCommand("pricingNativeListSeed", (ctx, input) => ctx.call(participant, runtime.createList, input));
  const failure = defineAtomicCommerceCommand("pricingLateFailure", (ctx, input) => ctx.call(participant, upsertCommand, input)
    .pipe(Effect.andThen(Effect.fail(commerceError("invalidInput")))));
  const writer = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, requestCallLimit: 256,
    participants: [{ participant, logicalStorage: pricing.hostInput.logicalStorage, commands: runtime.commands,
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: contracts.map(item => item.token), select: message => {
        const contract = isJsonObject(message) ? contracts.find(item => item.name === message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract.token);
      } } }], commands: [create, upsert, update, lists, failure],
    events: { producerRevision: "a".repeat(64), contracts: contracts.map(item => item.token),
      subscribers: [{ id: "pricing-updates", revision: "b".repeat(64) }], validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  cleanup.push(() => Effect.runPromise(writer.close));
  return { fixture, pricing, writer, create, upsert, update, lists, failure };
}
let connected: Awaited<ReturnType<typeof connect>>;
describe("native base-price replacement on shared logical storage", () => {
  beforeAll(async () => { connected = await connect(); }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });
  const run = (command: typeof connected.create, input: Parameters<typeof connected.writer.run>[2]) =>
    Effect.runPromise(connected.writer.run(connected.writer.newRequestKey(), command, input).pipe(Effect.flatMap(decodeRows)));
  const read = (id: string) => Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
    { filters: { id }, config: { relations: ["prices", "prices.price_rules"] } }).pipe(Effect.flatMap(decodeRows)));

  it("keeps the create-only profile without mutation methods", async () => {
    const old = await Effect.runPromise(makeLocalPricingCommands());
    expect(old.workflow.methods).not.toHaveProperty("upsertPriceSets");
    expect(old.workflow.methods).not.toHaveProperty("updatePriceSets");
    expect(old.commands.map(command => command)).not.toContain(connected.pricing.runtime.upsert);
  });

  it("updates a retained price, creates its replacement peer and deletes an omitted price and rule", async () => {
    const [original] = await run(connected.create, [{ id: "update-mixed-set", prices: [
      { id: "update-mixed-a", currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "old" } },
      { id: "update-mixed-b", currency_code: "EUR", amount: 200, rules: { region_id: "removed" } },
    ] }]);
    expect(original?.prices).toHaveLength(2);
    const result = await run(connected.upsert, [{ id: "update-mixed-set", prices: [
      { id: "update-mixed-a", amount: "987.6543210987654321", rules: { channel_id: "new" } },
      { currency_code: "GBP", amount: 300, rules: { region_id: "created" } },
    ] }]);
    expect(result[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "update-mixed-a", amount: 987.6543210987654 }),
      expect.objectContaining({ currency_code: "GBP", amount: 300 }),
    ]));
    expect(result[0]?.prices).toHaveLength(2);
    const persisted = await read("update-mixed-set");
    expect(persisted).toMatchObject(result);
    expect(persisted[0]?.prices.find(price => price.id === "update-mixed-a")?.raw_amount)
      .toEqual({ value: "987.65432109876543210", precision: 20 });
    expect(persisted[0]?.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "update-mixed-a", price_rules: [expect.objectContaining({ attribute: "channel_id", value: "new" })] }),
      expect.objectContaining({ currency_code: "GBP", price_rules: [expect.objectContaining({ attribute: "region_id", value: "created" })] }),
    ]));
    const events = await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    expect(events.some(event => event.envelope.contract === "pricing.price.deleted")).toBe(true);
  });

  it("clears base prices while preserving PriceList prices and supports empty updates", async () => {
    await run(connected.create, [{ id: "update-clear-set", prices: [{ currency_code: "USD", amount: 20 }] }]);
    await Effect.runPromise(connected.writer.run(connected.writer.newRequestKey(), connected.lists, [{ id: "update-clear-list",
      title: "sale", description: "sale", status: "active", type: "sale", prices: [{ id: "update-list-price",
        price_set_id: "update-clear-set", currency_code: "USD", amount: 10 }] }]));
    const result = await run(connected.update, { selector: { id: "update-clear-set" }, update: { prices: [] } });
    expect(result).toMatchObject([{ id: "update-clear-set", prices: [] }]);
    expect(await read("update-clear-set")).toEqual(result);
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.calculate,
      { filters: { id: ["update-clear-set"] }, pricingContext: { context: { currency_code: "USD" } } })))
      .toMatchObject([{ calculated_amount: 10, calculated_price: { id: "update-list-price" } }]);
    expect(await run(connected.upsert, [])).toEqual([]);
  });

  it("preserves the native same-attribute rule collision and rolls back its pending graph", async () => {
    await run(connected.create, [{ id: "update-collision-set", prices: [{ id: "update-collision-price",
      currency_code: "USD", amount: 10, rules: { region_id: "old" } }] }]);
    const beforeRows = await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    const result = await Effect.runPromise(Effect.result(connected.writer.run(connected.writer.newRequestKey(), connected.upsert,
      [{ id: "update-collision-set", prices: [{ id: "update-collision-price", rules: { region_id: "new" } }] }])));
    expect(result).toMatchObject({ _tag: "Failure" });
    expect(await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
    expect(await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
  });

  it("updates and clears nullable exact quantity bounds while keeping an omitted rule", async () => {
    await run(connected.create, [{ id: "update-quantity-set", prices: [{ id: "update-quantity-price", currency_code: "USD",
      amount: "123.4567890123456789", min_quantity: "1.0000000000000001", max_quantity: "9.9999999999999999", rules: { region_id: "same" } }] }]);
    const original = await read("update-quantity-set");
    const result = await run(connected.upsert, [{ id: "update-quantity-set", prices: [{ id: "update-quantity-price", min_quantity: null, max_quantity: null }] }]);
    expect(result).toMatchObject([{ prices: [{ min_quantity: null, max_quantity: null, amount: 123.45678901234568 }] }]);
    expect((await read("update-quantity-set"))[0]?.prices[0]?.price_rules).toEqual(original[0]?.prices[0]?.price_rules);
    await run(connected.upsert, [{ id: "update-quantity-set", prices: [{ id: "update-quantity-price", rules: { region_id: null } }] }]);
    expect((await read("update-quantity-set"))[0]?.prices[0]?.price_rules).toEqual([]);
  });

  it("retains calculation reads for nine PriceSets in the mutation profile", async () => {
    const ids = Array.from({ length: 9 }, (_, index) => "update-calculate-" + index);
    for (let offset = 0; offset < ids.length; offset += 3) await run(connected.create,
      ids.slice(offset, offset + 3).map(id => ({ id, prices: [{ currency_code: "USD", amount: 25 }] })));
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.calculate,
      { filters: { id: ids }, pricingContext: { context: { currency_code: "USD" } } })))
      .toEqual(expect.arrayContaining(ids.map(id => expect.objectContaining({ id, calculated_amount: 25 }))));
  });

  it("rolls back a physical replacement after a late failure and refuses managed fields", async () => {
    await run(connected.create, [{ id: "update-rollback-set", prices: [{ id: "update-rollback-price", currency_code: "USD",
      amount: 50, rules: { region_id: "old" } }] }]);
    const beforeRows = await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    const result = await Effect.runPromise(Effect.result(connected.writer.run(connected.writer.newRequestKey(), connected.failure,
      [{ id: "update-rollback-set", prices: [] }])));
    expect(result).toMatchObject({ _tag: "Failure" });
    expect(await connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
    expect(await connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    expect(await Effect.runPromise(Effect.result(connected.writer.run(connected.writer.newRequestKey(), connected.upsert,
      [{ id: "update-rollback-set", prices: [{ id: "update-rollback-price", amount: 1, raw_amount: { value: "1", precision: 20 } }] }]))))
      .toMatchObject({ _tag: "Failure" });
  });
});
