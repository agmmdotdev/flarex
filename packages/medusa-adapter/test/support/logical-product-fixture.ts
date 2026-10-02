import { Effect } from "effect";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { makeLocalProductCommands } from "../../src/product-service";
import type { LogicalCommerceHostInput } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { CommerceReadHostInput } from "../../../persistence-postgres/src/commerceTransaction/read/configuration";
import { getCommerceCommand, type CommerceHost } from "../../../persistence-postgres/src/commerceTransaction/commands";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract } from
  "../../../persistence-postgres/src/commerceTransaction/logicalSelection";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

interface LogicalProductHostFixture {
  readonly definition: NonNullable<LogicalCurrencyFixture["productDefinition"]>;
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly managedReadHostInput: CommerceReadHostInput<unknown> | undefined;
  readonly host: CommerceHost;
}

/** Select the complete Product source beside an already initialized Currency
 * source. The caller owns Product initialization and host release. */
export async function prepareLogicalProductHost(currency: LogicalCurrencyFixture): Promise<LogicalProductHostFixture> {
  const definition = currency.productDefinition;
  if (definition === undefined) throw new Error("Missing Product source");
  const selectedSource = currency.productLogicalSource;
  if (selectedSource === undefined) throw new Error("Missing admitted Product source");
  const runtime = await Effect.runPromise(makeLocalProductCommands());
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Product seed"),
      hashFailure: cause => new Error("Product seed hash", { cause }) }));
  const hostInput = { ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-internal-test" },
    logicalStorage: { ...currency.hostInput.logicalStorage,
      source: { sourceKey: "medusa.product", writeProfile: "medusa.product",
        schema: selectedSource.schema, evidence: selectedSource.evidence },
      initialization: { stepId: "product-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
    },
    commands: [runtime.commands.internalProductCreate, runtime.commands.internalProductRetrieve,
      runtime.commands.internalProductList, runtime.commands.internalProductUpdate,
      runtime.commands.internalProductSoftDelete, runtime.commands.internalProductRestore],
  };
  const managed = currency.managedRead;
  const source = currency.sourcePins.find(pin => pin.sourceKey === "medusa.product");
  if (managed !== undefined && source === undefined)
    throw new Error("Missing admitted Product source pin");
  const contract = managed === undefined ? undefined : await Effect.runPromise(
    Effect.fromResult(captureLogicalCommerceSelection(hostInput.logicalStorage)).pipe(
      Effect.flatMap(prepareLogicalCommerceContract)));
  const managedReadHostInput: CommerceReadHostInput<unknown> | undefined =
    managed === undefined || source === undefined || contract === undefined ? undefined : {
      hostRuntime: hostInput.hostRuntime, database: hostInput.database,
      session: hostInput.session, target: hostInput.target, deploymentId: hostInput.deploymentId,
      scopeId: hostInput.scopeId, authority: hostInput.authority, application: hostInput.application,
      identityAndAccessPolicy: hostInput.identityAndAccessPolicy,
      installation: managed.readInstallation,
      logicalStorage: { schemaVersionId: hostInput.logicalStorage.schemaVersionId, source,
        initialization: { ...hostInput.logicalStorage.initialization, contractSha256: contract.sha256Hex } },
      commands: Object.values(runtime.commands).filter(command => getCommerceCommand(command)?.mode === "read"),
    };
  const host = await Effect.runPromise(makeCommerceHost(hostInput));
  return { definition, runtime, hostInput, managedReadHostInput, host };
}
