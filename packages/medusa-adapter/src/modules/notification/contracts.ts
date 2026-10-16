import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** This import-connected profile admits the native local feed only. It supplies
 * no key or caller-selected identity; durable occurrence identity is separate. */
export const LocalFeedNotificationInput = Schema.Struct({
  to: Schema.String,
  channel: Schema.Literal("feed"),
  template: Schema.Literal("admin-ui"),
  data: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  trigger_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  resource_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  resource_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  receiver_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  original_notification_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export const LocalFeedNotificationsInput = Schema.Union([
  LocalFeedNotificationInput, Schema.Array(LocalFeedNotificationInput).check(Schema.isMaxLength(1)),
]);
export const decodeLocalFeedNotificationsInput = commerceDecoder(LocalFeedNotificationsInput, "invalidInput");
export const NotificationLocalProvider = Schema.Struct({ id: Schema.Literal("local"), handle: Schema.Literal("local"),
  name: Schema.Literal("local"), is_enabled: Schema.Literal(true), channels: Schema.Tuple([Schema.Literal("feed")]),
});
export const decodeNotificationLocalProvider = commerceDecoder(NotificationLocalProvider, "unsupportedProfile");

/** Column names come from the admitted DML. Persistence retains scalar value,
 * default, lifecycle, FK and uniqueness enforcement; phase schemas own only
 * this explicit local-feed envelope and native generated dispatch identities. */
export function compileNotificationPhaseContracts(notification: SchemaTable, provider: SchemaTable) {
  return Result.gen(function* () {
    if (notification.name !== "notification" || provider.name !== "notification_provider" ||
      Object.keys(LocalFeedNotificationInput.fields).some(name => !notification.columns.some(column => column.name === name)) ||
      Object.keys(NotificationLocalProvider.fields).some(name => !provider.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeNotificationRow = commerceRowDecoder(notification.columns.map(column => column.name), "storedCorruption");
    const providerRow = commerceRowDecoder(provider.columns.map(column => column.name), "storedCorruption");
    const arrayFields = provider.columns.filter(column => column.type === "array").map(column => column.name);
    const decodeProviderArrays = commerceDecoder(Schema.StructWithRest(
      Schema.Record(Schema.Literals(arrayFields), Schema.Array(Schema.String)), [Schema.Record(Schema.String, Schema.Json)],
    ), "storedCorruption");
    const decodeProviderRow = (input: unknown) => providerRow(input).pipe(Result.flatMap(decodeProviderArrays));
    const PreparedData = Schema.Struct({ ...LocalFeedNotificationInput.fields, id: Id, provider_id: Schema.Literal("local") });
    const ProviderRow = Schema.StructWithRest(NotificationLocalProvider, [Schema.Record(Schema.String, Schema.Json)]);
    const PendingRow = Schema.StructWithRest(Schema.Struct({ id: Id, to: Schema.String, channel: Schema.Literal("feed"),
      provider_id: Schema.Literal("local"), status: Schema.Literal("pending"),
    }), [Schema.Record(Schema.String, Schema.Json)]);
    const Prepared = Schema.Struct({ notificationsToProcess: Schema.Array(Schema.Struct({ provider: ProviderRow, data: PreparedData })).check(Schema.isMaxLength(1)),
      createdNotifications: Schema.Array(PendingRow).check(Schema.isMaxLength(1)),
    });
    return { input: LocalFeedNotificationsInput, prepared: Prepared, decodeInput: decodeLocalFeedNotificationsInput,
      decodePrepared: commerceDecoder(Prepared, "storedCorruption"), decodeNotificationRow, decodeProviderRow,
      decodeProvider: decodeNotificationLocalProvider };
  });
}
