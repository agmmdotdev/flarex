import { Result, Schema } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import type { ReadPlan } from "../../query/read";
import { ShippingOptionUpdateFilters, ShippingOptionUpdateIds, type compileShippingOptionUpdateContracts } from "./shipping-option-update-input";
import { ShippingOptionId } from "./shipping-option-create-input";
import { ShippingProviderReadFilters } from "./shipping-option-create-query";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionUpdateContracts>>;
const Or = Schema.Array(Schema.Struct({ id: ShippingOptionId })).check(Schema.isMaxLength(4));
const Selection = Schema.Union([ShippingOptionUpdateFilters, Schema.Struct({ $or: Or })]);
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeSelection = commerceDecoder(Selection, "unsupportedProfile");
const decodeProvider = commerceDecoder(ShippingProviderReadFilters, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(16))), limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}), "unsupportedProfile");
const where: WherePolicy = { decode: decodeSelection, fields: new Map([["id", { column: "id", decode: commerceDecoder(Schema.Union([ShippingOptionId, ShippingOptionUpdateIds]), "unsupportedProfile") }]]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Or, "unsupportedProfile") } };
const providerWhere: WherePolicy = { decode: decodeProvider, fields: new Map([["id", { column: "id", decode: commerceDecoder(ShippingProviderReadFilters.fields.id, "unsupportedProfile") }]]) };

/** This selected native view admits Option Type/Rule preimages and the scalar
 * JSON paths emitted by getSelectsAndRelationsFromObjectArray. */
export function prepareShippingOptionUpdateQuery(contracts: Contracts) {
  return Result.gen(function* () {
    const catalog = yield* makeReadCatalog(contracts.entities.map(entity => ({ name: entity.table.name,
      columns: entity.table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns), companions: {} })), contracts.relations);
    const table = yield* catalog.table(contracts.option.name), type = yield* catalog.table(contracts.type.name), rule = yield* catalog.table(contracts.rule.name);
    const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", incomingKeys: true, selectableRelations: [], nested: new Map() };
    const query = (tableName: string, input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), provider = tableName === contracts.provider.name,
        selection = yield* (provider ? decodeProvider : decodeSelection)(envelope.where ?? {}), options = yield* decodeOptions(envelope.options ?? {});
      const option = tableName === contracts.option.name, zone = tableName === contracts.zone.name;
      if (![contracts.option.name, contracts.zone.name, contracts.set.name, contracts.provider.name].includes(tableName))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const allowed = option ? ["rules", "type"] : zone ? ["fulfillment_set"] : [];
      const rawPaths = options.populate ?? [], paths = rawPaths.filter(path => allowed.includes(path));
      const scalarJsonPaths = ["data", "metadata", "rules.value"];
      if (rawPaths.some(path => !allowed.includes(path) && !(option && scalarJsonPaths.some(name => path === name || path.startsWith(name + ".")))))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      let fields = options.fields === undefined ? undefined : [...options.fields];
      if (option && fields !== undefined) {
        fields = fields.flatMap(field => field === "rules.*" ? rule.columns.map(name => "rules." + name)
          : field === "type.*" ? type.columns.map(name => "type." + name)
          : scalarJsonPaths.find(name => field.startsWith(name + ".")) !== undefined ? [scalarJsonPaths.find(name => field.startsWith(name + ".")) ?? field] : [field]);
        // type_id is the native workflow's declared transient alias. Every
        // other field still reaches strict metadata projection admission.
        fields = fields.filter(field => field !== "type_id");
        fields.push("id");
        for (const [name, child] of [["rules", rule], ["type", type]] as const) if (paths.includes(name)) {
          const nested = fields.some(field => field.startsWith(name + "."));
          fields.push(...(nested ? child.primaryKeys : child.columns).map(field => name + "." + field));
        }
        fields = [...new Set(fields)];
      }
      const projection = yield* compileProjection(catalog, tableName, fields, paths,
        { ...leaf, allowedPaths: allowed, selectableRelations: allowed, nested: new Map(allowed.map(name => [name, leaf])) });
      const direction = options.orderBy?.id === "DESC" ? "desc" : "asc", skip = options.offset ?? 0;
      const plan: ReadPlan = { table: tableName, projection, paths, withDeleted: false,
        ordering: new Map([[contracts.rule.name, { kind: "storageInsertion", direction: "asc" }]]), relationFilters: [],
        query: { skip, order: { column: "id", direction }, predicate: { kind: "and", children: [yield* compileWhere(selection, provider ? providerWhere : where), { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: rows => ({ rows: preservePrimaryKeyOrFilterOrder((direction === "asc" ? rows : [...rows].reverse()).slice(skip,
          options.limit === undefined ? undefined : skip + options.limit), selection, ["id"], [["id", direction === "asc" ? "ASC" : "DESC"]]), count: rows.length }) } };
      return { ...plan, selection, options };
    });
    return { catalog, table, paths: [{ path: "rules", table: rule, many: true }, { path: "type", table: type, many: false }], query };
  });
}
