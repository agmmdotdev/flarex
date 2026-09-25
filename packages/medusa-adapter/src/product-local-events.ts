import type { LogicalCallReceiptValidation } from "./logical-call-receipt";
import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { decodeProductLifecycleIds } from "./product-lifecycle";
import { captureCategoryProjection, decodeCategoryProjection } from "./product-category-projection";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { VariantImagePairs, decodeVariantThumbnailUpdate } from "./product-variant-workflow-input";
import { ProductRelationshipResultRows } from "./product-relationship-workflow-input";
import { ProductRelationshipUpsertRows } from "./product-value-profile";

function productRelationshipCallReceipt(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const input = Schema.decodeUnknownEffect(ProductRelationshipUpsertRows, { onExcessProperty: "error" });
  const output = Schema.decodeUnknownEffect(ProductRelationshipResultRows, { onExcessProperty: "error" });
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  return Effect.fn("ProductEvents.validateRelationshipCall")(function* (call, activity) {
    const requested = yield* input(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const returned = yield* output(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const desired = new Map(requested.map(row => [row.id, new Set(row.category_ids)]));
    const resultIds = new Set(returned.map(row => row.id));
    const pivot = (yield* productMembershipPivots(catalog))[1];
    const mismatch = () => commerceError("receiptMismatch");
    if (pivot === undefined || desired.size !== requested.length || resultIds.size !== returned.length ||
      resultIds.size !== desired.size || [...resultIds].some(id => !desired.has(id))) return yield* Effect.fail(mismatch());
    const changed = new Set<string>(), pairs = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after;
      if (mutation.table === catalog.product.table.name) {
        if ((mutation.operation !== "patch" && mutation.operation !== "replace") || before === null || after === null ||
          typeof before.id !== "string" || before.id !== after.id || before.deleted_at !== null ||
          !desired.has(before.id) || changed.has(before.id)) return yield* Effect.fail(mismatch());
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (key === "updated_at") continue;
          if (before[key] === undefined || after[key] === undefined || !jsonEqual(before[key], after[key]))
            return yield* Effect.fail(mismatch());
        }
        changed.add(before.id);
      } else {
        const insert = mutation.operation === "insert" && before === null && after !== null;
        const remove = mutation.operation === "delete" && before !== null && after === null;
        const row = insert ? after : before;
        const product = row?.[pivot.productColumn], category = row?.[pivot.targetColumn];
        const selected = typeof product === "string" ? desired.get(product) : undefined;
        const pair = JSON.stringify([product, category]);
        if (mutation.table !== pivot.table || (!insert && !remove) || selected === undefined || typeof category !== "string" ||
          pairs.has(pair) || selected.has(category) !== insert) return yield* Effect.fail(mismatch());
        pairs.add(pair);
      }
    }
    if (changed.size !== desired.size) return yield* Effect.fail(mismatch());
    const actual = new Map([...desired.keys()].map(id => [id, new Set<string>()]));
    for (const observation of activity.observedRows) {
      if (observation.table !== pivot.table) continue;
      const product = observation.row[pivot.productColumn], category = observation.row[pivot.targetColumn];
      const selected = typeof product === "string" ? actual.get(product) : undefined;
      if (selected === undefined) continue;
      if (typeof category !== "string" || selected.has(category)) return yield* Effect.fail(mismatch());
      selected.add(category);
    }
    for (const [id, selected] of desired) {
      const observed = actual.get(id);
      if (observed?.size !== selected.size || [...selected].some(category => !observed.has(category))) return yield* Effect.fail(mismatch());
    }
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.name !== catalog.product.updatedEvent || message.metadata.action !== CommonEvents.UPDATED)
        return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!changed.delete(id)) return yield* Effect.fail(mismatch());
    }
    if (changed.size !== 0) return yield* Effect.fail(mismatch());
  });
}


const EventId = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Public native rows contain the stored fields without Flarex document metadata. */
function matchesPublicRow(stored: JsonObject, returned: Json): boolean {
  if (!isJsonObject(returned)) return false;
  const fields = Object.keys(stored).filter(key => key !== "_id" && key !== "_creationTime");
  return Object.keys(returned).length === fields.length && fields.every(key => {
    const actual = returned[key], expected = stored[key];
    return actual !== undefined && expected !== undefined && jsonEqual(actual, expected);
  });
}

function productResultGraphMatcher(catalog: ProductRuntimeMetadata, rootTable: string,
  activity: Parameters<LogicalCallReceiptValidation>[1]): (stored: JsonObject, returned: Json) => boolean {
  const rows = new Map<string, JsonObject[]>();
  for (const { table, row } of activity.observedRows) rows.set(table, [...rows.get(table) ?? [], row]);
  for (const mutation of activity.mutations) {
    const after = mutation.after;
    if (after === null || typeof after.id !== "string") continue;
    const previous = rows.get(mutation.table) ?? [];
    rows.set(mutation.table, [...previous.filter(row => row.id !== after.id), after]);
  }
  const tuple = (row: JsonObject, columns: readonly string[]) => JSON.stringify(columns.map(column => row[column]));
  const matches = (table: string, current: JsonObject, value: Json, depth: number): boolean => {
    if (depth > 4 || !isJsonObject(value)) return false;
    const fields = Object.keys(current).filter(key => key !== "_id" && key !== "_creationTime");
    const relations = catalog.queryRelations.get(table);
    if (!fields.every(key => value[key] !== undefined && current[key] !== undefined && jsonEqual(value[key], current[key])) ||
      Object.keys(value).some(key => !fields.includes(key) && relations?.has(key) !== true)) return false;
    for (const [name, relation] of relations ?? []) {
      const selected = value[name];
      if (selected === undefined) continue;
      const targetRows = rows.get(relation.targetTable) ?? [];
      if (relation.join.type === "belongsTo") {
        const key = tuple(current, relation.join.foreignKeys);
        const targets = targetRows.filter(row => tuple(row, relation.targetPrimaryKeys) === key);
        if (relation.join.foreignKeys.every(column => current[column] === null)) {
          if (selected !== null) return false;
        } else if (targets.length !== 1 || !matches(relation.targetTable, targets[0]!, selected, depth + 1)) return false;
        continue;
      }
      if (!Array.isArray(selected)) return false;
      const join = relation.join;
      const matching = join.type === "hasMany"
        ? targetRows.filter(row => tuple(row, join.foreignKeys) === tuple(current, relation.sourcePrimaryKeys))
        : targetRows.filter(row => (rows.get(join.pivotTable) ?? []).some(pivot =>
          tuple(pivot, join.sourceColumns) === tuple(current, relation.sourcePrimaryKeys) &&
          tuple(pivot, join.targetColumns) === tuple(row, relation.targetPrimaryKeys)));
      const expected = new Map(matching.map(row => [tuple(row, relation.targetPrimaryKeys), row]));
      if (expected.size !== matching.length || expected.size !== selected.length) return false;
      for (const item of selected) {
        if (!isJsonObject(item)) return false;
        const key = tuple(item, relation.targetPrimaryKeys);
        const target = expected.get(key);
        if (target === undefined || !matches(relation.targetTable, target, item, depth + 1)) return false;
        expected.delete(key);
      }
      if (expected.size !== 0) return false;
    }
    return true;
  };
  return (stored, returned) => matches(rootTable, stored, returned, 0);
}

/** Native Collection update returns requested Product ID stubs, not a loaded relation. */
function matchesCollectionUpdateRow(before: JsonObject, stored: JsonObject, returned: Json, input: Json | undefined): boolean {
  if (!isJsonObject(returned) || input === undefined || !isJsonObject(input)) return false;
  for (const field of ["title", "handle", "metadata"] as const) {
    const supplied = input[field];
    if (supplied === undefined) continue;
    const persisted = stored[field];
    // Pinned internal-service metadata merges nonempty objects, deleting keys
    // whose requested value is an empty string. Empty objects/null replace it.
    if (field === "metadata" && isJsonObject(supplied) && Object.keys(supplied).length > 0) {
      if (persisted === undefined || !isJsonObject(persisted)) return false;
      const prior = before.metadata !== undefined && isJsonObject(before.metadata) ? before.metadata : {};
      const keys = new Set([...Object.keys(prior), ...Object.keys(supplied), ...Object.keys(persisted)]);
      for (const key of keys) {
        const expected = Object.hasOwn(supplied, key) ? supplied[key] : prior[key];
        const actual = persisted[key];
        if (Object.hasOwn(supplied, key) && expected === "") {
          if (actual !== undefined) return false;
        } else if (expected === undefined || actual === undefined || !jsonEqual(expected, actual)) return false;
      }
    } else if (persisted === undefined || !jsonEqual(supplied, persisted)) return false;
  }
  const { products, ...scalars } = returned;
  const ids = input.product_ids ?? [];
  return matchesPublicRow(stored, scalars) && products !== undefined && Array.isArray(ids) &&
    ids.every(id => typeof id === "string") && jsonEqual(products, ids.map(id => ({ id })));
}

const messageSchema = (maximumIds: number) => Schema.Struct({
  name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRODUCT), object: Schema.String, action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  // The pinned subscriber emits scalar IDs; service bulk operations can retain
  // an ID array. Preserve both message forms without regrouping them.
  data: Schema.Struct({ id: Schema.Union([EventId, Schema.Array(EventId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumIds))]) }),
});


/** Adapter-owned capture and fact validation, shared by local delivery and
 * durable workflow publication. Neither consumer invents a dummy destination. */
function productModuleEventCapture(catalog: ProductRuntimeMetadata, resources: CommerceResources) {
  const decode = Schema.decodeUnknownEffect(messageSchema(resources.eventIds), { onExcessProperty: "error" });
  const capture = Effect.fn("ProductEvents.capture")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, resources));
    const message = yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const candidates = catalog.entities.filter(entity => entity !== catalog.assignment);
    if (!candidates.some(entity => entity.eventObject === message.metadata.object &&
      (message.metadata.action === CommonEvents.CREATED ? entity.createdEvent : message.metadata.action === CommonEvents.UPDATED ? entity.updatedEvent : message.metadata.action === CommonEvents.RESTORED ? entity.restoredEvent : entity.deletedEvent) === message.name)) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  return capture;
}

