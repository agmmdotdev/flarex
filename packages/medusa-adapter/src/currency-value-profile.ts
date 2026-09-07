import { Result, Schema } from "effect";
import { Currency } from "@medusajs/currency/models";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { readCurrencyMetadata, type CurrencyDmlSource } from "./currency-schema";
import { commerceDecoder } from "./commerce-decoder";

/** Compile from the admitted DML, then apply the adapter's representation rules.
 * Ordinary write-column validation remains owned by persistence. */
export const compileCurrencyValueProfile = (model: CurrencyDmlSource) => readCurrencyMetadata(model).pipe(
  Result.map(metadata => {
    const fields = Object.values(metadata.schema);
    const textFields = fields.filter((field): field is Extract<typeof field, { dataType: { name: "text" } }> =>
      field.dataType.name === "text",
    ).map(field => field.fieldName);
    const writableFields = fields.filter(field =>
      field.dataType.name !== "dateTime" && field.dataType.name !== "json"
      && field.fieldName !== metadata.schema.code.fieldName && field.fieldName !== metadata.schema.rounding.fieldName,
    ).map(field => field.fieldName);
    const NumericInput = Schema.Union([Schema.String, Schema.Number]);
    const Projection = Schema.StructWithRest(
      Schema.Record(Schema.Literals(textFields), Schema.optionalKey(Schema.String)),
      [Schema.Record(Schema.String, Schema.Json)],
    );
    const WriteRow = Schema.StructWithRest(Schema.Struct({
      [metadata.schema.code.fieldName]: Schema.String.check(Schema.isLengthBetween(1, 256)),
      [metadata.schema.rounding.fieldName]: Schema.optionalKey(NumericInput),
    }), [Schema.Record(Schema.Literals(writableFields), Schema.optionalKey(Schema.Json))]);
    return {
      decodeWriteRow: commerceDecoder(WriteRow, "invalidInput"),
      decodeStoredRow: commerceDecoder(Schema.Record(
        Schema.Literals(fields.map(field => field.fieldName)), Schema.optionalKey(Schema.Json),
      ), "storedCorruption"),
      decodeProjection: commerceDecoder(Projection, "storedCorruption"),
      decodeProjections: commerceDecoder(Schema.Array(Projection), "storedCorruption"),
      decodeCountResult: commerceDecoder(Schema.Tuple([Schema.Array(Projection), Schema.Number]), "storedCorruption"),
    };
  }),
  Result.mapError(cause => commerceError("unsupportedProfile", cause)),
);

// Metadata parsing and Schema compilation happen once for the pinned model.
// Retain initialization failures as typed data until an operation consumes them.
export const currencyValueProfile = compileCurrencyValueProfile(Currency);
