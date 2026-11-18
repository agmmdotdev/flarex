import { Result, Schema } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { QueryLimit } from "../../query/decoder";
import type { WherePolicy } from "../../query/predicate";

export const InventoryLevelDeletionIds = Schema.Array(ScalarId).check(Schema.isMaxLength(4));
const Member = Schema.Union([ScalarId, InventoryLevelDeletionIds]);
const Tuple = Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId });
export const InventoryLevelDeletionFilters = Schema.Struct({ id: Schema.optionalKey(Member),
  inventory_item_id: Schema.optionalKey(Member), location_id: Schema.optionalKey(Member),
  $or: Schema.optionalKey(Schema.Array(Tuple).check(Schema.isMaxLength(4))) });
export const InventoryLevelDeletionInput = Schema.Struct({ ...InventoryLevelDeletionFilters.fields, force: Schema.optionalKey(Schema.Boolean) });
export const InventoryLevelDeletionReadInput = Schema.Struct({ filters: Schema.optionalKey(InventoryLevelDeletionFilters),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 16), Schema.makeFilter(fields => fields.includes("id")))),
    relations: Schema.optionalKey(Schema.Array(Schema.Never)), take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })) })) });
export const InventoryLevelDeletionOutput = Schema.Struct({ inventory_level_id: Schema.optionalKey(InventoryLevelDeletionIds) });
export const decodeInventoryLevelDeletionIds = commerceDecoder(InventoryLevelDeletionIds, "invalidInput");
export const decodeInventoryLevelDeletionReadInput = commerceDecoder(InventoryLevelDeletionReadInput, "invalidInput");
export const decodeInventoryLevelDeletionOutput = commerceDecoder(InventoryLevelDeletionOutput, "storedCorruption");
export const decodeInventoryLevelDeletionArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([InventoryLevelDeletionIds]), Schema.Tuple([InventoryLevelDeletionIds, Schema.Struct({})]),
]), "invalidInput");
const decodeMember = commerceDecoder(Member, "unsupportedProfile");
export const inventoryLevelDeletionWhere: WherePolicy = { decode: commerceDecoder(InventoryLevelDeletionFilters, "unsupportedProfile"),
  fields: new Map(["id", "inventory_item_id", "location_id"].map(column => [column, { column, decode: decodeMember }])),
  selectors: { mode: "tuples", key: "id", decode: commerceDecoder(Schema.Array(Tuple).check(Schema.isMaxLength(4)), "unsupportedProfile") } };

/** Receipt filtering uses only the admitted scalar and tuple grammar, rather
 * than adding native query operators or granting another persistence path. */
export function matchesInventoryLevelDeletionFilter(row: JsonObject, filters: typeof InventoryLevelDeletionFilters.Type): boolean {
  for (const field of ["id", "inventory_item_id", "location_id"] as const) {
    const selected = filters[field];
    if (selected !== undefined && !(Array.isArray(selected) ? selected : [selected]).includes(String(row[field]))) return false;
  }
  return filters.$or === undefined || filters.$or.some(pair => row.inventory_item_id === pair.inventory_item_id && row.location_id === pair.location_id);
}

/** The authenticated core reader may hydrate a scalar prefix before applying
 * the other native AND terms. Candidates must still belong to an explicitly
 * requested membership or complete tuple; this does not choose an index. */
export function matchesInventoryLevelDeletionCandidate(row: JsonObject, filters: typeof InventoryLevelDeletionFilters.Type): boolean {
  const fields = ["id", "inventory_item_id", "location_id"] as const;
  if (fields.every(field => filters[field] === undefined) && filters.$or === undefined) return true;
  return fields.some(field => {
    const selected = filters[field];
    return selected !== undefined && (Array.isArray(selected) ? selected : [selected]).includes(String(row[field]));
  }) || (filters.$or?.some(pair => row.inventory_item_id === pair.inventory_item_id && row.location_id === pair.location_id) ?? false);
}
/** Generated service maps omit their key on an empty lifecycle selection. */
export const decodeInventoryLevelDeletionResult = (input: unknown) => decodeInventoryLevelDeletionOutput(input).pipe(Result.flatMap(result =>
  result.inventory_level_id?.length === 0 ? Result.fail(commerceError("storedCorruption")) : Result.succeed(result)));
