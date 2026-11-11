import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";

const Direction = Schema.Literals(["ASC", "DESC"]);
/** Core retains its existing deterministic ties after one selected order column.
 * Collection's native Store defaults sort by created_at; other related models
 * retain their own id-only admission. */
export const decodeProductCollectionOrder = commerceDecoder(Schema.Struct({
  id: Schema.optionalKey(Direction), title: Schema.optionalKey(Direction), handle: Schema.optionalKey(Direction),
  created_at: Schema.optionalKey(Direction), updated_at: Schema.optionalKey(Direction),
}).check(Schema.makeFilter(order => {
  const columns = Object.keys(order).filter(column => column !== "id");
  return columns.length <= 1 && (columns.length === 0 || order.id === undefined ||
    order.id === "ASC" && Object.keys(order)[0] !== "id");
})), "unsupportedProfile");

export const ProductCollectionTextFilter = Schema.Union([
  Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
]);
