import { Result, Schema } from "effect";
import { JsonValue, type Json } from "flarex-protocol/json";
import { capturePrivateJsonData, cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";

// Native Payload owns the fields; this boundary authenticates the result envelope
// and retains all captured fields, including populated documents and join pages.
const Document = Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, JsonValue)]);
const Page = Schema.Struct({
  docs: Schema.Array(Document), totalDocs: Schema.Number, limit: Schema.Number,
  totalPages: Schema.Number, page: Schema.Number, pagingCounter: Schema.Number,
  hasPrevPage: Schema.Boolean, hasNextPage: Schema.Boolean,
  prevPage: Schema.NullOr(Schema.Number), nextPage: Schema.NullOr(Schema.Number),
});
const Count = Schema.Struct({ totalDocs: Schema.Number });
const decodeDocument = Schema.decodeUnknownResult(Document, { onExcessProperty: "error" });
const decodePage = Schema.decodeUnknownResult(Page, { onExcessProperty: "error" });
const decodeCount = Schema.decodeUnknownResult(Count, { onExcessProperty: "error" });

function capture<A extends Json>(decode: (value: unknown) => Result.Result<A, Schema.SchemaError>, value: unknown) {
  return capturePrivateJsonData(value, 1_048_576, cmsError).pipe(Result.flatMap(captured =>
    decode(captured.value).pipe(Result.mapError(cause => cmsError("storedCorruption", cause)))));
}

export const payloadResults = {
  document: (value: unknown) => capture(decodeDocument, value),
  page: (value: unknown) => capture(decodePage, value),
  count: (value: unknown) => capture(decodeCount, value),
};
export type PayloadDocument = typeof Document.Type;
export type PayloadPageResult = typeof Page.Type;
export type PayloadCountResult = typeof Count.Type;
