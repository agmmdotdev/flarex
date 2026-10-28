import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { decodeGraphCount } from "../../local-graph/query";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { decodeStoreCartRead } from "./cart-read-input";
import type { prepareStoreCartReadRepository } from "./cart-read-repository";

const decodeIdentities = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String })), "receiptMismatch");

/** Bind one complete active Store selection to the actual predicate, ordered
 * identities and complete rows. A read-only activity alone proves neither
 * query membership nor the values returned to native Cart steps. */
export function storeCartReadPolicy(prepared: Result.Result.Success<ReturnType<typeof prepareStoreCartReadRepository>>) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StoreCartRead.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const counted = call.commandName === "storeCountForCartContext";
    if (!counted && call.commandName !== "storeListForCartContext" || call.mode !== "read" || call.events.length ||
      activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length || activity.relationalReads.length !== 1)
      return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeStoreCartRead(call.input));
    const { select, relations, ...config } = input.config ?? {};
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters ?? {}, { ...config,
      ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
    })).pipe(Result.flatMap(prepared.query)));
    const observed = new Map<string, JsonObject>();
    for (const observation of activity.observedRows) {
      if (observation.table !== prepared.contracts.table.name) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(prepared.contracts.decodeRow(projectNativeRow(observation.row)));
      if (typeof row.id !== "string" || observed.has(row.id)) return yield* Effect.fail(mismatch());
      observed.set(row.id, row);
    }
    const actual = activity.relationalReads[0], identities = yield* Effect.fromResult(decodeIdentities(actual?.orderedIdentities));
    const selected: Array<JsonObject & { readonly id: string }> = [];
    const seen = new Set<string>();
    for (const identity of identities) {
      const row = observed.get(identity.id);
      if (row === undefined || row.deleted_at !== null || seen.has(identity.id)) return yield* Effect.fail(mismatch());
      seen.add(identity.id); selected.push({ ...row, id: identity.id });
    }
    if ([...observed.values()].some(row => row.deleted_at === null && (typeof row.id !== "string" || !seen.has(row.id))) ||
      !jsonEqual(selected, orderNativeIdRows(selected, {}))) return yield* Effect.fail(mismatch());
    const expectedRead = { table: prepared.contracts.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate, "id", { includeIdentities: true }),
      total: selected.length, returned: selected.length, orderedIdentities: identities };
    if (!jsonEqual(actual ?? null, expectedRead)) return yield* Effect.fail(mismatch());
    const ordered = plan.query.order.direction === "desc" ? [...selected].reverse() : selected;
    const page = ordered.slice(plan.query.skip, plan.query.take === undefined ? undefined : plan.query.skip + plan.query.take);
    const expected = yield* Effect.fromResult(projectRows(page, plan.projection.node));
    if (counted) {
      const [rows, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
      if (count !== selected.length || !jsonEqual(rows, expected)) return yield* Effect.fail(mismatch());
    } else if (!jsonEqual(call.result, expected)) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
