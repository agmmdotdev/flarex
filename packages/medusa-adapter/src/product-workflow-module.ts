import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceModuleDescription } from "./module-definition";
import type { GraphModuleDefinition } from "./local-graph/model";
import { commerceDecoder } from "./commerce-decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";
import { ProductNamedFilters } from "./product-service-input";
import { ProductTagUpdateData } from "./product-tag-update-input";
import { ProductLifecycleIds } from "./product-lifecycle";

export const ProductTagWorkflowInput = Schema.Array(Schema.Struct({ value: Schema.String,
  id: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(Schema.Json),
})).check(Schema.isMaxLength(256));
export const ProductTagWorkflowResult = Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, value: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256));
export const decodeProductTagWorkflowResult = commerceDecoder(ProductTagWorkflowResult, "storedCorruption");
const decodeArguments = commerceDecoder(Schema.Tuple([ProductTagWorkflowInput]), "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([ProductNamedFilters,
  Schema.Struct({ select: Schema.Array(Schema.String), relations: Schema.Array(Schema.String) }),
]), "invalidInput");
const decodeListResult = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "storedCorruption");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([ProductNamedFilters, ProductTagUpdateData]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([ProductLifecycleIds]), "invalidInput");
const decodeDeleteResult = commerceDecoder(Schema.NullOr(Schema.Record(Schema.String, ProductLifecycleIds)), "storedCorruption");

export function productWorkflowModule(source: CommerceModuleDescription,
  commands: { readonly createTags: CommerceCommand; readonly listTags: CommerceCommand; readonly updateTagsBySelector: CommerceCommand; readonly softDeleteTags: CommerceCommand },
  graph: GraphModuleDefinition, events: { readonly created: string; readonly updated: string; readonly deleted: string }) {
  return Result.gen(function* () {
    const createProductTags = yield* defineWorkflowMethod({ command: commands.createTags, arguments: decodeArguments,
      encode: ([tags]) => tags, output: decodeProductTagWorkflowResult, moduleEvent: events.created });
    const listProductTags = yield* defineWorkflowMethod({ command: commands.listTags, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeListResult });
    const updateProductTags = yield* defineWorkflowMethod({ command: commands.updateTagsBySelector, arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeProductTagWorkflowResult, moduleEvent: events.updated });
    const softDeleteProductTags = yield* defineWorkflowMethod({ command: commands.softDeleteTags, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: decodeDeleteResult, moduleEvent: events.deleted });
    return yield* defineWorkflowModule({ name: "product", source, methods: { createProductTags, listProductTags, updateProductTags, softDeleteProductTags }, graph,
      refusedMethods: ["deleteProductTags", "upsertProductTags", "restoreProductTags"] });
  });
}
export type ProductWorkflowModule = Result.Result.Success<ReturnType<typeof productWorkflowModule>>;
