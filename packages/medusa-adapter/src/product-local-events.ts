import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { captureCommerceInput } from "./commerce-input";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { VariantImagePairs, decodeVariantThumbnailUpdate } from "./product-variant-workflow-input";


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
    if (action === "created" && lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
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

/** A selected native root Category create, before sibling or path maintenance. */
export function productLogicalCategoryCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  return productLogicalEntityEventPolicy(catalog, catalog.category, "productCreatecategory", "created");
}

/** Selected native Collection root, before its relationship workflow moves. */
export function productLogicalCollectionCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  return productLogicalEntityEventPolicy(catalog, catalog.collection, "productCreatecollection", "created");
}

/** Native Collection assignment owns one Collection update and the Product
 * foreign-key changes implied by its final requested membership. */
export function productLogicalCollectionMembershipEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodeInput = Schema.decodeUnknownEffect(Schema.Struct({ id: EventId,
    data: Schema.Struct({ product_ids: Schema.Array(EventId).check(Schema.isMaxLength(256)) }),
  }), { onExcessProperty: "error" });
  const decodeResult = Schema.decodeUnknownEffect(Schema.StructWithRest(
    Schema.Struct({ id: EventId }), [Schema.Record(Schema.String, Schema.Json)]),
  { onExcessProperty: "error" });
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ProductEvents.validateLogicalCollectionMembership")(
    function* (calls, mutations, lifecycle) {
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      let cursor = 0;
      let writes = 0;
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
        if (++writes !== 1 || call.commandName !== "productupdatecollection") return yield* Effect.fail(mismatch());
        const input = yield* decodeInput(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const result = yield* decodeResult(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (result.id !== input.id) return yield* Effect.fail(mismatch());
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
      if (cursor !== mutations.length) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogical };
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

/** Selected tag create, selector update and soft-delete retain distinct native commands. */
export function productLogicalTagEventPolicy(catalog: ProductRuntimeMetadata,
  action: "created" | "updated" | "deleted") {
  return productLogicalEntityEventPolicy(catalog, catalog.tag,
    action === "created" ? "productCreatetag" : action === "updated" ? "productUpdateTagsBySelector" : "productSoftDeleteTag", action);
}

/** Existing standalone local delivery profile. */
export function productLocalEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata,
  deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>,
): LocalCommerceEventPolicy {
  const policy = productModuleEventPolicy(descriptor, catalog);
  return { capture: policy.capture, deliver, validate: policy.validate };
}