export function productModuleEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata): Pick<LocalCommerceEventPolicy, "capture" | "validate"> {
  const capture = productModuleEventCapture(catalog, descriptor.resources);
  return { capture,
    validate: Effect.fn("ProductEvents.validate")(function* (events, rows, commandName, lifecycle = []) {
      const internalCategory = ["productInternalCategorycreate", "productInternalCategoryupdate", "productInternalCategorydelete"].includes(commandName);
      if (internalCategory && (events.length !== 0 || lifecycle.length !== 0)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const internalProduct = ["productInternalProductcreate", "productInternalProductupdate", "productInternalProductsoftDelete", "productInternalProductrestore"].includes(commandName);
      if (internalProduct && events.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      const expected = new Set<string>();
      const observations = new Map<string, { readonly id: string; readonly observation: typeof lifecycle[number] }>();
      for (const observation of lifecycle) {
        const key = yield* decodeRelationalRowKey(descriptor.layout, observation.tableId, observation.keyBytes, 1)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const id = key.components[0]?.value;
        if (key.components.length !== 1 || typeof id !== "string" ||
          !(commandName === (observation.operation === "restore" ? "productRestore" : "productSoftDelete") || commandName === (observation.operation === "restore" ? "productInternalProductrestore" : "productInternalProductsoftDelete")
            || (observation.operation === "softDelete" && ((commandName === "productSoftDeleteVariant" && observation.tableId === catalog.variant.table.name)
              || (commandName === "productSoftDeleteTag" && observation.tableId === catalog.tag.table.name)))) ||
          (observation.operation === "restore" ? observation.afterDeletedAt !== null : observation.afterDeletedAt === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
        const identity = observation.tableId + ":" + id;
        if (observations.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        observations.set(identity, { id, observation });
      }
      for (const row of rows) {
        const key = yield* decodeRelationalRowKey(descriptor.layout, row.tableId, row.keyBytes, row.codecVersion)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (internalCategory) {
          // Direct Category methods have neither EmitEvents nor a caller-supplied
          // aggregator. Authenticate their limited facts, preserving every fact
          // while requiring zero published module messages for these commands.
          const categoryRow = row.tableId === catalog.category.table.name && key.components.length === 1 && key.components[0]?.columnId === "id" && typeof key.components[0].value === "string";
          const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
          const categoryPivot = relation?.join.type === "manyToMany" && row.tableId === relation.join.pivotTable;
          const admitted = categoryRow && (row.operation === "update" || (row.operation === "insert" && commandName === "productInternalCategorycreate") || (row.operation === "delete" && commandName === "productInternalCategorydelete"))
            || categoryPivot && ((row.operation === "insert" && commandName === "productInternalCategorycreate") || (row.operation === "delete" && commandName === "productInternalCategorydelete"));
          if (!admitted) return yield* Effect.fail(commerceError("receiptMismatch"));
          continue;
        }
        if (internalProduct) {
          const identity = row.tableId + ":" + key.components[0]?.value;
          const observation = observations.get(identity)?.observation;
          const productRow = row.tableId === catalog.product.table.name && key.components.length === 1 && key.components[0]?.columnId === "id" && typeof key.components[0].value === "string";
          const scalarWrite = productRow && observation === undefined && (
            commandName === "productInternalProductcreate" && row.operation === "insert" ||
            commandName === "productInternalProductupdate" && row.operation === "update");
          const lifecycleWrite = observation !== undefined && !(observation.operation === "restore" && observation.beforeDeletedAt === null) && row.operation === "update" &&
            [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image].some(entity => entity.table.name === row.tableId);
          if (!scalarWrite && !lifecycleWrite) return yield* Effect.fail(commerceError("receiptMismatch"));
          observations.delete(identity);
          continue;
        }
        if ((row.operation === "insert" || row.operation === "delete") && catalog.writablePivots.some(table => table.name === row.tableId)) continue;
        const object = catalog.entities.find(entity => entity.table.name === row.tableId);
        const id = key.components[0];
        if (object === undefined || key.components.length !== 1 || id?.columnId !== "id" || typeof id.value !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        if (object === catalog.assignment) {
          if (!((row.operation === "insert" && commandName === "productCreateassignment") || (row.operation === "delete" && ["productDeleteproduct", "productDeleteassignment"].includes(commandName)))) return yield* Effect.fail(commerceError("unadmittedEvent"));
          continue;
        }
        // The pinned physical-delete internal service dispatches only root IDs;
        // dependent removals still require complete core relational delete facts.
        if (row.operation === "delete" && commandName === "productDeleteproduct" && [catalog.option, catalog.value, catalog.variant, catalog.image].includes(object)) continue;
        if (row.operation === "delete" && commandName === "productDeleteoption" && object === catalog.value) continue;
        // Pinned reference detachment emits no Product mutation callback.
        if (row.operation === "update" && object === catalog.product && ["productDeletetype", "productDeletecollection"].includes(commandName)) continue;
        const observationKey = row.tableId + ":" + id.value;
        const observation = observations.get(observationKey)?.observation;
        if (observation !== undefined && (row.operation !== "update" || (observation.operation === "restore" && observation.beforeDeletedAt === null))) return yield* Effect.fail(commerceError("receiptMismatch"));
        observations.delete(observationKey);
        const action = observation !== undefined ? (observation.operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED)
          : row.operation === "insert" ? CommonEvents.CREATED : row.operation === "update" ? CommonEvents.UPDATED : CommonEvents.DELETED;
        const identity = action + ":" + object.eventObject + ":" + id.value;
        // Pinned Category rank/path maintenance can update the same row several
        // times in one command; its message aggregator retains one update event.
        // Keep every core fact and authenticate that single event identity only
        // for these Category commands. Other duplicate facts remain refused.
        const categoryMaintenance = object === catalog.category && row.operation === "update" && observation === undefined &&
          ["productCreatecategory", "productupdatecategory", "productupsertcategory", "productDeletecategory"].includes(commandName);
        if (expected.has(identity) && !categoryMaintenance) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      // Native restore selects active rows and emits restored events even when
      // storage made no transition. Only the core's unchanged observation can
      // authorize these messages; a fabricated update fact is not a substitute.
      for (const [identity, { id, observation }] of observations) {
        const entity = catalog.entities.find(value => value.table.name === observation.tableId);
        if (observation.operation !== "restore" || observation.beforeDeletedAt !== null || observation.afterDeletedAt !== null ||
          entity === undefined || ![catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image].includes(entity))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (!internalProduct) expected.add(CommonEvents.RESTORED + ":" + entity.eventObject + ":" + id);
        observations.delete(identity);
      }
      for (const event of events) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          const identity = message.metadata.action + ":" + message.metadata.object + ":" + id;
          if (!expected.delete(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size !== 0 || observations.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}

/** Read only the two module-local Product memberships declared by pinned DML. */
const productMembershipPivots = Effect.fn("ProductEvents.membershipPivots")(function* (catalog: ProductRuntimeMetadata) {
  const pivots: Array<{ readonly table: string; readonly productColumn: string; readonly targetColumn: string }> = [];
  for (const name of ["tags", "categories"] as const) {
    const relation = catalog.queryRelations.get(catalog.product.table.name)?.get(name);
    const join = relation?.join;
    if (join?.type !== "manyToMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
    const table = join.pivotTable;
    if (join.sourceColumns.length !== 1 || join.targetColumns.length !== 1 ||
      !catalog.writablePivots.some(pivot => pivot.name === table) || table === catalog.pivot.table.name)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const productColumn = join.sourceColumns[0];
    const targetColumn = join.targetColumns[0];
    if (productColumn === undefined || targetColumn === undefined || pivots.some(pivot => pivot.table === table))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    pivots.push({ table, productColumn, targetColumn });
  }
  return pivots;
});

const validateProductMembershipRows = Effect.fn("ProductEvents.validateMembershipRows")(function* (
  pivots: Effect.Success<ReturnType<typeof productMembershipPivots>>,
  rows: ReadonlyMap<string, readonly JsonObject[]>, products: ReadonlyMap<string, JsonObject>,
) {
  for (const pivot of pivots) {
    const identities = new Set<string>();
    for (const row of rows.get(pivot.table) ?? []) {
      const product = row[pivot.productColumn], target = row[pivot.targetColumn];
      const identity = JSON.stringify([product, target]);
      if (typeof product !== "string" || !products.has(product) || typeof target !== "string" ||
        identities.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      identities.add(identity);
    }
  }
});

/** One native entity command owns its row transitions and matching messages. */
function productLogicalEntityEventPolicy(catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  commandName: string, action: "created" | "updated" | "deleted") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const eventName = action === "created" ? entity.createdEvent : action === "updated" ? entity.updatedEvent : entity.deletedEvent;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalEntity")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (action !== "deleted" && lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    for (const mutation of mutations) {
      const id = mutation.after?.id;
      const before = mutation.before;
      const after = mutation.after;
      const transition = action === "created"
        ? mutation.operation === "insert" && before === null && after?.deleted_at === null
        : (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.id === id && before.deleted_at === null &&
          (action === "updated" ? after?.deleted_at === null : typeof after?.deleted_at === "string");
      if (mutation.table !== entity.table.name || !transition ||
        typeof id !== "string" || expected.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(id);
    }
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.name !== eventName || message.metadata.object !== entity.eventObject ||
        message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** Direct single-row updates must bind the returned DTO and requested fields
 * to the same mutation authenticated by the shared event receipt. */
function productLogicalDirectEntityUpdateEventPolicy(catalog: ProductRuntimeMetadata,
  entity: ProductEntityMetadata, commandName: string): LogicalCallReceiptValidation {
  const generic = productLogicalEntityEventPolicy(catalog, entity, commandName, "updated");
  return Effect.fn("ProductEvents.validateLogicalDirectEntityUpdate")(function* (call, activity) {
    yield* generic.validateLogicalCall(call, activity);
    const input = call.input, result = call.result;
    const mutation = activity.mutations[0];
    if (!isJsonObject(input) || typeof input.id !== "string" || input.data === undefined ||
      !isJsonObject(input.data) || result === undefined ||
      activity.mutations.length !== 1 || mutation?.after === null || mutation?.after === undefined ||
      mutation.after.id !== input.id || !matchesPublicRow(mutation.after, result) ||
      Object.entries(input.data).some(([field, value]) => {
        const stored = mutation.after?.[field];
        return stored === undefined || !jsonEqual(stored, value);
      })) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
}

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
  const collectionDelete = productLogicalNullableReferenceDeleteEventPolicy(catalog, catalog.collection,
    "collection_id", "productDeletecollection");
  const tags = tagCallEventPolicy(catalog);
  const variantImages = productLogicalVariantImagesEventPolicy(catalog);
  const other = new Map<string, LogicalCallReceiptValidation>([
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
      const receipt = other.get(call.commandName);
      if (receipt !== undefined) return yield* receipt(call, activity);
      if (call.commandName === "productDeletecollection") {
        const decoded = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const requested = new Set(typeof decoded === "string" ? [decoded] : decoded);
        if (call.result !== null || activity.referenceReplacements.length !== 0 ||
          activity.mutations.some(mutation => typeof mutation.before?.id !== "string" || !requested.has(mutation.before.id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        yield* collectionDelete.validateLogicalCall(call, activity);
        return;
      }
      const policy = call.commandName === "productCreatecategory" ? categoryCreate
        : call.commandName === "productupdatecategory" ? categoryUpdate
        : call.commandName === "productupsertcategory" ? categoryUpsert
        : call.commandName === "productDeletecategory" ? categoryDelete
        : call.commandName === "productInternalCategorycreate" ? internalCreate
        : call.commandName === "productInternalCategoryupdate" ? internalUpdate
        : call.commandName === "productInternalCategorydelete" ? internalDelete
        : call.commandName === "productCreatecollection" ? collectionCreate
        : call.commandName === "productupdatecollection" ? collectionUpdate
        : call.commandName === "productupsertcollection" ? collectionUpsert
        : ["productCreatetag", "productupdatetag", "productupserttag",
          "productUpdateTagsBySelector", "productSoftDeleteTag"].includes(call.commandName) ? tags
        : undefined;
      if (policy === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* policy.validateLogicalCall(call, activity);
    });
  return { capture: categoryCreate.capture, validateLogicalCall };
}

/** Native Category upsert creates ID-less rows, then updates selected IDs.
 * Reuse the tree receipts for each disjoint phase; overlapping tree effects
 * fail closed until one call can authenticate their combined ownership. */
function categoryUpsertEventPolicy(catalog: ProductRuntimeMetadata) {
  const create = categoryCreateEventPolicy(catalog);
  const update = categoryChangeEventPolicy(catalog, "update");
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCategoryUpsert")(
    function* (call, activity) {
      const requests = Array.isArray(call.input) ? call.input : [call.input];
      const results = Array.isArray(call.result) ? call.result : [call.result];
      if (call.commandName !== "productupsertcategory" || requests.length === 0 ||
        requests.length !== results.length || requests.some(row => !isJsonObject(row)) ||
        results.some(row => !isJsonObject(row)) || activity.lifecycle.length !== 0 ||
        activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
        return yield* Effect.fail(mismatch());
      const forCreate = requests.filter(row => isJsonObject(row) && typeof row.id !== "string");
      const forUpdate = requests.filter(row => isJsonObject(row) && typeof row.id === "string");
      if (forUpdate.length > 1) return yield* Effect.fail(mismatch());
      const createdResults = results.slice(0, forCreate.length);
      const updatedResult = results[forCreate.length];
      const created = activity.mutations.filter(mutation => mutation.operation === "insert");
      const updated = activity.mutations.filter(mutation => mutation.operation !== "insert");
      if (created.length !== forCreate.length || updated.length !== forUpdate.length ||
        activity.mutations.some((mutation, index) => mutation.ordinal !== index ||
          mutation.table !== catalog.category.table.name)) return yield* Effect.fail(mismatch());
      const createEvents: Json[] = [], updateEvents: Json[] = [];
      for (const event of call.events) {
        const message = yield* capture(event);
        if (message.metadata.object !== catalog.category.eventObject)
          return yield* Effect.fail(mismatch());
        if (message.name === catalog.category.createdEvent) createEvents.push(event);
        else if (message.name === catalog.category.updatedEvent) updateEvents.push(event);
        else return yield* Effect.fail(mismatch());
      }
      if (forCreate.length !== 0) yield* create.validateLogicalCall({ ...call,
        commandName: "productCreatecategory", input: forCreate, result: createdResults,
        events: createEvents, fromAttempt: 0, toAttempt: created.length,
      }, { ...activity, mutations: created.map((mutation, ordinal) => ({ ...mutation, ordinal })) });
      if (forUpdate.length !== 0) {
        const request = forUpdate[0];
        if (!isJsonObject(request) || typeof request.id !== "string" ||
          !isJsonObject(updatedResult) || updatedResult.id !== request.id)
          return yield* Effect.fail(mismatch());
        const { id, ...data } = request;
        yield* update.validateLogicalCall({ ...call, commandName: "productupdatecategory",
          input: { id, data }, result: updatedResult, events: updateEvents,
          fromAttempt: 0, toAttempt: updated.length,
        }, { ...activity, mutations: updated.map((mutation, ordinal) => ({ ...mutation, ordinal })) });
      }
    });
  return { capture, validateLogicalCall };
}

/** Bind public Category creation to the native tree transition, requested
 * Product memberships and the module messages for every affected Category. */
function categoryCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const tree = internalCategoryPolicy(catalog, "create");
  const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
  const join = relation?.join;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCategoryCreate")(
    function* (write, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const mismatch = () => commerceError("receiptMismatch");
      const emitted = write.events;
      if (lifecycle.length !== 0 || setNull.length !== 0 ||
        referenceReplacements.length !== 0 || join?.type !== "manyToMany" ||
        join.sourceColumns.length !== 1 || join.targetColumns.length !== 1 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const categoryColumn = join.sourceColumns[0], productColumn = join.targetColumns[0];
      if (categoryColumn === undefined || productColumn === undefined) return yield* Effect.fail(mismatch());
      const input = Array.isArray(write.input) ? write.input : [write.input];
      const result = Array.isArray(write.result) ? write.result : [write.result];
      if (input.length === 0 || input.length !== result.length ||
        input.some(row => !isJsonObject(row)) || result.some(row => !isJsonObject(row)))
        return yield* Effect.fail(mismatch());
      const expectedPivots = new Set<string>();
      const treeInput: JsonObject[] = [];
      for (const [index, inputRow] of input.entries()) {
        const resultRow = result[index];
        if (!isJsonObject(inputRow) || !isJsonObject(resultRow) || typeof resultRow.id !== "string")
          return yield* Effect.fail(mismatch());
        const { products, ...category } = inputRow;
        treeInput.push(category);
        if (products === undefined) continue;
        if (!Array.isArray(products)) return yield* Effect.fail(mismatch());
        for (const product of products) {
          if (!isJsonObject(product) || typeof product.id !== "string") return yield* Effect.fail(mismatch());
          const key = JSON.stringify([resultRow.id, product.id]);
          if (expectedPivots.has(key)) return yield* Effect.fail(mismatch());
          expectedPivots.add(key);
        }
      }
      const categories: Array<(typeof mutations)[number]> = [];
      const expectedEvents = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === join.pivotTable) {
          const categoryId = mutation.after?.[categoryColumn];
          const productId = mutation.after?.[productColumn];
          if (mutation.operation !== "insert" || mutation.before !== null ||
            typeof categoryId !== "string" || typeof productId !== "string" ||
            !expectedPivots.delete(JSON.stringify([categoryId, productId])))
            return yield* Effect.fail(mismatch());
          continue;
        }
        if (mutation.table !== catalog.category.table.name) return yield* Effect.fail(mismatch());
        const id = mutation.after?.id;
        const action = mutation.operation === "insert" ? CommonEvents.CREATED : CommonEvents.UPDATED;
        if (typeof id !== "string" || !["insert", "patch", "replace"].includes(mutation.operation))
          return yield* Effect.fail(mismatch());
        expectedEvents.add(action + ":" + id);
        categories.push({ ...mutation, ordinal: categories.length });
      }
      if (expectedPivots.size !== 0) return yield* Effect.fail(mismatch());
      const syntheticResult = yield* Effect.fromResult(captureCategoryProjection(result, defaultCommerceResources))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      yield* tree.validateLogicalCall({ ...write, commandName: "productInternalCategorycreate",
        input: treeInput, result: syntheticResult, events: [], fromAttempt: 0, toAttempt: categories.length },
      { ...activity, mutations: categories });
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.metadata.object !== catalog.category.eventObject ||
          (message.metadata.action === CommonEvents.CREATED ? message.name !== catalog.category.createdEvent
            : message.metadata.action === CommonEvents.UPDATED ? message.name !== catalog.category.updatedEvent : true))
          return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expectedEvents.delete(message.metadata.action + ":" + id)) return yield* Effect.fail(mismatch());
      }
      if (expectedEvents.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

/** Public Category update/delete retain the same native tree mutations as the
 * internal service, with public result shapes, module events and delete pivots. */
function categoryChangeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "update" | "delete") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const tree = internalCategoryPolicy(catalog, operation);
  const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
  const join = relation?.join;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCategoryChange")(
    function* (write, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const mismatch = () => commerceError("receiptMismatch");
      const emitted = write.events;
      if (lifecycle.length !== 0 || setNull.length !== 0 ||
        referenceReplacements.length !== 0 || join?.type !== "manyToMany" ||
        join.sourceColumns.length !== 1 || join.targetColumns.length !== 1 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const categoryColumn = join.sourceColumns[0];
      if (categoryColumn === undefined) return yield* Effect.fail(mismatch());
      const ids = operation === "delete" ? Array.isArray(write.input) ? write.input : [write.input] : [];
      if (operation === "delete" && (ids.length === 0 || ids.some(id => typeof id !== "string") || write.result !== null))
        return yield* Effect.fail(mismatch());
      const update = operation === "update" && isJsonObject(write.input) &&
        typeof write.input.id === "string" && write.input.data !== undefined &&
        isJsonObject(write.input.data) &&
        isJsonObject(write.result) && write.result.id === write.input.id
        ? { ...write.input.data, id: write.input.id } : undefined;
      if (operation === "update" && update === undefined) return yield* Effect.fail(mismatch());
      const selected = new Set(ids);
      const categories: Array<(typeof mutations)[number]> = [];
      const expectedEvents = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === join.pivotTable) {
          const categoryId = mutation.before?.[categoryColumn];
          if (operation !== "delete" || mutation.operation !== "delete" ||
            mutation.after !== null || mutation.before === null ||
            typeof categoryId !== "string" ||
            !selected.has(categoryId)) return yield* Effect.fail(mismatch());
          continue;
        }
        if (mutation.table !== catalog.category.table.name) return yield* Effect.fail(mismatch());
        const id = mutation.before?.id ?? mutation.after?.id;
        const action = mutation.operation === "delete" ? CommonEvents.DELETED : CommonEvents.UPDATED;
        if (typeof id !== "string" || !["patch", "replace", "delete"].includes(mutation.operation))
          return yield* Effect.fail(mismatch());
        expectedEvents.add(action + ":" + id);
        categories.push({ ...mutation, ordinal: categories.length });
      }
      const syntheticResult = yield* Effect.fromResult(captureCategoryProjection(
        operation === "update" ? [write.result] : ids, defaultCommerceResources))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      yield* tree.validateLogicalCall({ ...write, commandName: "productInternalCategory" + operation,
        input: operation === "update" ? [update] : ids, result: syntheticResult, events: [],
        fromAttempt: 0, toAttempt: categories.length }, { ...activity, mutations: categories });
      if (operation === "update" && update !== undefined && isJsonObject(write.result)) {
        const final = categories.findLast(mutation => mutation.after?.id === update.id)?.after;
        if (final === undefined || final === null || !isJsonObject(final)) return yield* Effect.fail(mismatch());
        if (!matchesPublicRow(final, write.result)) return yield* Effect.fail(mismatch());
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.metadata.object !== catalog.category.eventObject ||
          (message.metadata.action === CommonEvents.UPDATED ? message.name !== catalog.category.updatedEvent
            : message.metadata.action === CommonEvents.DELETED ? message.name !== catalog.category.deletedEvent : true))
          return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expectedEvents.delete(message.metadata.action + ":" + id)) return yield* Effect.fail(mismatch());
      }
      if (expectedEvents.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

const InternalCategoryCreateRows = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Schema.optionalKey(EventId), name: Schema.String,
  handle: Schema.optionalKey(Schema.String),
  parent_category_id: Schema.optionalKey(Schema.NullOr(EventId)),
  rank: Schema.optionalKey(Schema.Int),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 256));
const decodeInternalCategoryCreateRows = Schema.decodeUnknownEffect(InternalCategoryCreateRows,
  { onExcessProperty: "error" });

/** Direct internal Category calls emit no module events. Admit only their
 * selected root mutations and native sibling/path maintenance. */
function internalCategoryPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "delete") {
  const mismatch = () => commerceError("receiptMismatch");
  const ids = Schema.decodeUnknownEffect(Schema.Array(EventId).check(Schema.isLengthBetween(1, 256)),
    { onExcessProperty: "error" });
  const selectedRows = Schema.decodeUnknownEffect(Schema.Array(Schema.StructWithRest(
    Schema.Struct({ id: EventId }), [Schema.Record(Schema.String, Schema.Json)]))
    .check(Schema.isLengthBetween(1, 256)), { onExcessProperty: "error" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateInternalCategory")(
    function* (call, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      if (call.events.length !== 0 || lifecycle.length !== 0 || setNull.length !== 0 || referenceReplacements.length !== 0 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const createRows = operation === "create" ? yield* decodeInternalCategoryCreateRows(call.input)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : [];
      const updateRows = operation === "update" ? yield* selectedRows(call.input)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : [];
      const inputIds = operation === "delete" ? yield* ids(call.input)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))
        : operation === "update" ? updateRows.map(row => row.id) : [];
      const resultRows = yield* Effect.fromResult(decodeCategoryProjection(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const count = operation === "create" ? createRows.length : inputIds.length;
      if (!Array.isArray(resultRows) || resultRows.length !== count ||
        resultRows.some((row, index) => operation === "delete" ? row !== inputIds[index]
          : !isJsonObject(row) || typeof row.id !== "string" ||
            (operation === "create" ? createRows[index]?.id !== undefined && row.id !== createRows[index]?.id
              : row.id !== inputIds[index]))) return yield* Effect.fail(mismatch());
      const input = operation === "create" ? resultRows.map(row => isJsonObject(row) ? row.id as string : "") : inputIds;
      if (new Set(input).size !== input.length) return yield* Effect.fail(mismatch());
      const selected = new Set(input);
      const seen = new Set<string>();
      const segment = mutations;
      const roots = new Map<string, { before: JsonObject | null; after: JsonObject | null }>();
      for (const mutation of segment) {
        const id = mutation.before?.id ?? mutation.after?.id;
        if (typeof id !== "string" || !selected.has(id)) continue;
        const previous = roots.get(id);
        roots.set(id, { before: previous === undefined ? mutation.before : previous.before, after: mutation.after });
      }
      for (const mutation of segment) {
        const before = mutation.before, after = mutation.after;
        const id = operation === "delete" ? before?.id : after?.id;
        if (mutation.table !== catalog.category.table.name || typeof id !== "string")
          return yield* Effect.fail(mismatch());
        const root = selected.has(id);
        if (mutation.operation === "insert") {
          if (operation !== "create" || !root || before !== null || !isJsonObject(after) ||
            after.deleted_at !== null) return yield* Effect.fail(mismatch());
          const selectedRow = createRows[input.indexOf(id)];
          const resultRow = resultRows[input.indexOf(id)];
          if (selectedRow === undefined || after.name !== selectedRow.name ||
            (selectedRow.handle !== undefined && after.handle !== selectedRow.handle) ||
            after.parent_category_id !== (selectedRow.parent_category_id ?? null) ||
            !isJsonObject(resultRow) || after.rank !== resultRow.rank ||
            Object.entries(selectedRow).some(([key, value]) =>
              !["id", "name", "handle", "parent_category_id", "rank"].includes(key) &&
              (after[key] === undefined || !jsonEqual(value, after[key]))))
            return yield* Effect.fail(mismatch());
          seen.add(id);
        } else if (mutation.operation === "delete") {
          if (operation !== "delete" || !root || !isJsonObject(before) || after !== null)
            return yield* Effect.fail(mismatch());
          seen.add(id);
        } else if (mutation.operation === "patch" || mutation.operation === "replace") {
          if (!isJsonObject(before) || !isJsonObject(after) || before.id !== after.id ||
            before.deleted_at !== after.deleted_at) return yield* Effect.fail(mismatch());
          const requested = operation === "update" && root
            ? updateRows.find(row => row.id === id) : undefined;
          for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (before[key] !== undefined && after[key] !== undefined &&
              jsonEqual(before[key], after[key])) continue;
            if (["rank", "mpath", "updated_at"].includes(key)) continue;
            if (requested === undefined || requested[key] === undefined ||
              after[key] === undefined || !jsonEqual(requested[key], after[key]))
              return yield* Effect.fail(mismatch());
          }
          if (root && operation === "update") seen.add(id);
        } else return yield* Effect.fail(mismatch());
      }
      if (operation === "update") {
        for (const requested of updateRows) {
          const final = roots.get(requested.id)?.after;
          if (final === undefined || final === null) return yield* Effect.fail(mismatch());
          const result = resultRows[input.indexOf(requested.id)];
          if (!isJsonObject(result) ||
            !segment.some(mutation => mutation.after?.id === requested.id &&
              mutation.after.rank === result.rank && mutation.after.mpath === result.mpath))
            return yield* Effect.fail(mismatch());
          for (const [key, value] of Object.entries(requested)) {
            if (key === "id" || key === "rank" || key === "mpath" || key === "updated_at") continue;
            if (final[key] === undefined || !jsonEqual(value, final[key]))
              return yield* Effect.fail(mismatch());
          }
        }
      }
      if (seen.size !== selected.size) return yield* Effect.fail(mismatch());

    });
  return { validateLogicalCall };
}


/** Native Collection writes may change their own roots and, when product_ids
 * is present, only the requested Product.collection_id memberships. */
function collectionWriteEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "upsert") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCollectionWrite")(
    function* (write, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const emitted = write.events;
      if (lifecycle.length !== 0 || setNull.length !== 0) return yield* Effect.fail(mismatch());
      const upsertMembership = operation === "upsert" && Array.isArray(write.input) &&
        write.input.length === 1 && isJsonObject(write.input[0]) &&
        typeof write.input[0].id === "string" && Object.hasOwn(write.input[0], "product_ids")
        ? write.input[0] : undefined;
      const updateMembership = operation === "update" && isJsonObject(write.input) &&
        write.input.data !== undefined && isJsonObject(write.input.data) &&
        Object.hasOwn(write.input.data, "product_ids") ? write.input.data : undefined;
      const mixedMembership = operation === "upsert" && Array.isArray(write.input)
        ? write.input.filter(row => isJsonObject(row) && typeof row.id === "string" &&
          Object.hasOwn(row, "product_ids")) : [];
      const suppliedMembership = updateMembership ?? upsertMembership ??
        (mixedMembership.length === 1 ? mixedMembership[0] : undefined);
      const replacesMembership = suppliedMembership !== undefined;
      if (replacesMembership && referenceReplacements.length !== 1) return yield* Effect.fail(mismatch());
      if (referenceReplacements.length !== 0) {
        const intent = referenceReplacements[0];
        const supplied = suppliedMembership?.product_ids;
        const desired = Array.isArray(supplied) && supplied.every(id => typeof id === "string")
          ? [...new Set(supplied)] : undefined;
        const root = mutations[0];
        const event = emitted[0] === undefined ? undefined : yield* capture(emitted[0]);
        const rootId = operation === "update" && isJsonObject(write.input) ? write.input.id
          : suppliedMembership?.id;
        const returned = operation === "update" ? write.result
          : Array.isArray(write.result) && write.result.length === 1 ? write.result[0] : undefined;
        if (!replacesMembership || referenceReplacements.length !== 1 || intent === undefined ||
          intent.sourceTable !== catalog.product.table.name || intent.sourceColumn !== "collection_id" ||
          intent.targetTable !== catalog.collection.table.name || intent.targetColumn !== "id" ||
          typeof rootId !== "string" || intent.targetKey !== rootId || desired === undefined ||
          desired.length !== intent.desiredKeys.length ||
          desired.some((id, index) => id !== intent.desiredKeys[index]))
          return yield* Effect.fail(mismatch());
        if (operation === "upsert" && Array.isArray(write.input) && write.input.length > 1) {
          // The single sealed replacement belongs to the selected updated
          // root; ordinary receipt validation below owns the remaining roots.
          if (mixedMembership.length !== 1) return yield* Effect.fail(mismatch());
        } else if (
          mutations.length !== 1 || root?.table !== catalog.collection.table.name ||
          !["patch", "replace"].includes(root.operation) || root.before?.id !== intent.targetKey ||
          root.after?.id !== intent.targetKey || root.after.deleted_at !== null ||
          !matchesCollectionUpdateRow(root.before, root.after, returned, suppliedMembership) ||
          emitted.length !== 1 || event?.name !== catalog.collection.updatedEvent ||
          event.metadata.object !== catalog.collection.eventObject ||
          event.metadata.action !== CommonEvents.UPDATED || event.data.id !== intent.targetKey)
          return yield* Effect.fail(mismatch());
        else return;
      }
      const updateId = operation === "update" && isJsonObject(write.input) && typeof write.input.id === "string"
        ? write.input.id : undefined;
      if (operation === "update" && (updateId === undefined || !isJsonObject(write.result) || write.result.id !== updateId))
        return yield* Effect.fail(mismatch());
      const requested = operation === "update" ? [write.input] : Array.isArray(write.input) ? write.input : [write.input];
      const createdRequests = operation === "create" ? requested : operation === "upsert"
        ? requested.filter(item => isJsonObject(item) && typeof item.id !== "string") : [];
      const createdCount = createdRequests.length;
      const updatedIds = operation === "upsert" ? new Set(requested.flatMap(item =>
        isJsonObject(item) && typeof item.id === "string" ? [item.id] : [])) : new Set<string>();
      const returnsRoots = operation !== "update";
      const resultRows = returnsRoots
        ? Array.isArray(write.result) ? write.result : [write.result] : [];
      const returnedIds = new Set<string>();
      if (returnsRoots) {
        if (resultRows.length !== requested.length) return yield* Effect.fail(mismatch());
        for (const row of resultRows) {
          if (!isJsonObject(row) || typeof row.id !== "string" || row.id.length === 0 || returnedIds.has(row.id))
            return yield* Effect.fail(mismatch());
          returnedIds.add(row.id);
        }
        if (operation === "create") {
          for (const [index, item] of requested.entries()) {
            const returned = resultRows[index];
            if (!isJsonObject(item) || typeof item.id === "string" && (!isJsonObject(returned) || returned.id !== item.id))
              return yield* Effect.fail(mismatch());
          }
        } else {
          if (resultRows.slice(createdCount).length !== updatedIds.size ||
            resultRows.slice(createdCount).some(row => !isJsonObject(row) || typeof row.id !== "string" || !updatedIds.has(row.id)))
            return yield* Effect.fail(mismatch());
        }
      }
      const memberships = new Map<string, ReadonlySet<string>>();
      let createdOrdinal = 0;
      for (const [index, item] of requested.entries()) {
        if (!isJsonObject(item)) return yield* Effect.fail(mismatch());
        const generatedOrdinal = typeof item.id === "string" ? undefined : createdOrdinal++;
        const row = operation === "update" ? item.data : item;
        if (row === undefined || !isJsonObject(row) || !Object.hasOwn(row, "product_ids")) continue;
        const ids = row.product_ids;
        const result = operation === "upsert" ? resultRows[generatedOrdinal ?? -1] : resultRows[index];
        const rootId = typeof item.id === "string" ? item.id : isJsonObject(result) ? result.id : undefined;
        if (typeof rootId !== "string" || !Array.isArray(ids) ||
          ids.some(id => typeof id !== "string") || memberships.has(rootId))
          return yield* Effect.fail(mismatch());
        memberships.set(rootId, new Set(ids));
      }
      const expected = new Set<string>();
      const roots = new Set<string>();
      const createdRoots: string[] = [];
      const createdRootRows = new Map<string, JsonObject>();
      const updatedRoots: string[] = [];
      const attachedByRoot = new Map<string, Map<string, JsonObject>>();
      const returnedMembers = new Map<string, readonly Json[]>();
      for (const mutation of mutations) {
        const { before, after } = mutation;
        const created = mutation.operation === "insert" && before === null && after?.deleted_at === null;
        const updated = (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.deleted_at === null && after?.deleted_at === null && before.id === after.id;
        if (!(created || updated) || typeof after?.id !== "string") return yield* Effect.fail(mismatch());
        if (mutation.table === catalog.product.table.name) {
          if (!updated || before === null)
            return yield* Effect.fail(mismatch());
          const allowed = new Set(["collection_id", "updated_at"]);
          const unchanged = Object.keys(before).filter(key => !allowed.has(key));
          if (unchanged.length !== Object.keys(after).filter(key => !allowed.has(key)).length ||
            unchanged.some(key => {
              const left = before[key], right = after[key];
              return left === undefined || right === undefined || !jsonEqual(left, right);
            }))
            return yield* Effect.fail(mismatch());
          const attached = typeof after.collection_id === "string" && memberships.get(after.collection_id)?.has(after.id);
          const detached = typeof before.collection_id === "string" &&
            memberships.has(before.collection_id) && after.collection_id === null &&
            !memberships.get(before.collection_id)?.has(after.id);
          if (!attached && !detached) return yield* Effect.fail(mismatch());
          if (attached && typeof after.collection_id === "string") {
            const members = attachedByRoot.get(after.collection_id) ?? new Map<string, JsonObject>();
            members.set(after.id, after);
            attachedByRoot.set(after.collection_id, members);
          }
          const identity = catalog.product.updatedEvent + ":" + after.id;
          if (expected.has(identity)) return yield* Effect.fail(mismatch());
          expected.add(identity);
          continue;
        }
        if (mutation.table !== catalog.collection.table.name ||
          operation === "create" && !created || operation === "update" && (!updated || after.id !== updateId) || roots.has(after.id))
          return yield* Effect.fail(mismatch());
        if (returnsRoots && !returnedIds.has(after.id)) return yield* Effect.fail(mismatch());
        const returned = operation === "update" ? write.result
          : resultRows.find(row => isJsonObject(row) && row.id === after.id);
        if (returned === undefined || !isJsonObject(returned)) return yield* Effect.fail(mismatch());
        if (created) {
          // Native create uses upsertWithReplace(..., { relations: ["products"] });
          // updated roots instead return their normalized requested ID stubs.
          const { products, ...scalars } = returned;
          if (!Array.isArray(products) || !matchesPublicRow(after, scalars)) return yield* Effect.fail(mismatch());
          returnedMembers.set(after.id, products);
        } else {
          const input = operation === "update" && isJsonObject(write.input) ? write.input.data
            : requested.find(row => isJsonObject(row) && row.id === after.id);
          if (before === null || !matchesCollectionUpdateRow(before, after, returned, input)) return yield* Effect.fail(mismatch());
        }
        roots.add(after.id);
        (created ? createdRoots : updatedRoots).push(after.id);
        if (created) createdRootRows.set(after.id, after);
        const identity = (created ? catalog.collection.createdEvent : catalog.collection.updatedEvent) + ":" + after.id;
        if (expected.has(identity)) return yield* Effect.fail(mismatch());
        expected.add(identity);
      }
      for (const root of memberships.keys()) if (!roots.has(root)) return yield* Effect.fail(mismatch());
      if (returnsRoots && roots.size !== returnedIds.size) return yield* Effect.fail(mismatch());
      if (returnsRoots && (createdRoots.length !== createdCount || updatedRoots.length !== updatedIds.size ||
        updatedRoots.some(id => !updatedIds.has(id)))) return yield* Effect.fail(mismatch());
      if (returnsRoots) for (const [index, input] of createdRequests.entries()) {
        const returned = resultRows[index];
        const stored = isJsonObject(returned) && typeof returned.id === "string"
          ? createdRootRows.get(returned.id) : undefined;
        if (!isJsonObject(input) || !isJsonObject(returned) || stored === undefined ||
          returned.id !== stored.id) return yield* Effect.fail(mismatch());
        for (const field of ["title", "handle", "metadata"] as const) {
          if (!Object.hasOwn(input, field)) continue;
          const supplied = input[field], persisted = stored[field];
          if (supplied === undefined || persisted === undefined || !jsonEqual(supplied, persisted))
            return yield* Effect.fail(mismatch());
        }
      }
      for (const root of createdRoots) {
        const selected = memberships.get(root);
        if (selected !== undefined && ((attachedByRoot.get(root)?.size ?? 0) !== selected.size ||
          [...selected].some(id => !attachedByRoot.get(root)?.has(id)))) return yield* Effect.fail(mismatch());
        const returned = returnedMembers.get(root);
        const expectedMembers = new Map(attachedByRoot.get(root));
        if (returned === undefined || returned.length !== expectedMembers.size) return yield* Effect.fail(mismatch());
        for (const member of returned) {
          if (!isJsonObject(member) || typeof member.id !== "string") return yield* Effect.fail(mismatch());
          const stored = expectedMembers.get(member.id);
          if (stored === undefined || !matchesPublicRow(stored, member)) return yield* Effect.fail(mismatch());
          expectedMembers.delete(member.id);
        }
      }
      if (operation === "update" && (updateId === undefined || !roots.has(updateId)))
        return yield* Effect.fail(mismatch());
      for (const event of emitted) {
        const message = yield* capture(event);
        const created = message.name === catalog.collection.createdEvent && message.metadata.action === CommonEvents.CREATED &&
          message.metadata.object === catalog.collection.eventObject;
        const updated = message.name === catalog.collection.updatedEvent && message.metadata.action === CommonEvents.UPDATED &&
          message.metadata.object === catalog.collection.eventObject;
        const product = message.name === catalog.product.updatedEvent && message.metadata.action === CommonEvents.UPDATED &&
          message.metadata.object === catalog.product.eventObject;
        if (!(created || updated || product)) return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
      }
      if (expected.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

/** The event belongs to the deleted native root; Product detachment is a
 * declared core effect rather than an adapter-supplied mutation receipt. */
function productLogicalNullableReferenceDeleteEventPolicy(catalog: ProductRuntimeMetadata,
  target: ProductEntityMetadata, referenceColumn: "type_id" | "collection_id", commandName: string) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalReferenceDelete")(
    function* (call, activity) {
      const { mutations, lifecycle, setNull } = activity;
      if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      const deleted = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === target.table.name && mutation.operation === "delete" &&
          mutation.after === null && typeof mutation.before?.id === "string" &&
          !deleted.has(mutation.before.id)) {
          deleted.add(mutation.before.id);
          continue;
        }
        return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (setNull.length !== deleted.size || new Set(setNull.map(intent => intent.targetKey)).size !== setNull.length ||
        setNull.some(intent => intent.sourceTable !== catalog.product.table.name || intent.sourceColumn !== referenceColumn ||
          intent.targetTable !== target.table.name || intent.targetColumn !== "id" || !deleted.has(intent.targetKey)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.name !== target.deletedEvent || message.metadata.object !== target.eventObject ||
          message.metadata.action !== CommonEvents.DELETED) return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!deleted.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (deleted.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}

/** Direct Image creation carries one stored row and one returned row per
 * request. The module event must identify exactly those inserted rows. */
function productLogicalImageCreateEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const entity = productLogicalEntityEventPolicy(catalog, catalog.image, "productCreateimage", "created");
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalImageCreate")(function* (call, activity) {
    const requests = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productCreateimage" || requests.length === 0 ||
      requests.length !== results.length || activity.mutations.length !== requests.length ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 ||
      requests.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const pending = new Map<string, JsonObject>();
    for (const mutation of activity.mutations) {
      const row = mutation.after, id = row?.id;
      if (mutation.table !== catalog.image.table.name || mutation.operation !== "insert" ||
        mutation.before !== null || typeof id !== "string" || row === null || pending.has(id))
        return yield* Effect.fail(mismatch());
      pending.set(id, row);
    }
    const unmatched = [...requests];
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string") return yield* Effect.fail(mismatch());
      const row = pending.get(result.id);
      if (row === undefined || !matchesPublicRow(row, result)) return yield* Effect.fail(mismatch());
      const index = unmatched.findIndex(request => isJsonObject(request) &&
        Object.entries(request).every(([field, value]) => row[field] !== undefined && jsonEqual(row[field], value)));
      if (index < 0) return yield* Effect.fail(mismatch());
      unmatched.splice(index, 1);
      pending.delete(result.id);
    }
    if (unmatched.length !== 0 || pending.size !== 0) return yield* Effect.fail(mismatch());
    yield* entity.validateLogicalCall(call, activity);
  });
}

/** Native Type writes stay on Product's logical source. Its hard delete may
 * detach nullable Product.type_id references before removing the Type row. */
function productLogicalTypeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "delete") {
  if (operation !== "delete") return productLogicalEntityEventPolicy(catalog, catalog.type,
    operation === "create" ? "productCreatetype" : "productupdatetype",
    operation === "create" ? "created" : "updated");
  return productLogicalNullableReferenceDeleteEventPolicy(catalog, catalog.type, "type_id", "productDeletetype");
}

/** Native Type upsert creates ID-less rows first, then updates selected IDs.
 * Authenticate the complete result and both event families at this one call. */
function productLogicalTypeUpsertEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalTypeUpsert")(function* (call, activity) {
    const requests = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productupserttype" || call.mode !== "write" ||
      requests.length === 0 || requests.length !== results.length ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 ||
      requests.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const changed = new Map<string, typeof activity.mutations[number]>();
    const expected = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after, id = after?.id;
      const created = mutation.operation === "insert" && before === null && after?.deleted_at === null;
      const updated = (mutation.operation === "patch" || mutation.operation === "replace") &&
        before !== null && after !== null && before.id === id &&
        before.deleted_at === null && after.deleted_at === null;
      if (mutation.table !== catalog.type.table.name || typeof id !== "string" ||
        !(created || updated) || changed.has(id)) return yield* Effect.fail(mismatch());
      changed.set(id, mutation);
      expected.add((created ? catalog.type.createdEvent : catalog.type.updatedEvent) + ":" + id);
    }
    if (changed.size !== requests.length) return yield* Effect.fail(mismatch());
    const created = new Map<string, JsonObject>();
    const updated = new Map<string, JsonObject>();
    for (const request of requests) {
      if (!isJsonObject(request) || typeof request.value !== "string") return yield* Effect.fail(mismatch());
      if (typeof request.id === "string") {
        if (updated.has(request.id)) return yield* Effect.fail(mismatch());
        updated.set(request.id, request);
      } else {
        if (created.has(request.value)) return yield* Effect.fail(mismatch());
        created.set(request.value, request);
      }
    }
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string") return yield* Effect.fail(mismatch());
      const mutation = changed.get(result.id);
      const after = mutation?.after;
      if (mutation === undefined || after == null || typeof after.value !== "string" ||
        !matchesPublicRow(after, result))
        return yield* Effect.fail(mismatch());
      const request = mutation.operation === "insert"
        ? created.get(after.value)
        : updated.get(result.id);
      if (request === undefined || request.value !== after.value ||
        (mutation.operation === "insert" ? !created.delete(after.value) : !updated.delete(result.id)))
        return yield* Effect.fail(mismatch());
      changed.delete(result.id);
    }
    if (created.size !== 0 || updated.size !== 0 || changed.size !== 0)
      return yield* Effect.fail(mismatch());
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.object !== catalog.type.eventObject ||
        ![catalog.type.createdEvent, catalog.type.updatedEvent].includes(message.name))
        return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
    }
    if (expected.size !== 0) return yield* Effect.fail(mismatch());
  });
}

/** Native Option commands own their Value graph. Hard deletion emits only the
 * Option root message; create/update/upsert emit each changed entity message. */
function productLogicalOptionEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "upsert" | "delete") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = operation === "create" ? "productCreateoption" : operation === "update" ? "productupdateoption"
    : operation === "upsert" ? "productupsertoption" : "productDeleteoption";
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalOption")(
    function* (call, activity) {
      const { mutations, lifecycle } = activity;
      if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      const options = new Map<string, typeof mutations[number]>();
      const values = new Map<string, typeof mutations[number]>();
      const pivots: Array<typeof mutations[number]> = [];
      const expected = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === catalog.pivot.table.name) {
          if (mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
            return yield* Effect.fail(mismatch());
          pivots.push(mutation);
          continue;
        }
        const entity = mutation.table === catalog.option.table.name ? catalog.option
          : mutation.table === catalog.value.table.name ? catalog.value : undefined;
        if (entity === undefined) return yield* Effect.fail(mismatch());
        const before = mutation.before, after = mutation.after;
        const id = after?.id ?? before?.id;
        if (typeof id !== "string" || (before !== null && before.id !== id) || (after !== null && after.id !== id))
          return yield* Effect.fail(mismatch());
        const group = entity === catalog.option ? options : values;
        if (group.has(id)) return yield* Effect.fail(mismatch());
        group.set(id, mutation);
        if (operation === "delete") {
          if (mutation.operation !== "delete" || before === null || after !== null)
            return yield* Effect.fail(mismatch());
          if (entity === catalog.option) expected.add(`${entity.deletedEvent}:${id}`);
          continue;
        }
        const action = mutation.operation === "insert" && before === null && after?.deleted_at === null ? "created"
          : (mutation.operation === "patch" || mutation.operation === "replace") &&
            before !== null && after?.deleted_at === null ? "updated"
          : mutation.operation === "delete" && entity === catalog.value && before !== null && after === null ? "deleted" : undefined;
        if (action === undefined || (entity === catalog.option &&
          (operation === "create" && action !== "created" || operation === "update" && action !== "updated")))
          return yield* Effect.fail(mismatch());
        expected.add(`${action === "created" ? entity.createdEvent : action === "updated" ? entity.updatedEvent : entity.deletedEvent}:${id}`);
      }
      for (const mutation of values.values()) {
        const beforeParent = mutation.before?.[catalog.foreignKeys.value];
        const afterParent = mutation.after?.[catalog.foreignKeys.value];
        if (mutation.before !== null && (typeof beforeParent !== "string" || !options.has(beforeParent)) ||
          mutation.after !== null && (typeof afterParent !== "string" || !options.has(afterParent)) ||
          mutation.before !== null && mutation.after !== null && beforeParent !== afterParent)
          return yield* Effect.fail(mismatch());
      }
      const pivotKeys = new Set<string>();
      for (const mutation of pivots) {
        const value = mutation.before?.[catalog.pivot.valueColumn];
        const variant = mutation.before?.[catalog.pivot.variantColumn];
        const changedValue = typeof value === "string" ? values.get(value) : undefined;
        const key = JSON.stringify([variant, value]);
        if (typeof variant !== "string" || changedValue?.operation !== "delete" || pivotKeys.has(key))
          return yield* Effect.fail(mismatch());
        pivotKeys.add(key);
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!expected.delete(`${message.name}:${id}`)) return yield* Effect.fail(mismatch());
        }
      }
      if (expected.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

/** The native Product create command owns every inserted entity and its
 * variant/value pivot. No other command or Product table is admitted here. */
function productLogicalCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCreate")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== "productCreate") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const memberships = yield* productMembershipPivots(catalog);
    const membershipRows = new Map(memberships.map(pivot => [pivot.table, [] as JsonObject[]]));
    const expected = new Set<string>();
    const inserted = new Map(entities.map(entity => [entity.table.name, new Map<string, JsonObject>()]));
    const pivots: JsonObject[] = [];
    for (const mutation of mutations) {
      if (mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.table === catalog.pivot.table.name) { pivots.push(mutation.after); continue; }
      const members = membershipRows.get(mutation.table);
      if (members !== undefined) { members.push(mutation.after); continue; }
      const entity = byTable.get(mutation.table);
      const id = mutation.after.id;
      if (entity === undefined || mutation.after.deleted_at !== null || typeof id !== "string" || inserted.get(entity.table.name)?.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      inserted.get(entity.table.name)?.set(id, mutation.after);
      expected.add(entity.createdEvent + ":" + id);
    }
    const products = inserted.get(catalog.product.table.name);
    const options = inserted.get(catalog.option.table.name);
    const values = inserted.get(catalog.value.table.name);
    const variants = inserted.get(catalog.variant.table.name);
    if (products === undefined || products.size === 0 || options === undefined || values === undefined || variants === undefined)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* validateProductMembershipRows(memberships, membershipRows, products);
    for (const [table, foreignKey, parents] of [
      [catalog.option.table.name, catalog.foreignKeys.option, products],
      [catalog.image.table.name, catalog.foreignKeys.image, products],
      [catalog.variant.table.name, catalog.foreignKeys.variant, products],
      [catalog.value.table.name, catalog.foreignKeys.value, options],
    ] as const) for (const row of inserted.get(table)?.values() ?? []) {
      const parent = row[foreignKey];
      if (typeof parent !== "string" || !parents.has(parent)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const pivot of pivots) {
      const variant = pivot[catalog.pivot.variantColumn], value = pivot[catalog.pivot.valueColumn];
      const variantRow = typeof variant === "string" ? variants.get(variant) : undefined;
      const valueRow = typeof value === "string" ? values.get(value) : undefined;
      const optionId = valueRow?.[catalog.foreignKeys.value];
      const optionRow = typeof optionId === "string" ? options.get(optionId) : undefined;
      if (variantRow === undefined || optionRow === undefined ||
        variantRow[catalog.foreignKeys.variant] !== optionRow[catalog.foreignKeys.option])
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.metadata.action !== CommonEvents.CREATED) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** Native standalone Variant creation inserts Variant rows and silent
 * option-value pivots. The service reads Product options before assigning
 * values; bind those observations to each new Variant's Product. */
function productLogicalVariantCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalVariantCreate")(
    function* (call, activity) {
      const { mutations, lifecycle, observedRows } = activity;
      if (call.commandName !== "productCreatevariant") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      if (lifecycle.length !== 0 || mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const variants = new Map<string, JsonObject>();
      const pivots: JsonObject[] = [];
      for (const mutation of mutations) {
        const row = mutation.after;
        if (mutation.operation !== "insert" || mutation.before !== null || row === null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (mutation.table === catalog.variant.table.name) {
          if (typeof row.id !== "string" || typeof row[catalog.foreignKeys.variant] !== "string" ||
            row.deleted_at !== null || variants.has(row.id))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          variants.set(row.id, row);
        } else if (mutation.table === catalog.pivot.table.name) pivots.push(row);
        else return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (variants.size === 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      const options = new Map<string, JsonObject>();
      const values = new Map<string, JsonObject>();
      for (const observation of observedRows) {
        const row = observation.row;
        if (typeof row.id !== "string" || row.deleted_at !== null) continue;
        if (observation.table === catalog.option.table.name) options.set(row.id, row);
        if (observation.table === catalog.value.table.name) values.set(row.id, row);
      }
      const seen = new Set<string>();
      for (const row of pivots) {
        const variantId = row[catalog.pivot.variantColumn];
        const valueId = row[catalog.pivot.valueColumn];
        const variant = typeof variantId === "string" ? variants.get(variantId) : undefined;
        const value = typeof valueId === "string" ? values.get(valueId) : undefined;
        const optionId = value?.[catalog.foreignKeys.value];
        const option = typeof optionId === "string" ? options.get(optionId) : undefined;
        const identity = JSON.stringify([variantId, valueId]);
        if (variant === undefined || value === undefined || option === undefined ||
          option[catalog.foreignKeys.option] !== variant[catalog.foreignKeys.variant] || seen.has(identity))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        seen.add(identity);
      }
      const expected = new Set(variants.keys());
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.name !== catalog.variant.createdEvent || message.metadata.object !== catalog.variant.eventObject ||
          message.metadata.action !== CommonEvents.CREATED)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}

/** Standalone Variant changes own the selected Variant rows and their silent
 * OptionValue pivots. The native event family identifies every changed root. */
function productLogicalVariantChangeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "update" | "upsert"): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = operation === "update" ? "productupdatevariant" : "productupsertvariant";
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalVariantChange")(function* (call, activity) {
    if (call.commandName !== commandName || activity.lifecycle.length !== 0 ||
      activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(mismatch());
    const requested = operation === "update" && isJsonObject(call.input) &&
      typeof call.input.id === "string" && call.input.data !== undefined && isJsonObject(call.input.data)
      ? [{ ...call.input.data, id: call.input.id }]
      : operation === "upsert" ? Array.isArray(call.input) ? call.input : [call.input] : [];
    const results = operation === "upsert" && Array.isArray(call.result) ? call.result : [call.result];
    if (requested.length === 0 || requested.length !== results.length ||
      requested.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const variants = new Map<string, typeof activity.mutations[number]>();
    const pivots: Array<typeof activity.mutations[number]> = [];
    const expected = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.table === catalog.pivot.table.name) {
        const row = mutation.operation === "insert" ? mutation.after : mutation.before;
        if (!["insert", "delete"].includes(mutation.operation) || row === null ||
          (mutation.operation === "insert" ? mutation.before !== null : mutation.after !== null))
          return yield* Effect.fail(mismatch());
        pivots.push(mutation);
        continue;
      }
      const before = mutation.before, after = mutation.after, id = after?.id;
      const created = mutation.operation === "insert" && before === null && after?.deleted_at === null;
      const updated = (mutation.operation === "patch" || mutation.operation === "replace") &&
        before !== null && after !== null && before.id === id && before.deleted_at === null &&
        after.deleted_at === null && before.product_id === after.product_id;
      if (mutation.table !== catalog.variant.table.name || typeof id !== "string" ||
        typeof after?.product_id !== "string" || !(created || updated) ||
        (operation === "update" && !updated) || variants.has(id))
        return yield* Effect.fail(mismatch());
      variants.set(id, mutation);
      expected.add((created ? catalog.variant.createdEvent : catalog.variant.updatedEvent) + ":" + id);
    }
    if (variants.size !== requested.length) return yield* Effect.fail(mismatch());
    const matchesResult = productResultGraphMatcher(catalog, catalog.variant.table.name, activity);
    const returned = new Set<string>();
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string" || returned.has(result.id))
        return yield* Effect.fail(mismatch());
      const mutation = variants.get(result.id);
      if (mutation?.after === null || mutation === undefined ||
        !matchesResult(mutation.after, result)) return yield* Effect.fail(mismatch());
      returned.add(result.id);
    }
    const requestedIds = new Set<string>();
    const matchedNew = new Set<string>();
    for (const request of requested) {
      if (!isJsonObject(request)) return yield* Effect.fail(mismatch());
      if (typeof request.id === "string") {
        const mutation = variants.get(request.id);
        if (mutation === undefined || mutation.operation === "insert" || requestedIds.has(request.id))
          return yield* Effect.fail(mismatch());
        requestedIds.add(request.id);
      } else {
        if (operation !== "upsert") return yield* Effect.fail(mismatch());
        const inserted = [...variants.entries()].find(([id, mutation]) =>
          !matchedNew.has(id) && mutation.operation === "insert" &&
          mutation.after?.title === request.title &&
          (request.product_id === undefined || mutation.after?.product_id === request.product_id));
        if (inserted === undefined) return yield* Effect.fail(mismatch());
        matchedNew.add(inserted[0]);
      }
    }
    if ([...variants.entries()].some(([id, mutation]) =>
      mutation.operation === "insert" ? !matchedNew.has(id) : !requestedIds.has(id)))
      return yield* Effect.fail(mismatch());
    const observations = new Map(activity.observedRows.filter(item => item.table === catalog.value.table.name &&
      typeof item.row.id === "string").map(item => [item.row.id, item.row]));
    const options = new Map(activity.observedRows.filter(item => item.table === catalog.option.table.name &&
      typeof item.row.id === "string").map(item => [item.row.id, item.row]));
    const seen = new Set<string>();
    for (const mutation of pivots) {
      const row = mutation.operation === "insert" ? mutation.after : mutation.before;
      const variantId = row?.[catalog.pivot.variantColumn];
      const valueId = row?.[catalog.pivot.valueColumn];
      const identity = JSON.stringify([variantId, valueId]);
      const variant = typeof variantId === "string" ? variants.get(variantId)?.after : undefined;
      const value = typeof valueId === "string" ? observations.get(valueId) : undefined;
      const optionId = value?.[catalog.foreignKeys.value];
      const option = typeof optionId === "string" ? options.get(optionId) : undefined;
      if (variant === undefined || variant === null || value === undefined || option === undefined ||
        option[catalog.foreignKeys.option] !== variant[catalog.foreignKeys.variant] || seen.has(identity))
        return yield* Effect.fail(mismatch());
      seen.add(identity);
    }
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.object !== catalog.variant.eventObject ||
        ![catalog.variant.createdEvent, catalog.variant.updatedEvent].includes(message.name))
        return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
    }
    if (expected.size !== 0) return yield* Effect.fail(mismatch());
  });
}

/** Direct internal Product service calls change scalar Product roots without
 * public module events. Bind each service result to its charged row attempt. */
function productLogicalInternalProductWriteEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update"): LogicalCallReceiptValidation {
  const mismatch = () => commerceError("receiptMismatch");
  const commandName = "productInternalProduct" + operation;
  return Effect.fn("ProductEvents.validateLogicalInternalProductWrite")(function* (call, activity) {
    const requests = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== commandName || call.mode !== "write" || call.events.length !== 0 ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 || requests.length === 0 ||
      requests.length !== results.length || results.length !== activity.mutations.length ||
      requests.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const changed = new Map<string, JsonObject>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after, id = after?.id;
      const admitted = operation === "create"
        ? mutation.operation === "insert" && before === null && after?.deleted_at === null
        : (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.id === id && before.deleted_at === null && after?.deleted_at === null;
      if (!admitted || mutation.table !== catalog.product.table.name ||
        typeof id !== "string" || after === null || changed.has(id))
        return yield* Effect.fail(mismatch());
      changed.set(id, after);
    }
    const matchesResult = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    // The native internal DAL returns bulk updates in its read order, which
    // need not match the caller's input order (for example batch-10 precedes
    // batch-2). Authenticate an update by its selected identity instead.
    const requestedById = new Map<string, JsonObject>();
    if (operation === "update") {
      for (const request of requests) {
        if (!isJsonObject(request)) return yield* Effect.fail(mismatch());
        const id = request.selector !== undefined && isJsonObject(request.selector)
          ? request.selector.id : request.id;
        if (typeof id !== "string" || requestedById.has(id)) return yield* Effect.fail(mismatch());
        requestedById.set(id, request);
      }
    }
    for (const [index, result] of results.entries()) {
      const request = operation === "update" && isJsonObject(result) && typeof result.id === "string"
        ? requestedById.get(result.id) : requests[index];
      if (!isJsonObject(result) || !isJsonObject(request) || typeof result.id !== "string")
        return yield* Effect.fail(mismatch());
      const stored = changed.get(result.id);
      const selected = operation === "update" && request.selector !== undefined && isJsonObject(request.selector)
        ? request.selector.id : request.id;
      const values = operation === "update" && request.data !== undefined && isJsonObject(request.data)
        ? request.data : request;
      if (stored === undefined || !isJsonObject(values) ||
        typeof selected === "string" && selected !== result.id ||
        !matchesResult(stored, result) ||
        Object.entries(values).some(([field, value]) => field !== "id" &&
          stored[field] !== undefined && !jsonEqual(stored[field], value)))
        return yield* Effect.fail(mismatch());
      changed.delete(result.id);
      if (operation === "update") requestedById.delete(result.id);
    }
    if (changed.size !== 0 || requestedById.size !== 0) return yield* Effect.fail(mismatch());
  });
}

