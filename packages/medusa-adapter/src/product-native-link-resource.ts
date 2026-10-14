import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceDecoder } from "./commerce-decoder";
import { ProductLinkBatch } from "./product-link-service";
import { VariantLinkBatch } from "./variant-links-service";
import type { prepareLinkWorkflowService } from "./link-workflow-service";
import { defineComposedWorkflowResource } from "./workflow/composed-resource";

const Batch = Schema.Union([ProductLinkBatch, VariantLinkBatch]).check(Schema.isMaxLength(8));
const decodeArguments = commerceDecoder(Schema.Tuple([Batch]), "invalidInput");
const decodeResult = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");
type NativeService = Result.Result.Success<ReturnType<typeof prepareLinkWorkflowService>>;

/** Native routing over the four original families. Service proxies can call
 * only their authenticated source commands; identities and DAL grants stay put. */
export function prepareProductNativeLinkResource(services: readonly NativeService[]) {
  const selected = services.map(service => ({ ...service, routing: structuredClone(service.routing) }));
  return defineComposedWorkflowResource({ identity: { format: "medusa.product.native-links", services: selected.map(service => service.routing) },
    dependencies: selected.flatMap(service => [service.createMethod, service.listMethod]),
    methods: { create: { arguments: decodeArguments, output: decodeResult } },
    bind: invoke => {
      const loaded = selected.map(service => ({ ...structuredClone(service.routing),
        list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
        create: async (bulk: unknown) => [...await invoke(service.createMethod, bulk)],
      }));
      const native = new Link(loaded);
      return { create: native.create.bind(native) };
    },
  });
}
