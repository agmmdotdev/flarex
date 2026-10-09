import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeLocalPricingCommands } from "../../src/pricing-service";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

export interface LogicalPricingHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["pricingDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** Select the complete Pricing source beside an initialized Currency
 * source. The caller owns Pricing initialization and host release. */
export async function prepareLogicalPricingHost(currency: LogicalCurrencyFixture): Promise<LogicalPricingHostFixture> {
  const definition = currency.pricingDefinition;
  if (definition === undefined) throw new Error("Missing Pricing source");
  const runtime = await Effect.runPromise(makeLocalPricingCommands());
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
