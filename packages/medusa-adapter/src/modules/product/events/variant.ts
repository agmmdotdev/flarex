import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { VariantImagePairs, decodeVariantThumbnailUpdate, decodeVariantSelectorUpdate } from "../variant-workflow-input";
import { productModuleEventCapture, EventId } from "./capture";
import { productResultGraphMatcher } from "./result";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";

/** Native standalone Variant creation inserts Variant rows and silent
 * option-value pivots. The service reads Product options before assigning
 * values; bind those observations to each new Variant's Product. */
export function productLogicalVariantCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodeEmpty = Schema.decodeUnknownEffect(Schema.Array(Schema.Never));
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
      if (variants.size === 0) {
        yield* decodeEmpty(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        yield* decodeEmpty(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        // Native creation still performs option/variant reads. Logical row
        // observations may include scanned rows even when the selector is [].
        if (mutations.length !== 0 || emitted.length !== 0 ||
          activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        return;
      }
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
export function productLogicalVariantChangeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "update" | "upsert" | "selector"): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = operation === "update" ? "productupdatevariant" : operation === "selector" ? "productUpdateVariantsForWorkflow" : "productupsertvariant";
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalVariantChange")(function* (call, activity) {
    if (call.commandName !== commandName || activity.lifecycle.length !== 0 ||
      activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(mismatch());
    const selection = operation === "selector" ? yield* Effect.fromResult(decodeVariantSelectorUpdate(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : undefined;
    const selectedIds = selection === undefined ? [] : typeof selection.selector.id === "string" ? [selection.selector.id] : selection.selector.id;
    const results = (operation === "upsert" || operation === "selector") && Array.isArray(call.result) ? call.result : [call.result];
    if (selection !== undefined && (results.some(row => !isJsonObject(row) || typeof row.id !== "string" || !selectedIds.includes(row.id))))
      return yield* Effect.fail(mismatch());
    if (selection !== undefined && results.length === 0) {
      if (activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      return;
    }
    const requested = selection !== undefined ? results.map(row => isJsonObject(row) ? { ...selection.update, id: row.id } : row)
      : operation === "update" && isJsonObject(call.input) &&
      typeof call.input.id === "string" && call.input.data !== undefined && isJsonObject(call.input.data)
      ? [{ ...call.input.data, id: call.input.id }]
      : operation === "upsert" ? Array.isArray(call.input) ? call.input : [call.input] : [];
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
        (operation !== "upsert" && !updated) || variants.has(id))
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

/** The native image workflow writes silent assignment rows and may separately
 * clear a Variant thumbnail. Match each call to its own charged attempt range. */
export function productLogicalVariantImagesEventPolicy(catalog: ProductRuntimeMetadata,
  profile: "variantImages" | "imageVariants" = "variantImages") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const decodePairs = Schema.decodeUnknownEffect(VariantImagePairs, { onExcessProperty: "error" });
  const decodeCreated = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })),
    { onExcessProperty: "error" });
  const mismatch = () => commerceError("receiptMismatch");
  const imageVariants = profile === "imageVariants";
  const commandNames = imageVariants ? { create: "productImageWorkflowCreateAssignment", remove: "productImageWorkflowDeleteAssignment",
    update: "productImageWorkflowUpdateVariantsBySelector" } : { create: "productCreateassignment", remove: "productDeleteassignment",
    update: "productUpdateVariantsBySelector" };
  const encoder = new TextEncoder();
  const compareRows = (left: JsonObject, right: JsonObject) =>
    compareBytesLexicographically(encoder.encode(String(left.id)), encoder.encode(String(right.id)));
  type Activity = Parameters<LogicalCallReceiptValidation>[1];
  // The authentic command invokes the complete logical query under its existing
  // binding/readiness proofs. These pending observations bind its selected
  // cohort; the receipt does not independently prove arbitrary database absence.
  const initialRows = (activity: Activity, table: string) => {
    const rows = new Map<string, JsonObject>();
    for (const observation of activity.observedRows)
      if (observation.table === table && typeof observation.row.id === "string") rows.set(observation.row.id, observation.row);
    const touched = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.table !== table) continue;
      const id = mutation.before?.id ?? mutation.after?.id;
      if (typeof id !== "string" || touched.has(id)) continue;
      touched.add(id);
      if (mutation.before === null) rows.delete(id); else rows.set(id, mutation.before);
    }
    return rows;
  };
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalVariantImages")(
    function* (call, activity) {
      const { mutations: attempts, lifecycle } = activity;
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      if (imageVariants && (call.mode !== "write" || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
        attempts.some((mutation, index) => mutation.ordinal !== index))) return yield* Effect.fail(mismatch());
        if (call.commandName === commandNames.create) {
          const pairs = yield* decodePairs(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const created = yield* decodeCreated(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (call.events.length !== 0 || pairs.length !== attempts.length || created.length !== attempts.length)
            return yield* Effect.fail(mismatch());
          if (imageVariants && (pairs.length > 4 || new Set(pairs.map(pair => pair.image_id)).size > 1 ||
            new Set(created.map(row => row.id)).size !== created.length)) return yield* Effect.fail(mismatch());
          for (const [index, mutation] of attempts.entries()) {
            const row = mutation?.after, pair = pairs[index], result = created[index];
            if (mutation?.table !== catalog.assignment.table.name || mutation.operation !== "insert" ||
              mutation.before !== null || row === null || pair === undefined || result === undefined ||
              row.id !== result.id || row.variant_id !== pair.variant_id || row.image_id !== pair.image_id ||
              imageVariants && row.deleted_at !== null)
              return yield* Effect.fail(mismatch());
          }
          return;
        }
        if (call.commandName === commandNames.remove) {
          const pairs = yield* decodePairs(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          const requested = new Set(pairs.map(pair => JSON.stringify([pair.variant_id, pair.image_id])));
          if (call.events.length !== 0 || call.result !== null || attempts.some(mutation =>
            mutation.table !== catalog.assignment.table.name || mutation.operation !== "delete" ||
            mutation.before === null || mutation.after !== null ||
            !requested.has(JSON.stringify([mutation.before.variant_id, mutation.before.image_id]))))
            return yield* Effect.fail(mismatch());
          if (imageVariants) {
            if (pairs.length > 4 || new Set(pairs.map(pair => pair.image_id)).size > 1) return yield* Effect.fail(mismatch());
            // Native full-row assignment reads join both required endpoints
            // through their default active-row filters. Earlier observations
            // of an assignment do not grant visibility to an inactive or
            // absent endpoint at this authentic query boundary.
            const images = initialRows(activity, catalog.image.table.name);
            const variants = initialRows(activity, catalog.variant.table.name);
            const active = (rows: ReadonlyMap<string, JsonObject>, id: JsonObject[string] | undefined) =>
              typeof id === "string" && rows.get(id)?.deleted_at === null;
            const selected = [...initialRows(activity, catalog.assignment.table.name).values()].filter(row => row.deleted_at === null &&
              requested.has(JSON.stringify([row.variant_id, row.image_id])) && active(images, row.image_id) && active(variants, row.variant_id))
              .toSorted(compareRows);
            if (selected.length > 8 || selected.length !== attempts.length) return yield* Effect.fail(mismatch());
            for (const [index, row] of selected.entries()) {
              const mutation = attempts[index];
              if (mutation?.before === null || mutation === undefined || !jsonEqual(mutation.before, row))
                return yield* Effect.fail(mismatch());
            }
          }
          return;
        }
        if (call.commandName === commandNames.update) {
          const input = yield* Effect.fromResult(decodeVariantThumbnailUpdate(call.input))
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (imageVariants) {
            const selector = input.selector;
            const ids = new Set(typeof selector.id === "string" ? [selector.id] : selector.id);
            const selected = [...initialRows(activity, catalog.variant.table.name).values()].filter(row => row.deleted_at === null &&
              ids.has(String(row.id)) && (!("thumbnail" in selector) || row.thumbnail === selector.thumbnail)).toSorted(compareRows);
            const ordered = preservePrimaryKeyOrFilterOrder(selected, buildQuery(selector, { order: { id: "ASC" } }).where,
              ["id"], [["id", "ASC"]]);
            const results = call.result;
            if (ordered.length > 4 || !Array.isArray(results) || results.length !== ordered.length || attempts.length !== ordered.length)
              return yield* Effect.fail(mismatch());
            const matchesResult = productResultGraphMatcher(catalog, catalog.variant.table.name, activity);
            for (const [index, before] of ordered.entries()) {
              const mutation = attempts[index], after = mutation?.after, result = results[index];
              if (mutation === undefined || mutation.table !== catalog.variant.table.name ||
                !["patch", "replace"].includes(mutation.operation) || mutation.before === null || after == null || result === undefined ||
                !jsonEqual(mutation.before, before) || after.id !== before.id || after.thumbnail !== null ||
                !matchesResult(after, result)) return yield* Effect.fail(mismatch());
              const unchanged = (key: string) => key !== "thumbnail" && key !== "updated_at";
              const fields = Object.keys(before).filter(unchanged);
              if (fields.length !== Object.keys(after).filter(unchanged).length || fields.some(field => {
                const left = before[field], right = after[field];
                return left === undefined || right === undefined || !jsonEqual(left, right);
              })) return yield* Effect.fail(mismatch());
            }
            // Native module messages follow the complete normalized selector
            // cohort, including its first-occurrence ID order and scalar shape.
            if (call.events.length !== ordered.length) return yield* Effect.fail(mismatch());
            for (const [index, event] of call.events.entries()) {
              const message = yield* capture(event);
              if (message.name !== catalog.variant.updatedEvent || message.metadata.object !== catalog.variant.eventObject ||
                message.metadata.action !== CommonEvents.UPDATED || typeof message.data.id !== "string" || message.data.id !== ordered[index]?.id)
                return yield* Effect.fail(mismatch());
            }
            return;
          }
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
