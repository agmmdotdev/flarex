import { Effect } from "effect";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { makeLocalProductCommands } from "../../src/product-service";
import type { LogicalCommerceHostInput } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { CommerceHost } from "../../../persistence-postgres/src/commerceTransaction/commands";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalProductHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["productDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** Select the complete Product source beside an already initialized Currency
 * source. The caller owns Product initialization and host release. */
export async function prepareLogicalProductHost(currency: LogicalCurrencyFixture): Promise<LogicalProductHostFixture> {
  const definition = currency.productDefinition;
  if (definition === undefined) throw new Error("Missing Product source");
  const runtime = await Effect.runPromise(makeLocalProductCommands());
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Product seed"),
      hashFailure: cause => new Error("Product seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.product", writeProfile: "medusa.product",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "product-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    },
    commands: [runtime.commands.internalProductCreate, runtime.commands.internalProductRetrieve,
      runtime.commands.internalProductList, runtime.commands.internalProductUpdate,
      runtime.commands.internalProductSoftDelete, runtime.commands.internalProductRestore],
  };
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}
