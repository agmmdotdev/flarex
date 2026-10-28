import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { decodeGraphCount } from "../../local-graph/query";
import { captureCommerceInput } from "../../value/input";
import { decodeRegionCartReadInput, regionCartCountryLimit } from "./cart-read-input";
import { regionReadLimit } from "./input";
import type { prepareRegionCartReadRepository } from "./cart-read-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareRegionCartReadRepository>>;
const encoder = new TextEncoder();

export function regionCartReadPolicy(prepared: Prepared) {
  const { contracts } = prepared;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("RegionCartRead.validateCall")(function* (call, activity) {
    if (call.mode !== "read" || call.commandName !== "regionListForCart" && call.commandName !== "regionCountForCart" || call.events.length ||
      activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = yield* Effect.fromResult(decodeRegionCartReadInput(call.input));
    const { select, relations, ...config } = input.config ?? {};
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { ...config,
      ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
    })).pipe(Result.flatMap(prepared.query)));
    const regions = new Map<string, JsonObject & { readonly id: string }>(), countries = new Map<string, JsonObject & { readonly iso_2: string }>();
    for (const observation of activity.observedRows) {
      const native = projectNativeRow(observation.row);
      if (observation.table === contracts.table.name) {
        const row = yield* Effect.fromResult(contracts.decodeRow(native)), prior = regions.get(row.id);
        if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
        regions.set(row.id, row);
      } else if (observation.table === contracts.country.name) {
        const row = yield* Effect.fromResult(contracts.decodeCountry(native)), prior = countries.get(row.iso_2);
        if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(commerceError("receiptMismatch"));
        countries.set(row.iso_2, row);
      } else return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (regions.size > regionReadLimit || countries.size > regionCartCountryLimit || !plan.paths.length && countries.size)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const filter = input.filters?.id, ids = filter === undefined ? undefined : new Set(filter === null ? [] : typeof filter === "string" ? [filter] : filter);
    if ([...regions.values()].some(row => ids !== undefined && !ids.has(row.id))) return yield* Effect.fail(commerceError("receiptMismatch"));
    const active = orderNativeIdRows([...regions.values()].filter(row => row.deleted_at === null), {});
    if (plan.window.kind !== "catalog") return yield* Effect.fail(commerceError("receiptMismatch"));
    const selected = plan.window.select(active), rows = new Map<string, readonly JsonObject[]>([[contracts.table.name, selected.rows]]);
    const reads: JsonObject[] = [{ table: contracts.table.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate),
      total: active.length, returned: active.length }];
    if (plan.paths.length) {
      const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(contracts.countries.join.foreignKeys,
        selected.rows, contracts.countries.sourcePrimaryKeys, true, false));
      if (Option.isSome(population)) {
        if ([...countries.values()].some(row => typeof row.region_id !== "string" || !population.value.values.includes(row.region_id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const members = [...countries.values()].filter(row => row.deleted_at === null).sort((left, right) =>
          compareBytesLexicographically(encoder.encode(left.iso_2), encoder.encode(right.iso_2)));
        rows.set(contracts.country.name, members);
        reads.push({ table: contracts.country.name, query: commerceRelationReadQuery(defaultCommerceResources, population.value.predicate, "iso_2"),
          total: members.length, returned: members.length });
      } else if (countries.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const assembled = yield* Effect.fromResult(assembleCommerceRelations(contracts.table.name, rows, plan.paths, contracts.relations));
    const expected = yield* Effect.fromResult(projectRows(assembled, plan.projection.node));
    if (call.commandName === "regionCountForCart") {
      const [actual, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
      if (count !== active.length || !jsonEqual(actual, expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else if (!jsonEqual(yield* Effect.fromResult(contracts.decodeProjection(call.result)), expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