/** The internal DAL has no public event aggregator. Its lifecycle result still
 * owns exactly the requested Product roots and their source-local children. */
function productLogicalInternalProductLifecycleEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "softDelete" | "restore"): LogicalCallReceiptValidation {
  const mismatch = () => commerceError("receiptMismatch");
  const commandName = "productInternalProduct" + operation;
  const entities = [catalog.product, catalog.image, catalog.option, catalog.value, catalog.variant];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  return Effect.fn("ProductEvents.validateLogicalInternalProductLifecycle")(function* (call, activity) {
    const decoded = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const ids = typeof decoded === "string" ? [decoded] : decoded;
    const requested = new Set(ids);
    if (call.commandName !== commandName || call.mode !== "write" || call.events.length !== 0 ||
      activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
      ids.length === 0 || requested.size !== ids.length) return yield* Effect.fail(mismatch());
    const optionOwners = new Map<string, string>();
    for (const observation of activity.observedRows) {
      const id = observation.row.id, owner = observation.row[catalog.foreignKeys.option];
      if (observation.table !== catalog.option.table.name || typeof id !== "string" ||
        typeof owner !== "string") continue;
      optionOwners.set(id, owner);
    }
    for (const mutation of activity.mutations) {
      if (mutation.table !== catalog.option.table.name) continue;
      const row = mutation.after ?? mutation.before;
      const id = row?.id, owner = row?.[catalog.foreignKeys.option];
      if (typeof id === "string" && typeof owner === "string") optionOwners.set(id, owner);
    }
    const roots = new Set<string>(), matched = new Set<number>();
    for (const observation of activity.lifecycle) {
      const entity = byTable.get(observation.table), id = observation.key.id;
      if (entity === undefined || Object.keys(observation.key).length !== 1 ||
        typeof id !== "string" || observation.operation !== operation ||
        (operation === "softDelete" ? typeof observation.afterDeletedAt !== "string"
          : observation.afterDeletedAt !== null)) return yield* Effect.fail(mismatch());
      if (entity === catalog.product) {
        if (!requested.has(id) || roots.has(id)) return yield* Effect.fail(mismatch());
        roots.add(id);
      }
      if (observation.attemptOrdinal === null) {
        if (operation !== "restore" || observation.beforeDeletedAt !== null ||
          observation.afterDeletedAt !== null || entity !== catalog.product)
          return yield* Effect.fail(mismatch());
        continue;
      }
      const mutation = activity.mutations[observation.attemptOrdinal];
      if (mutation === undefined || matched.has(observation.attemptOrdinal) ||
        mutation.table !== observation.table || mutation.operation !== "patch" ||
        mutation.before?.id !== id || mutation.after?.id !== id ||
        mutation.before.deleted_at !== observation.beforeDeletedAt ||
        mutation.after.deleted_at !== observation.afterDeletedAt)
        return yield* Effect.fail(mismatch());
      matched.add(observation.attemptOrdinal);
      if (entity !== catalog.product) {
        const row = mutation.before;
        const optionId = row[catalog.foreignKeys.value];
        const root = entity === catalog.value
          ? typeof optionId === "string" ? optionOwners.get(optionId) : undefined
          : row[entity === catalog.image ? catalog.foreignKeys.image
            : entity === catalog.option ? catalog.foreignKeys.option : catalog.foreignKeys.variant];
        if (typeof root !== "string" || !requested.has(root)) return yield* Effect.fail(mismatch());
      }
    }
    if (roots.size !== requested.size || matched.size !== activity.mutations.length)
      return yield* Effect.fail(mismatch());
  });
}

