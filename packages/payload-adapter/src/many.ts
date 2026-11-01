import { Result, Schema } from "effect";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import {
  capturePrivateJsonData,
  cmsError,
  cmsLimits,
  type CmsTransactionError,
} from "@flarex/persistence-postgres/internal/cms-adapter";
import { payloadRelatedPostsField } from "./contract";

const decodeManyIds = Schema.decodeUnknownResult(Schema.Array(DeveloperDocumentIdSchema).check(
  Schema.isMaxLength(payloadRelatedPostsField.maxItems),
  Schema.makeFilter(ids => new Set(ids).size === ids.length ? undefined : "Payload many identities must be distinct"),
));

/** Pure input capture; the request's posts capability subsequently checks table authority. */
export function payloadManyIds(input: unknown): Result.Result<readonly string[], CmsTransactionError> {
  return Result.gen(function* () {
    const value = (yield* capturePrivateJsonData(input, cmsLimits.documentBytes, cmsError)).value;
    const ids = yield* decodeManyIds(value).pipe(Result.mapError(cause => cmsError("relationInvalid", cause)));
    return Object.freeze(ids);
  });
}
