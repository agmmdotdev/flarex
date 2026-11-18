import { Effect, Result, Schema } from "effect";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope } from "../../query/decoder";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, projectRows, type ProjectionPolicy } from "../../query/projection";
import { compileWhere } from "../../query/predicate";
import { executeRead, type ReadContext, type ReadPlan } from "../../query/read";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import type { CommerceRelationOrder } from "../../query/relations";
import type { compileFulfillmentCreationContracts } from "./fulfillment-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentCreationContracts>>;
/** Private evidence from the actual populated read, before native hooks expose
 * an ID relation for a filtered hasOne target. It carries no write authority. */
export interface FulfillmentNativeHydration {
  readonly id: string;
  readonly dirtyReferences: readonly { readonly column: string; readonly key: string }[];
}
const envelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const optionsDecoder = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(32))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(5))),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })) }), "unsupportedProfile");
const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };

/** Native selected DTOs and full internal Items/Labels hydration share the
 * existing read/projection owner; source rows stay complete and checked. */
export function prepareFulfillmentShipmentQuery(contracts: Contracts) {
  return Result.gen(function* () {
    const ordering: ReadonlyMap<string, CommerceRelationOrder> = new Map([
      [contracts.label.table.name, { kind: "storageInsertion", direction: "asc" }],
      [contracts.item.table.name, { kind: "storageInsertion", direction: "asc" }],
    ]);
    const catalog = yield* makeReadCatalog(contracts.entities.map(entity => {
      const companions: Readonly<Record<string, string>> = entity === contracts.item ? { quantity: "raw_quantity" } : {};
      return { name: entity.table.name, primaryKeys: ["id"], columns: entity.table.columns.map(column => column.name),
        foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns), companions };
    }), contracts.queryRelations);
    const query = (input: unknown) => Result.gen(function* () {
      const captured = yield* envelope(yield* captureCommerceInput(input)), options = yield* optionsDecoder(captured.options ?? {}), fields = options.fields;
      const requested = options.populate ?? [], allowed = ["items", "labels", ...contracts.referenceFields.map(field => field.name)];
      if (requested.some(path => !allowed.includes(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
      const referenceOnly = fields?.length === 0 && requested.length === 0;
      const implicit = contracts.referenceFields.filter(field => fields === undefined || referenceOnly || fields.includes(field.column)).map(field => field.name);
      const paths = [...new Set([...requested, ...implicit])];
      const policy: ProjectionPolicy = { ...leaf, allowedPaths: allowed, selectableRelations: allowed,
        nested: new Map(allowed.map(name => [name, name === "labels" ? { ...leaf, allowWildcard: true } : leaf])) };
      const selected = fields === undefined ? undefined : [...fields, "id", ...implicit.map(name => name + ".id"),
        ...(referenceOnly ? contracts.referenceFields.map(field => field.column) : [])];
      const projection = yield* compileProjection(catalog, contracts.fulfillment.table.name, selected, paths, policy);
      // Read complete owned rows before native FK presentation. The selected
      // projection is applied only after that view is established.
      const fullRoot = { ...projection.node, fields: new Set([...contracts.fulfillment.table.columns.map(column => column.name), ...paths]) };
      const plan: ReadPlan = { table: contracts.fulfillment.table.name, projection: { ...projection, node: fullRoot }, paths,
        ordering, relationFilters: [], withDeleted: false,
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
          yield* compileWhere(captured.where ?? {}, scalarIdWhere), { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: rows => ({ rows, count: rows.length }) } };
      const project = (rows: readonly JsonObject[]) => Result.gen(function* () {
        const native: JsonObject[] = [], omittedReferences: Array<ReadonlySet<string>> = [];
        for (const row of rows) {
          let output = contracts.initializeRead(row, row);
          const omitted = new Set<string>();
          if (fields !== undefined) for (const field of contracts.referenceFields) if (referenceOnly || fields.includes(field.column)) {
            const id = row[field.column];
            if (id !== null && typeof id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
            const relation = id === null ? null : { id }, populated = row[field.name] ?? null;
            // Empty native selection exposes filtered belongsTo references as
            // null pairs, but omits filtered hasOneWithFK pairs altogether.
            // Full/default reads retain their separate owning-FK presentation.
            if (referenceOnly && id !== null && populated === null) {
              output = { ...output, [field.name]: null, [field.column]: null };
              if (field.nativeKind === "hasOneWithFK") { omitted.add(field.name); omitted.add(field.column); }
              continue;
            }
            output = { ...output, [field.name]: relation,
              ...(field.nativeKind === "belongsTo" ? { [field.column]: isJsonObject(populated) ? populated.id ?? null : null } : {}) };
          }
          native.push(output);
          omittedReferences.push(omitted);
        }
        const projected = yield* projectRows(native, projection.node);
        return projected.map((row, index) => Object.fromEntries(Object.entries(row).filter(([name]) => !omittedReferences[index]?.has(name))));
      });
      return { ...plan, selectedProjection: projection, fields, project };
    });
    const admitSelection: NonNullable<ReadContext["admitSelection"]> = (table, rows) => Result.gen(function* () {
      const entity = contracts.entities.find(entity => entity.table.name === table);
      if (entity === undefined || entity !== contracts.label && rows.length > entity.maximum ||
        entity === contracts.label && rows.filter(row => row.deleted_at === null).length > 4) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* entity.decodeRow(projectNativeRow(row));
    });
    const hydration = (rows: readonly JsonObject[]) => Result.gen(function* () {
      const output: FulfillmentNativeHydration[] = [];
      for (const row of rows) {
        if (typeof row.id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
        const dirtyReferences: Array<{ column: string; key: string }> = [];
        for (const field of contracts.referenceFields) {
          if (field.nativeKind !== "hasOneWithFK" || !Object.hasOwn(row, field.name)) continue;
          const key = row[field.column];
          if (key !== null && typeof key !== "string") return yield* Result.fail(commerceError("storedCorruption"));
          // Native OnInit reconstructs this relation from its owning FK after
          // active population filtered its target. ORM assignment then writes
          // that same FK and its managed clock, even for an empty update.
          if (key !== null && row[field.name] === null) dirtyReferences.push({ column: field.column, key });
        }
        output.push({ id: row.id, dirtyReferences });
      }
      return output;
    });
    const find = Effect.fn("FulfillmentShipment.find")(function* (ctx: ReadContext, input: unknown) {
      const plan = yield* Effect.fromResult(query(input)), selected = yield* executeRead({ ...ctx, admitSelection }, catalog, plan, false);
      return { rows: yield* Effect.fromResult(plan.project(selected.rows)), hydration: yield* Effect.fromResult(hydration(selected.rows)) };
    });
    return { catalog, query, find, hydration, admitSelection, ordering };
  });
}
