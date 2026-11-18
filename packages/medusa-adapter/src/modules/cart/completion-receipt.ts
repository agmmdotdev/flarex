import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { ScalarId } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { moduleEventDecoder } from "../../module/events";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { decodeCartCompletionUpdates, decodeEmptyCartAddressRead, decodeEmptyCartAddresses } from "./completion-input";
import { cartPaymentReadPolicy } from "./payment-receipt";
import type { prepareCartCompletionRepository } from "./completion-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCartCompletionRepository>>;
const eventName = buildModuleResourceEventName({ prefix: Modules.CART, objectName: "cart", action: "updated" });
const capture = moduleEventDecoder(Schema.Struct({ name: Schema.Literal(eventName),
  metadata: Schema.Struct({ source: Schema.Literal(Modules.CART), object: Schema.Literal("cart"), action: Schema.Literal("updated") }),
  data: Schema.Struct({ id: Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isLengthBetween(1, 1))]) }) }), defaultCommerceResources);
const mismatch = () => commerceError("receiptMismatch");

/** Authenticate native completion, scalar preimages and genuine empty Address
 * calls. The shared Cart read receipt remains the sole totals/read owner. */
export function cartCompletionPolicy(prepared: Prepared) {
  const read = cartPaymentReadPolicy(prepared, "completion");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CartCompletion.validateCall")(function* (call, activity) {
    if (call.commandName === "cartListForCheckout" || call.commandName === "cartCountForCheckout" || call.commandName === "cartLineItemsCountForCheckout")
      return yield* read.validateLogicalCall(call, activity);
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    if (call.commandName === "cartAddressesForCheckout" || call.commandName === "cartEmptyAddressesUpdateForCheckout") {
      const updating = call.commandName === "cartEmptyAddressesUpdateForCheckout";
      if (updating) yield* Effect.fromResult(decodeEmptyCartAddresses(call.input));
      const input = updating ? { filters: { id: [] }, config: {} } :
        yield* Effect.fromResult(decodeEmptyCartAddressRead(call.input));
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, input.config ?? {}))
        .pipe(Result.flatMap(prepared.addressQuery)));
      if (call.mode !== (updating ? "write" : "read") || call.events.length || activity.mutations.length || activity.observedRows.length ||
        !jsonEqual(call.result, []) || !jsonEqual(activity.relationalReads, [{ table: prepared.address.table.name,
          query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 0, returned: 0 }]))
        return yield* Effect.fail(mismatch());
      return;
    }
    if (call.commandName !== "cartCompleteForCheckout" || call.mode !== "write" || activity.mutations.length !== 1)
      return yield* Effect.fail(mismatch());
    const [input] = yield* Effect.fromResult(decodeCartCompletionUpdates(call.input)), mutation = activity.mutations[0];
    if (input === undefined || mutation?.operation !== "patch" || mutation.table !== prepared.cart.table.name || mutation.ordinal !== 0 ||
      mutation.before === null || mutation.after === null) return yield* Effect.fail(mismatch());
    const before = yield* Effect.fromResult(prepared.cart.complete(projectNativeRow(mutation.before))),
      after = yield* Effect.fromResult(prepared.cart.complete(projectNativeRow(mutation.after)));
    if (before.id !== input.id || before.deleted_at !== null) return yield* Effect.fail(mismatch());
    for (const [name, value] of Object.entries(input)) if (name !== "completed_at") {
      const original = before[name];
      if (original === undefined || !jsonEqual(original, value)) return yield* Effect.fail(mismatch());
    }
    const { updated_at: _oldTime, ...previous } = before, { updated_at: _newTime, ...current } = after;
    if (!jsonEqual(current, { ...previous, completed_at: input.completed_at })) return yield* Effect.fail(mismatch());
    // Activity observations project the current working row. The authenticated
    // mutation owns its historical preimage; a completed write observes after.
    const [observation] = activity.observedRows;
    if (activity.observedRows.length !== 1 || observation?.table !== prepared.cart.table.name ||
      !jsonEqual(after, projectNativeRow(observation.row)))
      return yield* Effect.fail(mismatch());
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery({ $or: [{ id: input.id }] }, {})).pipe(Result.flatMap(prepared.query)));
    if (!jsonEqual(activity.relationalReads, [{ table: prepared.cart.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 }]) ||
      !jsonEqual(call.result, yield* prepared.present([after], prepared.cart.table.name))) return yield* Effect.fail(mismatch());
    if (call.events.length !== 1) return yield* Effect.fail(mismatch());
    const event = yield* capture(call.events[0]);
    if (!jsonEqual(Array.isArray(event.data.id) ? event.data.id : [event.data.id], [input.id])) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
