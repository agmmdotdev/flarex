import { Effect } from "effect";
import { productGraphDefinition } from "./graph-query";
import { productWorkflowModule } from "./workflow";
import { productVariantUpdateWorkflowModule } from "./variant-update-workflow";
import { productUpdateWorkflowModule } from "./product-update-workflow";
import { productUpdateGraphReceipt } from "./product-update-receipt";
import { productDeletionCommands } from "./commands/deletion";
import { productDeletionWorkflowModule } from "./product-deletion-workflow";
import { productBatchWorkflowModule } from "./product-batch-workflow";
import { prepareProductCommandServices } from "./commands/services";
import { productReadCommands } from "./commands/reads";
import { productInternalCommands } from "./commands/internal";
import { productMutationCommands } from "./commands/mutations";
import { commerceCommandIdentity, type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { productCallReceipts } from "./events/call-receipts";
import { productReferenceReplacementEventLimit } from "../../workflow/policy";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";

/** Private Product composition entry point. Callers receive the complete command,
 * graph and workflow definitions; no request selects a profile, manager or table. */
export const makeLocalProductCommands = Effect.fn("ProductAdapter.commands")(function* () {
  const services = yield* prepareProductCommandServices();
  const { metadata, description, withService } = services;
  const { internalProductRead, internalProductChange, internalCategoryRead, internalCategoryChange } = productInternalCommands(services);
  const reads = productReadCommands(services);
  const writes = productMutationCommands(services);
  const deletion = productDeletionCommands(services);
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
    update: writes.update, upsert: writes.upsert, upsertRelationships: writes.upsertRelationships, createOptions: writes.createOptions,
    createVariants: writes.createVariants, createCategories: writes.createCategories, addImageToVariant: writes.addImageToVariant,
    updateOptions: writes.updateOptions, updateVariants: writes.updateVariants, updateVariantsBySelector: writes.updateVariantsBySelector,
    updateVariantsForWorkflow: writes.updateVariantsForWorkflow,
    updateProductsForWorkflow: writes.updateProductsForWorkflow,
    softDeleteProductsForWorkflow: deletion.softDeleteProducts, softDeleteVariantsForWorkflow: deletion.softDeleteVariants,
    countVariantsForDeletion: deletion.countVariants,
    countImages: reads.countImages, updateValues: writes.updateValues, updateCollections: writes.updateCollections,
    updateCategories: writes.updateCategories, upsertOptions: writes.upsertOptions, upsertVariants: writes.upsertVariants,
    upsertCollections: writes.upsertCollections, upsertCategories: writes.upsertCategories });
  const graph = yield* Effect.fromResult(productGraphDefinition(metadata, commands));
  const receipts = productCallReceipts(metadata);
  const admitted = new Set(Object.values(commands));
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("Product.validateNativeCall")(
    function* (call, activity, command) {
      const identity = commerceCommandIdentity(command);
      if (!admitted.has(command) || identity?.name !== call.commandName || identity.mode !== call.mode)
        return yield* Effect.fail(commerceError("invalidAuthority"));
      yield* receipts.validateLogicalCall(call, activity);
    });
  const logicalPolicy = Object.freeze({ capture: receipts.capture, validateLogicalCall });
  const workflow = yield* Effect.fromResult(productWorkflowModule(description, commands, graph,
    { created: metadata.tag.createdEvent, updated: metadata.tag.updatedEvent, deleted: metadata.tag.deletedEvent,
      variantUpdated: metadata.variant.updatedEvent, variantCreated: metadata.variant.createdEvent,
      productCreated: metadata.product.createdEvent, productUpdated: metadata.product.updatedEvent,
      optionCreated: metadata.option.createdEvent, valueCreated: metadata.value.createdEvent,
      imageCreated: metadata.image.createdEvent, collectionUpdated: metadata.collection.updatedEvent }, {
        ...logicalPolicy, commands: Object.values(commands), allowSetNull: true,
        referenceReplacement: { commands: [commands.updateCollections, commands.upsertCollections],
          eventName: metadata.product.updatedEvent,
          metadata: { source: Modules.PRODUCT, object: metadata.product.eventObject, action: CommonEvents.UPDATED }, eventLimit: productReferenceReplacementEventLimit },
      }));
  const variantUpdateWorkflow = yield* Effect.fromResult(productVariantUpdateWorkflowModule(description, commands, graph,
    metadata.variant.updatedEvent, { ...logicalPolicy, commands: Object.values(commands) }));
  const productUpdateWorkflow = yield* Effect.fromResult(productUpdateWorkflowModule(description, commands, graph,
    [metadata.product.updatedEvent, ...[metadata.option, metadata.value, metadata.variant, metadata.image]
      .flatMap(entity => [entity.createdEvent, entity.updatedEvent, entity.deletedEvent])],
    { ...logicalPolicy, validateLogicalCall: productUpdateGraphReceipt(metadata, validateLogicalCall), commands: Object.values(commands) }));
  const productDeletionWorkflow = yield* Effect.fromResult(productDeletionWorkflowModule(description,
    { list: commands.list, softDeleteProducts: deletion.softDeleteProducts, softDeleteVariants: deletion.softDeleteVariants, countVariants: deletion.countVariants }, graph,
    { product: [metadata.product, metadata.image, metadata.option, metadata.value, metadata.variant].map(entity => entity.deletedEvent), variant: metadata.variant.deletedEvent },
    { ...logicalPolicy, commands: Object.values(commands) }));
  const productBatchWorkflow = yield* Effect.fromResult(productBatchWorkflowModule(description, metadata,
    { creation: workflow, update: productUpdateWorkflow, variantUpdate: variantUpdateWorkflow, deletion: productDeletionWorkflow },
    { ...logicalPolicy, commands: Object.values(commands) }));
  return { metadata, commands, withService, graph, workflow, variantUpdateWorkflow, productUpdateWorkflow, productDeletionWorkflow, productBatchWorkflow, logicalPolicy };
});
