import { Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";

const captureArray = Effect.fn("ApiKey.captureNativeArray")(function* (input: unknown) {
  const captured = yield* Effect.try({ try: () => {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw commerceError("unsupportedProfile");
    return { properties: Object.getOwnPropertyDescriptors(input), length: Object.getOwnPropertyDescriptor(input, "length") };
  }, catch: cause => commerceError("unsupportedProfile", cause) });
  const length: unknown = captured.length?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 4 || Reflect.ownKeys(captured.properties).length !== length + 1)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = captured.properties[String(index)];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    values.push(descriptor.value);
  }
  return values;
});

/** Convert only the native service's revocation comparison Dates. The two-
 * branch deletion guard and generated ID branches retain descriptor capture;
 * ordinary JSON queue capture still owns bounds and every other value. */
export const captureApiKeyNativeQuery = Effect.fn("ApiKey.captureNativeTimestampQuery")(function* (input: unknown) {
  const envelope = yield* captureNativeRecord(input);
  if (envelope.where === undefined) return envelope;
  const where = yield* captureNativeRecord(envelope.where);
  if (Object.hasOwn(where, "revoked_at") && where.revoked_at !== null)
    where.revoked_at = yield* captureNativeDateRecord(where.revoked_at, ["$gt", "$lt"]);
  if (Object.hasOwn(where, "$or")) {
    const branches: Record<string, unknown>[] = [];
    for (const value of yield* captureArray(where.$or)) {
      const branch = yield* captureNativeRecord(value);
      if (Object.hasOwn(branch, "revoked_at") && branch.revoked_at !== null)
        branch.revoked_at = yield* captureNativeDateRecord(branch.revoked_at, ["$gt", "$lt"]);
      branches.push(branch);
    }
    where.$or = branches;
  }
  return { ...envelope, where };
});

/** Only the selected business date accepts a genuine Date. Entity snapshots,
 * managed timestamps and all other update fields remain ordinary JSON. */
export const captureApiKeyNativeUpdates = Effect.fn("ApiKey.captureNativeUpdates")(function* (input: unknown) {
  const rows: Record<string, unknown>[] = [];
  for (const value of yield* captureArray(input)) {
    const pair = yield* captureNativeRecord(value);
    rows.push({ ...pair, update: yield* captureNativeDateRecord(pair.update, ["revoked_at"]) });
  }
  return rows;
});
