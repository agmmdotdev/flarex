import { Result, Schema, type Effect } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { prepareScalarRepository } from "../../repository/scalar";
import type { WherePolicy } from "../../query/predicate";
import { TaxId } from "./query";
import type { captureTaxMetadata } from "./schema";

const Ids = Schema.Array(Schema.NullOr(TaxId)).check(Schema.isLengthBetween(1, 4));
const decodeIn = commerceDecoder(Schema.Struct({ $in: Ids }), "unsupportedProfile");
const where: WherePolicy = { decode: commerceDecoder(Schema.Struct({ id: Schema.Struct({ $in: Ids }) }), "unsupportedProfile"),
  fields: new Map([["id", { column: "id", decode: input => decodeIn(input).pipe(Result.map(value => value.$in)) }]]) };
const decodeRead = commerceDecoder(Schema.Struct({ where: Schema.Struct({ id: Schema.Struct({ $in: Ids }) }),
  options: Schema.Struct({ populate: Schema.Array(Schema.Never), fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("country_code")]),
    orderBy: Schema.Struct({ id: Schema.Literal("ASC") }) }) }), "unsupportedProfile");

/** Only the genuine existing-parent lookup is readable in this creation
 * profile. Native buildQuery owns membership deduplication and option shape;
 * scalar query planning owns the authenticated storage recipe. */
export function prepareTaxRegionParentRepository(region: Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"]["tables"][number]) {
  return Result.gen(function* () {
    const scalar = yield* prepareScalarRepository(region, "TaxRegion", where, undefined,
      { managedTimestamps: true, nativeToOneCreationPresence: region.relationships });
    const parentQuery = (input: unknown) => decodeRead(input).pipe(Result.flatMap(scalar.query));
    const parentQueryForIds = (ids: readonly (string | null)[]) => captureCommerceInput(buildQuery({ id: { $in: [...ids] } },
      { select: ["id", "country_code"], order: { id: "ASC" } })).pipe(Result.flatMap(parentQuery));
    return { ...scalar, parentQuery, parentQueryForIds };
  });
}
