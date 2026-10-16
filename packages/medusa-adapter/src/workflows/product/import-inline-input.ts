import { Effect, Schema } from "effect";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { makeTaskInputReferenceV1, decodeTaskInputReferenceV1 } from "@flarex/durable-task/internal/run-creation-v1";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { PRODUCT_IMPORT_MAX_CSV_BYTES, PRODUCT_IMPORT_MAX_CSV_RECORDS } from "@medusajs/core-flows/durable/product/normalize-products-step";
import { capturePrivateJsonData, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

const utf8 = new TextEncoder();
export const productInlineImportProfile = "medusa.product.inline-import";
export const productInlineImportPolicy = Object.freeze({
  maximumCsvBytes: PRODUCT_IMPORT_MAX_CSV_BYTES,
  maximumCsvRecords: PRODUCT_IMPORT_MAX_CSV_RECORDS,
  maximumProducts: 4, maximumVariants: 4, maximumFilenameBytes: 256,
  confirmationTimeoutSeconds: 3600, maximumNotificationOccurrences: 2,
});
const Input = Schema.Struct({
  fileContent: Schema.String.check(Schema.makeFilter(value => utf8.encode(value).byteLength <= PRODUCT_IMPORT_MAX_CSV_BYTES)),
  filename: Schema.String.check(Schema.makeFilter(value => utf8.encode(value).byteLength <= productInlineImportPolicy.maximumFilenameBytes)),
});
export type ProductInlineImportInput = typeof Input.Type;
const decodeInput = Schema.decodeUnknownEffect(Input, { onExcessProperty: "error" });
export const ProductInlineImportSummary = Schema.Struct({
  toCreate: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  toUpdate: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
}).check(Schema.makeFilter(value => value.toCreate + value.toUpdate <= 4));

/** The native parser still owns CSV normalization and validation. This facade
 * captures its bounded two-field transport and commits that exact Task input. */
export const prepareProductInlineImportInput = Effect.fn("ProductImport.prepareInput")(function* (raw: unknown) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(raw,
    PRODUCT_IMPORT_MAX_CSV_BYTES * 6 + 2048, commerceError));
  const value = yield* decodeInput(captured.value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const canonical = yield* canonicalizeFlarexValueV1Effect(value);
  const reference = yield* Effect.fromResult(makeTaskInputReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  return Object.freeze({ value: Object.freeze(value), reference, canonicalBytes: canonical.canonicalBytes });
});

/** The outer Task body owner supplies original input on every fresh attempt.
 * A missing or changed body cannot authorize normalization or a fresh child. */
export const verifyProductInlineImportInput = Effect.fn("ProductImport.verifyInput")(function* (raw: unknown, expected: unknown) {
  const reference = yield* Effect.fromResult(decodeTaskInputReferenceV1(expected));
  const prepared = yield* prepareProductInlineImportInput(raw);
  if (reference.byteLength !== prepared.reference.byteLength ||
    !bytesEqualFullScan(reference.sha256, prepared.reference.sha256)) return yield* commerceError("requestConflict");
  return prepared.value;
});
