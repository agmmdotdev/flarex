import { Effect, Result, Schema } from "effect";
import { LinkPreimageRowSchema, type LinkPreimageStorage } from "@medusajs/link-modules";
import { requireAtomicCommerceScopeExclusion } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { commerceRepositoryContext } from "../repository/context";
import type { captureLinkMetadata } from "./schema";
import { readCommerceRelationRows } from "../query/relations";
import { commerceDecoder } from "../value/decoder";

const decodeRows = commerceDecoder(Schema.Array(LinkPreimageRowSchema), "storedCorruption");
type Row = typeof LinkPreimageRowSchema.Type;
type Metadata = Effect.Success<ReturnType<typeof captureLinkMetadata>>["frame"];

/** Adapt the native exact-row protocol to existing logical scope exclusion
 * and authenticated recorded-row replay. Native Link owns all generations,
 * decisions and events; this port owns neither SQL nor a transaction. */
export function prepareLinkPreimageStorage(table: Metadata, primary: string, foreign: string) {
  return Result.gen(function* () {
    const expected = ["id", primary, foreign, "created_at", "updated_at", "deleted_at"];
    if (new Set(expected).size !== 6 || table.columns.length !== 6 || table.columns.some(column => !expected.includes(column.name)) ||
      table.columns.filter(column => column.primaryKey).map(column => column.name).join(",") !== [primary, foreign].join(","))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const normalize = (rows: readonly JsonObject[]) => decodeRows(rows.map(row => ({ id: row.id, primary: row[primary], foreign: row[foreign],
      created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at })));
    const bind = (bridge: ReturnType<typeof commerceRepositoryContext>): LinkPreimageStorage => {
      const require = (shared: Parameters<LinkPreimageStorage["require"]>[0]) => bridge.execute(shared, ctx =>
        bridge.checked(ctx, requireAtomicCommerceScopeExclusion(ctx)));
      return {
        require,
        capture: (pairs, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          yield* requireAtomicCommerceScopeExclusion(ctx);
          if (!pairs.length) return [];
          const rows = yield* readCommerceRelationRows(ctx, table.name, { kind: "or", children: pairs.map(pair => ({ kind: "and", children: [
            { kind: "in", column: primary, values: [pair.primary] }, { kind: "in", column: foreign, values: [pair.foreign] },
          ] })) }, primary);
          return yield* Effect.fromResult(normalize(rows));
        }))),
        restore: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          yield* requireAtomicCommerceScopeExclusion(ctx);
          const rows: readonly Row[] = yield* Effect.fromResult(decodeRows(captured));
          const replay = (yield* ctx.table(table.name)).replay;
          if (replay === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          return yield* Effect.fromResult(normalize(yield* replay(ctx.manager, rows.map(row => ({ id: row.id,
            [primary]: row.primary, [foreign]: row.foreign, created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at })))));
        }))),
      };
    };
    return { bind };
  });
}
