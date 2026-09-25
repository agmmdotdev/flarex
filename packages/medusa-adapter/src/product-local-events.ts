import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { captureCommerceInput } from "./commerce-input";
import { captureCategoryProjection, decodeCategoryProjection } from "./product-category-projection";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { VariantImagePairs, decodeVariantThumbnailUpdate } from "./product-variant-workflow-input";
import { ProductRelationshipCategoryListCall, ProductRelationshipCategoryProducts,
  ProductRelationshipCollectionReadCall, ProductRelationshipCollectionReadResult,
  ProductRelationshipCollectionWriteCall, ProductRelationshipCollectionWriteResult,
  ProductRelationshipResultRows, ProductRelationshipUpsertRows } from "./product-relationship-workflow-input";


const EventId = Schema.String.check(Schema.isLengthBetween(1, 256));
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

const logicalSingleWriteEvents = Effect.fn("ProductEvents.singleLogicalWrite")(function* (
  calls: Parameters<LogicalCommerceEventValidation>[0], mutationCount: number, commandName: string,
) {
  let cursor = 0;
  let writes = 0;
  let emitted: readonly Json[] = [];
  for (const call of calls) {
    if (call.fromAttempt !== cursor) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.mode === "read") {
      if (call.toAttempt !== cursor || call.events.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      continue;
    }
    if (++writes !== 1 || call.commandName !== commandName || call.toAttempt !== mutationCount)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    cursor = call.toAttempt;
    emitted = call.events;
  }
  if (writes !== 1 || cursor !== mutationCount) return yield* Effect.fail(commerceError("receiptMismatch"));
  return emitted;
});

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
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalEntity")(function* (calls, mutations, lifecycle) {
    const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, commandName);
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
  return { capture, validateLogical };
}

/** Bind public Category creation to the native tree transition, requested
 * Product memberships and the module messages for every affected Category. */
export function productLogicalCategoryCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const tree = productLogicalInternalCategoryPolicy(catalog, "create");
  const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
  const join = relation?.join;
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCategoryCreate")(
    function* (calls, mutations, lifecycle, observedRows, setNull, referenceReplacements = []) {
      const mismatch = () => commerceError("receiptMismatch");
      const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, "productCreatecategory");
      const write = calls.find(call => call.mode === "write");
      if (write === undefined || lifecycle.length !== 0 || setNull.length !== 0 ||
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
      yield* tree.validateLogical([{ ...write, commandName: "productInternalCategorycreate",
        input: treeInput, result: syntheticResult, events: [], fromAttempt: 0, toAttempt: categories.length }],
      categories, [], observedRows, [], []);
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
  return { capture, validateLogical };
}

/** Public Category update/delete retain the same native tree mutations as the
 * internal service, with public result shapes, module events and delete pivots. */
