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
  const { read, readNamed, readCollection, readCategory, readOption, readVariant, countImages } = productReadCommands(services);
  const { create, related, changeRelated, productChange, remove, lifecycle, removeImageFromVariant,
    softDeleteVariants, softDeleteTags, updateTagsBySelector, updateVariantsBySelector } = productMutationCommands(services);
  const commands = Object.freeze({
    internalProductList: internalProductRead("list"), internalProductRetrieve: internalProductRead("retrieve"),
    internalProductCreate: internalProductChange("create"), internalProductUpdate: internalProductChange("update"),
    internalProductSoftDelete: internalProductChange("softDelete"), internalProductRestore: internalProductChange("restore"),
    internalCategoryList: internalCategoryRead("list"), internalCategoryRetrieve: internalCategoryRead("retrieve"), internalCategoryCount: internalCategoryRead("count"),
    internalCategoryCreate: internalCategoryChange("create"), internalCategoryUpdate: internalCategoryChange("update"), internalCategoryDelete: internalCategoryChange("delete"), create, list: read("list"), retrieve: read("retrieve"), count: read("count"),
    listCategories: readCategory("list"), retrieveCategory: readCategory("retrieve"), countCategories: readCategory("count"),
    listTypes: readNamed("type", "list"), retrieveType: readNamed("type", "retrieve"), countTypes: readNamed("type", "count"),
    listVariants: readVariant("list"), retrieveVariant: readVariant("retrieve"), countVariants: readVariant("count"), removeImageFromVariant, softDeleteVariants,
    listOptions: readOption("list"), retrieveOption: readOption("retrieve"), countOptions: readOption("count"), deleteOptions: remove("option"),
    listCollections: readCollection("list"), retrieveCollection: readCollection("retrieve"), countCollections: readCollection("count"),
    listTags: readNamed("tag", "list"), retrieveTag: readNamed("tag", "retrieve"), countTags: readNamed("tag", "count"),
    delete: remove("product"), deleteTags: remove("tag"), deleteTypes: remove("type"), deleteCategories: remove("category"), deleteCollections: remove("collection"),
    softDelete: lifecycle("softDelete"), restore: lifecycle("restore"), softDeleteTags,
    createTags: related("tag"), createTypes: related("type"), createCollections: related("collection"), createImages: related("image"),
    updateTags: changeRelated("tag", "update"), updateTagsBySelector, updateTypes: changeRelated("type", "update"),
    upsertTags: changeRelated("tag", "upsert"), upsertTypes: changeRelated("type", "upsert"),
    update: productChange("update"), upsert: productChange("upsert"), createOptions: related("option"), createVariants: related("variant"), createCategories: related("category"), addImageToVariant: related("assignment"),
    updateOptions: changeRelated("option", "update"), updateVariants: changeRelated("variant", "update"), updateVariantsBySelector, countImages, updateValues: changeRelated("value", "update"),
    updateCollections: changeRelated("collection", "update"), updateCategories: changeRelated("category", "update"),
    upsertOptions: changeRelated("option", "upsert"), upsertVariants: changeRelated("variant", "upsert"), upsertCollections: changeRelated("collection", "upsert"), upsertCategories: changeRelated("category", "upsert") });
  const graph = yield* Effect.fromResult(productGraphDefinition(metadata, commands));
  const workflow = yield* Effect.fromResult(productWorkflowModule(description, commands, graph,
    { created: metadata.tag.createdEvent, updated: metadata.tag.updatedEvent, deleted: metadata.tag.deletedEvent, variantUpdated: metadata.variant.updatedEvent, productUpdated: metadata.product.updatedEvent, collectionUpdated: metadata.collection.updatedEvent }));
  return { commands, withService, graph, workflow };
});
