import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { jsonEqual } from "flarex-protocol/json";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { bindCommerceRelationRows } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { captureNativeRecord } from "../../value/native-record";
import { captureExactNumericRow, decodeExactNumeric, encodeExactNumeric, ExactNumericRaw } from "../../value/exact-numeric";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { projectNativeRow } from "../../repository/result";
import { preparePromotionComputeRead } from "./compute-read";
import type { capturePromotionMetadata } from "./schema";
import type { PromotionUsageTable } from "./usage-query";

const nativeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)));
const id = commerceDecoder(ScalarId, "unsupportedProfile");
const rawNumber = commerceDecoder(ExactNumericRaw, "storedCorruption");
const deletion = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: ScalarId })).check(Schema.isLengthBetween(1, 4)) }), "unsupportedProfile");
const creation = commerceDecoder(Schema.Struct({ budget_id: ScalarId, attribute_value: Schema.String,
  used: Schema.Union([Schema.String, Schema.Number]), raw_used: Schema.JsonObject }), "unsupportedProfile");

/** One native same-manager usage profile. Medusa retains every limit, budget,
 * deduplication and inverse decision; this port admits only its scalar writes. */
export function preparePromotionUsageRepository(metadata: Effect.Success<ReturnType<typeof capturePromotionMetadata>>["frame"]) {
  return Result.gen(function* () {
    const read = yield* preparePromotionComputeRead(metadata, "usage");
    const entities = yield* Result.all((["promotion", "promotion_campaign_budget", "promotion_campaign_budget_usage"] as const).map(name => Result.gen(function* () {
      const entity = read.entities.find(entity => entity.table.name === name);
      if (entity === undefined || entity.primary.length !== 1 || entity.primary[0] !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      const model = name === "promotion" ? "Promotion" : name === "promotion_campaign_budget" ? "CampaignBudget" : "CampaignBudgetUsage";
      return { ...entity, name, model, numbers: entity.table.columns.filter(column => column.type === "bigNumber"),
        scalar: yield* prepareScalarRepository(entity.table, model, scalarIdWhere),
        projection: commerceRowDecoder(entity.table.columns.map(column => column.name), "unsupportedProfile") };
    })));
    const promotion = entities.find(entity => entity.name === "promotion");
    const campaign = promotion?.table.relationships.find(relation => relation.name === "campaign");
    const campaignKeys = promotion?.table.foreignKeys.filter(key => key.referencedTable === campaign?.targetTable);
    const campaignColumn = campaignKeys?.[0]?.columns[0];
    if (promotion === undefined || campaign?.type !== "belongsTo" || campaign.targetTable !== "promotion_campaign" ||
      campaignKeys?.length !== 1 || campaignKeys[0]?.columns.length !== 1 || campaignKeys[0]?.referencedColumns.length !== 1 ||
      campaignKeys[0]?.referencedColumns[0] !== "id" || campaignColumn === undefined ||
      !promotion.table.columns.some(column => column.name === campaignColumn && column.nullable))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const entityFor = (table: PromotionUsageTable) => entities.find(entity => entity.name === table);
    const internalRows = Effect.fn("PromotionUsage.internalRows")(function* (input: Json, table: PromotionUsageTable) {
      const rows = yield* read.internal(input, table);
      if (!Array.isArray(rows)) return yield* Effect.fail(commerceError("storedCorruption"));
      return rows;
    });
    const captureEntity = Effect.fn("PromotionUsage.captureEntity")(function* (table: PromotionUsageTable, input: unknown) {
      const entity = entityFor(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const row = yield* captureNativeRecord(input);
      // Native DAL projection presents an absent nullable belongsTo relation as
      // null even without population. It carries no stored scalar or mutation.
      // Every other relation value still reaches the strict complete-row codec.
      if (table === "promotion" && row[campaign.name] === null && row[campaignColumn] === null) delete row[campaign.name];
      for (const column of entity.numbers) {
        const raw = row["raw_" + column.name];
        if (column.nullable && row[column.name] === null && raw === null) continue;
        const encoded = yield* encodeExactNumeric(row[column.name]);
        yield* decodeExactNumeric(encoded.value, raw, column.nullable);
        row[column.name] = (yield* Effect.fromResult(rawNumber(raw))).value;
      }
      return yield* Effect.fromResult(captureCommerceInput(row).pipe(Result.flatMap(entity.complete)));
    });
    const captureUpdates = Effect.fn("PromotionUsage.captureUpdates")(function* (table: PromotionUsageTable, input: unknown) {
      const entity = entityFor(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const pairs = [], seen = new Set<string>();
      for (const value of yield* nativeRows(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
        const pair = yield* captureNativeRecord(value), before = yield* captureEntity(table, pair.entity), update = yield* captureNativeRecord(pair.update);
        const key = yield* Effect.fromResult(id(before.id));
        if (seen.has(key)) return yield* Effect.fail(commerceError("unsupportedProfile"));
        seen.add(key);
        // Native registerUsage may submit its complete hydrated Budget. Its
        // stale raw companions and unchanged scalar fields are authenticated
        // against the selected preimage, then only used is persisted.
        for (const column of entity.numbers) {
          const raw = "raw_" + column.name;
          if (Object.hasOwn(update, raw)) {
            const supplied = yield* Effect.fromResult(captureCommerceInput(update[raw]));
            if (!jsonEqual(supplied, before[raw] ?? null)) return yield* Effect.fail(commerceError("unsupportedProfile"));
            delete update[raw];
          }
          if (column.name !== "used" && Object.hasOwn(update, column.name)) {
            if (!(column.nullable && update[column.name] === null && before[raw] === null))
              yield* decodeExactNumeric((yield* encodeExactNumeric(update[column.name])).value, before[raw], column.nullable);
            delete update[column.name];
          }
        }
        const encoded = yield* captureExactNumericRow(update, entity.numbers), patch = yield* Effect.fromResult(entity.projection(encoded));
        const used = patch.used;
        if (patch.id !== key || used === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        for (const [name, value] of Object.entries(patch)) if (!["used", "raw_used"].includes(name) && !jsonEqual(value ?? null, before[name] ?? null))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        const fields: Record<string, Json> = { id: key, used };
        if (entity.numbers.some(column => column.name === "used")) {
          if (patch.raw_used === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
          fields.raw_used = patch.raw_used;
        }
        pairs.push({ before, patch: fields });
      }
      return pairs;
    });
    const captureCreates = Effect.fn("PromotionUsage.captureCreates")(function* (input: unknown) {
      const entity = entityFor("promotion_campaign_budget_usage");
      if (entity === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const rows = [];
      for (const value of yield* nativeRows(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause))))
        rows.push(yield* Effect.fromResult(creation(yield* captureExactNumericRow(value, entity.numbers))));
      return rows;
    });
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const first = entities[0];
      if (first === undefined) return owner.reject(commerceError("unsupportedProfile"));
      const root = first.scalar.bind(ctx, owner), { bridge, events } = root;
      const bound = new Map(entities.map(entity => [entity.name, entity.scalar.bind(ctx, owner, events, bridge)]));
      const denied = deniedCommerceRepository(root.repository, root.refuse), issued = new WeakSet<object>();
      const find = (table: PromotionUsageTable, input: unknown, shared: Parameters<DAL.RepositoryService["find"]>[1]) =>
        bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
          const selected = yield* read.read(bindCommerceRelationRows({ ...current, admitSelection: read.admitSelection }, { includeIdentities: true }), table, captured);
          const rows = yield* read.internal(selected.rows, table);
          if (!Array.isArray(rows)) return yield* current.refuse(commerceError("storedCorruption"));
          issued.add(rows); return { rows, count: selected.count, graph: selected.parsed.graph };
        })), (_current, value) => read.captureQuery(value));
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(value: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(bridge.current(), Effect.gen(function* () {
          if (options !== undefined || value === null || typeof value !== "object" || !issued.has(value)) return yield* ctx.refuse(commerceError("storedCorruption"));
          // SAFETY: the native DTO generic follows metadata-checked entities.
          return (yield* Effect.fromResult(captureNativeNumericDto(value))) as Output;
        })));
      const repository = (table: PromotionUsageTable): DAL.RepositoryService => {
        const entity = entityFor(table), scalar = bound.get(table);
        if (entity === undefined || scalar === undefined) return denied;
        return { ...denied, serialize,
          find: async (input, shared) => (await find(table, input, shared)).rows,
          findAndCount: async (input, shared) => { const value = await find(table, input, shared); if (!value.graph) return root.refuse(); return [value.rows, value.count]; },
          update: (input, shared) => bridge.execute(shared, current => bridge.checked(current, Effect.gen(function* () {
            const pairs = yield* captureUpdates(table, input);
            const rows = yield* (yield* current.table(table)).write(current.manager, "update", pairs.map(pair => pair.patch));
            for (const row of rows) yield* Effect.fromResult(entity.complete(projectNativeRow(row)));
            if (shared === undefined || !events.isSubscribed(shared)) return yield* current.refuse(commerceError("unadmittedEvent"));
            yield* events.rows("afterUpdate", entity.model, [...rows], shared);
            return yield* internalRows([...rows], table);
          }))),
          ...(table === "promotion_campaign_budget_usage" ? {
            create: ((input, shared) => bridge.execute(shared, current => bridge.checked(current, Effect.gen(function* () {
              const values = yield* captureCreates(input), rows = yield* scalar.createRows(current, values, shared);
              for (const row of rows) yield* Effect.fromResult(entity.complete(projectNativeRow(row)));
              return yield* internalRows(rows, table);
            })))) satisfies DAL.RepositoryService["create"],
            delete: ((input, shared) => bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
              const selection = yield* Effect.fromResult(deletion(captured));
              const rows = yield* (yield* current.table(table)).delete(current.manager, selection.$or);
              const ids = []; for (const row of rows) { yield* Effect.fromResult(entity.complete(projectNativeRow(row))); ids.push(yield* Effect.fromResult(id(row.id))); }
              return ids;
            })))) satisfies DAL.RepositoryService["delete"],
          } : {}),
        };
      };
      return { ...root, denied, serialize, promotionRepository: repository("promotion"), budgetRepository: repository("promotion_campaign_budget"),
        usageRepository: repository("promotion_campaign_budget_usage") };
    };
    return { read, entities, captureEntity, captureUpdates, captureCreates, internalRows, deletion, bind };
  });
}