export function productLogicalCategoryChangeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "update" | "delete") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const tree = productLogicalInternalCategoryPolicy(catalog, operation);
  const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
  const join = relation?.join;
  const commandName = operation === "update" ? "productupdatecategory" : "productDeletecategory";
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCategoryChange")(
    function* (calls, mutations, lifecycle, observedRows, setNull, referenceReplacements = []) {
      const mismatch = () => commerceError("receiptMismatch");
      const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, commandName);
      const write = calls.find(call => call.mode === "write");
      if (write === undefined || lifecycle.length !== 0 || setNull.length !== 0 ||
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
      yield* tree.validateLogical([{ ...write, commandName: "productInternalCategory" + operation,
        input: operation === "update" ? [update] : ids, result: syntheticResult, events: [],
        fromAttempt: 0, toAttempt: categories.length }], categories, [], observedRows, [], []);
      if (operation === "update" && update !== undefined && isJsonObject(write.result)) {
        const final = categories.findLast(mutation => mutation.after?.id === update.id)?.after;
        if (final === undefined || final === null || !isJsonObject(final)) return yield* Effect.fail(mismatch());
        const publicFields = Object.keys(final).filter(key => key !== "_id" && key !== "_creationTime");
        if (Object.keys(write.result).length !== publicFields.length) return yield* Effect.fail(mismatch());
        for (const key of publicFields) if (!Object.hasOwn(write.result, key))
          return yield* Effect.fail(mismatch());
        for (const [key, returned] of Object.entries(write.result)) {
          const stored = final[key];
          if (stored === undefined || !jsonEqual(stored, returned)) return yield* Effect.fail(mismatch());
        }
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
  return { capture, validateLogical };
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
export function productLogicalInternalCategoryPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "delete") {
  const mismatch = () => commerceError("receiptMismatch");
  const ids = Schema.decodeUnknownEffect(Schema.Array(EventId).check(Schema.isLengthBetween(1, 256)),
    { onExcessProperty: "error" });
  const selectedRows = Schema.decodeUnknownEffect(Schema.Array(Schema.StructWithRest(
    Schema.Struct({ id: EventId }), [Schema.Record(Schema.String, Schema.Json)]))
    .check(Schema.isLengthBetween(1, 256)), { onExcessProperty: "error" });
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateInternalCategory")(
    function* (calls, mutations, lifecycle, observedRows, setNull, referenceReplacements = []) {
      if (lifecycle.length !== 0 || setNull.length !== 0 || referenceReplacements.length !== 0 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const currentPaths = new Map<string, string>();
      for (const observation of observedRows) {
        if (observation.table === catalog.category.table.name &&
          typeof observation.row.id === "string" && typeof observation.row.mpath === "string")
          currentPaths.set(observation.row.id, observation.row.mpath);
      }
      const initialized = new Set<string>();
      for (const mutation of mutations) {
        const id = mutation.before?.id ?? mutation.after?.id;
        if (mutation.table !== catalog.category.table.name || typeof id !== "string" || initialized.has(id)) continue;
        initialized.add(id);
        if (typeof mutation.before?.mpath === "string") currentPaths.set(id, mutation.before.mpath);
        else currentPaths.delete(id);
      }
      let cursor = 0;
      for (const call of calls) {
        if (call.fromAttempt !== cursor || call.events.length !== 0) return yield* Effect.fail(mismatch());
        if (call.mode === "read") {
          if (call.toAttempt !== cursor) return yield* Effect.fail(mismatch());
          continue;
        }
        if (call.commandName !== "productInternalCategory" + operation ||
          call.toAttempt > mutations.length) return yield* Effect.fail(mismatch());
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
        const segment = mutations.slice(cursor, call.toAttempt);
        const roots = new Map<string, { before: JsonObject | null; after: JsonObject | null }>();
        for (const mutation of segment) {
          const id = mutation.before?.id ?? mutation.after?.id;
          if (typeof id !== "string" || !selected.has(id)) continue;
          const previous = roots.get(id);
          roots.set(id, { before: previous === undefined ? mutation.before : previous.before, after: mutation.after });
        }
        const pathMoves: Array<{ rootId: string; oldPath: string; newPath: string }> = [];
        const matchesSiblingRank = (before: JsonObject, after: JsonObject, id: string) => {
          const parent = before.parent_category_id, oldRank = before.rank, nextRank = after.rank;
          if (parent !== after.parent_category_id ||
            !(parent === null || typeof parent === "string") ||
            typeof oldRank !== "number" || typeof nextRank !== "number") return false;
          return [...roots].some(([rootId, root]) => {
            if (rootId === id) return false;
            const old = root.before, next = root.after;
            if (old !== null && old.parent_category_id === parent &&
              (next === null || next.parent_category_id !== parent) &&
              typeof old.rank === "number" && oldRank > old.rank && nextRank === oldRank - 1) return true;
            if (next !== null && next.parent_category_id === parent &&
              (old === null || old.parent_category_id !== parent) &&
              typeof next.rank === "number" && oldRank >= next.rank && nextRank === oldRank + 1) return true;
            return old !== null && next !== null && old.parent_category_id === parent &&
              next.parent_category_id === parent && typeof old.rank === "number" &&
              typeof next.rank === "number" && (
                old.rank < next.rank && oldRank > old.rank && oldRank <= next.rank && nextRank === oldRank - 1 ||
                old.rank > next.rank && oldRank >= next.rank && oldRank < old.rank && nextRank === oldRank + 1);
          });
        };
        const matchesDescendantPath = (before: JsonObject, after: JsonObject, id: string) => {
          const oldPath = before.mpath, newPath = after.mpath;
          return before.parent_category_id === after.parent_category_id &&
            typeof oldPath === "string" && typeof newPath === "string" &&
            pathMoves.some(move => move.rootId !== id && oldPath.startsWith(move.oldPath + ".") &&
              newPath === move.newPath + oldPath.slice(move.oldPath.length));
        };
        for (const mutation of segment) {
          const before = mutation.before, after = mutation.after;
          const id = operation === "delete" ? before?.id : after?.id;
          if (mutation.table !== catalog.category.table.name || typeof id !== "string")
            return yield* Effect.fail(mismatch());
          if (typeof before?.mpath === "string" && !currentPaths.has(id))
            currentPaths.set(id, before.mpath);
          const root = selected.has(id);
          if (mutation.operation === "insert") {
            if (operation !== "create" || !root || before !== null || !isJsonObject(after) ||
              after.deleted_at !== null) return yield* Effect.fail(mismatch());
            const selectedRow = createRows[input.indexOf(id)];
            const resultRow = resultRows[input.indexOf(id)];
            const parentPath = typeof after.parent_category_id === "string"
              ? currentPaths.get(after.parent_category_id) : undefined;
            if (selectedRow === undefined || after.name !== selectedRow.name ||
              (selectedRow.handle !== undefined && after.handle !== selectedRow.handle) ||
              after.parent_category_id !== (selectedRow.parent_category_id ?? null) ||
              !(after.parent_category_id === null ? after.mpath === id
                : parentPath !== undefined && after.mpath === parentPath + "." + id) ||
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
            const rankChanged = before.rank === undefined || after.rank === undefined
              ? before.rank !== after.rank : !jsonEqual(before.rank, after.rank);
            const pathChanged = before.mpath === undefined || after.mpath === undefined
              ? before.mpath !== after.mpath : !jsonEqual(before.mpath, after.mpath);
            const parentChanged = before.parent_category_id !== after.parent_category_id;
            if (root) {
              if (rankChanged && requested?.rank === undefined && !parentChanged &&
                !matchesSiblingRank(before, after, id)) return yield* Effect.fail(mismatch());
              if (pathChanged && !parentChanged && !matchesDescendantPath(before, after, id))
                return yield* Effect.fail(mismatch());
              if (parentChanged && !pathChanged) return yield* Effect.fail(mismatch());
              const parentPath = typeof after.parent_category_id === "string"
                ? currentPaths.get(after.parent_category_id) : undefined;
              if (pathChanged && parentChanged &&
                !(after.parent_category_id === null ? after.mpath === id
                  : parentPath !== undefined && after.mpath === parentPath + "." + id))
                return yield* Effect.fail(mismatch());
            } else if (rankChanged === pathChanged ||
              rankChanged && !matchesSiblingRank(before, after, id) ||
              pathChanged && !matchesDescendantPath(before, after, id))
              return yield* Effect.fail(mismatch());
            if (root && operation === "update") seen.add(id);
          } else return yield* Effect.fail(mismatch());
          if (root && before !== null && after !== null &&
            before.parent_category_id !== after.parent_category_id &&
            typeof before.mpath === "string" && typeof after.mpath === "string")
            pathMoves.push({ rootId: id, oldPath: before.mpath, newPath: after.mpath });
          if (typeof after?.mpath === "string") currentPaths.set(id, after.mpath);
          else currentPaths.delete(id);
        }
        if (operation === "update") {
          for (const requested of updateRows) {
            const final = roots.get(requested.id)?.after;
            if (final === undefined || final === null) return yield* Effect.fail(mismatch());
            const result = resultRows[input.indexOf(requested.id)];
            if (!isJsonObject(result) ||
              (typeof requested.rank === "number" &&
                (typeof result.rank !== "number" || result.rank > requested.rank)) ||
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
        cursor = call.toAttempt;
      }
      if (cursor !== mutations.length) return yield* Effect.fail(mismatch());
    });
  return { validateLogical };
}


/** Native Collection writes may change their own roots and, when product_ids
 * is present, only the requested Product.collection_id memberships. */
function productLogicalCollectionWriteEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "upsert") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = operation === "create" ? "productCreatecollection"
    : operation === "update" ? "productupdatecollection" : "productupsertcollection";
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCollectionWrite")(
    function* (calls, mutations, lifecycle, _observedRows, setNull, referenceReplacements = []) {
      const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, commandName);
      if (lifecycle.length !== 0 || setNull.length !== 0) return yield* Effect.fail(mismatch());
      const write = calls.find(call => call.mode === "write");
      if (write === undefined) return yield* Effect.fail(mismatch());
      if (referenceReplacements.length !== 0) {
        const intent = referenceReplacements[0];
        const supplied = isJsonObject(write.input) && write.input.data !== undefined &&
          isJsonObject(write.input.data)
          ? write.input.data.product_ids : undefined;
        const desired = Array.isArray(supplied) && supplied.every(id => typeof id === "string")
          ? [...new Set(supplied)] : undefined;
        const root = mutations[0];
        const event = emitted[0] === undefined ? undefined : yield* capture(emitted[0]);
        if (operation !== "update" || referenceReplacements.length !== 1 || intent === undefined ||
          intent.sourceTable !== catalog.product.table.name || intent.sourceColumn !== "collection_id" ||
          intent.targetTable !== catalog.collection.table.name || intent.targetColumn !== "id" ||
          !isJsonObject(write.input) || typeof write.input.id !== "string" ||
          intent.targetKey !== write.input.id || desired === undefined ||
          desired.length !== intent.desiredKeys.length ||
          desired.some((id, index) => id !== intent.desiredKeys[index]) ||
          mutations.length !== 1 || root?.table !== catalog.collection.table.name ||
          !["patch", "replace"].includes(root.operation) || root.before?.id !== intent.targetKey ||
          root.after?.id !== intent.targetKey || root.after.deleted_at !== null ||
          !isJsonObject(write.result) || write.result.id !== intent.targetKey ||
          emitted.length !== 1 || event?.name !== catalog.collection.updatedEvent ||
          event.metadata.object !== catalog.collection.eventObject ||
          event.metadata.action !== CommonEvents.UPDATED || event.data.id !== intent.targetKey)
          return yield* Effect.fail(mismatch());
        return;
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
      const generatedMembership = operation !== "update" && requested.some(item =>
        isJsonObject(item) && typeof item.id !== "string" && Object.hasOwn(item, "product_ids"));
      const resultRows = generatedMembership
        ? Array.isArray(write.result) ? write.result : [write.result] : [];
      const returnedIds = new Set<string>();
      if (generatedMembership) {
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
      const attachedByRoot = new Map<string, Set<string>>();
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
            const members = attachedByRoot.get(after.collection_id) ?? new Set<string>();
            members.add(after.id);
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
        if (generatedMembership && !returnedIds.has(after.id)) return yield* Effect.fail(mismatch());
        roots.add(after.id);
        (created ? createdRoots : updatedRoots).push(after.id);
        if (created) createdRootRows.set(after.id, after);
        const identity = (created ? catalog.collection.createdEvent : catalog.collection.updatedEvent) + ":" + after.id;
        if (expected.has(identity)) return yield* Effect.fail(mismatch());
        expected.add(identity);
      }
      for (const root of memberships.keys()) if (!roots.has(root)) return yield* Effect.fail(mismatch());
      if (generatedMembership && roots.size !== returnedIds.size) return yield* Effect.fail(mismatch());
      if (generatedMembership && (createdRoots.length !== createdCount || updatedRoots.length !== updatedIds.size ||
        updatedRoots.some(id => !updatedIds.has(id)))) return yield* Effect.fail(mismatch());
      if (generatedMembership) for (const [index, input] of createdRequests.entries()) {
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
  return { capture, validateLogical };
}

export function productLogicalCollectionCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  return productLogicalCollectionWriteEventPolicy(catalog, "create");
}

export function productLogicalCollectionUpdateEventPolicy(catalog: ProductRuntimeMetadata) {
  return productLogicalCollectionWriteEventPolicy(catalog, "update");
}

export function productLogicalCollectionUpsertEventPolicy(catalog: ProductRuntimeMetadata) {
  return productLogicalCollectionWriteEventPolicy(catalog, "upsert");
}

export function productLogicalCollectionDeleteEventPolicy(catalog: ProductRuntimeMetadata) {
  return productLogicalNullableReferenceDeleteEventPolicy(catalog, catalog.collection,
    "collection_id", "productDeletecollection");
}

/** The event belongs to the deleted native root; Product detachment is a
 * declared core effect rather than an adapter-supplied mutation receipt. */
function productLogicalNullableReferenceDeleteEventPolicy(catalog: ProductRuntimeMetadata,
  target: ProductEntityMetadata, referenceColumn: "type_id" | "collection_id", commandName: string) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalReferenceDelete")(
    function* (calls, mutations, lifecycle, _observedRows, setNull) {
      const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, commandName);
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
  return { capture, validateLogical };
}

/** Native Type writes stay on Product's logical source. Its hard delete may
 * detach nullable Product.type_id references before removing the Type row. */
export function productLogicalTypeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "delete") {
  if (operation !== "delete") return productLogicalEntityEventPolicy(catalog, catalog.type,
    operation === "create" ? "productCreatetype" : "productupdatetype",
    operation === "create" ? "created" : "updated");
  return productLogicalNullableReferenceDeleteEventPolicy(catalog, catalog.type, "type_id", "productDeletetype");
}

/** Native Option commands own their Value graph. Hard deletion emits only the
 * Option root message; create/update/upsert emit each changed entity message. */
export function productLogicalOptionEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "upsert" | "delete") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = operation === "create" ? "productCreateoption" : operation === "update" ? "productupdateoption"
    : operation === "upsert" ? "productupsertoption" : "productDeleteoption";
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalOption")(
    function* (calls, mutations, lifecycle) {
      const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, commandName);
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
  return { capture, validateLogical };
}

