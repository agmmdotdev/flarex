import { Schema } from "effect";
import { ScalarId } from "../../repository/scalar-id-read";

export const InventoryId = ScalarId;
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Dimension = Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isFinite())));
export const InventoryItemInput = Schema.Struct({ id: Schema.optionalKey(InventoryId), sku: Text, origin_country: Text,
  hs_code: Text, mid_code: Text, material: Text, weight: Dimension, length: Dimension, height: Dimension, width: Dimension,
  requires_shipping: Schema.optionalKey(Schema.Boolean), description: Text, title: Text, thumbnail: Text,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
