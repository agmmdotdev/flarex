import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { hasChangedFields } from "@medusajs/drizzle/mutation-plan";
import { commerceDecoder } from "../../value/decoder";
import { projectNativeRow } from "../../repository/result";
import { replaceGraphRows } from "../../write/replace";
import type { GraphCatalog, ReplacementProfile } from "../../write/graph-model";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import { compileFulfillmentShipmentContracts, FulfillmentShipmentLabel, FulfillmentShipmentUpdate, FulfillmentDeliveryUpdate, decodeFulfillmentShipmentUpdate } from "./fulfillment-shipment-input";
import { FulfillmentCreationId, type compileFulfillmentCreationContracts } from "./fulfillment-create-input";
import { prepareFulfillmentShipmentQuery } from "./fulfillment-shipment-query";

type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentCreationContracts>>;
const rootInput = commerceDecoder(Schema.Struct({ id: FulfillmentCreationId, shipped_at: Schema.optionalKey(FulfillmentShipmentUpdate.fields.shipped_at),
  delivered_at: Schema.optionalKey(FulfillmentDeliveryUpdate.fields.delivered_at),
  marked_shipped_by: FulfillmentShipmentUpdate.fields.marked_shipped_by, labels: FulfillmentShipmentUpdate.fields.labels }), "invalidInput");
const childInput = commerceDecoder(FulfillmentShipmentLabel, "invalidInput");

/** The genuine module already performed Label normalization and internal
 * hydration. This owner translates its checked DAL pair to shared graph writes. */
export function prepareFulfillmentShipmentRepository(contracts: Contracts) {
  return Result.gen(function* () {
    const values = yield* compileFulfillmentShipmentContracts(contracts), reads = yield* prepareFulfillmentShipmentQuery(contracts);
    const entity = (value: Contracts["fulfillment"]) => ({ table: value.table, model: value.model, keyColumn: "id",
      prefix: value.table.columns.find(column => column.name === "id")?.options?.prefix });
    const fulfillment = entity(contracts.fulfillment), label = entity(contracts.label), item = entity(contracts.item);
    const catalog: GraphCatalog = { entities: [fulfillment, label, item], tables: contracts.tables, writablePivots: [], queryRelations: contracts.queryRelations,
      decodeRow: (target, input) => Result.gen(function* () {
        const row = target === fulfillment ? yield* rootInput(input) : target === label ? yield* childInput(input)
          : yield* Result.fail(commerceError("unsupportedProfile"));
        return { supplied: row, key: row.id };
      }), decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
    const profile: ReplacementProfile = { catalog, operation: "update", ordering: reads.ordering, emptyCollections: "replace", replacementMembers: "active", allowReconstitution: true,
      allowedRelations: target => target === fulfillment ? ["labels"] : [], ownedToOne: () => [], mutableForeignKeys: () => false,
      admitSelection: (table, rows) => reads.admitSelection(table.name, rows), prepareProjection: () => Effect.void,
      toManyMode: (target, name, child) => target === fulfillment && name === "labels" && child === label ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: () => ["items", "labels"],
      project: rows => Result.succeed(new Map([...rows].map(([table, members]) => [table, members.filter(row => row.deleted_at === null)]))) };
    const update = Effect.fn("FulfillmentShipment.update")(function* (ctx: CommerceCommandContext, pair: { readonly entity: JsonObject; readonly update: JsonObject },
      events: ReturnType<typeof commerceMutationEvents>, shared: Parameters<DAL.RepositoryService["update"]>[1]) {
      if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      const before = yield* Effect.fromResult(contracts.decodeOutput(pair.entity)), { id, ...raw } = pair.update;
      if (typeof id !== "string" || id !== before.id) return yield* ctx.refuse(commerceError("invalidInput"));
      const request = yield* Effect.fromResult(decodeFulfillmentShipmentUpdate(raw));
      const labels = "labels" in request ? request.labels : undefined;
      // Native ORM dirty tracking omits equal scalar assignments. Labels have
      // their own shared child dirty tracking and native event contribution.
      const scalar = Object.fromEntries(Object.entries(request).filter(([name, value]) => name !== "labels" && hasChangedFields(before, { [name]: value }, [])));
      const input = { id, ...scalar, ...(labels == null ? {} : { labels }) };
      const replaced = yield* replaceGraphRows(ctx, profile, fulfillment, [input], { relations: labels == null ? [] : ["labels"] });
      const root = replaced.entities[0];
      if (root === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
      for (const [action, event] of [["created", "afterCreate"], ["updated", "afterUpdate"], ["deleted", "afterDelete"]] as const) {
        if (action === "updated") yield* events.rows(event, "Fulfillment", (replaced.performedActions.updated.Fulfillment ?? []).map(projectNativeRow), shared);
        yield* events.rows(event, "FulfillmentLabel", (replaced.performedActions[action].FulfillmentLabel ?? []).map(projectNativeRow), shared);
      }
      const result = contracts.initializeRead(root, before, "assigned");
      if (labels != null && Array.isArray(result.labels)) {
        const created = [...replaced.performedActions.created.FulfillmentLabel ?? []];
        const rows = new Map(result.labels.filter((row): row is JsonObject => row !== null && typeof row === "object" && !Array.isArray(row)).map(row => [row.id, row]));
        const ordered: JsonObject[] = [];
        for (const labelRequest of labels) {
          const id = labelRequest.id ?? created.shift()?.id, row = rows.get(id);
          if (row === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          ordered.push(row);
        }
        return [{ ...result, labels: ordered }];
      }
      return [result];
    });
    return { values, reads, graph: { catalog, profile, fulfillment, label, item }, update };
  });
}
