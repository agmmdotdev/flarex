import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { prepareProductSalesChannelLink } from "../../src/product-sales-channel-link-service";
import type { CommerceHost } from "../../../persistence-postgres/src/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalProductSalesChannelLinkHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["productLinksDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof prepareProductSalesChannelLink>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** The pinned native stored Link borrows one selected logical source. */
export async function prepareLogicalProductSalesChannelLinkHost(currency: LogicalCurrencyFixture): Promise<LogicalProductSalesChannelLinkHostFixture> {
  const definition = currency.productLinksDefinition;
  if (definition === undefined) throw new Error("Missing Product–SalesChannel Link source");
  const runtime = await Effect.runPromise(prepareProductSalesChannelLink());
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Link seed"),
      hashFailure: cause => new Error("Link seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-sales-channel-link-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.productLinks", writeProfile: "medusa.productLinks",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "product-sales-channel-link-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}
