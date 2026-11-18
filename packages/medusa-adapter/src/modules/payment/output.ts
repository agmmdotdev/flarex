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
    const collection = metadata.tables.find(table => table.name === "payment_collection"), session = metadata.tables.find(table => table.name === "payment_session"),
      payment = metadata.tables.find(table => table.name === "payment"), capture = metadata.tables.find(table => table.name === "capture"),
      refund = metadata.tables.find(table => table.name === "refund"), reason = metadata.tables.find(table => table.name === "refund_reason"),
      holder = metadata.tables.find(table => table.name === "account_holder");
    if (collection === undefined || session === undefined || payment === undefined || capture === undefined || refund === undefined || reason === undefined || holder === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const collectionComplete = yield* compileCompleteRow(collection), sessionComplete = yield* compileCompleteRow(session);
    const collectionProjection = yield* compileRowProjection(collection), sessionProjection = yield* compileRowProjection(session);
    const keyed = (decode: typeof collectionComplete) => (input: unknown) => Result.gen(function* () {
      const row = yield* decode(input); const result: JsonObject & { readonly id: string } = { ...row, id: yield* id(row.id) }; return result;
    });
    const decodeCollection = keyed(collectionComplete), decodeSession = keyed(sessionComplete);
    const decodePayment = keyed(yield* compileCompleteRow(payment)), decodeCapture = keyed(yield* compileCompleteRow(capture)),
      decodeRefund = keyed(yield* compileCompleteRow(refund)), decodeReason = keyed(yield* compileCompleteRow(reason)), decodeHolder = keyed(yield* compileCompleteRow(holder));
    const holderProjection = yield* compileRowProjection(holder);
    const paymentProjection = yield* compileRowProjection(payment), captureProjection = yield* compileRowProjection(capture),
      refundProjection = yield* compileRowProjection(refund), reasonProjection = yield* compileRowProjection(reason);
    const decodeCreatedCollection = (input: unknown) => Result.gen(function* () {
      const value = yield* object(input), { payment_providers, payment_sessions, payments, ...scalar } = value;
      return { ...yield* decodeCollection(scalar), payment_providers: yield* empty(payment_providers),
        payment_sessions: yield* empty(payment_sessions), payments: yield* empty(payments) };
    });
    const decodePaymentOutput = (input: unknown): Result.Result<JsonObject, ReturnType<typeof commerceError>> => Result.gen(function* () {
      const value = yield* object(input), { captures, refunds, payment_session, payment_collection, ...scalar } = value;
      const row = yield* decodePayment(scalar);
      for (const [children, decode] of [[captures, decodeCapture], [refunds, decodeRefund]] as const) if (children !== undefined) {
        if (!Array.isArray(children) || children.length > 4) return yield* Result.fail(commerceError("storedCorruption"));
        for (const child of children) if ((yield* decode(child)).payment_id !== row.id) return yield* Result.fail(commerceError("storedCorruption"));
      }
      if (payment_session !== undefined && payment_session !== null && (yield* decodeSession(payment_session)).id !== row.payment_session_id)
        return yield* Result.fail(commerceError("storedCorruption"));
      if (payment_collection !== undefined && payment_collection !== null && (yield* decodeCollection(payment_collection)).id !== row.payment_collection_id)
        return yield* Result.fail(commerceError("storedCorruption"));
      return value;
    });
    const decodeSessionOutput = (input: unknown) => Result.gen(function* () {
      const value = yield* object(input), { payment, payment_collection, ...scalar } = value;
      const row = yield* decodeSession(scalar);
      if (payment !== undefined && payment !== null && (yield* decodePaymentOutput(payment)).payment_session_id !== row.id)
        return yield* Result.fail(commerceError("storedCorruption"));
      if (payment_collection !== undefined && payment_collection !== null && (yield* decodeCollection(payment_collection)).id !== row.payment_collection_id)
        return yield* Result.fail(commerceError("storedCorruption"));
      return value;
    });
    const collectionNumbers = collection.columns.filter(column => column.type === "bigNumber"), sessionNumbers = session.columns.filter(column => column.type === "bigNumber");
    const paymentNumbers = payment.columns.filter(column => column.type === "bigNumber"), captureNumbers = capture.columns.filter(column => column.type === "bigNumber"),
      refundNumbers = refund.columns.filter(column => column.type === "bigNumber");
    const presentChildren = Effect.fn("Payment.presentChildren")(function* (input: Json, kind: "capture" | "refund") {
      const rows: JsonObject[] = [];
      if (!Array.isArray(input)) return yield* Effect.fail(commerceError("storedCorruption"));
      for (const value of input) {
        const row = yield* Effect.fromResult(object(value));
        yield* Effect.fromResult((kind === "capture" ? captureProjection : refundProjection)(row));
        const result = yield* projectExactNumericColumns(row, kind === "capture" ? captureNumbers : refundNumbers, "reserialize");
        if (!isJsonObject(result)) return yield* Effect.fail(commerceError("storedCorruption"));
        rows.push(result);
      }
      return rows;
    });
    const presentPayment = Effect.fn("Payment.presentPayment")(function* (value: Json): Effect.fn.Return<JsonObject, ReturnType<typeof commerceError>> {
      const row = yield* Effect.fromResult(object(value)), { captures, refunds, payment_session, payment_collection, ...scalar } = row;
      yield* Effect.fromResult(paymentProjection(scalar));
      const result = yield* projectExactNumericColumns(scalar, paymentNumbers, "reserialize");
      if (!isJsonObject(result)) return yield* Effect.fail(commerceError("storedCorruption"));
      return { ...result, ...(captures === undefined ? {} : { captures: yield* presentChildren(captures, "capture") }),
        ...(refunds === undefined ? {} : { refunds: yield* presentChildren(refunds, "refund") }),
        ...(payment_session === undefined ? {} : { payment_session: payment_session === null ? null : yield* present(payment_session, session.name) }),
        ...(payment_collection === undefined ? {} : { payment_collection: payment_collection === null ? null : yield* present(payment_collection, collection.name) }) };
    });
    const present = Effect.fn("Payment.present")(function* (input: Json, table?: string): Effect.fn.Return<Json, ReturnType<typeof commerceError>> {
      const rows: JsonObject[] = [];
      for (const value of Array.isArray(input) ? input : [input]) {
        const row = yield* Effect.fromResult(object(value));
        if (table === holder.name) {
          yield* Effect.fromResult(holderProjection(row)); rows.push(row);
        } else if (table === reason.name) {
          yield* Effect.fromResult(reasonProjection(row)); rows.push(row);
        } else if (table === payment.name || table === undefined && "payment_session_id" in row) {
          rows.push(yield* presentPayment(row));
        } else if (table === session.name || table === undefined && "provider_id" in row) {
          const { payment_collection, payment, ...scalar } = row;
          yield* Effect.fromResult(sessionProjection(scalar));
          const result = yield* projectExactNumericColumns(scalar, sessionNumbers, "reserialize");
          if (!isJsonObject(result)) return yield* Effect.fail(commerceError("storedCorruption"));
          rows.push({ ...result, ...(payment_collection === undefined ? {} : { payment_collection: payment_collection === null ? null : yield* present(payment_collection, collection.name) }),
            ...(payment === undefined ? {} : { payment: payment === null ? null : yield* presentPayment(payment) }) });
        } else {
          const { payment_sessions, payment_providers, payments, ...scalar } = row;
          yield* Effect.fromResult(collectionProjection(scalar));
          const result = yield* projectExactNumericColumns(scalar, collectionNumbers, "reserialize");
          if (!isJsonObject(result)) return yield* Effect.fail(commerceError("storedCorruption"));
          rows.push({ ...result, ...(payment_sessions === undefined ? {} : { payment_sessions: yield* present(payment_sessions, session.name) }),
            ...(payment_providers === undefined ? {} : { payment_providers }), ...(payments === undefined ? {} : { payments: yield* Effect.gen(function* () {
              if (!Array.isArray(payments)) return yield* Effect.fail(commerceError("storedCorruption"));
              const children: JsonObject[] = []; for (const payment of payments) children.push(yield* presentPayment(payment)); return children;
            }) }) });
        }
      }
      return Array.isArray(input) ? rows : rows[0]!;
    });
    return { collection, session, payment, capture, refund, reason, holder, collectionNumbers, sessionNumbers, paymentNumbers, captureNumbers, refundNumbers,
      decodeCollection, decodeCreatedCollection, decodeSession, decodePayment, decodeCapture, decodeRefund, decodeReason, decodeHolder, present, presentPayment,
      decodePaymentOutput, decodeSessionOutput,
      tables: metadata.tables };
  });
}