/** Native Product upsert groups creations before updates. A one-root graph
 * has the same owned mutations as native create/update; a multi-root scalar
 * update authenticates every selected root and returned DTO at this call. */
function productLogicalUpsertEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const created = productLogicalCreateEventPolicy(catalog);
  const updated = productLogicalUpdateEventPolicy(catalog);
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalUpsert")(function* (call, activity) {
    const requested = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productUpsert" || call.mode !== "write" ||
      requested.length === 0 || requested.length !== results.length ||
      requested.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    if (requested.length === 1) {
      const request = requested[0], result = results[0];
      if (!isJsonObject(request) || !isJsonObject(result) || typeof result.id !== "string" ||
        (typeof request.id === "string" && request.id !== result.id))
        return yield* Effect.fail(mismatch());
      return yield* (typeof request.id === "string" ? updated.validateLogicalCall(
        { ...call, commandName: "productUpdate" }, activity)
        : created.validateLogicalCall({ ...call, commandName: "productCreate" }, activity));
    }
    if (activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 ||
      activity.mutations.length !== requested.length) return yield* Effect.fail(mismatch());
    const selected = new Map<string, JsonObject>();
    for (const request of requested) {
      if (!isJsonObject(request) || typeof request.id !== "string" || selected.has(request.id))
        return yield* Effect.fail(mismatch());
      selected.set(request.id, request);
    }
    const changed = new Map<string, JsonObject>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after, id = after?.id;
      if (mutation.table !== catalog.product.table.name ||
        !["patch", "replace"].includes(mutation.operation) || before === null ||
        after === null || typeof id !== "string" || before.id !== id ||
        before.deleted_at !== null || after.deleted_at !== null ||
        !selected.has(id) || changed.has(id)) return yield* Effect.fail(mismatch());
      changed.set(id, after);
    }
    const matchesResult = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string") return yield* Effect.fail(mismatch());
      const stored = changed.get(result.id), request = selected.get(result.id);
      if (stored === undefined || request === undefined ||
        !matchesResult(stored, result) ||
        Object.entries(request).some(([field, value]) => field !== "id" &&
          stored[field] !== undefined && !jsonEqual(stored[field], value)))
        return yield* Effect.fail(mismatch());
      changed.delete(result.id);
    }
    if (changed.size !== 0) return yield* Effect.fail(mismatch());
    const expected = new Set(selected.keys());
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.name !== catalog.product.updatedEvent ||
        message.metadata.object !== catalog.product.eventObject ||
        message.metadata.action !== CommonEvents.UPDATED) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(id)) return yield* Effect.fail(mismatch());
    }
    if (expected.size !== 0) return yield* Effect.fail(mismatch());
  });
}

