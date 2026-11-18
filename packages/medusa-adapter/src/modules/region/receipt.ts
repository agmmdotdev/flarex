import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { decodeGraphCount } from "../../local-graph/query";
import { captureCommerceInput } from "../../value/input";
import { decodeRegionReadInput, regionReadLimit } from "./input";
import type { prepareRegionReadRepository } from "./repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareRegionReadRepository>>;

export function regionReadPolicy(prepared: Prepared) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("RegionRead.validateCall")(function* (call, activity) {
    if (call.mode !== "read" || call.commandName !== "regionListForShippingOptions" && call.commandName !== "regionCountForShippingOptions" ||
      call.events.length || activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = yield* Effect.fromResult(decodeRegionReadInput(call.input));
    const { select, relations, ...config } = input.config ?? {};
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { ...config,
      ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
    })).pipe(Result.flatMap(prepared.query)));
    const ids = new Set(typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id), observed = new Map<string, JsonObject & { readonly id: string }>();
    for (const observation of activity.observedRows) {
      if (observation.table !== prepared.contracts.table.name) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(prepared.contracts.decodeRow(projectNativeRow(observation.row))), prior = observed.get(row.id);
      if (!ids.has(row.id) || prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
      observed.set(row.id, row);
    }
    if (observed.size > regionReadLimit) return yield* Effect.fail(commerceError("receiptMismatch"));
    const active = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null), {}), selected = plan.window.select(active);
    const reads = [{ table: prepared.contracts.table.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: active.length, returned: active.length }];
    const expected = yield* Effect.fromResult(projectRows(selected.rows, plan.projection.node));
    if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.commandName === "regionCountForShippingOptions") {
      const [rows, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
      if (count !== active.length || !jsonEqual(rows, expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else if (!jsonEqual(yield* Effect.fromResult(prepared.contracts.decodeProjection(call.result)), expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
