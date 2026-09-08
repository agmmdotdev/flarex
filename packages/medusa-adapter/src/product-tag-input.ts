import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata } from "./product-runtime-metadata";

const managed = ["created_at", "updated_at", "deleted_at"] as const;

/** A returned DTO may echo managed columns, but only the scoped stored row
 * authenticates them. The unchanged service receives writable input afterward. */
export const captureProductTagUpsert = Effect.fn("ProductAdapter.captureTagUpsert")(function* (
  ctx: CommerceCommandContext, tag: ProductEntityMetadata, input: Json,
) {
  const members = Array.isArray(input) ? input : [input];
  if (members.length > 256) return yield* ctx.refuse(commerceError("limitExceeded"));
  const echoes: string[] = [];
  for (const row of members) {
    if (!isJsonObject(row)) return yield* ctx.refuse(commerceError("invalidInput"));
    if (!managed.some(name => row[name] !== undefined)) continue;
    if (typeof row.id !== "string" || row.id.length === 0 || !managed.every(name => row[name] !== undefined)) {
      return yield* ctx.refuse(commerceError("invalidInput"));
    }
    echoes.push(row.id);
  }
  if (echoes.length === 0) return input;
  const store = yield* ctx.table(tag.table.name);
  const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: "id", direction: "asc" },
    predicate: { kind: "in", column: "id", values: [...new Set(echoes)] },
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  const captured: Json[] = [];
  for (const row of members) {
    if (!isJsonObject(row)) return yield* ctx.refuse(commerceError("invalidInput"));
    if (!managed.some(name => row[name] !== undefined)) { captured.push(row); continue; }
    const stored = byId.get(row.id);
    if (stored === undefined || managed.some(name => row[name] !== stored[name])) return yield* ctx.refuse(commerceError("invalidInput"));
    const { created_at: _created, updated_at: _updated, deleted_at: _deleted, ...writable } = row;
    captured.push(writable);
  }
  if (Array.isArray(input)) return captured;
  const single = captured[0];
  if (single === undefined) return yield* Effect.die(new Error("Missing captured Tag input"));
  return single;
});
