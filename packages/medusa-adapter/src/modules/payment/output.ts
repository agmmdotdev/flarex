import { Effect, Result, Schema } from "effect";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";
import { PaymentId } from "./input";
import type { capturePaymentMetadata } from "./schema";

const object = commerceDecoder(Schema.JsonObject, "storedCorruption"), id = commerceDecoder(PaymentId, "storedCorruption");
const empty = commerceDecoder(Schema.Array(Schema.Never), "storedCorruption");
export function compilePaymentContracts(metadata: Effect.Success<ReturnType<typeof capturePaymentMetadata>>["frame"]) {
  return Result.gen(function* () {
    const collection = metadata.tables.find(table => table.name === "payment_collection"), session = metadata.tables.find(table => table.name === "payment_session");
    if (collection === undefined || session === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const collectionComplete = yield* compileCompleteRow(collection), sessionComplete = yield* compileCompleteRow(session);
    const collectionProjection = yield* compileRowProjection(collection), sessionProjection = yield* compileRowProjection(session);
    const keyed = (decode: typeof collectionComplete) => (input: unknown) => Result.gen(function* () {
      const row = yield* decode(input); const result: JsonObject & { readonly id: string } = { ...row, id: yield* id(row.id) }; return result;
    });
    const decodeCollection = keyed(collectionComplete), decodeSession = keyed(sessionComplete);
    const decodeCreatedCollection = (input: unknown) => Result.gen(function* () {
      const value = yield* object(input), { payment_providers, payment_sessions, payments, ...scalar } = value;
      return { ...yield* decodeCollection(scalar), payment_providers: yield* empty(payment_providers),
        payment_sessions: yield* empty(payment_sessions), payments: yield* empty(payments) };
    });
    const collectionNumbers = collection.columns.filter(column => column.type === "bigNumber"), sessionNumbers = session.columns.filter(column => column.type === "bigNumber");
    const present = Effect.fn("Payment.present")(function* (input: Json): Effect.fn.Return<Json, ReturnType<typeof commerceError>> {
      const rows: JsonObject[] = [];
      for (const value of Array.isArray(input) ? input : [input]) {
        const row = yield* Effect.fromResult(object(value));
        if ("provider_id" in row) {
          const { payment_collection, ...scalar } = row;
          yield* Effect.fromResult(sessionProjection(scalar));
          const result = yield* projectExactNumericColumns(scalar, sessionNumbers, "reserialize");
          if (!isJsonObject(result)) return yield* Effect.fail(commerceError("storedCorruption"));
          rows.push(payment_collection === undefined ? result : { ...result, payment_collection });
        } else {
          const { payment_sessions, payment_providers, payments, ...scalar } = row;
          yield* Effect.fromResult(collectionProjection(scalar));
          const result = yield* projectExactNumericColumns(scalar, collectionNumbers, "reserialize");
          if (!isJsonObject(result)) return yield* Effect.fail(commerceError("storedCorruption"));
          rows.push({ ...result, ...(payment_sessions === undefined ? {} : { payment_sessions: yield* present(payment_sessions) }),
            ...(payment_providers === undefined ? {} : { payment_providers }), ...(payments === undefined ? {} : { payments }) });
        }
      }
      return Array.isArray(input) ? rows : rows[0]!;
    });
    return { collection, session, collectionNumbers, sessionNumbers, decodeCollection, decodeCreatedCollection, decodeSession, present,
      tables: metadata.tables };
  });
}
