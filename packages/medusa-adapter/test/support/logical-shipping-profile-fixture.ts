import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeLocalShippingProfileCommands } from "../../src/modules/fulfillment/shipping-profile-service";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalShippingProfileHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["shippingProfileDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalShippingProfileCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** The native selected ShippingProfile service borrows one admitted source. */
export async function prepareLogicalShippingProfileHost(currency: LogicalCurrencyFixture): Promise<LogicalShippingProfileHostFixture> {
  const definition = currency.shippingProfileDefinition;
  if (definition === undefined) throw new Error("Missing ShippingProfile source");
  const runtime = await Effect.runPromise(makeLocalShippingProfileCommands());
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid ShippingProfile seed"),
      hashFailure: cause => new Error("ShippingProfile seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-shipping-profile-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.shippingProfile", writeProfile: "medusa.shippingProfile",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "shipping-profile-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}
