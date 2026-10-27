import { Effect, Option, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../module/promise-owner";
import type { SchemaTable } from "../schema/model";
import { compileCompleteRow } from "../value/complete-row";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";
import { projectExactNumericColumns } from "../value/exact-numeric";
import { captureNativeNumericDto } from "../value/native-numeric";
import { makeReadCatalog } from "../query/catalog";
import { compileProjection, projectRows, type ProjectionPolicy } from "../query/projection";
import { compileWhere } from "../query/predicate";
import { executeRead, orderedCatalog, type ReadPlan } from "../query/read";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation, type CommerceRelations } from "../query/relations";
import { decodeGraphCount } from "../local-graph/query";
import { prepareScalarRepository } from "./scalar";
import { ScalarIdRead, scalarIdWhere } from "./scalar-id-read";
import { deniedCommerceRepository } from "./denied";
import { projectNativeRow } from "./result";
import type { LogicalCallReceiptValidation } from "./call-receipt";

const decodeInput = commerceDecoder(ScalarIdRead, "invalidInput");
const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.Array(Schema.String),
  limit: Schema.optionalKey(Schema.Literals([4, 15, 256])), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
}) }), "unsupportedProfile");

/** Counted native ID reads with a finite, one-level local relation closure.
 * Existing query/population owners perform the reads. Receipts use the same
 * plans and complete observed rows; no database or settlement capability escapes. */
