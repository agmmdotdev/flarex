import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../module/promise-owner";
import type { decodeCompiledDml } from "../schema/compiled";
import { prepareScalarRepository } from "../repository/scalar";
import { scalarIdWhere } from "../repository/scalar-id-read";
import { commerceDecoder, commerceRowDecoder } from "../value/decoder";
import { compileRowProjection } from "../value/complete-row";
import { compileKeyedUpdates } from "../write/keyed";
import { captureCommerceInput } from "../value/input";

type Table = Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number];
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "invalidInput");
const decodeUpdates = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(256)), "invalidInput");

/** Selected native protocol models use normal scalar DAL mechanics. Replay,
 * revision comparison and compensation remain entirely in native Link code;
 * these records produce no independent business-module events. */
export function prepareLinkOperationRepository(table: Table, modelName: string) {
  return Result.gen(function* () {
    const mutable = table.name === "link_workflow_operation" ? ["state", "compensation_events"]
      : table.name === "link_pair_revision" ? ["revision"] : undefined;
    if (mutable === undefined || table.relationships.length !== 0 || table.foreignKeys.length !== 0 ||
      table.cascades.delete.length !== 0 || table.cascades.detach.length !== 0)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const scalar = yield* prepareScalarRepository(table, modelName, scalarIdWhere);
    const complete = yield* compileRowProjection(table);
    const create = commerceRowDecoder(table.columns.map(column => column.name)
      .filter(name => !["created_at", "updated_at", "deleted_at"].includes(name)), "invalidInput");
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodeUpdates,
      readEntry: pair => decodeId(pair.entity.id).pipe(Result.map(key => ({ key, update: pair.update }))),
      validateData: commerceRowDecoder(mutable, "invalidInput") });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound;
      const repository: DAL.RepositoryService = { ...bound.repository,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const rows: JsonObject[] = [];
          for (const row of yield* Effect.fromResult(decodeRows(captured))) {
            yield* Effect.fromResult(create(row));
            yield* Effect.fromResult(decodeId(row.id));
            rows.push({ ...row });
          }
          const store = yield* ctx.table(table.name);
          const inserted = yield* store.write(ctx.manager, "insert", rows);
          for (const row of inserted) yield* Effect.fromResult(complete(row));
          return structuredClone([...inserted]);
        }))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(updates)));
          const store = yield* ctx.table(table.name);
          const updated = yield* store.write(ctx.manager, "update", rows);
          for (const row of updated) yield* Effect.fromResult(complete(row));
          return structuredClone([...updated]);
        }))),
        delete: bound.refuse, softDelete: bound.refuse, restore: bound.refuse,
        upsert: bound.refuse, upsertWithReplace: bound.refuse,
      };
      return repository;
    };
    return { table, bind };
  });
}
