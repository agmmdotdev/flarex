import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

export interface LogicalSalesChannelHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["salesChannelDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** Native SalesChannel methods borrow one admitted logical source and host. */
export async function prepareLogicalSalesChannelHost(currency: LogicalCurrencyFixture): Promise<LogicalSalesChannelHostFixture> {
  const definition = currency.salesChannelDefinition;
  if (definition === undefined) throw new Error("Missing SalesChannel source");
  const runtime = await Effect.runPromise(makeLocalSalesChannelCommands());
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid SalesChannel seed"),
      hashFailure: cause => new Error("SalesChannel seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-sales-channel-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.salesChannel", writeProfile: "medusa.salesChannel",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "sales-channel-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}
