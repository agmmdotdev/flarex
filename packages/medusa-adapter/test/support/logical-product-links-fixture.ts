import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

export interface LogicalProductLinksHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["productLinksDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
}

/** The native two-Link router borrows both tables from one selected source. */
export async function prepareLogicalProductLinksHost(currency: LogicalCurrencyFixture,
  admission: "create" | "product-updates" = "create"): Promise<LogicalProductLinksHostFixture> {
  const definition = currency.productLinksDefinition;
  if (definition === undefined || definition.schema.tables.length !== 2) throw new Error("Missing two-table Product Links source");
  const runtime = await Effect.runPromise(prepareLocalProductLinks(admission));
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Product Links seed"),
      hashFailure: cause => new Error("Product Links seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-links-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.productLinks", writeProfile: "medusa.productLinks",
        schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "product-links-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    }, commands: runtime.commands,
  } satisfies LogicalCommerceHostInput<unknown>;
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, host };
}
