import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { scalarLifecycleReceipt } from "../../repository/scalar-lifecycle-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { prepareShippingOptionTypeDeletionRepository } from "./shipping-option-type-delete-repository";
import { decodeShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionRead } from "./shipping-option-type-delete-input";

type Prepared = Result.Result.Success<ReturnType<typeof prepareShippingOptionTypeDeletionRepository>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.FULFILLMENT), object: Schema.Literal("shipping_option_type"),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(4))]) }),
}), defaultCommerceResources);
const decodeOptionCount = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(1)),
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
]), "receiptMismatch");

/** Authenticate the actual paginated Option read/count independently from Type
 * lifecycle. Native module calls and raw inverse deliberately have no guard. */
export function shippingOptionTypeDeletionPolicy(prepared: Prepared) {
  const { contracts } = prepared;
  const capture = Effect.fn("ShippingOptionTypeEvents.captureLifecycle")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: "shipping_option_type", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLifecycle = scalarLifecycleReceipt({ table: contracts.table.name,
    softDeleteCommand: "shippingOptionTypeSoftDeleteForWorkflow", restoreCommand: "shippingOptionTypeRestoreForWorkflow", maximumRoots: 4, activeRestoreUpdates: true,
    decodeIds: decodeShippingOptionTypeDeletionIds, decodeRow: contracts.decodeRow,
    decodeResult: value => contracts.decodeOutput(value).pipe(Result.map(result => ({
      empty: Object.keys(result).length === 0, ids: result.shipping_option_type_id ?? [],
    }))) });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionTypeDelete.validateCall")(function* (call, activity) {
    if (call.commandName === "shippingOptionCountForTypeDeletion") {
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length ||
        activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult(decodeShippingOptionTypeDeletionRead(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const [output, count] = yield* Effect.fromResult(decodeOptionCount(call.result));
      const envelope = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, {
        select: contracts.option.columns.map(column => column.name), relations: [], order: { id: "ASC" }, skip: 0, take: 1,
      })));
      const plan = yield* Effect.fromResult(prepared.optionQuery(envelope))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const rows = new Map<string, Result.Result.Success<ReturnType<typeof contracts.decodeOptionRow>>>();
      for (const observation of activity.observedRows) {
        if (observation.table !== contracts.option.name) return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(contracts.decodeOptionRow(projectNativeRow(observation.row)))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (typeof row.shipping_option_type_id !== "string" || !input.filters.shipping_option_type_id.includes(row.shipping_option_type_id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const prior = rows.get(row.id);
        if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
        rows.set(row.id, row);
      }
      // Indexed dependency candidates may include physical tombstones before
      // the final active-row predicate. Validate all bodies, then count/page
      // only the active native matches, independently of their Type's state.
      const active = [...rows.values()].filter(row => row.deleted_at === null);
      const expected = orderNativeIdRows(active, {}).slice(0, 1).map(row => ({ id: row.id }));
      // Both methods execute the same prepared read. Count returns its actual
      // pre-pagination total; its read receipt still records the one-row page.
      const read = { table: contracts.option.name, query: plan.query, total: count, returned: expected.length };
      const reads = [read, read];
      if (active.length !== count || !jsonEqual(output, expected) || !jsonEqual(activity.relationalReads, reads))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    const { operation, ids: ordered } = yield* validateLifecycle(call, activity);
    const ids = yield* Effect.fromResult(decodeShippingOptionTypeDeletionIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const historical = new Set(activity.observedRows.map(observation => observation.row.id));
    const reads = ids.length === 0 ? [] : [{ table: contracts.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids }),
      total: historical.size, returned: historical.size }];
    if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== ordered[emitted++]) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (emitted !== ordered.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall, allowActiveRestoreUpdate: true as const };
}
