import { Effect, Schema } from "effect";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import type { Json } from "flarex-protocol/json";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { cmsLimits } from "../cmsTransaction/model";
import { capturePrivateJsonData } from "../privateJsonData";
import { compositeError } from "./model";

// The envelope is fixed; each framework still owns validation of its payload.
const CurrencyAnnouncementArguments = Schema.Struct({
  currency: Schema.JsonObject,
  cms: Schema.JsonObject,
  application: Schema.JsonObject,
});
export type CurrencyAnnouncementArguments =
  typeof CurrencyAnnouncementArguments.Type;
const isArguments = Schema.is(CurrencyAnnouncementArguments);
const decodeKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);

const hash = makeLivePrivateSha256V1({
  invalidBudget: () => compositeError("limitExceeded"),
  invalidBytes: () => compositeError("invalidInput"),
  inputBytesExceeded: () => compositeError("limitExceeded"),
  unavailable: () => compositeError("resourceFailure"),
  nativeRejected: (cause) => compositeError("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid composite command digest"),
});
export const hashCurrencyAnnouncement = (bytes: Uint8Array) =>
  hash(bytes, { maximumInputBytes: cmsLimits.commandBytes });

export const captureCurrencyAnnouncementRequest = Effect.fn(
  "CurrencyAnnouncement.captureRequest",
)(function* (requestKey: string, args: Json) {
  // Capture first: Schema alone does not provide getter avoidance or byte ownership.
  const captured = yield* Effect.fromResult(
    capturePrivateJsonData(args, cmsLimits.commandBytes, compositeError),
  );
  // Schema.is preserves the captured frozen objects; its structural check allows
  // excess keys, so enforce this command's closed three-field envelope here.
  if (
    !isArguments(captured.value) ||
    Object.keys(captured.value).length !== 3
  ) {
    return yield* Effect.fail(compositeError("invalidInput"));
  }
  const argumentsValue = captured.value;
  const key = yield* decodeKey(requestKey).pipe(
    Effect.mapError((cause) => compositeError("invalidInput", cause)),
  );
  // Retain the existing private namespace and lexical contract for replay.
  if (!/^composite\/[0-9a-f-]{36}$/.test(key)) {
    return yield* Effect.fail(compositeError("invalidInput"));
  }
  return { key, argumentsValue, captured };
});
