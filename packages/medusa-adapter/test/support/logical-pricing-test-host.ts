import { createHash } from "node:crypto";
import { Effect } from "effect";
import { pricingLogicalCreateEventPolicy } from "../../src/pricing-events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalPricingHost } from "./logical-pricing-fixture";

/** Exercise the same admitted logical PriceSet command as the workflow host. */
export async function logicalPricingTestHost(registerCleanup: (close: () => Promise<void>) => void) {
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Pricing test driver");
  const currency = await logicalCurrencyFixture(driver, registerCleanup, { includePricing: true });
  const pricing = await prepareLogicalPricingHost(currency);
  registerCleanup(() => Effect.runPromise(pricing.host.close));
  await Effect.runPromise(pricing.host.initialize([]));
  const policy = pricingLogicalCreateEventPolicy();
  const revision = createHash("sha256").update("logical-pricing-base-test").digest("hex");
  const contracts = ["pricing.price-set.created", "pricing.price.created", "pricing.price-rule.created"]
    .map(name => ({ name, token: defineCommerceEventContract({ name, revision, internal: true,
      decode: policy.capture }) }));
  const tokens = contracts.map(entry => entry.token);
  const participant = defineAtomicCommerceParticipant("pricing");
  const root = defineAtomicCommerceCommand("pricingBaseCreate", (ctx, input) =>
    ctx.call(participant, pricing.runtime.create, input));
  const writer = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-pricing-base-test" },
    participants: [{ participant, logicalStorage: pricing.hostInput.logicalStorage,
      commands: [pricing.runtime.create], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts: tokens, select: event => {
        const contract = isJsonObject(event) && typeof event.name === "string"
          ? contracts.find(candidate => candidate.name === event.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract.token);
      } } }],
    commands: [root], events: { producerRevision: revision, contracts: tokens,
      subscribers: [{ id: "logical-pricing-base-test", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  registerCleanup(() => Effect.runPromise(writer.close));
  return { currency, pricing, writer, root, create: (input: Parameters<typeof writer.run>[2]) =>
    writer.run(writer.newRequestKey(), root, input),
    read: pricing.host.read.bind(pricing.host) };
}
