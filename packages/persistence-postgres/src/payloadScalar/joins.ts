import { Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../privateJsonData";
import { cmsError, type CmsTransactionError } from "../cmsTransaction/model";
import { payloadJoins } from "./contract";

export type PayloadJoinQuery = Readonly<Record<"referencedBy" | "referencedByMany", false | Readonly<{ limit: number }>>>;

type MutablePayloadJoinQuery = { -readonly [Key in keyof PayloadJoinQuery]: PayloadJoinQuery[Key] };

/** The foreign sanitizer may add only an empty where object; caller predicates remain refused. */
export function payloadJoinQuery(input: unknown, sanitized = false): Result.Result<PayloadJoinQuery, CmsTransactionError> {
  return Result.gen(function* () {
    const value = (yield* capturePrivateJsonData(input === undefined ? {} : input, 4096, cmsError)).value;
    if (value !== false && (!isJsonObject(value) || Object.keys(value).some(name => !payloadJoins.some(join => join.name === name)))) {
      return yield* Result.fail(cmsError("unsupportedProfile"));
    }
    const query: MutablePayloadJoinQuery = { referencedBy: false, referencedByMany: false };
    for (const join of payloadJoins) {
      const options = value === false ? false : value[join.name];
      if (options === false) continue;
      if (options !== undefined && (!isJsonObject(options) || Object.keys(options).some(key =>
        !["limit", "page", "count", ...(sanitized ? ["where"] : [])].includes(key)))) return yield* Result.fail(cmsError("unsupportedProfile"));
      if (isJsonObject(options) && ((options.page !== undefined && options.page !== 1) ||
        (options.count !== undefined && options.count !== false) ||
        (options.where !== undefined && (!isJsonObject(options.where) || Object.keys(options.where).length !== 0)))) return yield* Result.fail(cmsError("unsupportedProfile"));
      const limit = isJsonObject(options) ? options.limit === undefined ? join.defaultLimit : options.limit : join.defaultLimit;
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > join.maximumLimit) return yield* Result.fail(cmsError("unsupportedProfile"));
      query[join.name] = Object.freeze({ limit });
    }
    return Object.freeze(query);
  });
}
