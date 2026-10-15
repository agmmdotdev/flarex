import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { categoryCreateEventPolicy, categoryChangeEventPolicy, categoryUpsertEventPolicy, internalCategoryPolicy } from "./category";
import { collectionWriteEventPolicy, collectionDeleteEventPolicy } from "./collection";
import { productLogicalTypeEventPolicy, productLogicalTypeUpsertEventPolicy, productLogicalImageCreateEventPolicy, productLogicalOptionEventPolicy, productLogicalDirectEntityUpdateEventPolicy } from "./entity";
import { tagCallEventPolicy, productLogicalTagHardDeleteEventPolicy } from "./tag";
import { productLogicalVariantImagesEventPolicy, productLogicalVariantCreateEventPolicy, productLogicalVariantChangeEventPolicy } from "./variant";
import { productLogicalCreateEventPolicy, productLogicalUpdateEventPolicy, productLogicalUpsertEventPolicy, productLogicalInternalProductWriteEventPolicy, productLogicalDeleteEventPolicy } from "./product";
import { productRelationshipCallReceipt } from "./memberships";
import { productLogicalInternalProductLifecycleEventPolicy, productLogicalLifecycleEventPolicy } from "./lifecycle";

/** Selected Product commands validate at the same native call boundary. Selection
 * of callable methods stays with the host; unsupported writes fail closed here. */
