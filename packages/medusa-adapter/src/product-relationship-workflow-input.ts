import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "./commerce-decoder";
import { defineWorkflowMethod } from "./workflow/module";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).check(Schema.isMaxLength(256));
export const ProductMembershipChange = Schema.Struct({ id: Id, add: Schema.optionalKey(Ids), remove: Schema.optionalKey(Ids) });
export const ProductRelationshipsInput = Schema.Struct({ collection: ProductMembershipChange, category: ProductMembershipChange });
const Identity = Schema.Struct({ id: Id });
const IdRows = Schema.Array(Identity).check(Schema.isMaxLength(256));
export const ProductRelationshipsOutput = Schema.Struct({
  products: Schema.Array(Schema.Struct({ id: Id, collection_id: Schema.NullOr(Id), categories: IdRows })).check(Schema.isMaxLength(256)),
  collections: Schema.Array(Schema.Struct({ id: Id, products: IdRows })).check(Schema.isMaxLength(256)),
});

const CategoryListFilters = Schema.Struct({ id: Ids });
const CategoryListConfig = Schema.Struct({ select: Schema.Tuple([Schema.Literal("id")]),
  relations: Schema.Tuple([Schema.Literal("categories")]), take: Schema.Literal(256) });
const decodeListArguments = commerceDecoder(Schema.Tuple([CategoryListFilters, CategoryListConfig]), "invalidInput");
const decodeRetrieveArguments = commerceDecoder(Schema.Tuple([Id,
  Schema.Struct({ select: Schema.Tuple([Schema.Literal("id"), Schema.Literal("products.id")]), relations: Schema.Tuple([Schema.Literal("products")]) }),
]), "invalidInput");
export const ProductRelationshipUpsertRows = Schema.Array(Schema.Struct({ id: Id, category_ids: Ids })).check(Schema.isMaxLength(256));
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([ProductRelationshipUpsertRows]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([Id, Schema.Struct({ product_ids: Ids })]), "invalidInput");
// Existing service serialization may include additional checked Product fields.
const Row = Schema.StructWithRest(Identity, [Schema.Record(Schema.String, Schema.Json)]);
export const ProductRelationshipResultRows = Schema.Array(Row).check(Schema.isMaxLength(256));
const decodeRows = commerceDecoder(ProductRelationshipResultRows, "storedCorruption");
const decodeRow = commerceDecoder(Row, "storedCorruption");
export const ProductRelationshipCategoryProducts = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id,
  categories: Schema.Array(Row).check(Schema.isMaxLength(256)),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(256));
const decodeCategoryProducts = commerceDecoder(ProductRelationshipCategoryProducts, "storedCorruption");
export const ProductRelationshipCategoryListCall = Schema.Struct({
  filters: CategoryListFilters,
  config: CategoryListConfig,
});
const decodeCollection = commerceDecoder(Schema.StructWithRest(Schema.Struct({ id: Id,
  products: Schema.Array(Row).check(Schema.isMaxLength(256)),
}), [Schema.Record(Schema.String, Schema.Json)]), "storedCorruption");

/** Relation-only method contracts over the existing Product commands. The
 * compatibility method name does not grant arbitrary Product creation/update. */
export function productRelationshipWorkflowMethods(commands: {
  readonly list: CommerceCommand; readonly retrieveCollection: CommerceCommand;
  readonly upsert: CommerceCommand; readonly updateCollections: CommerceCommand;
}, events: { readonly productUpdated: string; readonly collectionUpdated: string }) {
  return Result.gen(function* () {
    const listProducts = yield* defineWorkflowMethod({ command: commands.list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeCategoryProducts });
    const retrieveProductCollection = yield* defineWorkflowMethod({ command: commands.retrieveCollection, arguments: decodeRetrieveArguments,
      encode: ([id, config]) => ({ id, config }), output: decodeCollection });
    const upsertProducts = yield* defineWorkflowMethod({ command: commands.upsert, arguments: decodeUpsertArguments,
      encode: ([products]) => products, output: decodeRows, moduleEvents: [events.productUpdated] });
    const updateProductCollections = yield* defineWorkflowMethod({ command: commands.updateCollections, arguments: decodeUpdateArguments,
      encode: ([id, data]) => ({ id, data }), output: decodeRow, moduleEvents: [events.collectionUpdated, events.productUpdated] });
    return { listProducts, retrieveProductCollection, upsertProducts, updateProductCollections };
  });
}
