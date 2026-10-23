import { Effect } from "effect";
import { AccountHolder, Capture, Payment, PaymentCollection, PaymentProvider, PaymentSession, Refund, RefundReason } from "@medusajs/payment/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

/** Complete native Payment metadata, including unselected lifecycle models and
 * the implicit Collection/Provider pivot. Selection grants no CRUD authority. */
export const paymentModels = [PaymentCollection, PaymentSession, Payment, Capture, Refund, RefundReason, AccountHolder, PaymentProvider] as const;

export const capturePaymentMetadata = Effect.fn("Payment.captureMetadata")(function* () {
  const source = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([...paymentModels]))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const names = ["payment_collection", "payment_session", "payment", "capture", "refund", "refund_reason", "account_holder", "payment_provider", "payment_collection_payment_providers"];
  if (compiled.tables.length !== names.length || names.some(name => compiled.tables.filter(table => table.name === name).length !== 1) ||
    compiled.tables.some(table => table.foreignKeys.some(key => !names.includes(key.referencedTable))))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});

export const paymentSourceProvenance = Object.freeze({ kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f", paths: Object.freeze([
    "packages/modules/payment/src/models/payment-collection.ts", "packages/modules/payment/src/models/payment-session.ts",
    "packages/modules/payment/src/models/payment.ts", "packages/modules/payment/src/models/capture.ts", "packages/modules/payment/src/models/refund.ts",
    "packages/modules/payment/src/models/refund-reason.ts", "packages/modules/payment/src/models/account-holder.ts",
    "packages/modules/payment/src/models/payment-provider.ts", "packages/database/drizzle/src/schema.ts",
  ]) } as const);

export const compilePaymentDefinition = Effect.fn("Payment.compileDefinition")(function* () {
  const metadata = yield* capturePaymentMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.payment")));
  return Object.freeze({ schema, provenance: paymentSourceProvenance });
});
