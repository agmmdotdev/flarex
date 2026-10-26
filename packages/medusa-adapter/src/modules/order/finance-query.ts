import { Result, Schema } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileWhere, type Predicate, type WherePolicy, type ScalarFilter } from "../../query/predicate";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { orderedCatalog, type ReadPlan } from "../../query/read";
import type { ReadCatalog } from "../../query/catalog";
import type { SchemaTable } from "../../schema/model";
import type { PopulationFilter } from "../../query/population";
import { captureCommerceInput } from "../../value/input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const strings = commerceDecoder(Schema.Union([Schema.NullOr(Id), Schema.Array(Id).check(Schema.isMaxLength(4))]), "unsupportedProfile");
const versions = commerceDecoder(Schema.Number.check(Schema.isInt()), "unsupportedProfile");
const parentVersion = commerceDecoder(Schema.Struct({ id: Id, version: Schema.Finite.check(Schema.isInt()) }), "storedCorruption");
const decodeWhere = commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile");
const branches = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "unsupportedProfile");
const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.optionalKey(Schema.JsonObject), options: Schema.optionalKey(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(128))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(32))),
  limit: Schema.optionalKey(Schema.Literals([4, 15, 256])),
  offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")),
    actions: Schema.optionalKey(Schema.Struct({ ordering: Schema.Literal("ASC") })) })),
})) }), "unsupportedProfile");
const populations = new Map<string, readonly string[]>([
  ["order", ["summary", "transactions", "credit_lines", "items", "items.item", "items.item.tax_lines", "items.item.adjustments",
    "shipping_methods", "shipping_methods.shipping_method", "shipping_methods.shipping_method.tax_lines", "shipping_methods.shipping_method.adjustments"]],
  ["order_change", ["actions"]], ["order_item", ["item"]], ["order_shipping", ["shipping_method"]],
  ["order_line_item", ["adjustments", "tax_lines"]], ["order_shipping_method", ["adjustments", "tax_lines"]],
]);

/** Only selectors used by native financial methods enter this repository. */
export function orderFinanceWhere(table: SchemaTable): WherePolicy {
  const names = ["id", "order_id", "order_change_id", "item_id", "shipping_method_id", "version", "status", "reference", "reference_id"];
  return { decode: decodeWhere, fields: new Map(names.filter(name => table.columns.some(column => column.name === name))
    .map((name): [string, ScalarFilter] => [name, name === "version" ? { column: name,
      decodePredicate: input => versions(input).pipe(Result.map(value => ({ kind: "numberIn", column: name, values: [value] }))) }
      : { column: name, decode: strings }])),
    logical: { decodeBranches: branches, nodes: 16, depth: 3, operands: 32, unwrapMembership: value => value } };
}

/** Native Drizzle reads retain OrderItem/OrderShipping wrappers. The public
 * detail selection requests the wrapper; item/shipping method leaves travel
 * through its owning relation before native formatOrder flattens the result. */
