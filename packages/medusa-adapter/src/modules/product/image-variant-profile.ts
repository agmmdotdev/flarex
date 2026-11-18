import { Result, Schema } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import { commerceDecoder } from "../../value/decoder";
import { tupleKey } from "@medusajs/drizzle/relation-query";
import { VariantImagePairs } from "./variant-workflow-input";
import type { ReadPlan } from "../../query/read";

const thumbnail = commerceDecoder(Schema.String, "unsupportedProfile");
const assignmentWhere = commerceDecoder(Schema.Struct({ $or: VariantImagePairs.check(Schema.isMaxLength(4)) }), "unsupportedProfile");

/** Native thumbnail preparation reads complete sibling/Option cohorts. This
 * state belongs to one command-owned repository, never a workflow singleton. */
export function productImageVariantReadProfile(catalog: ProductRuntimeMetadata) {
  const identities = new Map<string, Set<string>>();
  const owners = new Map<string, Map<string, Set<string>>>();
  const parents = new Set<string>();
  const optionIds = new Set<string>();
  const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
    const maximum = table === catalog.variant.table.name ? 16
      : table === catalog.option.table.name || table === catalog.product.table.name ? 4
      : table === catalog.assignment.table.name ? 8 : undefined;
    const group = table === catalog.value.table.name ? catalog.foreignKeys.value
      : table === catalog.pivot.table.name ? catalog.pivot.variantColumn : undefined;
    const selected = identities.get(table) ?? new Set<string>();
    const grouped = owners.get(table) ?? new Map<string, Set<string>>();
    const definition = catalog.tables.find(candidate => candidate.name === table);
    const primary = definition?.columns.filter(column => column.primaryKey).map(column => column.name);
    const columns = primary?.length ? primary : definition?.foreignKeys.flatMap(key => key.columns);
    if (columns === undefined || columns.length === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const row of rows) {
      if (columns.some(column => typeof row[column] !== "string")) return yield* Result.fail(commerceError("storedCorruption"));
      const key = tupleKey(row, columns);
      selected.add(key);
      // Explicit preimage selects may omit the parent. The subsequent native
      // full preparation reads establish the complete parent cohort.
      const parentColumn = table === catalog.variant.table.name ? catalog.foreignKeys.variant : catalog.foreignKeys.option;
      if ((table === catalog.variant.table.name || table === catalog.option.table.name) && row[parentColumn] !== undefined) {
        const parent = row[parentColumn];
        if (typeof parent !== "string") return yield* Result.fail(commerceError("storedCorruption"));
        parents.add(parent);
      }
      if (table === catalog.product.table.name && typeof row.id === "string") parents.add(row.id);
      if (table === catalog.option.table.name && typeof row.id === "string") optionIds.add(row.id);
      if (group !== undefined) {
        const owner = row[group];
        if (typeof owner !== "string") return yield* Result.fail(commerceError("storedCorruption"));
        if (table === catalog.value.table.name) optionIds.add(owner);
        const members = grouped.get(owner) ?? new Set<string>();
        members.add(key);
        if (members.size > 4) return yield* Result.fail(commerceError("unsupportedProfile"));
        grouped.set(owner, members);
      }
    }
    if (parents.size > 4 || optionIds.size > 4 || maximum !== undefined && selected.size > maximum)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    identities.set(table, selected); owners.set(table, grouped);
  });
  const variant = catalog.relatedReads.get(catalog.variant.table.name);
  const where = variant === undefined ? undefined : { ...variant.where,
    fields: new Map([...variant.where.fields, ["thumbnail", { column: "thumbnail", decode: thumbnail }] as const]),
  };
  // The native full-row assignment query joins both active endpoints. Keep
  // this selected query shape separate from retained portable read profiles.
  const assignmentFilters = (input: JsonObject) => assignmentWhere(input).pipe(Result.map(({ $or: pairs }) => [
    { path: "image", predicate: { kind: "and", children: [
      { kind: "in", column: catalog.image.keyColumn, values: [...new Set(pairs.map(pair => pair.image_id))] },
      { kind: "isNull", column: "deleted_at" },
    ] } },
    { path: "variant", predicate: { kind: "and", children: [
      { kind: "in", column: catalog.variant.keyColumn, values: [...new Set(pairs.map(pair => pair.variant_id))] },
      { kind: "isNull", column: "deleted_at" },
    ] } },
  ] satisfies ReadPlan["relationFilters"]));
  return { admitSelection, where, assignmentFilters };
}
