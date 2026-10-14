import { productCreationInput } from "../../workflows/product/create-input";
export { SimpleProductInput, ProductCreateGraphInput } from "../../workflows/product/create-input";
import { productRelationshipWorkflowMethods } from "./relationship-workflow-input";
import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import { ProductNamedFilters } from "./service-input";
import { ProductTagUpdateData } from "./tag-update-input";
import { ProductLifecycleIds } from "./lifecycle";
import { VariantSelector, VariantThumbnailUpdate, VariantImagePairs, SimpleVariantInput } from "./variant-workflow-input";

export const ProductTagWorkflowInput = Schema.Array(Schema.Struct({ value: Schema.String,
  id: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(Schema.Json),
})).check(Schema.isMaxLength(256));
export const ProductTagWorkflowResult = Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, value: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256));
export const decodeProductTagWorkflowResult = commerceDecoder(ProductTagWorkflowResult, "storedCorruption");
const decodeCreatedProducts = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, title: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256)), "storedCorruption");
const decodeArguments = commerceDecoder(Schema.Tuple([ProductTagWorkflowInput]), "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([ProductNamedFilters,
  Schema.Struct({ select: Schema.Array(Schema.String), relations: Schema.Array(Schema.String) }),
]), "invalidInput");
const decodeListResult = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "storedCorruption");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([ProductNamedFilters, ProductTagUpdateData]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([ProductLifecycleIds]), "invalidInput");
const decodeDeleteResult = commerceDecoder(Schema.NullOr(Schema.Record(Schema.String, ProductLifecycleIds)), "storedCorruption");
const decodeImageArguments = commerceDecoder(Schema.Tuple([VariantImagePairs]), "invalidInput");
const decodeAssignmentResult = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String })).check(Schema.isMaxLength(256)), "storedCorruption");
const decodeRemoveResult = commerceDecoder(Schema.Null, "storedCorruption");
const decodeVariantListArguments = commerceDecoder(Schema.Tuple([VariantSelector,
  Schema.Struct({ select: Schema.Array(Schema.String), relations: Schema.Array(Schema.String) }),
]), "invalidInput");
const decodeVariantUpdateArguments = commerceDecoder(Schema.Tuple([VariantSelector, VariantThumbnailUpdate]), "invalidInput");
const decodeCreateVariantsArguments = commerceDecoder(Schema.Tuple([Schema.Array(SimpleVariantInput).check(Schema.isMaxLength(4))]), "invalidInput");

export function productWorkflowModule(source: CommerceModuleDescription,
  commands: { readonly create: CommerceCommand; readonly list: CommerceCommand; readonly retrieveCollection: CommerceCommand; readonly upsertRelationships: CommerceCommand; readonly updateCollections: CommerceCommand; readonly createTags: CommerceCommand; readonly listTags: CommerceCommand; readonly updateTagsBySelector: CommerceCommand; readonly softDeleteTags: CommerceCommand;
    readonly createVariants: CommerceCommand; readonly listVariants: CommerceCommand; readonly updateVariantsBySelector: CommerceCommand; readonly addImageToVariant: CommerceCommand; readonly removeImageFromVariant: CommerceCommand },
  graph: GraphModuleDefinition, events: { readonly created: string; readonly updated: string; readonly deleted: string; readonly productCreated: string; readonly productUpdated: string; readonly collectionUpdated: string; readonly variantUpdated: string; readonly variantCreated: string;
    readonly optionCreated: string; readonly valueCreated: string; readonly imageCreated: string },
  logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const table = graph.reads.find(read => read.model === "Product")?.table;
    if (!table) return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeCreateProductsArguments = commerceDecoder(Schema.Tuple([Schema.Array(productCreationInput(table.columns)).check(Schema.isMaxLength(256))]), "invalidInput");
    const createProducts = yield* defineWorkflowMethod({ command: commands.create, arguments: decodeCreateProductsArguments,
      encode: ([products]) => products, output: decodeCreatedProducts,
      moduleEvents: [events.productCreated, events.optionCreated, events.valueCreated, events.variantCreated, events.imageCreated] });
    const createProductVariants = yield* defineWorkflowMethod({ command: commands.createVariants, arguments: decodeCreateVariantsArguments,
      encode: ([variants]) => variants, output: decodeCreatedProducts, moduleEvents: [events.variantCreated] });
    const createProductTags = yield* defineWorkflowMethod({ command: commands.createTags, arguments: decodeArguments,
      encode: ([tags]) => tags, output: decodeProductTagWorkflowResult, moduleEvents: [events.created] });
    const listProductTags = yield* defineWorkflowMethod({ command: commands.listTags, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeListResult });
    const updateProductTags = yield* defineWorkflowMethod({ command: commands.updateTagsBySelector, arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeProductTagWorkflowResult, moduleEvents: [events.updated] });
    const softDeleteProductTags = yield* defineWorkflowMethod({ command: commands.softDeleteTags, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: decodeDeleteResult, moduleEvents: [events.deleted] });
    const addImageToVariant = yield* defineWorkflowMethod({ command: commands.addImageToVariant, arguments: decodeImageArguments,
      encode: ([pairs]) => pairs, output: decodeAssignmentResult });
    const removeImageFromVariant = yield* defineWorkflowMethod({ command: commands.removeImageFromVariant, arguments: decodeImageArguments,
      encode: ([pairs]) => pairs, output: decodeRemoveResult });
    const listProductVariants = yield* defineWorkflowMethod({ command: commands.listVariants, arguments: decodeVariantListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeListResult });
    const updateProductVariants = yield* defineWorkflowMethod({ command: commands.updateVariantsBySelector, arguments: decodeVariantUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeListResult, moduleEvents: [events.variantUpdated] });
    const relationships = yield* productRelationshipWorkflowMethods(commands, events);
    return yield* defineWorkflowModule({ name: "product", source,
      methods: { ...relationships, createProducts, createProductVariants, createProductTags, listProductTags, updateProductTags, softDeleteProductTags, addImageToVariant, removeImageFromVariant, listProductVariants, updateProductVariants }, graph,
      logical });
  });
}
export type ProductWorkflowModule = Result.Result.Success<ReturnType<typeof productWorkflowModule>>;
