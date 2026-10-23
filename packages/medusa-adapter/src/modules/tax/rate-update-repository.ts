import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { assignNativeJsonObject } from "@medusajs/utils/dal/json-assignment";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { QueryEnvelope } from "../../query/decoder";
import { readCommerceRelationRows } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { compileKeyedUpdates } from "../../write/keyed";
import { TaxId } from "./query";
import type { captureTaxMetadata } from "./schema";
import { compileTaxRateUpdateContracts, TaxRateUpdateData, TaxRateUpdateMetadata, decodeTaxRateUpdateUpserts } from "./rate-update-input";
import { prepareTaxRateUpdateQuery, taxRateUpdateWhere } from "./rate-update-query";

const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodePatch = commerceDecoder(TaxRateUpdateData, "unsupportedProfile");
const decodeId = commerceDecoder(TaxId, "storedCorruption");
const decodeAssignment = commerceDecoder(TaxRateUpdateMetadata, "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Genuine internal services normalize selector updates before these pairs
 * arrive. This extension persists native assignments and presents references;
 * it never repeats metadata preparation or owns transaction settlement. */
export function prepareTaxRateUpdateRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileTaxRateUpdateContracts(metadata), { rate } = contracts;
    const scalar = yield* prepareScalarRepository(rate, "TaxRate", taxRateUpdateWhere, undefined,
      { managedTimestamps: true, nativeRealPresentation: true });
    const reads = prepareTaxRateUpdateQuery(scalar, contracts), columns = rate.columns.map(column => column.name);
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => Result.gen(function* () {
        const entity = yield* contracts.decodeEntity(pair.entity), patch = yield* decodePatch(pair.update);
        const { updated_by: _actor, ...data } = patch;
        if (patch.metadata !== undefined) {
          const current = yield* decodeAssignment(entity.metadata), supplied = yield* decodeAssignment(patch.metadata);
          return { key: entity.id, update: { ...data, metadata: yield* decodeAssignment(assignNativeJsonObject(current, supplied)) } };
        }
        return { key: entity.id, update: data };
      }) });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      type Row = Result.Result.Success<ReturnType<typeof contracts.decodeRateRow>>;
      // This native command's complete read evidence survives the framework's
      // mutation of its detached entities. It is not a cross-call identity map.
      const originalRows = new Map<string, Row>();
      const decodeSelected = (input: readonly JsonObject[]) => Result.gen(function* () {
        if (input.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
        const rows: Row[] = [], regions = new Set<string>();
        for (const value of input) {
          const row = yield* contracts.decodeRateRow(projectNativeRow(value));
          if (row.deleted_at !== null || typeof row.tax_region_id !== "string")
            return yield* Result.fail(commerceError("storedCorruption"));
          regions.add(row.tax_region_id); rows.push(row);
        }
        if (regions.size > 2) return yield* Result.fail(commerceError("limitExceeded"));
        return rows;
      });
      const selectActiveRegions = Effect.fn("TaxRateUpdate.selectActiveRegions")(function* (
        ctx: CommerceCommandContext, rows: readonly JsonObject[],
      ) {
        if (rows.length === 0) return [];
        const predicate = yield* Effect.fromResult(reads.regionPredicate(rows));
        const regions = yield* readCommerceRelationRows(ctx, contracts.region.name, predicate);
        return yield* Effect.fromResult(reads.filterActiveRegionRates(rows, regions));
      });
      const find = Effect.fn("TaxRateUpdate.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const envelope = yield* Effect.fromResult(decodeEnvelope(captured)), plan = yield* Effect.fromResult(reads.query(captured));
        const found = yield* bound.find(ctx, { where: envelope.where, options: { fields: columns, populate: [], orderBy: { id: "ASC" } } }, false);
        const selected = plan.regionFilter ? yield* selectActiveRegions(ctx, found.rows) : found.rows;
        const rows = yield* Effect.fromResult(decodeSelected(selected));
        for (const row of rows) originalRows.set(row.id, row);
        return structuredClone(yield* Effect.fromResult(contracts.decodePreimages(yield* Effect.fromResult(reads.projectRows(rows, plan)))));
      });
      const update = Effect.fn("TaxRateUpdate.update")(function* (
        ctx: CommerceCommandContext, input: unknown, shared: Parameters<DAL.RepositoryService["update"]>[1],
      ) {
        const entries = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodePairs)));
        const planned = yield* Effect.fromResult(updates(entries)), changed: JsonObject[] = [];
        for (const [index, pair] of entries.entries()) {
          const entity = yield* Effect.fromResult(contracts.decodeEntity(pair.entity)), before = originalRows.get(entity.id), patch = planned[index];
          if (before === undefined || patch === undefined || Object.entries(entity).some(([name, value]) => {
            const previous = before[name];
            return name !== "metadata" && (previous === undefined || !jsonEqual(previous, value));
          })) return yield* ctx.refuse(commerceError("storedCorruption"));
          if (pair.update.metadata === undefined && (before.metadata === undefined || entity.metadata === undefined || !jsonEqual(before.metadata, entity.metadata)))
            return yield* ctx.refuse(commerceError("storedCorruption"));
          const data = Object.fromEntries(Object.entries(patch).filter(([name, value]) => {
            const previous = before[name]; return name !== "id" && (previous === undefined || !jsonEqual(previous, value));
          }));
          if (Object.keys(data).length) changed.push({ ...data, id: entity.id });
        }
        const written = changed.length ? yield* (yield* ctx.table(rate.name)).write(ctx.manager, "update", changed) : [];
        const stored = new Map<string, Row>(), changedIds = new Set(changed.map(row => row.id));
        for (const value of written) {
          const row = yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(value)));
          if (stored.has(row.id) || !changedIds.has(row.id)) return yield* ctx.refuse(commerceError("storedCorruption"));
          stored.set(row.id, row);
        }
        if (stored.size !== changed.length) return yield* ctx.refuse(commerceError("storedCorruption"));
        if (changed.length) {
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "TaxRate", [...stored.values()], shared);
        }
        const output: JsonObject[] = [];
        for (const [index, pair] of entries.entries()) {
          const patch = planned[index], id = yield* Effect.fromResult(decodeId(pair.entity.id));
          const row = stored.get(id) ?? originalRows.get(id), actor = pair.update.updated_by;
          if (row === undefined || patch === undefined || actor !== undefined && typeof actor !== "string")
            return yield* ctx.refuse(commerceError("storedCorruption"));
          // SQL conversion must complete first. The native managed entity still
          // presents the submitted REAL rather than the rounded cold value.
          const presented = patch.rate === undefined ? row : { ...row, rate: patch.rate };
          output.push(yield* Effect.fromResult(contracts.present(presented, actor)));
        }
        return structuredClone(yield* Effect.fromResult(contracts.decodeRows(output)));
      });
      const upsert = Effect.fn("TaxRateUpdate.upsertInverse")(function* (
        ctx: CommerceCommandContext, input: unknown, shared: Parameters<DAL.RepositoryService["upsert"]>[1],
      ) {
        const entries = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeTaxRateUpdateUpserts)));
        const selected = entries.length ? yield* bound.find(ctx, { where: { id: entries.map(row => row.id) },
          options: { fields: columns, populate: [], orderBy: { id: "ASC" } } }, false) : { rows: [] };
        const active = yield* Effect.fromResult(decodeSelected(yield* selectActiveRegions(ctx, selected.rows))),
          byId = new Map(active.map(row => [row.id, row])), output: JsonObject[] = [];
        for (const entry of entries) {
          const captured = yield* Effect.fromResult(captureCommerceInput(entry, ctx.resources));
          const value = yield* Effect.fromResult(contracts.decodePreimages([captured])), preimage = value[0];
          if (preimage === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          const { tax_region, ...scalarInput } = preimage;
          const before = byId.get(entry.id);
          if (before === undefined) {
            // Native upsert attempts a fresh entity when default active lookup
            // cannot see a missing/deleted row. Sparse retained inputs fail the
            // genuine DML creation shape, with its original decoder Cause.
            const creation = yield* Effect.fromResult(contracts.decodeCreation(scalarInput));
            const inserted = yield* bound.createRows(ctx, [creation], shared);
            for (const row of inserted) output.push(yield* Effect.fromResult(contracts.present(row, undefined, tax_region !== undefined)));
            continue;
          }
          const data = Object.fromEntries(Object.entries(scalarInput).filter(([name, value]) => {
            const previous = before[name]; return name !== "id" && (previous === undefined || !jsonEqual(previous, value));
          }));
          let after = before;
          if (Object.keys(data).length) {
            const written = yield* (yield* ctx.table(rate.name)).write(ctx.manager, "update", [{ ...data, id: entry.id }]);
            if (written.length !== 1 || written[0] === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            after = yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(written[0])));
            if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", "TaxRate", [after], shared);
          }
          const presented = scalarInput.rate === undefined ? after : { ...after, rate: scalarInput.rate };
          output.push(yield* Effect.fromResult(contracts.present(presented, undefined, tax_region !== undefined)));
        }
        return structuredClone(yield* Effect.fromResult(contracts.decodeUpsertRows(output)));
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, update(ctx, captured, shared))),
        upsert: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, upsert(ctx, captured, shared))),
      };
      return { ...bound, repository, rateRepository: repository, denied };
    };
    return { bind, contracts, rate, table: scalar.table, paths: [], query: reads.query, projectRows: reads.projectRows,
      regionPredicate: reads.regionPredicate, filterActiveRegionRates: reads.filterActiveRegionRates };
  });
}
