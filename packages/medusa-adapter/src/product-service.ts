import { Effect } from "effect";
import { productGraphDefinition } from "./product-graph-query";
import { productWorkflowModule } from "./product-workflow-module";
import { prepareProductCommandServices } from "./product-commands/services";
import { productReadCommands } from "./product-commands/reads";
import { productInternalCommands } from "./product-commands/internal";
import { productMutationCommands } from "./product-commands/mutations";

/** Private Product composition entry point. Callers receive the complete command,
 * graph and workflow definitions; no request selects a profile, manager or table. */
export const makeLocalProductCommands = Effect.fn("ProductAdapter.commands")(function* () {
  const services = yield* prepareProductCommandServices();
  const { metadata, description, withService } = services;
  const { internalProductRead, internalProductChange, internalCategoryRead, internalCategoryChange } = productInternalCommands(services);
  const reads = productReadCommands(services);
  const writes = productMutationCommands(services);
  const commands = Object.freeze({
    internalProductList: internalProductRead("list"), internalProductRetrieve: internalProductRead("retrieve"),
    internalProductCreate: internalProductChange("create"), internalProductUpdate: internalProductChange("update"),
    internalProductSoftDelete: internalProductChange("softDelete"), internalProductRestore: internalProductChange("restore"),
    internalCategoryList: internalCategoryRead("list"), internalCategoryRetrieve: internalCategoryRead("retrieve"), internalCategoryCount: internalCategoryRead("count"),
    internalCategoryCreate: internalCategoryChange("create"), internalCategoryUpdate: internalCategoryChange("update"), internalCategoryDelete: internalCategoryChange("delete"),
    create: writes.create, list: reads.list, retrieve: reads.retrieve,
    count: reads.count, listCategories: reads.listCategories, retrieveCategory: reads.retrieveCategory,
    countCategories: reads.countCategories, listTypes: reads.listTypes, retrieveType: reads.retrieveType,
    countTypes: reads.countTypes, listVariants: reads.listVariants, retrieveVariant: reads.retrieveVariant,
    countVariants: reads.countVariants, removeImageFromVariant: writes.removeImageFromVariant, softDeleteVariants: writes.softDeleteVariants,
    listOptions: reads.listOptions, retrieveOption: reads.retrieveOption, countOptions: reads.countOptions,
    deleteOptions: writes.deleteOptions, listCollections: reads.listCollections, retrieveCollection: reads.retrieveCollection,
    countCollections: reads.countCollections, listTags: reads.listTags, retrieveTag: reads.retrieveTag,
    countTags: reads.countTags, delete: writes.delete, deleteTags: writes.deleteTags,
    deleteTypes: writes.deleteTypes, deleteCategories: writes.deleteCategories, deleteCollections: writes.deleteCollections,
    softDelete: writes.softDelete, restore: writes.restore, softDeleteTags: writes.softDeleteTags,
    createTags: writes.createTags, createTypes: writes.createTypes, createCollections: writes.createCollections,
    createImages: writes.createImages, updateTags: writes.updateTags, updateTagsBySelector: writes.updateTagsBySelector,
    updateTypes: writes.updateTypes, upsertTags: writes.upsertTags, upsertTypes: writes.upsertTypes,
    update: writes.update, upsert: writes.upsert, createOptions: writes.createOptions,
    createVariants: writes.createVariants, createCategories: writes.createCategories, addImageToVariant: writes.addImageToVariant,
    updateOptions: writes.updateOptions, updateVariants: writes.updateVariants, updateVariantsBySelector: writes.updateVariantsBySelector,
    countImages: reads.countImages, updateValues: writes.updateValues, updateCollections: writes.updateCollections,
    updateCategories: writes.updateCategories, upsertOptions: writes.upsertOptions, upsertVariants: writes.upsertVariants,
    upsertCollections: writes.upsertCollections, upsertCategories: writes.upsertCategories });
  const graph = yield* Effect.fromResult(productGraphDefinition(metadata, commands));
  const workflow = yield* Effect.fromResult(productWorkflowModule(description, commands, graph,
    { created: metadata.tag.createdEvent, updated: metadata.tag.updatedEvent, deleted: metadata.tag.deletedEvent, variantUpdated: metadata.variant.updatedEvent, productCreated: metadata.product.createdEvent, productUpdated: metadata.product.updatedEvent, collectionUpdated: metadata.collection.updatedEvent }));
  return { commands, withService, graph, workflow };
});
