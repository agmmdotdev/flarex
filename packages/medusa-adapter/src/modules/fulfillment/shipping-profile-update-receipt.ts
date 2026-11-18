import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import { isPresent } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { shippingProfileLogicalEventPolicy } from "./shipping-profile-events";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { nativePreimageSelection } from "../../workflow/preimage";
import { projectRows } from "../../query/projection";
import { ShippingProfileUpdateReadInput, decodeShippingProfileUpdateInput, decodeShippingProfileUpdateUpserts } from "./shipping-profile-update-input";
import type { prepareShippingProfileUpdateRepository } from "./shipping-profile-update-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareShippingProfileUpdateRepository>>;
type Row = Result.Result.Success<ReturnType<Prepared["contracts"]["decodeRow"]>>;
const decodeRead = commerceDecoder(ShippingProfileUpdateReadInput, "receiptMismatch");

/** Authentic complete storage observations, exact native scalar projection and
 * update/inverse results, no-op membership and mutation-event order. Native
 * metadata merging remains owned by its promoted primitive. */
export function shippingProfileUpdatePolicy(prepared: Prepared) {
  const { capture } = shippingProfileLogicalEventPolicy();
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingProfileUpdate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const decodeRow = (row: JsonObject) => Effect.fromResult(prepared.contracts.decodeRow(projectNativeRow(row)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const initial = new Map<string, Row>();
    for (const observation of activity.observedRows) {
      if (observation.table !== "shipping_profile") return yield* Effect.fail(mismatch());
      const row = yield* decodeRow(observation.row);
      initial.set(row.id, row);
    }
    const mutated = new Set<string>();
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.table !== "shipping_profile" || mutation.operation !== "patch" ||
        mutation.before === null || mutation.after === null) return yield* Effect.fail(mismatch());
      const before = yield* decodeRow(mutation.before), after = yield* decodeRow(mutation.after);
      if (mutated.has(before.id) || before.id !== after.id || before.deleted_at !== null || after.deleted_at !== null)
        return yield* Effect.fail(mismatch());
      mutated.add(before.id); initial.set(before.id, before);
    }
    if (initial.size > 4) return yield* Effect.fail(mismatch());
    if (call.commandName === "shippingProfileListForUpdate") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeRead(call.input));
      const requested = typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id;
      if ([...initial.keys()].some(id => !requested.includes(id))) return yield* Effect.fail(mismatch());
      const config = nativePreimageSelection(input.config ?? {}, prepared);
      const envelope = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, {
        ...(config.select === undefined ? {} : { select: [...config.select] }),
        ...(config.relations === undefined ? {} : { relations: [...config.relations] }),
      })));
      const plan = yield* Effect.fromResult(prepared.query(envelope)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const where = buildQuery(input.filters).where;
      const expected = yield* Effect.fromResult(projectRows(orderNativeIdRows([...initial.values()].filter(row => row.deleted_at === null), where),
        plan.projection.node)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const output = yield* Effect.fromResult(prepared.contracts.decodePreimages(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(output, expected)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write" || call.commandName !== "shippingProfileUpdateForWorkflow" && call.commandName !== "shippingProfileUpsertForUpdateInverse")
      return yield* Effect.fail(mismatch());
    const active = [...initial.values()].filter(row => row.deleted_at === null);
    const supplied = call.commandName === "shippingProfileUpdateForWorkflow"
      ? yield* Effect.fromResult(decodeShippingProfileUpdateInput(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)), Effect.map(input => ({
          requested: typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id,
          rows: orderNativeIdRows(active, buildQuery(input.selector).where).map(row => ({ id: row.id, ...input.update })),
        })))
      : yield* Effect.fromResult(decodeShippingProfileUpdateUpserts(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)), Effect.map(rows => ({ requested: rows.map(row => row.id), rows })));
    if ([...initial.keys()].some(id => !supplied.requested.includes(id))) return yield* Effect.fail(mismatch());
    const updates = new Map(supplied.rows.map(row => [row.id, row]));
    const order = { $or: supplied.rows.map(row => ({ id: row.id })) };
    const selected = orderNativeIdRows(active, order);
    if (selected.length !== updates.size || selected.some(row => !updates.has(row.id))) return yield* Effect.fail(mismatch());
    const output = yield* Effect.fromResult(prepared.contracts.decodeRows(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const expected: Row[] = [], eventIds: string[] = [];
    let ordinal = 0;
    for (const before of selected) {
      const patch = updates.get(before.id);
      if (patch === undefined) return yield* Effect.fail(mismatch());
      const { id, ...data } = patch;
      if (Object.keys(data).length === 0) { expected.push(before); continue; }
      const mutation = activity.mutations[ordinal++];
      if (mutation?.before === null || mutation?.before === undefined || mutation.after === null ||
        !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Effect.fail(mismatch());
      const after = yield* decodeRow(mutation.after);
      if (typeof after.updated_at !== "string") return yield* Effect.fail(mismatch());
      const wanted: Record<string, Json> = { ...before, ...data, updated_at: after.updated_at };
      if (data.metadata !== undefined && data.metadata !== null && isPresent(data.metadata)) {
        // Native DML permits JSON; the native merge starts by copying enumerable
        // own properties. This detached record keeps the primitive's typed
        // boundary without inventing a separate metadata merge algorithm.
        wanted.metadata = mergeMetadata(Object.fromEntries(Object.entries(before.metadata ?? {})), data.metadata);
      }
      if (!jsonEqual(after, wanted)) return yield* Effect.fail(mismatch());
      expected.push(after); eventIds.push(after.id);
    }
    if (ordinal !== activity.mutations.length || !jsonEqual(output, expected)) return yield* Effect.fail(mismatch());
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== "updated") return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== eventIds[emitted++]) return yield* Effect.fail(mismatch());
    }
    if (emitted !== eventIds.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