/** Native Collection assignment owns one Collection update and the Product
 * foreign-key changes implied by its final requested membership. */
export function productLogicalCollectionMembershipEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodeInput = Schema.decodeUnknownEffect(ProductRelationshipCollectionWriteCall, { onExcessProperty: "error" });
  const decodeResult = Schema.decodeUnknownEffect(ProductRelationshipCollectionWriteResult, { onExcessProperty: "error" });
  const decodeReadInput = Schema.decodeUnknownEffect(ProductRelationshipCollectionReadCall, { onExcessProperty: "error" });
  const decodeReadResult = Schema.decodeUnknownEffect(ProductRelationshipCollectionReadResult, { onExcessProperty: "error" });
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCollectionMembership")(
    function* (calls, mutations, lifecycle, observedRows) {
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      let cursor = 0;
      let writes = 0;
      let prior: { readonly id: string; readonly members: ReadonlySet<string> } | undefined;
      for (const call of calls) {
        if (call.fromAttempt !== cursor || call.toAttempt < cursor || call.toAttempt > mutations.length)
          return yield* Effect.fail(mismatch());
        const attempts = mutations.slice(cursor, call.toAttempt);
        if (attempts.some((mutation, index) => mutation.ordinal !== cursor + index))
          return yield* Effect.fail(mismatch());
        cursor = call.toAttempt;
        if (call.mode === "read") {
          if (attempts.length !== 0 || call.events.length !== 0) return yield* Effect.fail(mismatch());
          if (call.commandName === "productCollectionretrieve") {
            if (prior !== undefined || writes !== 0) return yield* Effect.fail(mismatch());
            const input = yield* decodeReadInput(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
            const result = yield* decodeReadResult(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
            const ids = result.products.map(row => row.id);
            if (result.id !== input.id || new Set(ids).size !== ids.length) return yield* Effect.fail(mismatch());
            prior = { id: input.id, members: new Set(ids) };
          }
          continue;
        }
        if (++writes !== 1 || call.commandName !== "productupdatecollection" || prior === undefined)
          return yield* Effect.fail(mismatch());
        const input = yield* decodeInput(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const result = yield* decodeResult(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (result.id !== input.id || input.id !== prior.id) return yield* Effect.fail(mismatch());
        const selected = new Set(input.data.product_ids);
        const expected = new Set<string>();
        let collectionUpdates = 0;
        for (const mutation of attempts) {
          const before = mutation.before, after = mutation.after;
          if ((mutation.operation !== "patch" && mutation.operation !== "replace") || before === null || after === null ||
            before.id !== after.id || typeof after.id !== "string" ||
            before.deleted_at !== null || after.deleted_at !== null) return yield* Effect.fail(mismatch());
          const collection = mutation.table === catalog.collection.table.name;
          const product = mutation.table === catalog.product.table.name;
          if (!collection && !product) return yield* Effect.fail(mismatch());
          if (collection && (++collectionUpdates !== 1 || after.id !== input.id)) return yield* Effect.fail(mismatch());
          if (product && !(after.collection_id === input.id && selected.has(after.id) ||
            before.collection_id === input.id && after.collection_id === null && !selected.has(after.id)))
            return yield* Effect.fail(mismatch());
          const allowed = product ? new Set(["collection_id", "updated_at"]) : new Set(["updated_at"]);
          const unchanged = (key: string) => !allowed.has(key);
          const keys = Object.keys(before).filter(unchanged);
          if (keys.length !== Object.keys(after).filter(unchanged).length || keys.some(key => {
            const left = before[key], right = after[key];
            return right === undefined || left === undefined || !jsonEqual(left, right);
          })) return yield* Effect.fail(mismatch());
          const entity = collection ? catalog.collection : catalog.product;
          const identity = entity.updatedEvent + ":" + after.id;
          if (expected.has(identity)) return yield* Effect.fail(mismatch());
          expected.add(identity);
        }
        if (collectionUpdates !== 1) return yield* Effect.fail(mismatch());
        const changedProducts = new Set(attempts.filter(mutation => mutation.table === catalog.product.table.name)
          .map(mutation => mutation.after?.id));
        for (const id of prior.members) if (!selected.has(id) && !changedProducts.has(id))
          return yield* Effect.fail(mismatch());
        const finalProducts = new Set<string>();
        for (const observation of observedRows) {
          if (observation.table !== catalog.product.table.name) continue;
          const row = observation.row;
          if (typeof row.id !== "string" || row.deleted_at !== null) continue;
          if (row.collection_id === input.id) finalProducts.add(row.id);
          if (selected.has(row.id) && !changedProducts.has(row.id)) return yield* Effect.fail(mismatch());
        }
        if (finalProducts.size !== [...selected].filter(id => changedProducts.has(id)).length ||
          [...finalProducts].some(id => !selected.has(id))) return yield* Effect.fail(mismatch());
        for (const event of call.events) {
          const message = yield* capture(event);
          if (message.metadata.action !== CommonEvents.UPDATED ||
            ![catalog.collection.updatedEvent, catalog.product.updatedEvent].includes(message.name))
            return yield* Effect.fail(mismatch());
          const entity = message.name === catalog.collection.updatedEvent ? catalog.collection : catalog.product;
          if (message.metadata.object !== entity.eventObject) return yield* Effect.fail(mismatch());
          for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
            if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
        }
        if (expected.size !== 0) return yield* Effect.fail(mismatch());
      }
      if (cursor !== mutations.length || (prior === undefined ? writes !== 0 : writes !== 1))
        return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogical };
}

/** The pinned Category child upserts selected Products with final category IDs.
 * A Product event owns its timestamp update; category pivot rows are silent. */
export function productLogicalCategoryMembershipEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodeInput = Schema.decodeUnknownEffect(ProductRelationshipUpsertRows, { onExcessProperty: "error" });
  const decodeResult = Schema.decodeUnknownEffect(ProductRelationshipResultRows, { onExcessProperty: "error" });
  const decodeListInput = Schema.decodeUnknownEffect(ProductRelationshipCategoryListCall, { onExcessProperty: "error" });
  const decodeListResult = Schema.decodeUnknownEffect(ProductRelationshipCategoryProducts, { onExcessProperty: "error" });
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCategoryMembership")(
    function* (calls, mutations, lifecycle, observedRows) {
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      const pivot = (yield* productMembershipPivots(catalog))[1];
      if (pivot === undefined) return yield* Effect.fail(mismatch());
      let cursor = 0;
      let writes = 0;
      let prior: Map<string, Set<string>> | undefined;
      for (const call of calls) {
        if (call.fromAttempt !== cursor || call.toAttempt < cursor || call.toAttempt > mutations.length)
          return yield* Effect.fail(mismatch());
        const attempts = mutations.slice(cursor, call.toAttempt);
        if (attempts.some((mutation, index) => mutation.ordinal !== cursor + index))
          return yield* Effect.fail(mismatch());
        cursor = call.toAttempt;
        if (call.mode === "read") {
          if (attempts.length !== 0 || call.events.length !== 0) return yield* Effect.fail(mismatch());
          if (call.commandName === "productlist") {
            if (prior !== undefined || writes !== 0) return yield* Effect.fail(mismatch());
            const input = yield* decodeListInput(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
            const result = yield* decodeListResult(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
            const requested = new Set(input.filters.id);
            prior = new Map();
            for (const row of result) {
              if (!requested.has(row.id) || prior.has(row.id)) return yield* Effect.fail(mismatch());
              const categories = row.categories.map(category => category.id);
              if (new Set(categories).size !== categories.length) return yield* Effect.fail(mismatch());
              prior.set(row.id, new Set(categories));
            }
          }
          continue;
        }
        if (++writes !== 1 || call.commandName !== "productUpsert" || prior === undefined)
          return yield* Effect.fail(mismatch());
        const input = yield* decodeInput(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const result = yield* decodeResult(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const selected = new Map(input.map(row => [row.id, new Set(row.category_ids)]));
        if (selected.size !== input.length || result.length !== input.length ||
          new Set(result.map(row => row.id)).size !== result.length ||
          result.some(row => !selected.has(row.id)) || selected.size !== prior.size)
          return yield* Effect.fail(mismatch());
        const expected = new Set<string>();
        const expectedPivots = new Set<string>();
        for (const [id, final] of selected) {
          const before = prior.get(id);
          if (before === undefined) return yield* Effect.fail(mismatch());
          for (const categoryId of before) if (!final.has(categoryId))
            expectedPivots.add(JSON.stringify(["delete", id, categoryId]));
          for (const categoryId of final) if (!before.has(categoryId))
            expectedPivots.add(JSON.stringify(["insert", id, categoryId]));
        }
        for (const mutation of attempts) {
          const before = mutation.before, after = mutation.after;
          if (mutation.table === catalog.product.table.name) {
            if ((mutation.operation !== "patch" && mutation.operation !== "replace") ||
              before === null || after === null || before.id !== after.id ||
              typeof after.id !== "string" || !selected.has(after.id) ||
              before.deleted_at !== null || after.deleted_at !== null || expected.has(after.id))
              return yield* Effect.fail(mismatch());
            const keys = Object.keys(before).filter(key => key !== "updated_at");
            if (keys.length !== Object.keys(after).filter(key => key !== "updated_at").length ||
              keys.some(key => before[key] === undefined || after[key] === undefined || !jsonEqual(before[key], after[key])))
              return yield* Effect.fail(mismatch());
            expected.add(after.id);
            continue;
          }
          const row = mutation.operation === "insert" ? after : mutation.operation === "delete" ? before : null;
          const productId = row?.[pivot.productColumn], categoryId = row?.[pivot.targetColumn];
          const final = typeof productId === "string" ? selected.get(productId) : undefined;
          if (mutation.table !== pivot.table || row === null ||
            (mutation.operation === "insert" ? before !== null : after !== null) ||
            typeof categoryId !== "string" || final === undefined ||
            (mutation.operation === "insert" ? !final.has(categoryId) : final.has(categoryId)))
            return yield* Effect.fail(mismatch());
          if (!expectedPivots.delete(JSON.stringify([mutation.operation, productId, categoryId])))
            return yield* Effect.fail(mismatch());
        }
        for (const mutation of attempts) {
          if (mutation.table === pivot.table) {
            const row = mutation.operation === "insert" ? mutation.after : mutation.before;
            const productId = row?.[pivot.productColumn];
            if (typeof productId !== "string" || !expected.has(productId))
              return yield* Effect.fail(mismatch());
          }
        }
        for (const event of call.events) {
          const message = yield* capture(event);
          if (message.name !== catalog.product.updatedEvent || message.metadata.object !== catalog.product.eventObject ||
            message.metadata.action !== CommonEvents.UPDATED) return yield* Effect.fail(mismatch());
          for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
            if (!expected.delete(id)) return yield* Effect.fail(mismatch());
        }
        if (expected.size !== 0 || expectedPivots.size !== 0 ||
          attempts.filter(mutation => mutation.table === catalog.product.table.name).length !== selected.size)
          return yield* Effect.fail(mismatch());
        const final = new Map([...selected.keys()].map(id => [id, new Set<string>()]));
        for (const observation of observedRows) {
          if (observation.table !== pivot.table) continue;
          const productId = observation.row[pivot.productColumn];
          const categoryId = observation.row[pivot.targetColumn];
          const categories = typeof productId === "string" ? final.get(productId) : undefined;
          if (categories === undefined) continue;
          if (typeof categoryId !== "string" || categories.has(categoryId)) return yield* Effect.fail(mismatch());
          categories.add(categoryId);
        }
        for (const [id, categories] of final) {
          const requested = selected.get(id);
          if (requested === undefined || categories.size !== requested.size ||
            [...categories].some(categoryId => !requested.has(categoryId))) return yield* Effect.fail(mismatch());
        }
      }
      if (cursor !== mutations.length || (prior === undefined ? writes !== 0 : writes !== 1))
        return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogical };
}

/** The native composed root executes Collection before Category. Rebase only
 * trusted attempt ordinals; each child still validates its exact call range. */
export function productLogicalRelationshipsEventPolicy(catalog: ProductRuntimeMetadata) {
  const collection = productLogicalCollectionMembershipEventPolicy(catalog);
  const category = productLogicalCategoryMembershipEventPolicy(catalog);
  const collectionCommands = new Set(["productCollectionretrieve", "productupdatecollection"]);
  const categoryCommands = new Set(["productlist", "productUpsert"]);
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalRelationships")(
    function* (calls, mutations, lifecycle, observedRows) {
      let categoryStart = calls.length;
      for (const [index, call] of calls.entries()) {
        if (collectionCommands.has(call.commandName)) {
          if (categoryStart !== calls.length) return yield* Effect.fail(commerceError("receiptMismatch"));
        } else if (categoryCommands.has(call.commandName)) {
          if (categoryStart === calls.length) categoryStart = index;
        } else if (call.mode !== "read") return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const boundary = categoryStart === calls.length ? mutations.length : calls[categoryStart]?.fromAttempt;
      if (boundary === undefined || boundary < 0 || boundary > mutations.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* collection.validateLogical(calls.slice(0, categoryStart), mutations.slice(0, boundary), lifecycle, observedRows, []);
      const categoryCalls = calls.slice(categoryStart).map(call => ({ ...call,
        fromAttempt: call.fromAttempt - boundary, toAttempt: call.toAttempt - boundary }));
      const categoryMutations = mutations.slice(boundary).map(mutation => ({ ...mutation,
        ordinal: mutation.ordinal - boundary }));
      yield* category.validateLogical(categoryCalls, categoryMutations, lifecycle, observedRows, []);
    });
  return { capture: collection.capture, validateLogical };
}

/** The native Product create command owns every inserted entity and its
 * variant/value pivot. No other command or Product table is admitted here. */
export function productLogicalCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCreate")(function* (calls, mutations, lifecycle) {
    const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, "productCreate");
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
  return { capture, validateLogical };
}

/** Native standalone Variant creation inserts Variant rows and silent
 * option-value pivots. The service reads Product options before assigning
 * values; bind those observations to each new Variant's Product. */
export function productLogicalVariantCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalVariantCreate")(
    function* (calls, mutations, lifecycle, observedRows) {
      const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, "productCreatevariant");
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
  return { capture, validateLogical };
}

/** A native Product update owns its root, direct children and declared
 * tag/category memberships. Core authenticates rows and FK targets; this
 * policy binds every transition and silent pivot to the root's native event. */
export function productLogicalUpdateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalUpdate")(function* (calls, mutations, lifecycle, observedRows) {
    const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, "productUpdate");
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
  return { capture, validateLogical };
}

/** The native image workflow writes silent assignment rows and may separately
 * clear a Variant thumbnail. Match each call to its own charged attempt range. */
export function productLogicalVariantImagesEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodePairs = Schema.decodeUnknownEffect(VariantImagePairs, { onExcessProperty: "error" });
  const decodeCreated = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })),
    { onExcessProperty: "error" });
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalVariantImages")(
    function* (calls, mutations, lifecycle) {
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      let cursor = 0;
      for (const call of calls) {
        if (call.fromAttempt !== cursor || call.toAttempt < cursor || call.toAttempt > mutations.length)
          return yield* Effect.fail(mismatch());
        const attempts = mutations.slice(cursor, call.toAttempt);
        if (attempts.some((mutation, index) => mutation.ordinal !== cursor + index))
          return yield* Effect.fail(mismatch());
        cursor = call.toAttempt;
        if (call.mode === "read") {
          if (attempts.length !== 0 || call.events.length !== 0) return yield* Effect.fail(mismatch());
          continue;
        }
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
          continue;
        }
        if (call.commandName === "productDeleteassignment") {
          const pairs = yield* decodePairs(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const requested = new Set(pairs.map(pair => JSON.stringify([pair.variant_id, pair.image_id])));
          if (call.events.length !== 0 || call.result !== null || attempts.some(mutation =>
            mutation.table !== catalog.assignment.table.name || mutation.operation !== "delete" ||
            mutation.before === null || mutation.after !== null ||
            !requested.has(JSON.stringify([mutation.before.variant_id, mutation.before.image_id]))))
            return yield* Effect.fail(mismatch());
          continue;
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
          continue;
        }
        return yield* Effect.fail(mismatch());
      }
      if (cursor !== mutations.length) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogical };
}

