import { Schema } from "effect";
import { commerceDecoder } from "../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const decodeLinkCascade = commerceDecoder(Schema.Tuple([
  Schema.Union([Schema.Null, Schema.Array(Schema.Struct({ serviceName: Schema.String, method: Schema.String,
    args: Schema.Json, error: Schema.JsonObject })).check(Schema.isLengthBetween(1, 8))]),
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id).check(Schema.isMaxLength(16)))),
]), "storedCorruption");
