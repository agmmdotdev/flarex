import { Effect } from "effect";
import { Notification, NotificationProvider } from "@medusajs/notification/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

/** Compile the genuine two-model closure. Array representation/defaults remain
 * with the shared DML and relational schema owners, including channels=[]. */
export const captureNotificationMetadata = Effect.fn("Notification.captureMetadata")(function* () {
  const source = yield* Effect.try({
    try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([Notification, NotificationProvider]))),
    catch: cause => commerceError("unsupportedProfile", cause),
  });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  if (compiled.tables.length !== 2 || ["notification", "notification_provider"].some(name =>
    compiled.tables.filter(table => table.name === name).length !== 1))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => commerceError("unsupportedProfile"), hashFailure: cause => commerceError("unsupportedProfile", cause),
  });
});

export const notificationSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/notification/src/models/notification.ts",
    "packages/modules/notification/src/models/notification-provider.ts", "packages/database/drizzle/src/schema.ts"]),
} as const);

export const compileNotificationDefinition = Effect.fn("Notification.compileDefinition")(function* () {
  const metadata = yield* captureNotificationMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.notification")));
  return Object.freeze({ schema, provenance: notificationSourceProvenance });
});
