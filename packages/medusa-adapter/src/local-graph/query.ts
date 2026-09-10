import { Effect, Result, Schema } from "effect";
import { commerceError, commerceLimits, capturePrivateJsonData, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../commerce-decoder";
import { QueryLimit, QueryOffset } from "../query-decoder";
import { makeReadCatalog } from "../query/catalog";
import { isGraphReadCommand } from "./commands";
import { planGraphFields, type GraphFieldPlan } from "./fields";
import type { GraphParticipant, GraphReadDefinition, LocalGraphQuery, PreparedLocalGraph } from "./model";

const decodeInput = commerceDecoder(Schema.Struct({
  entity: Schema.String.check(Schema.isLengthBetween(1, 256)),
  fields: Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256)),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.Struct({ take: QueryLimit, skip: Schema.optionalKey(QueryOffset),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))),
  }),
}), "unsupportedProfile");
export const decodeGraphCount = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)),
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
]), "storedCorruption");

function nativeFilters(value: Json): boolean {
  if (Array.isArray(value)) return value.every(nativeFilters);
  if (!isJsonObject(value)) return true;
  return Object.entries(value).every(([key, member]) => !key.startsWith("$") && nativeFilters(member));
}

function graphOrder(read: GraphReadDefinition, supplied: Readonly<Record<string, "ASC" | "DESC">> | undefined): Result.Result<JsonObject, CommerceTransactionError> {
  const identity = read.table.primaryKeys[0];
  if (identity === undefined) return Result.fail(commerceError("unsupportedProfile"));
  const order = { ...supplied };
  if (Object.keys(order).some(key => !read.orderable.includes(key))) return Result.fail(commerceError("unsupportedProfile"));
  if (!Object.keys(order).some(key => read.uniqueOrder.includes(key))) order[identity] = "ASC";
  if (!read.multipleOrder && Object.keys(order).length !== 1) return Result.fail(commerceError("unsupportedProfile"));
  return Result.succeed(order);
}

interface GraphEntry { readonly participant: GraphParticipant["participant"]; readonly read: GraphReadDefinition }
function planQuery(input: unknown, entries: ReadonlyMap<string, GraphEntry>) {
  return Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, commerceLimits.commandBytes, commerceError);
    const args = yield* decodeInput(captured.value);
    if (!nativeFilters(args.filters ?? {})) return yield* Result.fail(commerceError("unsupportedProfile"));
    const entry = entries.get(args.entity);
    if (entry === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return { entry, args, fields: yield* planGraphFields(entry.read, args.fields), order: yield* graphOrder(entry.read, args.pagination.order) };
  });
}

function graphResult(value: Json, read: GraphReadDefinition, fields: GraphFieldPlan, skip: number, take: number) {
  return Result.gen(function* () {
    const [rows, count] = yield* read.decode(value);
    if (rows.length > take || rows.length !== Math.min(take, Math.max(0, count - skip))) return yield* Result.fail(commerceError("storedCorruption"));
    return { data: yield* fields.project(rows), metadata: { count, skip, take } };
  });
}

/** Capture trusted module metadata once. Scope/installation/command authority
 * remains with core; this registry only restricts graph dispatch and projection. */
export function prepareLocalGraph(participants: readonly GraphParticipant[]): Result.Result<PreparedLocalGraph, CommerceTransactionError> {
  return Result.gen(function* () {
    const entries = new Map<string, GraphEntry>();
    for (const { participant, module } of participants) {
      const models = new Map<string, GraphReadDefinition>();
      for (const input of module.reads) {
        if (!input.model.trim() || !input.methodSuffix.trim() || models.has(input.model) || !isGraphReadCommand(input.command)
          || input.table.primaryKeys.length !== 1) return yield* Result.fail(commerceError("unsupportedProfile"));
        // Reuse the read catalog's owned metadata snapshots; its relation map is
        // unnecessary here because services retain population responsibility.
        const tables = new Map([input.table, ...input.paths.map(path => path.table)].map(table => [table.name, table]));
        const catalog = yield* makeReadCatalog([...tables.values()], new Map());
        const paths = [];
        const names = new Set<string>();
        for (const relation of input.paths) {
          if (names.has(relation.path) || relation.path.split(".").some(part => !/^[a-z][a-z0-9_]*$/.test(part))) return yield* Result.fail(commerceError("unsupportedProfile"));
          names.add(relation.path);
          paths.push(Object.freeze({ ...relation, table: yield* catalog.table(relation.table.name) }));
        }
        if ([...names].some(path => path.includes(".") && !names.has(path.slice(0, path.lastIndexOf("."))))) return yield* Result.fail(commerceError("unsupportedProfile"));
        const table = yield* catalog.table(input.table.name);
        const identity = table.primaryKeys[0];
        if (identity === undefined || !input.orderable.includes(identity) || !input.uniqueOrder.includes(identity)
          || input.orderable.some(field => !table.columns.includes(field)) || input.uniqueOrder.some(field => !input.orderable.includes(field))) return yield* Result.fail(commerceError("unsupportedProfile"));
        const read = Object.freeze({ ...input, table, paths: Object.freeze(paths),
          orderable: Object.freeze([...input.orderable]), uniqueOrder: Object.freeze([...input.uniqueOrder]), decode: input.decode });
        models.set(read.model, read);
      }
      const selected = new Set<string>();
      for (const alias of module.aliases) {
        const read = models.get(alias.model);
        if (read === undefined) continue;
        if (!/^[a-z][a-z0-9_]*$/.test(alias.name) || alias.methodSuffix !== read.methodSuffix || entries.has(alias.name)) return yield* Result.fail(commerceError("unsupportedProfile"));
        entries.set(alias.name, { participant, read });
        selected.add(alias.model);
      }
      if (selected.size !== models.size) return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    if (entries.size === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    return Object.freeze({ entities: Object.freeze([...entries.keys()]), bind: (context): LocalGraphQuery => {
      // Only newly originated planner/result failures enter refusal here. A
      // participant call already owns its full failure Cause and must propagate.
      const checked = <Value>(result: Result.Result<Value, CommerceTransactionError>) => Effect.fromResult(result)
        .pipe(Effect.catchTag("CommerceTransactionError", error => context.refuse(error)));
      const graph: LocalGraphQuery["graph"] = Effect.fn("LocalGraph.query")(function* (input: unknown) {
        const { entry, args, fields, order } = yield* checked(planQuery(input, entries));
        const skip = args.pagination.skip ?? 0, take = args.pagination.take;
        const value = yield* context.call(entry.participant, entry.read.command, {
          filters: args.filters ?? {}, config: { select: fields.select, relations: fields.relations, order, skip, take },
        });
        return yield* checked(graphResult(value, entry.read, fields, skip, take));
      });
      return Object.freeze({ graph });
    } } satisfies PreparedLocalGraph);
  });
}
