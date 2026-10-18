import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { decodeGraphCount } from "../../local-graph/query";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectRows } from "../../query/projection";
import type { SchemaTable } from "../../schema/model";
import type { prepareStockLocationUpdateReadPlan } from "./update-read-plan";
import { StockLocationUpdateReadInput, StockLocationAddressReadInput } from "./update-input";

const decodeLocations = commerceDecoder(StockLocationUpdateReadInput, "receiptMismatch");
const decodeAddresses = commerceDecoder(StockLocationAddressReadInput, "receiptMismatch");
const encoder = new TextEncoder();
const order = (rows: readonly JsonObject[]) => [...rows].sort((a, b) =>
  compareBytesLexicographically(encoder.encode(String(a.id)), encoder.encode(String(b.id))));

/** Correlate the native service result with the existing repository plan and
 * complete read evidence; no extra database access or query execution occurs. */
export function compileStockLocationUpdateReadReceipt(table: SchemaTable, address: SchemaTable,
  prepared: Result.Result.Success<ReturnType<typeof prepareStockLocationUpdateReadPlan>>) {
  return Result.gen(function* () {
    const decodeLocation = yield* compileCompleteRow(table), decodeAddress = yield* compileCompleteRow(address);
    const validate: LogicalCallReceiptValidation = Effect.fn("StockLocation.validateUpdateRead")(function* (call, activity) {
      const addresses = call.commandName === "stockLocationAddressListForUpdate";
      const counted = call.commandName === "stockLocationCountForUpdate";
      if (call.mode !== "read" || !addresses && !counted && call.commandName !== "stockLocationListForUpdate" ||
        call.events.length || activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult((addresses ? decodeAddresses : decodeLocations)(call.input));
      const { select, relations, ...config } = input.config ?? {};
      const selectedTable = addresses ? address.name : table.name;
      const { plan, matches, matchesCandidate } = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, { ...config,
        ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
      })).pipe(Result.flatMap(query => prepared.query(selectedTable, query))));
      const groups = new Map<string, Map<string, JsonObject>>([[table.name, new Map()], [address.name, new Map()]]);
      for (const observation of activity.observedRows) {
        const decode = observation.table === table.name ? decodeLocation : observation.table === address.name ? decodeAddress : undefined;
        if (decode === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(decode(projectNativeRow(observation.row)));
        const rows = groups.get(observation.table);
        if (typeof row.id !== "string" || rows === undefined || rows.has(row.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        rows.set(row.id, row);
      }
      const candidates = [...groups.get(selectedTable)?.values() ?? []];
      if (candidates.some(row => !matchesCandidate(row))) return yield* Effect.fail(commerceError("receiptMismatch"));
      const active = order(candidates.filter(row => matches(row) && (plan.withDeleted || row.deleted_at === null)));
      if (active.length > 4) return yield* Effect.fail(commerceError("receiptMismatch"));
      const selection = plan.window.select(active);
      const reads: JsonObject[] = [{ table: selectedTable, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate),
        total: active.length, returned: active.length }];
      let children: readonly JsonObject[] = [];
      const childCandidates = addresses ? [] : [...groups.get(address.name)?.values() ?? []];
      if (!addresses && plan.paths.includes("address")) {
        const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(prepared.relation.targetPrimaryKeys,
          selection.rows, prepared.relation.join.foreignKeys, true, plan.withDeleted));
        if (Option.isSome(population)) {
          const ids = new Set(population.value.values);
          if (childCandidates.some(row => typeof row.id !== "string" || !ids.has(row.id))) return yield* Effect.fail(commerceError("receiptMismatch"));
          children = order(childCandidates.filter(row => plan.withDeleted || row.deleted_at === null));
          if (children.length > 4) return yield* Effect.fail(commerceError("receiptMismatch"));
          reads.push({ table: address.name, query: commerceRelationReadQuery(defaultCommerceResources, population.value.predicate),
            total: children.length, returned: children.length });
        } else if (childCandidates.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      } else if (addresses ? groups.get(table.name)?.size : childCandidates.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      const state = new Map([[selectedTable, selection.rows], ...(!addresses ? [[address.name, children] as const] : [])]);
      const assembled = assembleCommerceRelations(selectedTable, state, plan.paths, prepared.relations);
      const expected = yield* Effect.fromResult(projectRows(assembled, plan.projection.node));
      if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (counted) {
        const [rows, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
        if (count !== selection.count || !jsonEqual(rows, expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
      } else if (!jsonEqual(call.result, expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
    return validate;
  });
}
