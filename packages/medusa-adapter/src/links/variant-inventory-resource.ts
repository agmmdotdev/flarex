import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { VariantInventoryLinkBatch } from "./variant-service";
import { linkWorkflowServiceDefinition } from "./workflow-service";

const decodeArguments = commerceDecoder(Schema.Tuple([VariantInventoryLinkBatch]), "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([VariantInventoryLinkBatch,
  Schema.Struct({ asLinkDefinition: Schema.Literal(true) }),
]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");
const decodeDefinitions = commerceDecoder(VariantInventoryLinkBatch, "storedCorruption");

/** Native Link owns routing, exact preimages and upsert/dismiss semantics. The
 * Product facade admits this single inventory family through authentic methods. */
export function prepareVariantInventoryLinkResource(inventory: unknown) {
  return Result.gen(function* () {
    const service = linkWorkflowServiceDefinition(inventory);
    if (service === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const dismissMethod = service.dismissMethod;
    if (dismissMethod === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({
      identity: { format: "medusa.product-variant.inventory-links", services: [service.routing] },
      dependencies: [service.createMethod, service.listMethod, dismissMethod],
      methods: {
        create: { arguments: decodeArguments, output: decodeRows },
        dismiss: { arguments: decodeArguments, output: decodeRows },
        list: { arguments: decodeListArguments, output: decodeDefinitions },
      },
      bind: invoke => {
        const loaded = { ...structuredClone(service.routing),
          create: async (bulk: unknown) => [...await invoke(service.createMethod, bulk)],
          list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
          dismiss: async (bulk: unknown) => [...await invoke(dismissMethod, bulk)],
        };
        const native = new Link([loaded]);
        return { create: native.create.bind(native), dismiss: native.dismiss.bind(native), list: native.list.bind(native) };
      },
    });
  });
}
