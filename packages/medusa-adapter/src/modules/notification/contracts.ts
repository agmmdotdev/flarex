import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { NotificationStatus } from "@medusajs/utils/notification/common";
import { jsonEqual } from "flarex-protocol/json";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";

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
export const LocalFeedDispatchData = Schema.Struct({ ...LocalFeedNotificationInput.fields,
  id: Id, provider_id: Schema.optionalKey(Schema.Literal("local")) });
export const NotificationTerminalUpdate = Schema.Struct({ ...LocalFeedDispatchData.fields,
  status: Schema.Literals([NotificationStatus.SUCCESS, NotificationStatus.FAILURE]), external_id: Schema.optionalKey(Schema.String) });
export const NotificationTerminalUpdates = Schema.Array(NotificationTerminalUpdate).check(Schema.isMaxLength(1));
export const decodeNotificationTerminalUpdates = commerceDecoder(NotificationTerminalUpdates, "invalidInput");
export const NotificationPhaseMessage = Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal("notification"), object: Schema.Literal("notification"),
    action: Schema.Literals(["created", "updated"]) }), data: Schema.Struct({ id: Id }),
});
export const NotificationPhaseMessages = Schema.Array(NotificationPhaseMessage).check(Schema.isMaxLength(1));

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
    const decodeCompleteNotification = yield* compileCompleteRow(notification);
    const decodeCompleteProvider = yield* compileCompleteRow(provider);
    const ProviderRow = Schema.StructWithRest(Schema.Struct({ id: Schema.Literal("local"), handle: Schema.Literal("local"),
      name: Schema.Literal("local"), is_enabled: Schema.Boolean, channels: Schema.Array(Schema.Literal("feed")).check(Schema.isMaxLength(1)),
    }), [Schema.Record(Schema.String, Schema.Json)]);
    const PendingRow = Schema.StructWithRest(Schema.Struct({ id: Id, to: Schema.String, channel: Schema.Literal("feed"),
      provider_id: Schema.NullOr(Schema.Literal("local")), status: Schema.Literal("pending"),
    }), [Schema.Record(Schema.String, Schema.Json)]);
    const Prepared = Schema.Struct({ notificationsToProcess: Schema.Array(Schema.Struct({ provider: Schema.optionalKey(ProviderRow), data: LocalFeedDispatchData })).check(Schema.isMaxLength(1)),
      createdNotifications: Schema.Array(PendingRow).check(Schema.isMaxLength(1)),
    });
    const decodePreparedShape = commerceDecoder(Prepared, "storedCorruption");
    const decodePrepared = (input: unknown) => decodePreparedShape(input).pipe(Result.flatMap(value => Result.gen(function* () {
      if (value.notificationsToProcess.length !== value.createdNotifications.length) return yield* Result.fail(commerceError("storedCorruption"));
      for (const [index, entry] of value.notificationsToProcess.entries()) {
        const row = value.createdNotifications[index];
        if (row === undefined || row.id !== entry.data.id || row.provider_id !== (entry.data.provider_id ?? null) ||
          entry.provider?.id !== entry.data.provider_id) return yield* Result.fail(commerceError("storedCorruption"));
        for (const [key, field] of Object.entries(entry.data)) {
          if (field !== undefined && (row[key] === undefined || !jsonEqual(row[key], field)))
            return yield* Result.fail(commerceError("storedCorruption"));
        }
        yield* decodeCompleteNotification(row);
        if (entry.provider !== undefined) yield* decodeCompleteProvider(entry.provider);
      }
      return value;
    })));
    const decodeRowArray = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }),
      [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(1)), "storedCorruption");
    const decodeRows = (input: unknown) => decodeRowArray(input)
      .pipe(Result.flatMap(rows => Result.gen(function* () { for (const row of rows) yield* decodeCompleteNotification(row); return rows; })));
    return { input: LocalFeedNotificationsInput, prepared: Prepared, decodeInput: decodeLocalFeedNotificationsInput,
      decodePrepared, decodeNotificationRow, decodeProviderRow, decodeCompleteNotification, decodeCompleteProvider, decodeRows,
      decodeDispatch: commerceDecoder(LocalFeedDispatchData, "storedCorruption"),
      decodeProvider: decodeNotificationLocalProvider };
  });
}
