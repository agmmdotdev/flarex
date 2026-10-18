import { Effect, Result, Schema } from "effect";
import { commerceError, commerceLimits, capturePrivateJsonData, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { makeReadCatalog } from "../query/catalog";
import { isGraphReadCommand } from "./commands";
import { planGraphFields, type GraphFieldPlan } from "./fields";
import type { GraphParticipant, GraphReadDefinition, GraphReadSelection, LocalGraphQuery, PreparedLocalGraph } from "./model";
import { populateGraphRemotePaths, prepareGraphRemotePaths } from "./remote-paths";

const queryFields = {
  fields: Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256)),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.Struct({ take: QueryLimit, skip: Schema.optionalKey(QueryOffset),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))),
  }),
};
const decodeInput = commerceDecoder(Schema.Struct({ entity: Schema.String.check(Schema.isLengthBetween(1, 256)), ...queryFields }), "unsupportedProfile");
const decodeServiceInput = commerceDecoder(Schema.Struct({ service: Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/)), ...queryFields }), "unsupportedProfile");
export const decodeGraphCount = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)),
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
]), "storedCorruption");

function nativeFilters(value: Json, allowOr: boolean): boolean {
  if (Array.isArray(value)) return value.every(member => nativeFilters(member, allowOr));
  if (!isJsonObject(value)) return true;
  return Object.entries(value).every(([key, member]) => key === "$or"
    ? allowOr && Array.isArray(member) && member.every(branch => isJsonObject(branch) && nativeFilters(branch, allowOr))
    : !key.startsWith("$") && nativeFilters(member, allowOr));
}

function graphOrder(read: GraphReadDefinition, supplied: Readonly<Record<string, "ASC" | "DESC">> | undefined): Result.Result<JsonObject, CommerceTransactionError> {
  const identity = read.table.primaryKeys[0];
  if (identity === undefined) return Result.fail(commerceError("unsupportedProfile"));
  const order = { ...supplied };
  if (Object.keys(order).some(key => !read.orderable.includes(key))) return Result.fail(commerceError("unsupportedProfile"));
  // The physical reader appends every remaining primary-key component as an
  // ascending tie-breaker. Do not pretend the leading component is unique.
  if (!Object.keys(order).some(key => read.uniqueOrder.includes(key)) && !Object.hasOwn(order, identity)) order[identity] = "ASC";
  if (!read.multipleOrder && Object.keys(order).length !== 1) return Result.fail(commerceError("unsupportedProfile"));
  return Result.succeed(order);
}

function planQuery(input: unknown, entries: ReadonlyMap<string, GraphReadSelection>, service: boolean, native: boolean) {
  return Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, commerceLimits.commandBytes, commerceError);
    const args = yield* service ? decodeServiceInput(captured.value).pipe(Result.map(value => ({ ...value, entity: value.service }))) : decodeInput(captured.value);
    const entry = entries.get(args.entity);
    if (entry === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    if (!nativeFilters(args.filters ?? {}, entry.read.allowOrFilters === true)) return yield* Result.fail(commerceError("unsupportedProfile"));
    return { entry, args, fields: yield* planGraphFields(entry.read, args.fields, native), order: yield* graphOrder(entry.read, args.pagination.order) };
  });
}

function graphResult(rows: readonly JsonObject[], count: number, fields: GraphFieldPlan, skip: number, take: number) {
  return Result.gen(function* () {
    if (rows.length > take || rows.length !== Math.min(take, Math.max(0, count - skip))) return yield* Result.fail(commerceError("storedCorruption"));
    return { data: yield* fields.project(rows), metadata: { count, skip, take } };
  });
}

/** Capture trusted module metadata once. Scope/installation/command authority
 * remains with core; this registry only restricts graph dispatch and projection. */
