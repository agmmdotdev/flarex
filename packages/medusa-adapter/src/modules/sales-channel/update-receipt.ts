import { Effect } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import { isPresent, Modules } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import { matchesPublicRow } from "../../repository/result";
import { decodeOptionalServiceResult } from "../../module/result";
import { decodeSalesChannelUpdateInput } from "./update-input";

/** Bind the native scalar-first result to the same selected roots and actual
 * mutation evidence. Empty updates use genuine reads, without invented writes. */
export function salesChannelSelectorUpdatePolicy() {
  const scalar = scalarLogicalEventPolicy(Modules.SALES_CHANNEL, "sales_channel", {
    insert: "salesChannelCreate", update: "salesChannelUpdateBySelector", delete: "salesChannelDelete",
  });
  const encoder = new TextEncoder();
  const compareIds = ([left]: readonly [string, JsonObject], [right]: readonly [string, JsonObject]) =>
    compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SalesChannelEvents.validateSelectorUpdate")(function* (call, activity) {
    yield* scalar.validateLogicalCall(call, activity);
    if (call.mode === "read") return;
    const input = yield* Effect.fromResult(decodeSalesChannelUpdateInput(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(decodeOptionalServiceResult(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const preimages = new Map<string, JsonObject>();
    for (const observed of activity.observedRows)
      if (observed.table === "sales_channel" && typeof observed.row.id === "string") preimages.set(observed.row.id, observed.row);
    const mutated = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before;
      if (mutation.table !== "sales_channel" || before === null || typeof before.id !== "string" || mutated.has(before.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      mutated.add(before.id); preimages.set(before.id, before);
    }
    const ids = input.selector.id === undefined ? undefined : new Set(typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id);
    const names = input.selector.name === undefined ? undefined : new Set(typeof input.selector.name === "string" ? [input.selector.name] : input.selector.name);
    const selected = new Map([...preimages].filter(([id, row]) => row.deleted_at === null &&
      (ids === undefined || ids.has(id)) && (names === undefined || typeof row.name === "string" && names.has(row.name)) &&
      (input.selector.is_disabled === undefined || row.is_disabled === input.selector.is_disabled)));
    const emptyUpdate = Object.keys(input.update).length === 0;
    if (selected.size > 4 || activity.mutations.length !== (emptyUpdate ? 0 : selected.size))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const nativeWhere = buildQuery(input.selector, { order: { id: "ASC" } }).where;
    const ordered = preservePrimaryKeyOrFilterOrder([...selected].toSorted(compareIds).map(([, row]) => row),
      nativeWhere, ["id"], [["id", "ASC"]]);
    let first = ordered[0];
    for (const [index, mutation] of activity.mutations.entries()) {
      const before = mutation.before, after = mutation.after;
      if (before === null || after === null || before.id !== ordered[index]?.id || after.id !== before.id)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const [field, value] of Object.entries(before)) {
        if (field === "updated_at") continue;
        let expected = value;
        if ((field === "name" || field === "description" || field === "is_disabled") && input.update[field] !== undefined)
          expected = input.update[field];
        if (field === "metadata" && input.update.metadata !== undefined) {
          const incoming = input.update.metadata;
          if (isPresent(incoming)) {
            if (!isJsonObject(incoming) || value !== null && !isJsonObject(value))
              return yield* Effect.fail(commerceError("receiptMismatch"));
            expected = mergeMetadata(value ?? {}, incoming);
          } else expected = incoming;
        }
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (index === 0) first = after;
    }
    if (first === undefined ? result !== undefined : result === undefined || !matchesPublicRow(first, result))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    let ordinal = 0;
    for (const event of call.events) {
      const message = yield* scalar.capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== ordered[ordinal++]?.id) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (ordinal !== (emptyUpdate ? 0 : ordered.length)) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture: scalar.capture, validateLogicalCall };
}
