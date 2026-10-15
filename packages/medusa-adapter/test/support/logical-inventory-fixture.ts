import { Effect } from "effect";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { compileInventoryDefinition } from "../../src/modules/inventory/schema";
import { compileStockLocationDefinition } from "../../src/modules/stock-location/schema";
import { compileVariantLinksDefinition } from "../../src/links/variant-definition";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

/** Native scalar/array tests use the same atomic event receipt boundary. */
export async function prepareInventoryCreateHost(fixture: LogicalCurrencyFixture, inventory: LogicalInventoryHosts["inventory"]) {
  const participant = defineAtomicCommerceParticipant("inventory");
  const policy = inventory.runtime.logicalEventPolicy();
  const name = "inventory.inventory-item.created";
  const contract = defineCommerceEventContract({ name, revision: "1".repeat(64), internal: true, decode: policy.capture });
  const create = defineAtomicCommerceCommand("nativeInventoryCreate", (ctx, input) => ctx.call(participant, inventory.runtime.create, input));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: inventory.hostInput.logicalStorage, commands: inventory.runtime.commands,
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: [contract], select: message =>
        isJsonObject(message) && message.name === name ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [create], events: { producerRevision: "1".repeat(64), contracts: [contract],
      subscribers: [{ id: "native-inventory-test", revision: "2".repeat(64) }], validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create };
}

/** Test composition reuses production source compilers and command owners. */
export interface LogicalInventoryHosts {
  readonly inventory: { readonly runtime: Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>; readonly hostInput: LogicalCommerceHostInput<unknown> };
  readonly stockLocation: { readonly runtime: Effect.Success<ReturnType<typeof makeStockLocationCommands>>; readonly hostInput: LogicalCommerceHostInput<unknown> };
  readonly link: { readonly runtime: Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>; readonly hostInput: LogicalCommerceHostInput<unknown> };
}
export async function prepareLogicalInventoryHosts(fixture: LogicalCurrencyFixture,
  admission: { readonly levels?: boolean; readonly stockLocations?: boolean; readonly stock?: boolean; readonly variantLinks?: "variant-updates" } = {}): Promise<LogicalInventoryHosts> {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid Inventory seed"), hashFailure: cause => new Error("Inventory seed hash", { cause }) }));
  const inventory = await Effect.runPromise(makeLocalInventoryCommands(admission.stock === true ? "stock" : admission.levels === true ? "levels" : "items"));
  const stockLocation = await Effect.runPromise(makeStockLocationCommands(admission.stockLocations === true ? "create" : "read"));
  const link = await Effect.runPromise(prepareLocalVariantLinks(admission.variantLinks ?? "create"));
  const inventoryDefinition = await Effect.runPromise(compileInventoryDefinition());
  const stockDefinition = await Effect.runPromise(compileStockLocationDefinition());
  const linkDefinition = await Effect.runPromise(compileVariantLinksDefinition());
  const inputFor = (key: string, definition: typeof inventoryDefinition, commands: LogicalCommerceHostInput<unknown>["commands"]) => ({
    ...fixture.hostInput, identityAndAccessPolicy: { profile: key + ".internal-test" }, commands,
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: key.toLowerCase() + ".empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 },
    },
  } satisfies LogicalCommerceHostInput<unknown>);
  const inventoryInput = inputFor("medusa.inventory", inventoryDefinition, inventory.commands);
  const stockInput = inputFor("medusa.stockLocation", stockDefinition, stockLocation.commands);
  const linkInput = inputFor("medusa.variantLinks", linkDefinition, link.commands);
  for (const input of [inventoryInput, stockInput, linkInput]) {
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize([])); } finally { await Effect.runPromise(host.close); }
  }
  return { inventory: { runtime: inventory, hostInput: inventoryInput }, stockLocation: { runtime: stockLocation, hostInput: stockInput },
    link: { runtime: link, hostInput: linkInput } };
}