export function prepareIdReadRepository(root: SchemaTable, model: string, tables: readonly SchemaTable[],
  relations: CommerceRelations, defaultRelations: readonly string[], commandName: string) {
  return Result.gen(function* () {
    const entities = yield* Result.all(tables.map(table => compileCompleteRow(table).pipe(Result.map(complete => ({ table, complete })))));
    const byName = new Map(entities.map(entity => [entity.table.name, entity]));
    const members = relations.get(root.name) ?? new Map();
    if (!byName.has(root.name) || defaultRelations.some(name => !members.has(name)) ||
      [...members.values()].some(relation => relation.join.type !== "hasOne" || !byName.has(relation.targetTable)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const catalog = yield* makeReadCatalog(tables.map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"],
      foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])) })), relations);
    const leaf: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
    const projection = { ...leaf, selectableRelations: [...members.keys()], nested: new Map([...members.keys()].map(name => [name, leaf])) };
    const query = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeQuery(input), paths = value.options.populate;
      if (paths.some(path => !members.has(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
      return { table: root.name, projection: yield* compileProjection(catalog, root.name, value.options.fields, paths, projection),
        paths, withDeleted: false, relationFilters: [], ordering: new Map(),
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
          yield* compileWhere(value.where, scalarIdWhere), { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: orderedCatalog("asc") } } satisfies ReadPlan;
    });
    const scalar = yield* prepareScalarRepository(root, model, scalarIdWhere);
    const present = Effect.fn("IdRead.present")(function* (input: Json, table: string): Effect.fn.Return<Json, CommerceTransactionError> {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      const rows: JsonObject[] = [];
      for (const value of Array.isArray(input) ? input : [input]) {
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
        const row = { ...value }, nested: Record<string, Json> = {};
        for (const relation of relations.get(table)?.values() ?? []) if (Object.hasOwn(row, relation.name)) {
          const child = row[relation.name]; delete row[relation.name];
          if (child === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          nested[relation.name] = child === null ? null : yield* present(child, relation.targetTable);
        }
        const projected = yield* projectExactNumericColumns(row, entity.table.columns.filter(column => column.type === "bigNumber"), "reserialize");
        if (!isJsonObject(projected)) return yield* Effect.fail(commerceError("storedCorruption"));
        rows.push({ ...projected, ...nested });
      }
      return Array.isArray(input) ? rows : rows[0]!;
    });
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(ctx, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse), { bridge } = bound;
      const repository: DAL.RepositoryService = { ...denied,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(ctx, Effect.gen(function* () {
          if (options !== undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const value = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          // SAFETY: complete DML rows preceded this selected native projection.
          return (yield* present(value, root.name)) as Output;
        }))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
          const plan = yield* Effect.fromResult(query(captured));
          const result = yield* executeRead({ ...current, admitSelection: (table, rows) => Result.gen(function* () {
            const entity = byName.get(table);
            if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
            if (rows.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
            for (const row of rows) yield* entity.complete(projectNativeRow(row));
          }) }, catalog, plan, true);
          if (result.count === undefined) return yield* current.refuse(commerceError("storedCorruption"));
          return [structuredClone(result.rows), result.count];
        }))),
      };
      return { ...bound, repository, denied };
    };
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("IdRead.validateCall")(function* (call, activity) {
      const mismatch = () => commerceError("receiptMismatch");
      if (call.commandName !== commandName || call.mode !== "read" || call.events.length || activity.mutations.length ||
        activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeInput(call.input));
      const { select, ...configuration } = input.config ?? {};
      const config = { ...configuration, ...(select === undefined ? {} : { select: [...select] }), relations: [...defaultRelations] };
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, config)).pipe(Result.flatMap(query)));
      const state = new Map<string, JsonObject[]>();
      for (const observation of activity.observedRows) {
        const entity = byName.get(observation.table);
        if (entity === undefined) return yield* Effect.fail(mismatch());
        const row = yield* Effect.fromResult(entity.complete(projectNativeRow(observation.row)));
        const rows = state.get(observation.table) ?? [];
        if (rows.some(prior => prior.id === row.id)) return yield* Effect.fail(mismatch());
        rows.push(row); state.set(observation.table, rows);
      }
      const ids = input.filters?.id, requested = typeof ids === "string" ? [ids] : ids;
      const roots = orderedCatalog("asc")((state.get(root.name) ?? []).filter(row => row.deleted_at === null &&
        (requested === undefined || typeof row.id === "string" && requested.includes(row.id)))).rows;
      if (roots.length > 4) return yield* Effect.fail(mismatch());
      const selected = new Map<string, readonly JsonObject[]>([[root.name, roots]]);
      const reads = [{ table: root.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: roots.length, returned: roots.length }];
      for (const name of plan.paths) {
        const relation = members.get(name);
        if (relation === undefined || relation.join.type !== "hasOne") return yield* Effect.fail(mismatch());
        const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(relation.join.foreignKeys, roots, relation.sourcePrimaryKeys, true, false));
        const rows = Option.isNone(population) ? [] : orderedCatalog("asc")((state.get(relation.targetTable) ?? []).filter(row => {
          const value = row[population.value.column];
          return row.deleted_at === null && typeof value === "string" && population.value.values.includes(value);
        })).rows;
        if (rows.length > 4) return yield* Effect.fail(mismatch());
        if (Option.isSome(population)) reads.push({ table: relation.targetTable,
          query: commerceRelationReadQuery(defaultCommerceResources, population.value.predicate), total: rows.length, returned: rows.length });
        selected.set(relation.targetTable, rows);
      }
      for (const [table, observed] of state) {
        const admitted = selected.get(table);
        if (admitted === undefined || observed.length !== admitted.length || observed.some(row => !admitted.some(value => jsonEqual(row, value))))
          return yield* Effect.fail(mismatch());
      }
      const assembled = yield* Effect.fromResult(assembleCommerceRelations(root.name, selected, plan.paths, catalog.relations));
      const projected = yield* Effect.fromResult(projectRows(assembled, plan.projection.node));
      const expected = yield* present(projected, root.name).pipe(Effect.flatMap(value => Effect.fromResult(captureNativeNumericDto(value))));
      const [rows, count] = yield* Effect.fromResult(decodeGraphCount(call.result));
      if (!jsonEqual(reads, activity.relationalReads) || count !== roots.length || !jsonEqual(rows, expected)) return yield* Effect.fail(mismatch());
    }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
    return { bind, query, table: yield* catalog.table(root.name), policy: {
      capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall } };
  });
}