export function productCallReceipts(catalog: ProductRuntimeMetadata) {
  const categoryCreate = categoryCreateEventPolicy(catalog);
  const categoryUpdate = categoryChangeEventPolicy(catalog, "update");
  const categoryUpsert = categoryUpsertEventPolicy(catalog);
  const categoryDelete = categoryChangeEventPolicy(catalog, "delete");
  const internalCreate = internalCategoryPolicy(catalog, "create");
  const internalUpdate = internalCategoryPolicy(catalog, "update");
  const internalDelete = internalCategoryPolicy(catalog, "delete");
  const collectionCreate = collectionWriteEventPolicy(catalog, "create");
  const collectionUpdate = collectionWriteEventPolicy(catalog, "update");
  const collectionUpsert = collectionWriteEventPolicy(catalog, "upsert");
  const collectionDelete = collectionDeleteEventPolicy(catalog);
  const tags = tagCallEventPolicy(catalog);
  const variantImages = productLogicalVariantImagesEventPolicy(catalog);
  const policies = new Map<string, LogicalCallReceiptValidation>([
    ["productCreatecategory", categoryCreate.validateLogicalCall],
    ["productupdatecategory", categoryUpdate.validateLogicalCall],
    ["productupsertcategory", categoryUpsert.validateLogicalCall],
    ["productDeletecategory", categoryDelete.validateLogicalCall],
    ["productInternalCategorycreate", internalCreate.validateLogicalCall],
    ["productInternalCategoryupdate", internalUpdate.validateLogicalCall],
    ["productInternalCategorydelete", internalDelete.validateLogicalCall],
    ["productCreatecollection", collectionCreate.validateLogicalCall],
    ["productupdatecollection", collectionUpdate.validateLogicalCall],
    ["productupsertcollection", collectionUpsert.validateLogicalCall],
    ["productDeletecollection", collectionDelete],
    ...["productCreatetag", "productupdatetag", "productupserttag",
      "productUpdateTagsBySelector", "productSoftDeleteTag"].map(name => [name, tags.validateLogicalCall] as const),
    ["productCreate", productLogicalCreateEventPolicy(catalog).validateLogicalCall],
    ["productUpdate", productLogicalUpdateEventPolicy(catalog).validateLogicalCall],
    ["productUpsert", productLogicalUpsertEventPolicy(catalog)],
    ["productUpsertRelationships", productRelationshipCallReceipt(catalog)],
    ["productInternalProductcreate", productLogicalInternalProductWriteEventPolicy(catalog, "create")],
    ["productInternalProductupdate", productLogicalInternalProductWriteEventPolicy(catalog, "update")],
    ["productInternalProductsoftDelete", productLogicalInternalProductLifecycleEventPolicy(catalog, "softDelete")],
    ["productInternalProductrestore", productLogicalInternalProductLifecycleEventPolicy(catalog, "restore")],
    ["productCreatevariant", productLogicalVariantCreateEventPolicy(catalog).validateLogicalCall],
    ["productupdatevariant", productLogicalVariantChangeEventPolicy(catalog, "update")],
    ["productupsertvariant", productLogicalVariantChangeEventPolicy(catalog, "upsert")],
    ["productUpdateVariantsForWorkflow", productLogicalVariantChangeEventPolicy(catalog, "selector")],
    ["productDeleteproduct", productLogicalDeleteEventPolicy(catalog).validateLogicalCall],
    ["productSoftDelete", productLogicalLifecycleEventPolicy(catalog, "softDelete").validateLogicalCall],
    ["productSoftDeleteVariant", productLogicalLifecycleEventPolicy(catalog, "softDelete", "variant").validateLogicalCall],
    ["productRestore", productLogicalLifecycleEventPolicy(catalog, "restore").validateLogicalCall],
    ["productCreatetype", productLogicalTypeEventPolicy(catalog, "create").validateLogicalCall],
    ["productupdatetype", productLogicalTypeEventPolicy(catalog, "update").validateLogicalCall],
    ["productupserttype", productLogicalTypeUpsertEventPolicy(catalog)],
    ["productDeletetype", productLogicalTypeEventPolicy(catalog, "delete").validateLogicalCall],
    ["productDeletetag", productLogicalTagHardDeleteEventPolicy(catalog)],
    ["productCreateimage", productLogicalImageCreateEventPolicy(catalog)],
    ["productCreateoption", productLogicalOptionEventPolicy(catalog, "create").validateLogicalCall],
    ["productupdateoption", productLogicalOptionEventPolicy(catalog, "update").validateLogicalCall],
    ["productupsertoption", productLogicalOptionEventPolicy(catalog, "upsert").validateLogicalCall],
    ["productDeleteoption", productLogicalOptionEventPolicy(catalog, "delete").validateLogicalCall],
    ["productupdatevalue", productLogicalDirectEntityUpdateEventPolicy(catalog, catalog.value,
      "productupdatevalue")],
    ["productCreateassignment", variantImages.validateLogicalCall],
    ["productDeleteassignment", variantImages.validateLogicalCall],
    ["productUpdateVariantsBySelector", variantImages.validateLogicalCall],
  ]);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCall")(
    function* (call, activity) {
      if (call.fromAttempt !== 0 || call.toAttempt !== activity.mutations.length ||
        call.fromLifecycle !== 0 || call.toLifecycle !== activity.lifecycle.length ||
        activity.mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") {
        if (call.events.length || activity.mutations.length || activity.lifecycle.length ||
          activity.setNull.length || activity.referenceReplacements.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        return;
      }
      if (activity.referenceReplacements.length !== 0 &&
        !["productupdatecollection", "productupsertcollection"].includes(call.commandName) ||
        activity.setNull.length !== 0 && !["productDeletetype", "productDeletecollection"].includes(call.commandName) ||
        activity.lifecycle.length !== 0 && !["productSoftDelete", "productRestore", "productSoftDeleteTag", "productSoftDeleteVariant",
          "productInternalProductsoftDelete", "productInternalProductrestore"].includes(call.commandName))
        return yield* Effect.fail(commerceError("receiptMismatch", { commandName: call.commandName,
          referenceReplacements: activity.referenceReplacements.length, setNull: activity.setNull.length,
          lifecycle: activity.lifecycle.length }));
      const policy = policies.get(call.commandName);
      if (policy === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* policy(call, activity);
    });
  return { capture: categoryCreate.capture, validateLogicalCall };
}
