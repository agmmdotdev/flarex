import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod } from "../../workflow/module";
import { ProductRelationshipId as Id, ProductRelationshipIds as Ids, ProductRelationshipUpsertRows } from "./value-profile";
import type { ProductTypes } from "@medusajs/framework/types";

export const ProductMembershipChange = Schema.Struct({ id: Id, add: Schema.optionalKey(Ids), remove: Schema.optionalKey(Ids) });
/** The pinned Category step concatenates add and remove before one bounded list. */
export const ProductCategoryMembershipInput = ProductMembershipChange.check(Schema.makeFilter(value =>
  (value.add?.length ?? 0) + (value.remove?.length ?? 0) <= 256
    ? undefined : "At most 256 selected Product IDs"));
export const ProductRelationshipsInput = Schema.Struct({ collection: ProductMembershipChange,
  category: ProductCategoryMembershipInput }).check(Schema.makeFilter(value => {
  const selected = new Set([...(value.collection.add ?? []), ...(value.collection.remove ?? []),
    ...(value.category.add ?? []), ...(value.category.remove ?? [])]);
  return selected.size <= 256 ? undefined : "Product relationship graph selection exceeds 256 IDs";
}));
const Identity = Schema.Struct({ id: Id });
const IdRows = Schema.Array(Identity).check(Schema.isMaxLength(256));
export const ProductRelationshipsOutput = Schema.Struct({
  productsAfterCategory: Schema.Array(Schema.Struct({ id: Id, categories: IdRows })).check(Schema.isMaxLength(256)),
  collection: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("skipped"), id: Id }),
    Schema.Struct({ kind: Schema.Literal("replacementRequested"), id: Id, requestedProductIds: Ids }),
  ]),
});
export const ProductCollectionMembershipOutput = ProductRelationshipsOutput.fields.collection;
/** Native update returns requested stubs, including IDs absent from storage.
 * This private result deliberately does not claim a final membership graph. */
export function collectionReplacementResult(id: string, updated: ProductTypes.ProductCollectionDTO | undefined) {
  return updated === undefined ? { kind: "skipped" as const, id }
    : { kind: "replacementRequested" as const, id: updated.id,
      requestedProductIds: [...new Set((updated.products ?? []).map(product => product.id))] };
}

const CategoryListFilters = Schema.Struct({ id: Ids });
const CategoryListConfig = Schema.Struct({ select: Schema.Tuple([Schema.Literal("id")]),
  relations: Schema.Tuple([Schema.Literal("categories")]), take: Schema.Literal(256) });
const decodeListArguments = commerceDecoder(Schema.Tuple([CategoryListFilters, CategoryListConfig]), "invalidInput");
const CollectionRetrieveConfig = Schema.Struct({ select: Schema.Tuple([Schema.Literal("id"), Schema.Literal("products.id")]),
  relations: Schema.Tuple([Schema.Literal("products")]) });
const decodeRetrieveArguments = commerceDecoder(Schema.Tuple([Id, CollectionRetrieveConfig]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([ProductRelationshipUpsertRows]), "invalidInput");
const CollectionUpdateData = Schema.Struct({ product_ids: Ids });
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([Id, CollectionUpdateData]), "invalidInput");
// Existing service serialization may include additional checked Product fields.
const Row = Schema.StructWithRest(Identity, [Schema.Record(Schema.String, Schema.Json)]);
export const ProductRelationshipResultRows = Schema.Array(Row).check(Schema.isMaxLength(256));
const decodeRows = commerceDecoder(ProductRelationshipResultRows, "storedCorruption");
const decodeRow = commerceDecoder(Row, "storedCorruption");
export const ProductRelationshipCategoryProducts = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id,
  categories: Schema.Array(Row).check(Schema.isMaxLength(256)),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(256));
const decodeCategoryProducts = commerceDecoder(ProductRelationshipCategoryProducts, "storedCorruption");
export const ProductRelationshipCollectionReadResult = Schema.StructWithRest(Schema.Struct({ id: Id,
  products: Schema.Array(Row).check(Schema.isMaxLength(256)),
}), [Schema.Record(Schema.String, Schema.Json)]);
const decodeCollection = commerceDecoder(ProductRelationshipCollectionReadResult, "storedCorruption");

/** Relation-only method contracts over the existing Product commands. The
 * compatibility method name does not grant arbitrary Product creation/update. */
export function productRelationshipWorkflowMethods(commands: {
  readonly list: CommerceCommand; readonly retrieveCollection: CommerceCommand;
  readonly upsertRelationships: CommerceCommand; readonly updateCollections: CommerceCommand;
}, events: { readonly productUpdated: string; readonly collectionUpdated: string }) {
  return Result.gen(function* () {
    const listProducts = yield* defineWorkflowMethod({ command: commands.list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeCategoryProducts });
    const retrieveProductCollection = yield* defineWorkflowMethod({ command: commands.retrieveCollection, arguments: decodeRetrieveArguments,
      encode: ([id, config]) => ({ id, config }), output: decodeCollection });
    const upsertProducts = yield* defineWorkflowMethod({ command: commands.upsertRelationships, arguments: decodeUpsertArguments,
      encode: ([products]) => products, output: decodeRows, moduleEvents: [events.productUpdated] });
    const updateProductCollections = yield* defineWorkflowMethod({ command: commands.updateCollections, arguments: decodeUpdateArguments,
      encode: ([id, data]) => ({ id, data }), output: decodeRow, moduleEvents: [events.collectionUpdated, events.productUpdated] });
    return { listProducts, retrieveProductCollection, upsertProducts, updateProductCollections };
  });
}
