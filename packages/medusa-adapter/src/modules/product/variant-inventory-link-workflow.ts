import { Effect, Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { commerceDecoder } from "../../value/decoder";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import { ProductVariantParentReadConfig, ProductVariantParentRows, validateProductVariantParentRead } from "./variant-parent-read-receipt";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Selector = Schema.Struct({ id: Schema.Array(Id).check(Schema.isLengthBetween(1, 8)), product_id: Id });
const Config = ProductVariantParentReadConfig;
const argumentsDecoder = commerceDecoder(Schema.Tuple([Selector, Config]), "invalidInput");
const output = commerceDecoder(ProductVariantParentRows, "storedCorruption");

/** A separate method view preserves existing Image/Variant admission. Product's
 * genuine list command retains exact DAL dependencies in the borrowed root. */
export function productVariantInventoryLinkWorkflowModule(source: CommerceModuleDescription,
  listVariants: CommerceCommand, graph: GraphModuleDefinition, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const variant = graph.reads.find(read => read.model === "ProductVariant");
    if (variant === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const listProductVariants = yield* defineWorkflowMethod({ command: listVariants, arguments: argumentsDecoder,
      encode: ([filters, config]) => ({ filters, config }), output });
    const validateLogicalCall: NonNullable<WorkflowLogicalPolicy["validateLogicalCall"]> = Effect.fn("ProductVariantInventoryLinks.validateParentRead")(
      function* (call, activity, command) {
        yield* logical.validateLogicalCall(call, activity, command);
        yield* validateProductVariantParentRead(variant.table.name, call, activity);
      });
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".variant-inventory-links" },
      methods: { listProductVariants }, graph, logical: { ...logical, validateLogicalCall } });
  });
}
export type ProductVariantInventoryLinkWorkflowModule = Result.Result.Success<ReturnType<typeof productVariantInventoryLinkWorkflowModule>>;
