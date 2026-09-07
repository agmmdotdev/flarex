import { Result } from "effect";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { cmsError, cmsLimits, type CmsTransactionError } from "../cmsTransaction/model";
import { capturePrivateJsonData } from "../privateJsonData";

export const maximumPayloadPopulationTargets = 32;

/** Pure decoding of the pinned loader's one generated query form, not authority. */
export function payloadPopulationIds(input: unknown): Result.Result<readonly string[] | null, CmsTransactionError> {
  return Result.gen(function* () {
    let value = (yield* capturePrivateJsonData(input ?? {}, cmsLimits.documentBytes, cmsError)).value;
    if (isJsonObject(value) && Object.keys(value).join() === "and" && Array.isArray(value.and) && value.and.length === 1) value = value.and[0] ?? null;
    if (!isJsonObject(value) || !isJsonObject(value.id) || !Object.hasOwn(value.id, "in")) return null;
    if (Object.keys(value).join() !== "id" || Object.keys(value.id).join() !== "in" || !Array.isArray(value.id.in) ||
      value.id.in.length === 0 || value.id.in.some(id => typeof id !== "string")) return yield* Result.fail(cmsError("invalidInput"));
    if (value.id.in.length > maximumPayloadPopulationTargets) return yield* Result.fail(cmsError("limitExceeded"));
    const ids: string[] = [];
    for (const id of value.id.in) {
      if (typeof id !== "string") return yield* Result.fail(cmsError("invalidInput"));
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) return yield* Result.fail(cmsError("invalidInput"));
    return Object.freeze(ids);
  });
}

/** One root read owns this ledger; it is never shared across requests or writes. */
export function makePayloadPopulation() {
  let registered = false;
  const references = new Map<string, number>();
  let rootBytes = 0;
  return Object.freeze({
    roots(documents: readonly JsonObject[]): Result.Result<void, CmsTransactionError> {
      return Result.gen(function* () {
        if (registered) return yield* Result.fail(cmsError("invalidAuthority"));
        registered = true;
        if (documents.length > cmsLimits.pageRows) return yield* Result.fail(cmsError("limitExceeded"));
        for (const document of documents) {
          rootBytes += (yield* capturePrivateJsonData(document, cmsLimits.documentBytes, cmsError)).bytes;
          const id = document.relatedPost;
          if (id === null || id === undefined) continue;
          if (typeof id !== "string") return yield* Result.fail(cmsError("storedCorruption", "invalid forward identity"));
          references.set(id, (references.get(id) ?? 0) + 1);
          if (references.size > maximumPayloadPopulationTargets) return yield* Result.fail(cmsError("limitExceeded"));
        }
        if (rootBytes > cmsLimits.commandBytes) return yield* Result.fail(cmsError("limitExceeded"));
      });
    },
    admit(ids: readonly string[]): Result.Result<void, CmsTransactionError> {
      if (!registered || ids.some(id => !references.has(id))) return Result.fail(cmsError("invalidAuthority"));
      return Result.succeed(undefined);
    },
    outputBytes(ids: readonly string[], documents: readonly (Json | null)[]): Result.Result<number, CmsTransactionError> {
      return Result.gen(function* () {
        if (ids.length !== documents.length) return yield* Result.fail(cmsError("storedCorruption", "population batch length"));
        let bytes = rootBytes;
        for (const [index, id] of ids.entries()) {
          const document = documents[index];
          if (document === null || document === undefined) return yield* Result.fail(cmsError("storedCorruption", { reason: "relationTargetMissing", documentId: id }));
          const occurrences = references.get(id);
          if (occurrences === undefined) return yield* Result.fail(cmsError("invalidAuthority"));
          bytes += (yield* capturePrivateJsonData(document, cmsLimits.documentBytes, cmsError)).bytes * occurrences;
          if (bytes > cmsLimits.commandBytes) return yield* Result.fail(cmsError("limitExceeded"));
        }
        return bytes;
      });
    },
  });
}
