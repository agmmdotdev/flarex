import { Result, Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";

const object = commerceDecoder(Schema.JsonObject, "invalidInput");
const emptyImages = commerceDecoder(Schema.Tuple([]), "unsupportedProfile");
const selectorUpdate = commerceDecoder(Schema.Struct({ selector: Schema.Struct({ id: Schema.String }), data: Schema.JsonObject }), "unsupportedProfile");

/** Only scalar internal mutations and empty create-image lists are admitted.
 * The pinned service owns selector expansion, defaults, metadata merging, and exact missing-ID errors. */
export function productInternalInput(metadata: ProductRuntimeMetadata) {
  return (input: Json, update: boolean) => Result.gen(function* () {
    const rows = Array.isArray(input) ? input : [input];
    if (rows.length > 256) return yield* Result.fail(commerceError("limitExceeded"));
    for (const row of rows) {
      const decoded = yield* object(row);
      if (update && "selector" in decoded) {
        const pair = yield* selectorUpdate(decoded);
        yield* metadata.valueProfile.validateRelatedUpdateData(metadata.product.table.name, pair.data);
      } else {
        const { images, ...scalars } = decoded;
        yield* metadata.valueProfile.decodeInternalProductScalars(update ? decoded : scalars);
        if (!update && images !== undefined) yield* emptyImages(images);
        if (decoded.id !== undefined && typeof decoded.id !== "string") return yield* Result.fail(commerceError("invalidInput"));
      }
    }
  });
}
