import { Effect, Schema } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../privateJsonData";
import { cmsError } from "../cmsTransaction/model";

const text = Schema.String.check(Schema.makeFilter(value => value.length > 0 && value.length <= 512 ? undefined : "Expected bounded identity"));
const date = Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value)) ? undefined : "Expected date"));
const decode = Schema.decodeUnknownEffect(Schema.Struct({
  id: text, key: Schema.NullOr(Schema.String), user: Schema.Struct({ relationTo: Schema.Literal("users"), value: text }),
  value: Schema.Unknown, createdAt: date, updatedAt: date,
}), { onExcessProperty: "error" });
function isSqlText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function isSqlJson(value: Json): boolean {
  if (typeof value === "string") return isSqlText(value);
  if (Array.isArray(value)) return value.every(isSqlJson);
  if (isJsonObject(value)) return Object.entries(value).every(([key, child]) => isSqlText(key) && isSqlJson(child));
  return true;
}
export const capturePayloadPreferenceRecord = Effect.fn("PayloadPreferences.captureRecord")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(input, 65_536, cmsError));
  if (!isSqlJson(captured.value)) return yield* Effect.fail(cmsError("invalidInput"));
  const record = yield* decode(captured.value).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
  // Descriptor-safe capture owns the recursive JSON tree; Schema owns its exact outer shape.
  if (!isJsonObject(captured.value)) return yield* Effect.fail(cmsError("invalidInput"));
  const value: Json = captured.value.value ?? null;
  return { ...record, value, createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString() };
});
