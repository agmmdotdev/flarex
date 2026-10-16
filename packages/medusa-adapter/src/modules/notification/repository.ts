import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import type { WherePolicy, ScalarFilter } from "../../query/predicate";
import { compileKeyedUpdates } from "../../write/keyed";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { SchemaTable } from "../../schema/model";
import { compileNotificationPhaseContracts, NotificationTerminalUpdate } from "./contracts";

const pairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(1)), "unsupportedProfile");
const id = commerceDecoder(ScalarId, "storedCorruption");
const terminal = commerceDecoder(NotificationTerminalUpdate, "unsupportedProfile");
const notificationWhere: WherePolicy = { ...scalarIdWhere, fields: new Map<string, ScalarFilter>([
  ...scalarIdWhere.fields,
  // No idempotency key is admitted. The native empty membership lookup still
  // traverses its real query owner and contributes its actual read evidence.
  ["idempotency_key", { column: "idempotency_key", decode: commerceDecoder(Schema.Array(Schema.String).check(Schema.isMaxLength(0)), "unsupportedProfile") }],
]) };
const providerWhere: WherePolicy = { ...scalarIdWhere, fields: new Map<string, ScalarFilter>([
  ...scalarIdWhere.fields,
  ["is_enabled", { column: "is_enabled", decode: commerceDecoder(Schema.Literal(true), "unsupportedProfile") }],
]) };

/** Two genuine DML models over existing scalar/read/keyed-update mechanics.
 * Provider registration is explicit setup; sends never repair configuration. */
export function prepareNotificationRepository(notification: SchemaTable, provider: SchemaTable, providerRegistration = false) {
  return Result.gen(function* () {
    const contracts = yield* compileNotificationPhaseContracts(notification, provider);
    const notifications = yield* prepareScalarRepository(notification, "Notification", notificationWhere);
    const providers = yield* prepareScalarRepository(provider, "NotificationProvider", providerWhere);
    if (!notification.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "provider_id" &&
      key.referencedTable === provider.name && key.referencedColumns[0] === "id")) return yield* Result.fail(commerceError("unsupportedProfile"));
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: pairs,
      readEntry: pair => Result.gen(function* () {
        yield* contracts.decodeCompleteNotification(pair.entity);
        const key = yield* id(pair.entity.id);
        const data = yield* terminal(pair.update);
        return { key, update: data };
      }) });
    const bind = (...args: Parameters<typeof notifications.bind>) => {
      const bound = notifications.bind(...args);
      const providerBound = providers.bind(args[0], args[1], bound.events);
      const repository: DAL.RepositoryService = { ...bound.repository,
        findAndCount: bound.refuse,
        update: (input, shared) => bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(updates(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          const table = yield* ctx.table(notification.name);
          const changed = yield* table.write(ctx.manager, "update", rows);
          for (const row of changed) yield* Effect.fromResult(contracts.decodeCompleteNotification(row));
          if (shared === undefined || !bound.events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* bound.events.rows("afterUpdate", "Notification", changed.map(row => ({ ...row })), shared);
          return [...changed];
        }))),
      };
      const providerRepository: DAL.RepositoryService = { ...providerBound.repository,
        create: providerRegistration ? providerBound.repository.create : providerBound.refuse, findAndCount: providerBound.refuse,
        // Genuine NotificationProviderService.getProviderForChannels calls its
        // repository directly without a context. Borrow the notification
        // preparation's current child; never select the idle outer manager.
        find: (input, shared) => args[1].run(Effect.gen(function* () {
          const ctx = bound.bridge.current();
          if (shared !== undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          return yield* bound.bridge.checked(ctx, Effect.gen(function* () {
            const rows = (yield* providerBound.find(ctx, input, false)).rows;
            if (rows.length > 1) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            for (const row of rows) {
              yield* Effect.fromResult(contracts.decodeCompleteProvider(row));
              if (row.id !== "local" || row.handle !== "local" || row.name !== "local" ||
                !Array.isArray(row.channels) || row.channels.some(channel => channel !== "feed") || row.channels.length > 1)
                return yield* ctx.refuse(commerceError("unsupportedProfile"));
            }
            return structuredClone([...rows]);
          }));
        })),
      };
      return { ...bound, repository, providerRepository };
    };
    return { ...notifications, bind, contracts, providerTable: providers.table };
  });
}
