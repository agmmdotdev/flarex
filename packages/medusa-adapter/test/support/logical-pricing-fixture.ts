import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { compilePricePreferenceContracts } from "../../src/modules/pricing/preference-input";
import { pricingPreferencePolicy } from "../../src/modules/pricing/preference-receipt";
import { Effect, Result } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { pricingLogicalProductUpdateEventPolicy } from "../../src/modules/pricing/lifecycle-events";
import { workflowModuleDefinition } from "../../src/workflow/module";

export interface LogicalPricingHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["pricingDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** Select the complete Pricing source beside an initialized Currency
 * source. The caller owns Pricing initialization and host release. */
export async function prepareLogicalPricingHost(currency: LogicalCurrencyFixture,
  admission: "create" | "variant-updates" | "product-updates" = "create"): Promise<LogicalPricingHostFixture> {
  const definition = currency.pricingDefinition;
  if (definition === undefined) throw new Error("Missing Pricing source");
  const runtime = await Effect.runPromise(makeLocalPricingCommands(admission));
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Pricing seed"),
      hashFailure: cause => new Error("Pricing seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-pricing-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.pricing", writeProfile: "medusa.pricing",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "pricing-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}

/** Two consumers seed the admitted native PriceList graph through the same
 * scoped command, event policy and outer settlement owner. */
export async function seedLogicalPricingLists(fixture: LogicalCurrencyFixture, pricing: LogicalPricingHostFixture, input: Json): Promise<{
  result: Json; activity: Parameters<LogicalCommerceCallValidation>[1];
}> {
  if (workflowModuleDefinition(pricing.runtime.workflow)?.source.profile !== "pricing-product-updates")
    throw new Error("PriceList rule seeding requires the Product-update Pricing profile");
  const participant = defineAtomicCommerceParticipant("pricing"), policy = pricingLogicalProductUpdateEventPolicy(await preparePricingPreferencePolicy());
  const names = ["pricing.price-list.created", "pricing.price.created", "pricing.price-list-rule.created", "pricing.price-rule.created"];
  const contracts = names.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
  const command = defineAtomicCommerceCommand("pricingListSeed", (ctx, data) => ctx.call(participant, pricing.runtime.createList, data));
  let activity: Parameters<LogicalCommerceCallValidation>[1] | undefined;
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: pricing.hostInput.logicalStorage, commands: [pricing.runtime.createList],
      validateLogicalCall: (call, observed) => policy.validateLogicalCall(call, observed).pipe(Effect.tap(() => Effect.sync(() => { activity = observed; }))),
      events: { contracts: contracts.map(item => item.token), select: message => {
        const contract = isJsonObject(message) ? contracts.find(item => item.name === message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract.token);
      } } }], commands: [command],
    events: { producerRevision: "a".repeat(64), contracts: contracts.map(item => item.token),
      subscribers: [{ id: "pricing-list-seed", revision: "b".repeat(64) }], validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  try {
    const result = await Effect.runPromise(host.run(host.newRequestKey(), command, input));
    if (activity === undefined) throw new Error("Missing native PriceList seed receipt");
    return { result, activity };
  } finally { await Effect.runPromise(host.close); }
}

/** Assemble complete DML validation for comparison tests of combined policies. */
export async function preparePricingPreferencePolicy() {
  const { frame } = await Effect.runPromise(capturePricingMetadata());
  return pricingPreferencePolicy(Result.getOrThrow(compilePricePreferenceContracts(frame)));
}