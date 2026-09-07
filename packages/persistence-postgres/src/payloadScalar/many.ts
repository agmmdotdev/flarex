import { Result } from "effect";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { cmsError, type CmsTransactionError } from "../cmsTransaction/model";
import { capturePrivateJsonData } from "../privateJsonData";
import { payloadRelatedPostsField } from "./contract";

/** Pure input capture; the request's posts capability subsequently checks table authority. */
export function payloadManyIds(input: unknown): Result.Result<readonly string[], CmsTransactionError> {
  return Result.gen(function* () {
    const value = (yield* capturePrivateJsonData(input, 65_536, cmsError)).value;
    if (!Array.isArray(value) || value.length > payloadRelatedPostsField.maxItems) return yield* Result.fail(cmsError("relationInvalid"));
    const ids: string[] = [];
    for (const id of value) {
      if (typeof id !== "string") return yield* Result.fail(cmsError("relationInvalid"));
      yield* decodeAppDocumentIdentityV1Result(id).pipe(Result.mapError(cause => cmsError("relationInvalid", cause)));
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) return yield* Result.fail(cmsError("relationInvalid"));
    return Object.freeze(ids);
  });
}
