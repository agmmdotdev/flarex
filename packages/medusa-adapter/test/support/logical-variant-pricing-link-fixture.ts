import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalVariantPricingLinkHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["variantPricingLinkDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof prepareVariantPricingLink>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** The selected native stored Link uses a generic logical row with no
 * implied endpoint FK. The caller owns initialization and host release. */
export async function prepareLogicalVariantPricingLinkHost(currency: LogicalCurrencyFixture): Promise<LogicalVariantPricingLinkHostFixture> {
  const definition = currency.variantPricingLinkDefinition;
  if (definition === undefined) throw new Error("Missing Variant–PriceSet Link source");
  const runtime = await Effect.runPromise(prepareVariantPricingLink());
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Link seed"),
      hashFailure: cause => new Error("Link seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-variant-pricing-link-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.link.productVariantPriceSet", writeProfile: "medusa.link.productVariantPriceSet",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "variant-pricing-link-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}