export function prepareOrderFinanceQuery(catalog: ReadCatalog, tables: readonly SchemaTable[]) {
  const byName = new Map(tables.map(table => [table.name, table]));
  const policy = (table: string, paths: readonly string[]): ProjectionPolicy => {
    const members = [...new Set(paths.map(path => path.split(".")[0]!))]
      .flatMap(name => { const relation = catalog.relations.get(table)?.get(name); return relation === undefined ? [] : [relation]; });
    return { keys: "retain", storageKeys: "last", joinKeys: "retain", incomingKeys: true, allowWildcard: true,
      selectableRelations: members.map(relation => relation.name),
      nested: new Map(members.map(relation => [relation.name, policy(relation.targetTable,
        paths.filter(path => path.startsWith(relation.name + ".")).map(path => path.slice(relation.name.length + 1)))])) };
  };
  const query = (table: SchemaTable, input: unknown) => Result.gen(function* () {
    const envelope = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeQuery)), options = envelope.options ?? {}, paths: string[] = [], fields: string[] = [];
    const translate = (path: string, selection: boolean) => Result.gen(function* () {
      let translated = path;
      if (table.name === "order") {
        if (path === "items.detail") translated = "items.*";
        else if (path.startsWith("items.detail.")) translated = "items." + path.slice("items.detail.".length);
        else if (path === "items") translated = "items.item";
        else if (path.startsWith("items.") && !path.startsWith("items.item.")) translated = "items.item." + path.slice("items.".length);
        else if (path === "shipping_methods.detail") translated = "shipping_methods.*";
        else if (path.startsWith("shipping_methods.detail.")) translated = "shipping_methods." + path.slice("shipping_methods.detail.".length);
        else if (path === "shipping_methods") translated = "shipping_methods.shipping_method";
        else if (path.startsWith("shipping_methods.") && !path.startsWith("shipping_methods.shipping_method."))
          translated = "shipping_methods.shipping_method." + path.slice("shipping_methods.".length);
      }
      let source = table.name; const prefix: string[] = [], parts = translated.split(".");
      if (parts.length > 5) return yield* Result.fail(commerceError("unsupportedProfile"));
      for (const [index, name] of parts.entries()) {
        const relation = catalog.relations.get(source)?.get(name);
        if (relation !== undefined) { prefix.push(name); paths.push(prefix.join(".")); source = relation.targetTable; }
        else {
          const target = byName.get(source);
          if (index !== parts.length - 1 || target === undefined || name !== "*" && !target.columns.some(column => column.name === name))
            return yield* Result.fail(commerceError("unsupportedProfile"));
        }
      }
      if (selection) {
        const terminal = parts[parts.length - 1];
        // A terminal relation selects its complete child, expressed by the
        // population path. Scalar/wildcard leaves enter ordinary projection.
        if (terminal === "*" || byName.get(source)?.columns.some(column => column.name === terminal)) fields.push(translated);
      }
    });
    for (const path of options.populate ?? []) yield* translate(path, false);
    for (const field of options.fields ?? []) yield* translate(field, true);
    // Loading the owned entity is native wrapper behavior even when only its
    // detail was selected. All scalar contracts remain metadata checked.
    if (table.name === "order") {
      if (paths.includes("items")) paths.push("items.item");
      if (paths.includes("shipping_methods")) paths.push("shipping_methods.shipping_method");
    }
    const selected = [...new Set(paths)], projectionPolicy = policy(table.name, selected);
    if (selected.some(path => !populations.get(table.name)?.includes(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
    const projection = yield* compileProjection(catalog, table.name, options.fields === undefined ? undefined : fields,
      selected, projectionPolicy);
    const predicate = yield* compileWhere(envelope.where ?? {}, orderFinanceWhere(table));
    const ordering = new Map<string, string>();
    if (options.orderBy?.actions !== undefined) {
      if (table.name !== "order_change" || !selected.includes("actions")) return yield* Result.fail(commerceError("unsupportedProfile"));
      const actions = catalog.relations.get(table.name)?.get("actions");
      if (actions === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      ordering.set(actions.targetTable, "ordering");
    }
    return { table: table.name, projection, paths: selected, relationFilters: [], ordering, withDeleted: false,
      query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] } },
      window: { kind: "catalog", order: "id", select: orderedCatalog("asc") },
    } satisfies ReadPlan;
  });
  return { query };
}

/** Match each versioned child to its own parent, including multi-Order reads.
 * This is the module's versioned relation contract, not a global read filter. */
export function orderFinanceVersionFilters(table: string, paths: readonly string[], rows: readonly JsonObject[]) {
  return Result.gen(function* () {
    const selected = ["items", "shipping_methods", "summary", "credit_lines"].filter(path => paths.includes(path));
    if (table !== "order" || selected.length === 0) return [];
    const parents: Array<Result.Result.Success<ReturnType<typeof parentVersion>>> = [];
    for (const row of rows) parents.push(yield* parentVersion({ id: row.id, version: row.version }));
    return selected.map((path): PopulationFilter => ({ path,
      predicate: { kind: "or", children: parents.map(row => ({ kind: "and", children: [
        { kind: "in", column: "order_id", values: [row.id] },
        { kind: "numberIn", column: "version", values: [row.version] },
      ] })) } satisfies Predicate }));
  });
}
