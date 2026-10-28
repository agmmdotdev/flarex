import { Effect, Result } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { projectRows } from "../../query/projection";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { decodePaymentRead, decodePaymentDelete } from "./input";
import { decodeAccountHolderCreate } from "./account-input";
import type { preparePaymentSessionRepository } from "./repository";

export function paymentAccountPolicy(prepared: Result.Result.Success<ReturnType<typeof preparePaymentSessionRepository>>) {
  const { contracts, query } = prepared, base = scalarLogicalEventPolicy(Modules.PAYMENT, contracts.holder.name,
    { insert: "paymentAccountHolderCreate", delete: "paymentAccountHolderDelete" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PaymentAccount.validateCall")(function* (call, activity) {
    yield* base.validateLogicalCall(call, activity);
    const mismatch = () => commerceError("receiptMismatch");
    const rows = [];
    for (const observation of activity.observedRows) {
      if (observation.table !== contracts.holder.name) return yield* Effect.fail(mismatch());
      rows.push(yield* Effect.fromResult(contracts.decodeHolder(projectNativeRow(observation.row))));
    }
    if (rows.length > 4 || new Set(rows.map(row => row.id)).size !== rows.length) return yield* Effect.fail(mismatch());
    if (call.commandName === "paymentAccountHolderCount") {
      if (call.mode !== "read" || call.events.length || activity.mutations.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodePaymentRead(call.input)), plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters ?? {}, input.config ?? {}))
        .pipe(Result.flatMap(value => query(contracts.holder, value))));
      const ids = input.filters?.id;
      if (rows.some(row => row.deleted_at !== null || ids !== undefined && !(typeof ids === "string" ? row.id === ids : ids.includes(row.id)))) return yield* Effect.fail(mismatch());
      rows.sort((a, b) => a.id.localeCompare(b.id));
      if (!jsonEqual(activity.relationalReads, [{ table: contracts.holder.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate),
        total: rows.length, returned: rows.length }]) || !jsonEqual(call.result, [yield* Effect.fromResult(projectRows(rows, plan.projection.node)), rows.length])) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    if (call.commandName === "paymentAccountHolderCreate") {
      const input = yield* Effect.fromResult(decodeAccountHolderCreate(call.input));
      if (input.context.account_holder !== undefined) {
        const previous = yield* Effect.fromResult(contracts.decodeHolder(input.context.account_holder));
        if (previous.provider_id !== input.provider_id || activity.mutations.length || rows.length || activity.relationalReads.length || call.events.length || !jsonEqual(call.result, previous))
          return yield* Effect.fail(mismatch());
        return;
      }
      const mutation = activity.mutations[0];
      if (activity.mutations.length !== 1 || mutation?.after === null || mutation?.after === undefined || activity.relationalReads.length || rows.length !== 1) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(contracts.decodeHolder(projectNativeRow(mutation.after)));
      if (row.provider_id !== input.provider_id || row.external_id !== input.context.customer.id || row.email !== (input.context.customer.email ?? null) ||
        !jsonEqual(row.data ?? null, {}) || row.metadata !== null || row.deleted_at !== null || row.created_at !== row.updated_at ||
        !jsonEqual(call.result, row) || !jsonEqual(rows[0] ?? null, row)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.commandName !== "paymentAccountHolderDelete") return yield* Effect.fail(mismatch());
    const id = yield* Effect.fromResult(decodePaymentDelete(call.input)), mutation = activity.mutations[0];
    if (call.result !== null || activity.mutations.length !== 1 || mutation?.before === null || mutation?.before === undefined) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(contracts.decodeHolder(projectNativeRow(mutation.before)));
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery({ id }, { select: ["id", "provider_id", "external_id", "email", "data"] }))
      .pipe(Result.flatMap(value => query(contracts.holder, value))));
    if (row.id !== id || row.provider_id !== "pp_system_default" || row.deleted_at !== null || rows.length !== 0 ||
      !jsonEqual(activity.relationalReads, [{ table: contracts.holder.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 }]))
      return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: base.capture, validateLogicalCall };
}