/** Public native Product lifecycle admits the owned cascade and authenticates
 * an already-active restore without pretending that storage changed a row. */
export function productLogicalLifecycleEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "softDelete" | "restore") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
  const commandName = operation === "restore" ? "productRestore" : "productSoftDelete";
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalLifecycle")(function* (calls, mutations, lifecycle) {
    const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, commandName);
    const expected = new Set<string>();
    const matchedAttempts = new Set<number>();
    for (const observation of lifecycle) {
      const entity = byTable.get(observation.table);
      const id = observation.key.id;
      if (entity === undefined || observation.operation !== operation || Object.keys(observation.key).length !== 1 ||
        typeof id !== "string" || id.length === 0 ||
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
  return { capture, validateLogical };
}

/** The native public delete emits a Product root message while storage removes
 * its owned graph. Every silent child and pivot must trace to a deleted root. */
export function productLogicalDeleteEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalDelete")(function* (calls, mutations, lifecycle) {
    const emitted = yield* logicalSingleWriteEvents(calls, mutations.length, "productDeleteproduct");
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
  return { capture, validateLogical };
}

/** Every selected tag method validates at the shared outer-call boundary. */
export function productLogicalTagEventPolicy(catalog: ProductRuntimeMetadata) {
  const created = productLogicalEntityEventPolicy(catalog, catalog.tag, "productCreatetag", "created");
  const updated = productLogicalEntityEventPolicy(catalog, catalog.tag, "productUpdateTagsBySelector", "updated");
  const deleted = productLogicalEntityEventPolicy(catalog, catalog.tag, "productSoftDeleteTag", "deleted");
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("ProductEvents.validateLogicalTagCall")(
    function* (call, activity) {
      const { mutations, lifecycle, observedRows, setNull, referenceReplacements } = activity;
      if (setNull.length !== 0 || referenceReplacements.length !== 0)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") return;
      const policy = call.commandName === "productCreatetag" ? created
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
      yield* policy.validateLogical([call], mutations, lifecycle, observedRows, setNull);
    });
  return { capture: created.capture, validateLogicalCall };
}

/** Existing standalone local delivery profile. */
export function productLocalEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata,
  deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>,
): LocalCommerceEventPolicy {
  const policy = productModuleEventPolicy(descriptor, catalog);
  return { capture: policy.capture, deliver, validate: policy.validate };
}
