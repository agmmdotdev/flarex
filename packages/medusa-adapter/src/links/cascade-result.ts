import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeCascadeTuple = commerceDecoder(Schema.Tuple([
  Schema.Union([Schema.Null, Schema.Array(Schema.Struct({ serviceName: Schema.String, method: Schema.String,
    args: Schema.Json, error: Schema.JsonObject })).check(Schema.isLengthBetween(1, 8))]),
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id).check(Schema.isMaxLength(16)))),
]), "storedCorruption");

/** Native cascade errors remain data inside Link. The atomic resource boundary
 * refuses them only after authenticating the whole tuple, retaining both the
 * reported errors and actual partial map for the existing sticky refusal owner. */
export const decodeLinkCascade = (value: unknown) => decodeCascadeTuple(value).pipe(
  Result.flatMap(tuple => tuple[0] === null
    ? Result.succeed<readonly [null, typeof tuple[1]]>([tuple[0], tuple[1]])
    : Result.fail(commerceError("adapterFailure", tuple))),
);