/** A native Product update owns its root, direct children and declared
 * tag/category memberships. Core authenticates rows and FK targets; this
 * policy binds every transition and silent pivot to the root's native event. */
function productLogicalUpdateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalUpdate")(function* (call, activity) {
      const { mutations, lifecycle, observedRows } = activity;
    if (call.commandName !== "productUpdate") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const memberships = yield* productMembershipPivots(catalog);
    const pivots = new Map(memberships.map(pivot => [pivot.table, pivot]));
    const children = new Map([
      [catalog.image.table.name, { entity: catalog.image, owner: catalog.foreignKeys.image }],
      [catalog.variant.table.name, { entity: catalog.variant, owner: catalog.foreignKeys.variant }],
      [catalog.option.table.name, { entity: catalog.option, owner: catalog.foreignKeys.option }],
    ]);
    let root: string | undefined;
    const seen = new Set<string>();
    const childAttempts: Array<{ mutation: typeof mutations[number]; entity: ProductEntityMetadata; owner: string }> = [];
    const valueAttempts: Array<typeof mutations[number]> = [];
    const variantOptionAttempts: Array<typeof mutations[number]> = [];
    for (const mutation of mutations) {
      if (mutation.table === catalog.product.table.name) {
        const before = mutation.before, after = mutation.after;
        if (root !== undefined || (mutation.operation !== "patch" && mutation.operation !== "replace") ||
          before === null || after === null || typeof before.id !== "string" || before.id !== after.id ||
          before.deleted_at !== null || after.deleted_at !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        root = before.id;
        continue;
      }
      const child = children.get(mutation.table);
      if (child !== undefined) { childAttempts.push({ mutation, ...child }); continue; }
      if (mutation.table === catalog.value.table.name) { valueAttempts.push(mutation); continue; }
      if (mutation.table === catalog.pivot.table.name) { variantOptionAttempts.push(mutation); continue; }
      const pivot = pivots.get(mutation.table);
      const row = mutation.operation === "insert" ? mutation.after : mutation.operation === "delete" ? mutation.before : null;
      const productId = row?.[pivot?.productColumn ?? ""];
      const targetId = row?.[pivot?.targetColumn ?? ""];
      const identity = JSON.stringify([mutation.table, productId, targetId]);
      if (pivot === undefined || row === null ||
        (mutation.operation === "insert" ? mutation.before !== null : mutation.after !== null) ||
        typeof productId !== "string" || typeof targetId !== "string" || seen.has(identity))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      seen.add(identity);
    }
    if (root === undefined || mutations.some(mutation => pivots.has(mutation.table) &&
      (mutation.operation === "insert" ? mutation.after : mutation.before)?.[
        pivots.get(mutation.table)?.productColumn ?? ""] !== root))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set([catalog.product.updatedEvent + ":" + root]);
    const childIds = new Set<string>();
    const finalOptions = new Set<string>(), previousOptions = new Set<string>();
    const finalVariants = new Set<string>(), previousVariants = new Set<string>();
    for (const { mutation, entity, owner } of childAttempts) {
      const before = mutation.before, after = mutation.after;
      const row = mutation.operation === "delete" ? before : after;
      const eventName = mutation.operation === "insert" ? entity.createdEvent
        : mutation.operation === "delete" ? entity.deletedEvent : entity.updatedEvent;
      const valid = mutation.operation === "insert" ? before === null && after !== null && after.deleted_at === null
          : mutation.operation === "delete" ? before !== null && before.deleted_at === null && after === null
          : before !== null && after !== null && before.id === after.id &&
            before[owner] === after[owner] && before.deleted_at === null && after.deleted_at === null;
      if (!valid || row === null || typeof row.id !== "string" || row[owner] !== root ||
        childIds.has(entity.table.name + ":" + row.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      childIds.add(entity.table.name + ":" + row.id);
      if (entity === catalog.option) {
        if (before !== null) previousOptions.add(row.id);
        if (after !== null) finalOptions.add(row.id);
      }
      if (entity === catalog.variant) {
        if (before !== null) previousVariants.add(row.id);
        if (after !== null) finalVariants.add(row.id);
      }
      expected.add(eventName + ":" + row.id);
    }
    for (const observation of observedRows) {
      const row = observation.row;
      if (typeof row.id !== "string" || row.deleted_at !== null) continue;
      if (observation.table === catalog.option.table.name && row[catalog.foreignKeys.option] === root) {
        finalOptions.add(row.id);
        if (!childIds.has(catalog.option.table.name + ":" + row.id)) previousOptions.add(row.id);
      }
      if (observation.table === catalog.variant.table.name && row[catalog.foreignKeys.variant] === root) {
        finalVariants.add(row.id);
        if (!childIds.has(catalog.variant.table.name + ":" + row.id)) previousVariants.add(row.id);
      }
    }
    const finalValues = new Set<string>(), previousValues = new Set<string>();
    for (const mutation of valueAttempts) {
      const before = mutation.before, after = mutation.after;
      const row = mutation.operation === "delete" ? before : after;
      const eventName = mutation.operation === "insert" ? catalog.value.createdEvent
        : mutation.operation === "delete" ? catalog.value.deletedEvent : catalog.value.updatedEvent;
      const valid = mutation.operation === "insert" ? before === null && after !== null && after.deleted_at === null
        : mutation.operation === "delete" ? before !== null && before.deleted_at === null && after === null
          : before !== null && after !== null && before.id === after.id &&
            before[catalog.foreignKeys.value] === after[catalog.foreignKeys.value] &&
            before.deleted_at === null && after.deleted_at === null;
      const beforeOption = before?.[catalog.foreignKeys.value], afterOption = after?.[catalog.foreignKeys.value];
      if (!valid || row === null || typeof row.id !== "string" ||
        (before !== null && (typeof beforeOption !== "string" || !previousOptions.has(beforeOption))) ||
        (after !== null && (typeof afterOption !== "string" || !finalOptions.has(afterOption))) ||
        childIds.has(catalog.value.table.name + ":" + row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      childIds.add(catalog.value.table.name + ":" + row.id);
      if (before !== null) previousValues.add(row.id);
      if (after !== null) finalValues.add(row.id);
      expected.add(eventName + ":" + row.id);
    }
    for (const observation of observedRows) {
      if (observation.table !== catalog.value.table.name) continue;
      const row = observation.row, optionId = row[catalog.foreignKeys.value];
      if (row.deleted_at !== null || typeof row.id !== "string" || typeof optionId !== "string") continue;
      if (finalOptions.has(optionId)) finalValues.add(row.id);
      if (!childIds.has(catalog.value.table.name + ":" + row.id) && previousOptions.has(optionId))
        previousValues.add(row.id);
    }
    for (const mutation of variantOptionAttempts) {
      const row = mutation.operation === "insert" ? mutation.after : mutation.operation === "delete" ? mutation.before : null;
      const variantId = row?.[catalog.pivot.variantColumn], valueId = row?.[catalog.pivot.valueColumn];
      const identity = JSON.stringify([mutation.table, variantId, valueId]);
      const ownedVariants = mutation.operation === "insert" ? finalVariants : previousVariants;
      const ownedValues = mutation.operation === "insert" ? finalValues : previousValues;
      if (row === null || (mutation.operation === "insert" ? mutation.before !== null : mutation.after !== null) ||
        typeof variantId !== "string" || typeof valueId !== "string" ||
        !ownedVariants.has(variantId) || !ownedValues.has(valueId) || seen.has(identity))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      seen.add(identity);
    }
    const allowedEvents = new Map([
      [catalog.product.updatedEvent, { object: catalog.product.eventObject, action: CommonEvents.UPDATED }],
      ...[catalog.image, catalog.variant, catalog.option, catalog.value].flatMap(entity => [
        [entity.createdEvent, { object: entity.eventObject, action: CommonEvents.CREATED }],
        [entity.updatedEvent, { object: entity.eventObject, action: CommonEvents.UPDATED }],
        [entity.deletedEvent, { object: entity.eventObject, action: CommonEvents.DELETED }],
      ] as const),
    ]);
    for (const event of emitted) {
      const message = yield* capture(event);
      const allowed = allowedEvents.get(message.name);
      if (allowed === undefined || message.metadata.object !== allowed.object ||
        message.metadata.action !== allowed.action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** The native image workflow writes silent assignment rows and may separately
 * clear a Variant thumbnail. Match each call to its own charged attempt range. */
function productLogicalVariantImagesEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodePairs = Schema.decodeUnknownEffect(VariantImagePairs, { onExcessProperty: "error" });
  const decodeCreated = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })),
    { onExcessProperty: "error" });
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalVariantImages")(
    function* (call, activity) {
      const { mutations: attempts, lifecycle } = activity;
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
        if (call.commandName === "productCreateassignment") {
          const pairs = yield* decodePairs(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const created = yield* decodeCreated(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (call.events.length !== 0 || pairs.length !== attempts.length || created.length !== attempts.length)
            return yield* Effect.fail(mismatch());
          for (const [index, mutation] of attempts.entries()) {
            const row = mutation?.after, pair = pairs[index], result = created[index];
            if (mutation?.table !== catalog.assignment.table.name || mutation.operation !== "insert" ||
              mutation.before !== null || row === null || pair === undefined || result === undefined ||
              row.id !== result.id || row.variant_id !== pair.variant_id || row.image_id !== pair.image_id)
              return yield* Effect.fail(mismatch());
          }
          return;
        }
        if (call.commandName === "productDeleteassignment") {
          const pairs = yield* decodePairs(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const requested = new Set(pairs.map(pair => JSON.stringify([pair.variant_id, pair.image_id])));
          if (call.events.length !== 0 || call.result !== null || attempts.some(mutation =>
            mutation.table !== catalog.assignment.table.name || mutation.operation !== "delete" ||
            mutation.before === null || mutation.after !== null ||
            !requested.has(JSON.stringify([mutation.before.variant_id, mutation.before.image_id]))))
            return yield* Effect.fail(mismatch());
          return;
        }
        if (call.commandName === "productUpdateVariantsBySelector") {
          const input = yield* Effect.fromResult(decodeVariantThumbnailUpdate(call.input))
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (attempts.length > 1 || attempts.some(mutation =>
            mutation.table !== catalog.variant.table.name ||
            (mutation.operation !== "patch" && mutation.operation !== "replace") ||
            mutation.before === null || mutation.after === null || mutation.before.id !== input.selector.id ||
            mutation.after.id !== input.selector.id || mutation.before.product_id !== mutation.after.product_id ||
            mutation.after.thumbnail !== null)) return yield* Effect.fail(mismatch());
          for (const mutation of attempts) {
            if (mutation.before === null || mutation.after === null) return yield* Effect.fail(mismatch());
            const before = mutation.before, after = mutation.after;
            const unchanged = (key: string) => key !== "thumbnail" && key !== "updated_at";
            const keys = Object.keys(before).filter(unchanged);
            if (keys.length !== Object.keys(after).filter(unchanged).length || keys.some(key => {
              const left = before[key], right = after[key];
              return right === undefined || left === undefined || !jsonEqual(left, right);
            })) return yield* Effect.fail(mismatch());
          }
          const expected = new Set(attempts.map(() => catalog.variant.updatedEvent + ":" + input.selector.id));
          for (const event of call.events) {
            const message = yield* capture(event);
            if (message.name !== catalog.variant.updatedEvent || message.metadata.object !== catalog.variant.eventObject ||
              message.metadata.action !== CommonEvents.UPDATED) return yield* Effect.fail(mismatch());
            for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
              if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
          }
          if (expected.size !== 0) return yield* Effect.fail(mismatch());
          return;
        }
      return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

/** Public native Product lifecycle admits the owned cascade and authenticates
 * an already-active restore without pretending that storage changed a row. */
function productLogicalLifecycleEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "softDelete" | "restore", target: "product" | "variant" = "product") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = target === "variant" ? [catalog.variant]
    : [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
  const commandName = target === "variant" ? "productSoftDeleteVariant"
    : operation === "restore" ? "productRestore" : "productSoftDelete";
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalLifecycle")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
    const requested = target === "variant"
      ? yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : undefined;
    const pending = requested === undefined ? undefined
      : new Set(typeof requested === "string" ? [requested] : requested);
    if (pending !== undefined) {
      const result = call.result;
      const ids = isJsonObject(result) ? result.variant_id : undefined;
      const productIds = isJsonObject(result) ? result.product_variant_id : undefined;
      if (pending.size === 0 || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
        !isJsonObject(result) || Object.keys(result).length !== 2 ||
        !Array.isArray(ids) || !Array.isArray(productIds) || ids.length !== pending.size ||
        ids.some(id => typeof id !== "string" || !pending.has(id)) ||
        productIds.length !== ids.length || productIds.some((id, index) => id !== ids[index]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
      const emitted = call.events;
    const expected = new Set<string>();
    const matchedAttempts = new Set<number>();
    for (const observation of lifecycle) {
      const entity = byTable.get(observation.table);
      const id = observation.key.id;
      if (entity === undefined || observation.operation !== operation || Object.keys(observation.key).length !== 1 ||
        typeof id !== "string" || id.length === 0 ||
        (pending !== undefined && !pending.delete(id)) ||
        (operation === "restore" ? observation.afterDeletedAt !== null : typeof observation.afterDeletedAt !== "string"))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = entity.eventObject + ":" + id;
      if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(identity);
      if (observation.attemptOrdinal === null) {
        if (operation !== "restore" || observation.beforeDeletedAt !== null || observation.afterDeletedAt !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        continue;
      }
      const mutation = mutations[observation.attemptOrdinal];
      if (mutation === undefined || matchedAttempts.has(observation.attemptOrdinal) || mutation.ordinal !== observation.attemptOrdinal ||
        mutation.table !== observation.table || mutation.operation !== "patch" || mutation.before?.id !== id || mutation.after?.id !== id ||
        mutation.before.deleted_at !== observation.beforeDeletedAt || mutation.after.deleted_at !== observation.afterDeletedAt ||
        (operation === "restore" && observation.beforeDeletedAt === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
      matchedAttempts.add(observation.attemptOrdinal);
    }
    if (matchedAttempts.size !== mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (pending?.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (!expected.delete(message.metadata.object + ":" + id) ||
          !entities.some(entity => entity.eventObject === message.metadata.object &&
            (operation === "restore" ? entity.restoredEvent : entity.deletedEvent) === message.name))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** The native public delete emits a Product root message while storage removes
 * its owned graph. Every silent child and pivot must trace to a deleted root. */
function productLogicalDeleteEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalDelete")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== "productDeleteproduct") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const memberships = yield* productMembershipPivots(catalog);
    const membershipRows = new Map(memberships.map(pivot => [pivot.table, [] as JsonObject[]]));
    const removed = new Map(entities.map(entity => [entity.table.name, new Map<string, JsonObject>()]));
    const pivots: JsonObject[] = [];
    for (const mutation of mutations) {
      if (mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.table === catalog.pivot.table.name) { pivots.push(mutation.before); continue; }
      const members = membershipRows.get(mutation.table);
      if (members !== undefined) { members.push(mutation.before); continue; }
      const entity = byTable.get(mutation.table);
      const id = mutation.before.id;
      if (entity === undefined || typeof id !== "string" || removed.get(entity.table.name)?.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      removed.get(entity.table.name)?.set(id, mutation.before);
    }
    const products = removed.get(catalog.product.table.name);
    const options = removed.get(catalog.option.table.name);
    const values = removed.get(catalog.value.table.name);
    const variants = removed.get(catalog.variant.table.name);
    if (products === undefined || options === undefined || values === undefined || variants === undefined)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* validateProductMembershipRows(memberships, membershipRows, products);
    for (const [table, foreignKey, parents] of [
      [catalog.option.table.name, catalog.foreignKeys.option, products],
      [catalog.image.table.name, catalog.foreignKeys.image, products],
      [catalog.variant.table.name, catalog.foreignKeys.variant, products],
      [catalog.value.table.name, catalog.foreignKeys.value, options],
    ] as const) for (const row of removed.get(table)?.values() ?? []) {
      const parent = row[foreignKey];
      if (typeof parent !== "string" || !parents.has(parent)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const pivotKeys = new Set<string>();
    for (const pivot of pivots) {
      const variant = pivot[catalog.pivot.variantColumn], value = pivot[catalog.pivot.valueColumn];
      const variantRow = typeof variant === "string" ? variants.get(variant) : undefined;
      const valueRow = typeof value === "string" ? values.get(value) : undefined;
      const optionId = valueRow?.[catalog.foreignKeys.value];
      const optionRow = typeof optionId === "string" ? options.get(optionId) : undefined;
      const identity = JSON.stringify([variant, value]);
      if (pivotKeys.has(identity) || variantRow === undefined || optionRow === undefined ||
        variantRow[catalog.foreignKeys.variant] !== optionRow[catalog.foreignKeys.option])
        return yield* Effect.fail(commerceError("receiptMismatch"));
      pivotKeys.add(identity);
    }
    const expected = new Set(products.keys());
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.name !== catalog.product.deletedEvent || message.metadata.object !== catalog.product.eventObject ||
        message.metadata.action !== CommonEvents.DELETED) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** Every selected tag method validates at the shared outer-call boundary. */
function tagCallEventPolicy(catalog: ProductRuntimeMetadata) {
  const created = productLogicalEntityEventPolicy(catalog, catalog.tag, "productCreatetag", "created");
  const updated = productLogicalEntityEventPolicy(catalog, catalog.tag, "productUpdateTagsBySelector", "updated");
  const updatedDirect = { ...productLogicalEntityEventPolicy(catalog, catalog.tag, "productupdatetag", "updated"),
    validateLogicalCall: productLogicalDirectEntityUpdateEventPolicy(catalog, catalog.tag, "productupdatetag") };
  const deleted = productLogicalEntityEventPolicy(catalog, catalog.tag, "productSoftDeleteTag", "deleted");
  const upsert: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalTagUpsert")(function* (call, activity) {
    if (call.commandName !== "productupserttag" || !Array.isArray(call.input) ||
      !Array.isArray(call.result) || call.input.length !== call.result.length ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    const mutations = new Map<string, typeof activity.mutations[number]>();
    for (const mutation of activity.mutations) {
      const after = mutation.after, before = mutation.before, id = after?.id;
      const action = mutation.operation === "insert" && before === null && after?.deleted_at === null
        ? CommonEvents.CREATED
        : (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.id === id && before.deleted_at === null && after?.deleted_at === null
          ? CommonEvents.UPDATED : undefined;
      if (mutation.table !== catalog.tag.table.name || typeof id !== "string" ||
        action === undefined || mutations.has(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      mutations.set(id, mutation);
      expected.add((action === CommonEvents.CREATED ? catalog.tag.createdEvent : catalog.tag.updatedEvent) + ":" + id);
    }
    if (mutations.size !== call.result.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const requestedExisting = new Map<string, string>();
    const requestedNew = new Set<string>();
    for (const input of call.input) {
      if (!isJsonObject(input) || typeof input.value !== "string")
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (typeof input.id === "string") {
        if (requestedExisting.has(input.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        requestedExisting.set(input.id, input.value);
      } else {
        if (requestedNew.has(input.value)) return yield* Effect.fail(commerceError("receiptMismatch"));
        requestedNew.add(input.value);
      }
    }
    const returned = new Set<string>();
    for (const result of call.result) {
      if (!isJsonObject(result) || typeof result.id !== "string" ||
        typeof result.value !== "string" || returned.has(result.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const mutation = mutations.get(result.id);
      if (mutation?.after?.value !== result.value || !matchesPublicRow(mutation.after, result) ||
        (mutation.operation === "insert" ? !requestedNew.delete(result.value)
          : requestedExisting.get(result.id) !== result.value || !requestedExisting.delete(result.id)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      returned.add(result.id);
    }
    if (requestedExisting.size !== 0 || requestedNew.size !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const event of call.events) {
      const message = yield* created.capture(event);
      if (message.metadata.object !== catalog.tag.eventObject) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalTagCall")(
    function* (call, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      if (setNull.length !== 0 || referenceReplacements.length !== 0)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") return;
      const policy = call.commandName === "productCreatetag" ? created
        : call.commandName === "productupdatetag" ? updatedDirect
        : call.commandName === "productupserttag" ? { validateLogicalCall: upsert }
        : call.commandName === "productUpdateTagsBySelector" ? updated
        : call.commandName === "productSoftDeleteTag" ? deleted : undefined;
      if (policy === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const lifecycleAttempts = new Set<number>();
      for (const observation of lifecycle) {
        const mutation = observation.attemptOrdinal === null ? undefined : mutations[observation.attemptOrdinal];
        if (mutation === undefined || observation.table !== catalog.tag.table.name ||
          observation.operation !== "softDelete" || observation.key.id !== mutation.after?.id ||
          observation.beforeDeletedAt !== null || observation.afterDeletedAt !== mutation.after?.deleted_at ||
          lifecycleAttempts.has(mutation.ordinal))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        lifecycleAttempts.add(mutation.ordinal);
      }
      if (call.commandName === "productSoftDeleteTag" ? lifecycle.length !== mutations.length : lifecycle.length !== 0)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* policy.validateLogicalCall(call, activity);
    });
  return { capture: created.capture, validateLogicalCall };
}

/** Hard Tag deletion also removes its Product membership pivots. The native
 * event names only the deleted Tags; core owns the FK and pivot settlement. */
function productLogicalTagHardDeleteEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  return Effect.fn("ProductEvents.validateLogicalTagHardDelete")(function* (call, activity) {
    if (call.commandName !== "productDeletetag" || call.mode !== "write" || call.result !== null ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const decoded = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(typeof decoded === "string" ? [decoded] : decoded);
    if (requested.size !== (typeof decoded === "string" ? 1 : decoded.length))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const tagPivot = (yield* productMembershipPivots(catalog))[0];
    if (tagPivot === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const deleted = new Set<string>();
    const memberships = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.table === catalog.tag.table.name) {
        const id = mutation.before.id;
        if (typeof id !== "string" || !requested.has(id) || deleted.has(id) ||
          mutation.before.deleted_at !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
        deleted.add(id);
      } else if (mutation.table === tagPivot.table) {
        const productId = mutation.before[tagPivot.productColumn];
        const tagId = mutation.before[tagPivot.targetColumn];
        const identity = JSON.stringify([productId, tagId]);
        if (typeof productId !== "string" || typeof tagId !== "string" ||
          !requested.has(tagId) || memberships.has(identity))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        memberships.add(identity);
      } else return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const announced = new Set(deleted);
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.name !== catalog.tag.deletedEvent || message.metadata.object !== catalog.tag.eventObject ||
        message.metadata.action !== CommonEvents.DELETED)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!announced.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (announced.size !== 0 || activity.mutations.some(mutation => {
      if (mutation.table !== tagPivot.table) return false;
      const target = mutation.before?.[tagPivot.targetColumn];
      return typeof target !== "string" || !deleted.has(target);
    }))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
}

/** Existing standalone local delivery profile. */
export function productLocalEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata,
  deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>,
): LocalCommerceEventPolicy {
  const policy = productModuleEventPolicy(descriptor, catalog);
  return { capture: policy.capture, deliver, validate: policy.validate };
}