export function prepareLocalGraph(participants: readonly GraphParticipant[]): Result.Result<PreparedLocalGraph, CommerceTransactionError> {
  return Result.gen(function* () {
    const entries = new Map<string, GraphReadSelection>();
    const services = new Map<string, GraphReadSelection>();
    const allModels = new Map<string, GraphReadSelection[]>();
    for (const { participant, module } of participants) {
      const models = new Map<string, GraphReadDefinition>();
      for (const input of module.reads) {
        if (!input.model.trim() || models.has(input.model) || !isGraphReadCommand(input.command)
          || input.allowOrFilters !== undefined && input.allowOrFilters !== true
          || input.selectedFieldsOnly !== undefined && input.selectedFieldsOnly !== true
          || input.table.primaryKeys.length === 0 || input.table.primaryKeys.length > 16
          || new Set(input.table.primaryKeys).size !== input.table.primaryKeys.length) return yield* Result.fail(commerceError("unsupportedProfile"));
        // Reuse the read catalog's owned metadata snapshots; its relation map is
        // unnecessary here because services retain population responsibility.
        const tables = new Map([input.table, ...input.paths.map(path => path.table)].map(table => [table.name, table]));
        const catalog = yield* makeReadCatalog([...tables.values()], new Map());
        const paths = [];
        const names = new Set<string>();
        for (const relation of input.paths) {
          if (names.has(relation.path) || relation.path.split(".").some(part => !/^[a-z][a-z0-9_]*$/.test(part))) return yield* Result.fail(commerceError("unsupportedProfile"));
          names.add(relation.path);
          paths.push(Object.freeze({ ...relation, table: yield* catalog.table(relation.table.name),
            ...(relation.sourceFields === undefined ? {} : { sourceFields: Object.freeze([...relation.sourceFields]) }) }));
        }
        if ([...names].some(path => path.includes(".") && !names.has(path.slice(0, path.lastIndexOf("."))))) return yield* Result.fail(commerceError("unsupportedProfile"));
        for (const relation of paths) if (relation.sourceFields !== undefined) {
          const dot = relation.path.lastIndexOf(".");
          const parent = dot === -1 ? input.table : paths.find(candidate => candidate.path === relation.path.slice(0, dot))?.table;
          if (parent === undefined || relation.sourceFields.length === 0 || relation.sourceFields.length > 16 ||
            new Set(relation.sourceFields).size !== relation.sourceFields.length ||
            relation.sourceFields.some(column => !parent.columns.includes(column) || !parent.foreignKeys.includes(column) && !parent.primaryKeys.includes(column)))
            return yield* Result.fail(commerceError("unsupportedProfile"));
        }
        const table = yield* catalog.table(input.table.name);
        const identity = table.primaryKeys[0];
        if (identity === undefined || !input.orderable.includes(identity)
          || (table.primaryKeys.length === 1 && !input.uniqueOrder.includes(identity))
          || input.orderable.some(field => !table.columns.includes(field)) || input.uniqueOrder.some(field => !input.orderable.includes(field))) return yield* Result.fail(commerceError("unsupportedProfile"));
        const read = Object.freeze({ ...input, table, paths: Object.freeze(paths),
          orderable: Object.freeze([...input.orderable]), uniqueOrder: Object.freeze([...input.uniqueOrder]), decode: input.decode });
        models.set(read.model, read);
        const existing = allModels.get(read.model) ?? [];
        existing.push({ participant, read }); allModels.set(read.model, existing);
      }
      const selected = new Set<string>();
      for (const alias of module.aliases) {
        const read = models.get(alias.model);
        if (read === undefined) continue;
        if (!/^[a-z][a-z0-9_]*$/.test(alias.name) || entries.has(alias.name)) return yield* Result.fail(commerceError("unsupportedProfile"));
        entries.set(alias.name, { participant, read });
        selected.add(alias.model);
      }
      for (const service of module.services ?? []) {
        const read = models.get(service.model);
        if (read === undefined || !/^[A-Za-z][A-Za-z0-9_]{0,255}$/.test(service.name) || services.has(service.name))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        services.set(service.name, { participant, read });
      }
      if (selected.size !== models.size) return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    if (entries.size === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    const remotePaths = yield* prepareGraphRemotePaths(participants, allModels);
    for (const catalog of [entries, services]) for (const [alias, entry] of catalog) {
      const paths = remotePaths.get(entry.read.model);
      if (paths === undefined) continue;
      catalog.set(alias, { ...entry, read: Object.freeze({ ...entry.read, paths: Object.freeze([...entry.read.paths,
        ...[...paths.values()].map(path => Object.freeze({ path: path.path, table: path.target.read.table, many: true, sourceFields: Object.freeze([path.sourceKey]) })),
      ]) }) });
    }
    return Object.freeze({ entities: Object.freeze([...entries.keys()]), bind: (context): LocalGraphQuery => {
      // Only newly originated planner/result failures enter refusal here. A
      // participant call already owns its full failure Cause and must propagate.
      const execute = Effect.fn("LocalGraph.query")(function* (input: unknown, service: boolean, native: boolean) {
        const { entry, args, fields, order } = yield* checkedCommerceValue(context, () => planQuery(input, service ? services : entries, service, native));
        const skip = args.pagination.skip ?? 0, take = args.pagination.take;
        const remote = remotePaths.get(entry.read.model);
        const selectedRemote = fields.relations.filter(path => remote?.has(path));
        const relations = fields.relations.filter(path => !remote?.has(path));
        const select = selectedRemote.length !== 0 && relations.length === 0
          ? [...new Set([...fields.node.fields, ...entry.read.table.primaryKeys])] : fields.select;
        const value = yield* context.call(entry.participant, entry.read.command, {
          filters: args.filters ?? {}, config: { select, relations, order, skip, take },
        });
        const [rows, count] = yield* checkedCommerceValue(context, () => entry.read.decode(value));
        if (rows.length > take || rows.length !== Math.min(take, Math.max(0, count - skip)))
          return yield* context.refuse(commerceError("storedCorruption"));
        const populated = selectedRemote.length === 0 || remote === undefined ? rows
          : yield* populateGraphRemotePaths(context, rows, fields.node, remote);
        return yield* checkedCommerceValue(context, () => graphResult(populated, count, fields, skip, take));
      });
      return Object.freeze({ graph: (input: unknown) => execute(input, false, false), service: (input: unknown) => execute(input, true, true), native: (input: unknown) => execute(input, false, true) });
    } } satisfies PreparedLocalGraph);
  });
}
