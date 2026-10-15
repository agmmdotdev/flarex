import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceDecoder } from "../value/decoder";
import { ProductLinkBatch } from "./product-service";
import { VariantLinkBatch } from "./variant-service";
import type { prepareLinkWorkflowService } from "./workflow-service";
import { linkWorkflowServiceDefinition } from "./workflow-service";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";

const Batch = Schema.Union([ProductLinkBatch, VariantLinkBatch]).check(Schema.isMaxLength(8));
const decodeArguments = commerceDecoder(Schema.Tuple([Batch]), "invalidInput");
const decodeResult = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");
type NativeService = Result.Result.Success<ReturnType<typeof prepareLinkWorkflowService>>;

/** Native routing over the four original families. Service proxies can call
 * only their authenticated source commands; identities and DAL grants stay put. */
export function prepareProductNativeLinkResource(services: readonly NativeService[]) {
  const selected: Array<NonNullable<ReturnType<typeof linkWorkflowServiceDefinition>>> = [];
  for (const service of services) {
    const definition = linkWorkflowServiceDefinition(service);
    if (definition === undefined) return Result.fail(commerceError("invalidAuthority"));
    selected.push(definition);
  }
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
